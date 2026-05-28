import { useCallback, useEffect, useRef, useState } from 'react';
import { instance as api } from '../lib/api';
import { isLstmSupported } from '../constants/exerciseTypes';
import { supabase } from '../services/supabase';

/**
 * Hook to handle pose detection by communicating with the backend.
 * Instead of running heavy Machine Learning models on the phone,
 * it sends camera images to the backend and gets the pose results back.
 */

const usePoseDetection = () => {
  // UI states for loading and error handling
  const [isDetecting, setIsDetecting] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);

  // References used to keep track of background processes without triggering a re-render
  const isDetectingRef = useRef(false);
  const isEstimatingRef = useRef(false);
  // Used to cancel any ongoing backend requests if the user stops early
  const abortRef = useRef(null);

  // Checks if the backend server is reachable before starting to send camera frames
  const startDetection = useCallback(async () => {
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

  // Stops the detection process and cancels any ongoing server requests
  const stopDetection = useCallback(() => {
    isDetectingRef.current = false;
    setIsDetecting(false);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // Sends a single camera frame to the backend to get the user's current pose.
  // It returns the body joints (keypoints), visual colors, and text hints.
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
    classifyFormSequence,
  };
};

export default usePoseDetection;
