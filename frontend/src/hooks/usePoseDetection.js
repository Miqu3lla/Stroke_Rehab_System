import { useCallback, useEffect, useRef, useState } from 'react';
import { instance as api } from '../lib/api';

// Heavy ML now lives in the backend (MediaPipe Python). This hook is a thin
// HTTP client: it takes a base64 frame, posts it to /pose/estimate, and returns
// keypoints + colours + hint exactly as the on-device version used to. The
// public API is unchanged so CameraComponent doesn't need to know the work
// moved off the phone.

const usePoseDetection = () => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);

  // Mirrors of state for use inside the frame-loop closure.
  const isDetectingRef = useRef(false);
  const isEstimatingRef = useRef(false);
  // Aborts the in-flight request when the user finishes the exercise early.
  const abortRef = useRef(null);

  const startDetection = useCallback(async () => {
    // Probe the backend so we surface a clear error instead of silently
    // failing on the first frame. The /health endpoint already exists.
    try {
      await api.get('/health', { timeout: 5000 });
      isDetectingRef.current = true;
      setIsDetecting(true);
      setIsModelReady(true);
      setModelError(null);
      return true;
    } catch (err) {
      const message = err?.response?.data?.detail || err?.message || 'Backend unreachable';
      setModelError(`Backend unreachable — ${message}`);
      setIsModelReady(false);
      setIsDetecting(false);
      isDetectingRef.current = false;
      return false;
    }
  }, []);

  const stopDetection = useCallback(() => {
    isDetectingRef.current = false;
    setIsDetecting(false);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // viewWidth/viewHeight are accepted for API compatibility but no longer used —
  // the backend returns the photo's own dimensions and the SkeletonOverlay
  // applies the cover-mode transform from those.
  const estimateFromBase64 = useCallback(async (base64Image, exerciseType = '', affectedSide = 'right') => {
    if (!isDetectingRef.current || !base64Image) return null;
    if (isEstimatingRef.current) return null;

    isEstimatingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.post(
        '/pose/estimate',
        {
          image_base64: base64Image,
          exercise_type: exerciseType,
          affected_side: affectedSide,
        },
        { signal: controller.signal, timeout: 10000 },
      );
      return response.data || null;
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return null;
      console.log('Pose estimation request failed:', err?.message || err);
      return null;
    } finally {
      isEstimatingRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    isDetecting,
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    estimateFromBase64,
  };
};

export default usePoseDetection;
