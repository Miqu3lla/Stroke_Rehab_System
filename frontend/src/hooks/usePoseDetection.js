import { useCallback, useEffect, useRef, useState } from 'react';
import { instance as api } from '../lib/api';
import { isLstmSupported } from '../constants/exerciseTypes';
import { supabase } from '../services/supabase';
import useSessionStore from '../store/useSessionStore';

/**
 * Pose detection over a persistent WebSocket: one /ws/pose connection per
 * exercise, streaming raw JPEG frames and receiving JSON pose results.
 *
 * Auth: open the socket (no token in the URL — it would leak in proxy logs),
 * send an {type:"auth", ...} message first, and wait for "auth_ok" before
 * the frame loop starts. The whole handshake is bounded by HANDSHAKE_TIMEOUT_MS.
 *
 * classifyFormSequence still uses HTTP — it's a one-shot call at session end.
 */

// Max wait for the handshake + auth_ok before we give up (avoids a hung UI).
const HANDSHAKE_TIMEOUT_MS = 10000;

const usePoseDetection = () => {
  // UI states for loading and error handling
  const [isDetecting, setIsDetecting] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);

  // Live socket + callbacks. Refs (not state) so the WS handler never reads
  // a stale closure when useCamera re-renders mid-exercise.
  const wsRef = useRef(null);
  const onResultRef = useRef(null);
  // Fires when the socket drops so useCamera can stop its capture loop.
  const onCloseRef = useRef(null);
  // True once auth_ok has landed; pose results before this are a protocol error.
  const authedRef = useRef(false);
  // Bumped on every start/stop/unmount. Handlers captured by an older socket
  // compare against it and bail, so a late close/error/message from a replaced
  // connection can't flip state or fire the new connection's callbacks.
  const connectionIdRef = useRef(0);

  // Build the wss:// URL from the axios baseURL (same host as the HTTP API).
  // No token in the query string — auth happens in the first message.
  const buildWsUrl = useCallback(() => {
    const httpBase = (api.defaults?.baseURL || '').replace(/\/$/, '');
    const wsBase = httpBase.replace(/^https?:/i, (scheme) =>
      scheme.toLowerCase() === 'https:' ? 'wss:' : 'ws:'
    );
    return `${wsBase}/ws/pose`;
  }, []);

  // Opens the pose WebSocket. Resolves true on a successful auth_ok handshake,
  // false on any connection/auth/timeout failure. onResult fires once per pose
  // message (after auth_ok). onClose fires ONLY when a socket that completed
  // the auth_ok handshake later drops — handshake failures (auth rejected,
  // timeout, connection error) are reported solely through the resolved false,
  // so callers never see both signals for the same attempt.
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
    // This attempt's identity. Every handler below checks it before touching
    // shared state, so an in-flight socket from a previous call goes silent
    // the moment startDetection/stopDetection is called again.
    const connId = connectionIdRef.current + 1;
    connectionIdRef.current = connId;
    const isCurrent = () => connectionIdRef.current === connId;

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

      // getSession() above is async — a newer attempt may have started while
      // we waited, in which case this one is already obsolete.
      if (!isCurrent()) return false;

      const ws = new WebSocket(buildWsUrl());
      // Forward-compatible: any future binary server messages arrive as
      // ArrayBuffer instead of Blob. Server currently sends only JSON text.
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      return await new Promise((resolve) => {
        let settled = false;
        // Auth state for THIS socket only. authedRef mirrors it (sendFrameBase64
        // reads it) but is written only while this connection is current.
        let authed = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(ok);
        };

        // Bail if the handshake stalls (e.g. server hung) instead of awaiting forever.
        const timeoutHandle = setTimeout(() => {
          if (isCurrent()) {
            setModelError('Pose tracking handshake timed out');
            setIsModelReady(false);
            setIsDetecting(false);
          }
          try { ws.close(); } catch (_) { /* already closed */ }
          finish(false);
        }, HANDSHAKE_TIMEOUT_MS);

        ws.onopen = () => {
          // Send auth first; not "ready" until the server replies auth_ok.
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
            if (isCurrent()) setModelError('Failed to send auth message');
            try { ws.close(); } catch (_) { /* already closed */ }
            finish(false);
          }
        };

        ws.onerror = () => {
          if (isCurrent()) {
            setModelError('Pose tracking connection error');
            setIsModelReady(false);
            setIsDetecting(false);
          }
          finish(false);
        };

        ws.onmessage = (event) => {
          // A superseded socket may still deliver buffered frames; drop them
          // rather than feeding them to the current exercise's callback.
          if (!isCurrent()) return;
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

          // Auth phase — the first message must be auth_ok, else bail.
          if (!authed) {
            if (data?.type === 'auth_ok') {
              authed = true;
              authedRef.current = true;
              setIsDetecting(true);
              setIsModelReady(true);
              setModelError(null);
              finish(true);
            } else {
              setModelError('Pose tracking auth failed');
              try { ws.close(); } catch (_) { /* already closed */ }
              finish(false);
            }
            return;
          }

          // Post-auth: forward pose results AND error payloads so useCamera's
          // loop always clears its in-flight flag on any reply.
          onResultRef.current?.(data);
        };

        ws.onclose = (event) => {
          // Stale socket: it's already been replaced or stopped, so its close
          // says nothing about the live connection.
          if (!isCurrent()) {
            finish(false);
            return;
          }
          setIsDetecting(false);
          setIsModelReady(false);
          if (event?.code === 4401) {
            setModelError('Pose tracking auth failed — please log in again');
          }
          // Tell useCamera to stop capturing. Skip if we never authed —
          // startDetection's promise handles that case.
          if (authed) {
            onCloseRef.current?.(event);
          }
          // Resolves the handshake promise if it hadn't settled yet.
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

  // Closes the socket and clears callbacks. Safe to call multiple times.
  const stopDetection = useCallback(() => {
    // Retire the current connection id so its handlers go silent.
    connectionIdRef.current += 1;
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

  // Send a base64 JPEG as a binary WS frame. Returns { ok } plus a reason
  // useCamera reads: 'not_open' (retry), 'closed' or 'send_failed' (stop).
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
      // Decode base64 → bytes. atob is global in Expo SDK 49+; the base64
      // is already in hand from takePictureAsync, so no filesystem round-trip.
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

  // Flatten the 33 (x, y, z) body points into the 99-number list the ML model expects.
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

  // Send the full movement sequence to the backend for a form score.
  // HTTP, not WS — it's one-shot at session end, not in the realtime hot path.
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

  // Close the socket on unmount so swapping exercises doesn't leak connections.
  useEffect(() => {
    return () => {
      // Same retirement as stopDetection: drop the callbacks and invalidate
      // the connection id so nothing the socket emits on its way out reaches
      // an unmounted consumer.
      connectionIdRef.current += 1;
      onResultRef.current = null;
      onCloseRef.current = null;
      authedRef.current = false;
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
