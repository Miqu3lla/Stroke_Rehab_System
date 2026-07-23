import { useCallback, useEffect, useRef, useState } from 'react';
import { instance as api } from '../lib/api';
import { isLstmSupported } from '../constants/exerciseTypes';
import { supabase } from '../services/supabase';
import useSessionStore from '../store/useSessionStore';

/**
 * Hook to handle pose detection by communicating with the backend.
 *
 * Phase 2 architecture: a persistent WebSocket replaces the HTTP-per-frame
 * pattern. We open one /ws/pose connection per exercise, stream raw JPEG
 * bytes over binary frames, and receive JSON pose results via the message
 * handler. This removes ~80–150ms of per-frame HTTP + base64 overhead that
 * the old POST /pose/estimate path paid every cycle.
 *
 * Auth protocol (since 2026-06-04, after CodeRabbit feedback):
 *   1. Open WS to /ws/pose with NO token in the URL — query-string tokens
 *      end up in reverse-proxy logs and would leak the bearer.
 *   2. On open, send {"type": "auth", "token", "exercise_type",
 *      "affected_side", "patient_id", "session_id"} as the first message.
 *      patient_id + session_id let the backend file the session-evidence
 *      clip it records from this stream (see core/session_video.py).
 *   3. Wait for {"type": "auth_ok"} from the server before we consider
 *      the connection live and let the frame loop start.
 *   4. The whole handshake (TCP connect + auth round-trip) is bounded by
 *      HANDSHAKE_TIMEOUT_MS — without it a stuck CONNECTING socket would
 *      leave the UI on "Preparing pose detection…" forever.
 *
 * The end-of-session LSTM call (classifyFormSequence) still uses HTTP
 * because it's one-shot and benefits from the standard auth interceptor.
 */

// Cap on how long startDetection waits for handshake + auth_ok. Real
// networks resolve this in under a second; a stuck CONNECTING socket
// previously hung the UI indefinitely.
const HANDSHAKE_TIMEOUT_MS = 10000;

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
  // onCloseRef lets useCamera know the underlying socket dropped so it
  // can stop the capture loop instead of busy-retrying takePictureAsync.
  const onCloseRef = useRef(null);
  // True once the auth_ok handshake has completed. Pose result messages
  // arriving before this point would be a protocol error.
  const authedRef = useRef(false);

  // Build the wss:// URL from the axios baseURL — same host as the HTTP
  // API, so dev/prod just works without an extra env var. We deliberately
  // do NOT put the token in the query string; auth happens via the first
  // message after open.
  const buildWsUrl = useCallback(() => {
    const httpBase = (api.defaults?.baseURL || '').replace(/\/$/, '');
    const wsBase = httpBase.replace(/^https?:/i, (scheme) =>
      scheme.toLowerCase() === 'https:' ? 'wss:' : 'ws:'
    );
    return `${wsBase}/ws/pose`;
  }, []);

  // Opens the realtime pose WebSocket. Resolves true on successful
  // auth_ok handshake, false on connection / auth / timeout failure. The
  // supplied onResult callback is invoked once per server pose message
  // (after auth_ok); useCamera uses this to update skeleton state and
  // trigger the next frame capture (backpressure-driven loop). The
  // onClose callback fires when the socket drops so useCamera can tear
  // down its capture loop instead of retrying into a dead channel.
  const startDetection = useCallback(async (
    exerciseType = '',
    affectedSide = 'right',
    onResult = null,
    onClose = null,
    exerciseSlug = '',
  ) => {
    onResultRef.current = onResult;
    onCloseRef.current = onClose;
    authedRef.current = false;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      // For the session-evidence clip: the backend records the first ~10s
      // of this exercise's frames and files it under (patient, session).
      // Both are best-effort — if either is missing the backend just skips
      // recording and pose scoring is unaffected.
      const patientId = session?.user?.id || '';
      const sessionId = useSessionStore.getState()?.session?.sessionId || '';
      if (!token) {
        setModelError('Not authenticated — please log in again');
        setIsModelReady(false);
        setIsDetecting(false);
        return false;
      }

      const ws = new WebSocket(buildWsUrl());
      // arraybuffer so future server→client binary messages (if we ever
      // send compressed pose deltas) come through as ArrayBuffer instead
      // of Blob. Current server only sends JSON text, so this is forward-
      // compatible rather than load-bearing.
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      return await new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(ok);
        };

        // Handshake timeout — without this a socket stuck in CONNECTING
        // (e.g. tunnel unavailable, server hung) would leave the caller
        // awaiting forever and the UI on "Preparing pose detection…".
        const timeoutHandle = setTimeout(() => {
          setModelError('Pose tracking handshake timed out');
          setIsModelReady(false);
          setIsDetecting(false);
          try { ws.close(); } catch (_) { /* already closed */ }
          finish(false);
        }, HANDSHAKE_TIMEOUT_MS);

        ws.onopen = () => {
          // Don't mark ready yet — we still need auth_ok from the server.
          try {
            ws.send(JSON.stringify({
              type: 'auth',
              token,
              exercise_type: exerciseType || '',
              affected_side: affectedSide || 'right',
              patient_id: patientId,
              session_id: sessionId,
              // Clean exercise slug (e.g. "shoulder_flexion") for the
              // evidence clip filename — exercise_type above is the long
              // scoring hint, which makes an ugly path.
              exercise_slug: exerciseSlug || '',
            }));
          } catch (err) {
            setModelError('Failed to send auth message');
            try { ws.close(); } catch (_) { /* already closed */ }
            finish(false);
          }
        };

        ws.onerror = () => {
          setModelError('Pose tracking connection error');
          setIsModelReady(false);
          setIsDetecting(false);
          finish(false);
        };

        ws.onmessage = (event) => {
          let data;
          try {
            const raw = typeof event.data === 'string'
              ? event.data
              : new TextDecoder().decode(event.data);
            data = JSON.parse(raw);
          } catch (err) {
            console.log('[Pose WS] Failed to parse message:', err?.message || err);
            return;
          }

          // Auth phase — first message must be auth_ok.
          if (!authedRef.current) {
            if (data?.type === 'auth_ok') {
              authedRef.current = true;
              setIsDetecting(true);
              setIsModelReady(true);
              setModelError(null);
              finish(true);
            } else {
              // Anything other than auth_ok before we're authed is a
              // protocol failure — bail.
              setModelError('Pose tracking auth failed');
              try { ws.close(); } catch (_) { /* already closed */ }
              finish(false);
            }
            return;
          }

          // Post-auth: every message is either a pose result or a
          // server-side error payload (decode_failed / frame_too_large
          // / etc). We forward both to useCamera so its backpressure
          // loop always clears its in-flight flag on any reply.
          onResultRef.current?.(data);
        };

        ws.onclose = (event) => {
          setIsDetecting(false);
          setIsModelReady(false);
          if (event?.code === 4401) {
            setModelError('Pose tracking auth failed — please log in again');
          }
          // Notify the consumer (useCamera) so it can stop capturing
          // instead of feeding a dead socket. Skip if we never even
          // authed — startDetection's promise rejection handles that.
          if (authedRef.current) {
            onCloseRef.current?.(event);
          }
          // If the handshake hadn't completed yet, this closes the
          // resolution path too.
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

  // Closes the pose WebSocket and clears all callbacks. Safe to call
  // multiple times — both unmount cleanup and the explicit stop path
  // route through here.
  const stopDetection = useCallback(() => {
    setIsDetecting(false);
    setIsModelReady(false);
    onResultRef.current = null;
    onCloseRef.current = null;
    authedRef.current = false;
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      try { ws.close(); } catch (_) { /* already closed */ }
    }
  }, []);

  // Convert a base64-encoded JPEG to an ArrayBuffer and send it over the
  // open WebSocket as a binary frame. Returns one of:
  //   { ok: true }                                — frame queued for send
  //   { ok: false, reason: 'not_open' }           — handshake not finished yet (retryable)
  //   { ok: false, reason: 'closed' }             — socket gone (terminal)
  //   { ok: false, reason: 'send_failed', err }   — runtime error (terminal-ish)
  // useCamera uses these to decide between retrying and tearing down.
  const sendFrameBase64 = useCallback((base64) => {
    const ws = wsRef.current;
    if (!ws) return { ok: false, reason: 'closed' };
    // CLOSING (2) and CLOSED (3) are both terminal from our side.
    if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      return { ok: false, reason: 'closed' };
    }
    // CONNECTING (0) or pre-auth_ok OPEN (1) — caller can retry shortly.
    if (ws.readyState !== WebSocket.OPEN || !authedRef.current) {
      return { ok: false, reason: 'not_open' };
    }
    if (!base64) {
      return { ok: false, reason: 'send_failed' };
    }
    try {
      // atob is available globally in modern React Native / Expo SDK 49+.
      // We could use fetch(file://photo.uri).arrayBuffer() instead but
      // that adds a filesystem round-trip; base64 is already in hand
      // from takePictureAsync.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      ws.send(bytes.buffer);
      return { ok: true };
    } catch (err) {
      console.log('[Pose WS] sendFrame failed:', err?.message || err);
      return { ok: false, reason: 'send_failed', err };
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
