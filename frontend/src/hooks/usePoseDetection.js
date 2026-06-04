import { useCallback, useEffect, useRef, useState } from 'react';
import { instance as api } from '../lib/api';
import { isLstmSupported } from '../constants/exerciseTypes';
import { supabase } from '../services/supabase';

/**
 * Hook to handle pose detection by communicating with the backend.
 *
 * Phase 2 architecture: a persistent WebSocket replaces the HTTP-per-frame
 * pattern. We open one /ws/pose connection per exercise (the JWT, exercise
 * type, and affected side are query params on the handshake URL), then
 * stream raw JPEG bytes over binary frames and receive JSON pose results
 * via the message handler. This removes ~80–150ms of per-frame HTTP +
 * base64 overhead that the old POST /pose/estimate path paid every cycle.
 *
 * The end-of-session LSTM call (classifyFormSequence) still uses HTTP
 * because it's one-shot and benefits from the standard auth interceptor.
 */

const usePoseDetection = () => {
  // UI states for loading and error handling
  const [isDetecting, setIsDetecting] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);

  // The live WebSocket and the registered result-callback. onResult is a
  // ref (not state) so the WS message handler doesn't capture a stale
  // closure when useCamera re-renders mid-exercise.
  const wsRef = useRef(null);
  const onResultRef = useRef(null);

  // Build the wss:// URL from the axios baseURL — same host as the HTTP
  // API, so dev/prod just works without an extra env var. URLSearchParams
  // handles the param escaping (token contains '.', '+', '/' that must
  // pass through unmodified for JWT validation to succeed).
  const buildWsUrl = useCallback((exerciseType, affectedSide, token) => {
    const httpBase = (api.defaults?.baseURL || '').replace(/\/$/, '');
    const wsBase = httpBase.replace(/^https?:/i, (scheme) =>
      scheme.toLowerCase() === 'https:' ? 'wss:' : 'ws:'
    );
    const params = new URLSearchParams({
      token,
      exercise_type: exerciseType || '',
      affected_side: affectedSide || 'right',
    });
    return `${wsBase}/ws/pose?${params.toString()}`;
  }, []);

  // Opens the realtime pose WebSocket. Resolves true on successful
  // handshake, false on auth/connection failure. The supplied onResult
  // callback is invoked once per server message with the decoded pose
  // payload — useCamera uses this to update skeleton state AND to
  // trigger the next frame capture (backpressure-driven loop).
  const startDetection = useCallback(async (exerciseType = '', affectedSide = 'right', onResult = null) => {
    onResultRef.current = onResult;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setModelError('Not authenticated — please log in again');
        setIsModelReady(false);
        setIsDetecting(false);
        return false;
      }

      const url = buildWsUrl(exerciseType, affectedSide, token);
      const ws = new WebSocket(url);
      // arraybuffer so future server→client binary messages (if we ever
      // send compressed pose deltas) come through as ArrayBuffer instead
      // of Blob. Current server only sends JSON text, so this is forward-
      // compatible rather than load-bearing.
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      // Wrap the open/error events in a promise so the caller can await
      // the handshake completing before kicking off the frame loop.
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };

        ws.onopen = () => {
          setIsDetecting(true);
          setIsModelReady(true);
          setModelError(null);
          finish(true);
        };
        ws.onerror = () => {
          setModelError('Pose tracking connection error');
          setIsModelReady(false);
          setIsDetecting(false);
          finish(false);
        };
        ws.onmessage = (event) => {
          try {
            const raw = typeof event.data === 'string'
              ? event.data
              : new TextDecoder().decode(event.data);
            const data = JSON.parse(raw);
            onResultRef.current?.(data);
          } catch (err) {
            console.log('[Pose WS] Failed to parse result:', err?.message || err);
          }
        };
        ws.onclose = (event) => {
          setIsDetecting(false);
          setIsModelReady(false);
          // 4401 = our app-defined "unauthorized" close code.
          if (event?.code === 4401) {
            setModelError('Pose tracking auth failed — please log in again');
          }
          // If we never opened (failed handshake), unblock the promise.
          finish(false);
        };
      });
    } catch (err) {
      setModelError(err?.message || 'Failed to open pose WebSocket');
      setIsModelReady(false);
      setIsDetecting(false);
      return false;
    }
  }, [buildWsUrl]);

  // Closes the pose WebSocket and clears the callback. Safe to call
  // multiple times — both unmount cleanup and the explicit stop path
  // route through here.
  const stopDetection = useCallback(() => {
    setIsDetecting(false);
    setIsModelReady(false);
    onResultRef.current = null;
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      try { ws.close(); } catch (_) { /* already closed */ }
    }
  }, []);

  // Convert a base64-encoded JPEG to an ArrayBuffer and send it over the
  // open WebSocket as a binary frame. Returns true when the frame was
  // queued for send, false when the socket isn't ready (caller can use
  // this to know whether backpressure was actually applied). Drops
  // silently on broken sockets — the watchdog in useCamera handles
  // recovery.
  const sendFrameBase64 = useCallback((base64) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !base64) return false;
    try {
      // atob is available globally in modern React Native / Expo SDK 49+.
      // We could use a fetch(file://photo.uri).arrayBuffer() instead but
      // that adds a filesystem round-trip; the base64 path is already in
      // hand from takePictureAsync.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      ws.send(bytes.buffer);
      return true;
    } catch (err) {
      console.log('[Pose WS] sendFrame failed:', err?.message || err);
      return false;
    }
  }, []);

  // Converts the 33 body points (x, y, z) into a simple flat list of 99 numbers.
  // The backend Machine Learning model needs the data in this specific format.
  const flattenKeypoints = useCallback((keypoints) => {
    const flat = new Array(99).fill(0);
    if (!Array.isArray(keypoints)) return flat;
    for (let i = 0; i < 33; i += 1) {
      const kp = keypoints[i];
      if (!kp) continue;
      flat[i * 3] = Number(kp.x) || 0;
      flat[i * 3 + 1] = Number(kp.y) || 0;
      flat[i * 3 + 2] = Number(kp.z) || 0;
    }
    return flat;
  }, []);

  // Sends the entire sequence of body movements from an exercise to the backend.
  // The backend will score how well the user performed the exercise.
  // Still uses HTTP — it's one-shot at session end, not in the realtime hot path.
  const classifyFormSequence = useCallback(async (exerciseType, keypointsSequence) => {
    if (!isLstmSupported(exerciseType)) {
      return { ok: false, reason: 'lstm_unsupported_exercise' };
    }
    if (!Array.isArray(keypointsSequence) || keypointsSequence.length === 0) {
      return { ok: false, reason: 'empty_sequence' };
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return { ok: false, reason: 'not_authenticated' };
      }
      const sequence = keypointsSequence.map((kps, frame_index) => ({
        frame_index,
        keypoints: flattenKeypoints(kps),
      }));
      const response = await api.post(
        '/predict/form',
        { patient_id: user.id, exercise_type: exerciseType, sequence },
        { timeout: 15000 },
      );
      return { ok: true, data: response.data };
    } catch (err) {
      console.log('Form classification request failed:', err?.message || err);
      return { ok: false, reason: 'request_failed', detail: err?.response?.data || err?.message };
    }
  }, [flattenKeypoints]);

  // Always close the socket when the hook unmounts so we don't leak
  // connections when CameraComponent swaps exercises via key=.
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        try { ws.close(); } catch (_) { /* already closed */ }
      }
    };
  }, []);

  return {
    isDetecting,
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    sendFrameBase64,
    classifyFormSequence,
  };
};

export default usePoseDetection;
