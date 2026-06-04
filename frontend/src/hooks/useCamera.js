import { useState, useRef, useEffect, useCallback } from 'react';
import usePoseDetection from './usePoseDetection';

//custom hook that encapsulates all camera exercise session logic
//manages the timer, score tracking, frame loop, and exercise lifecycle.
//Score reporting is decoupled from persistence — the parent (ExerciseScreen)
//passes an onComplete callback that receives the final avg score and
//endedVia tag, then decides whether to save / transition / batch later.
//
// Phase 2 frame loop (since 2026-06-04): backpressure-driven via WebSocket.
// Each capture+send is followed by an inFlight flag that's only cleared
// when the server's pose result arrives (handlePoseResult) OR when a
// 2-second watchdog fires (network glitch recovery). The next capture
// kicks off the moment the flag clears, so the loop self-paces to the
// slowest link instead of paying a fixed sleep on top of every cycle.

const useCamera = (exercise, { onComplete } = {}) => {
  //exercise session state
  const [isExercising, setIsExercising] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  const [scoreHistory, setScoreHistory] = useState([]);
  const [jointColors, setJointColors] = useState({});
  const [keypoints, setKeypoints] = useState([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [inferenceSize, setInferenceSize] = useState({ width: 1, height: 1 });
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });

  //refs for intervals and internal flags
  const frameCountRef = useRef(0);
  const timerRef = useRef(null);
  const watchdogRef = useRef(null);
  const finishingRef = useRef(false);
  const cameraRef = useRef(null);
  const startTimeRef = useRef(null);
  // True between sendFrame and the matching pose result. Used as the
  // backpressure signal — captureAndSend skips when this is already
  // true so we don't pile frames onto a busy server.
  const inFlightRef = useRef(false);
  // setTimeout handle for the "ready for next frame" kick when we
  // couldn't send (WS not open yet, or sendFrame failed). Separate from
  // the watchdog so they don't stomp on each other's IDs.
  const retryRef = useRef(null);

  //derived values
  // Prefer duration_seconds when the recommender provides it — that's the
  // precise length after the trajectory multiplier (e.g. 138 on a +15%
  // upgrade). duration_minutes is the rounded label and would silently
  // strip a partial-minute upgrade back down to the base 2 minutes.
  const totalSeconds = Math.max(
    1,
    Number(exercise?.duration_seconds) || (Number(exercise?.duration_minutes) || 1) * 60,
  );
  const affectedSide = (exercise?.affected_side || 'right').toLowerCase();

  //pose detection backend client
  const {
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    sendFrameBase64,
    classifyFormSequence,
  } = usePoseDetection();

  // Buffers the per-frame keypoint arrays as they come back from the
  // /ws/pose WebSocket. On finish we flush this sequence to the LSTM via
  // /predict/form (fire-and-forget) so form_predictions gets populated.
  // Lives in a ref because the frame loop is callback-based.
  const keypointsBufferRef = useRef([]);

  //formats seconds into M:SS display string
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  //clears the wall clock timer + any pending watchdog/retry timers
  const clearIntervals = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  // Compute the avg score from accumulated frames. Returns 0 if the
  // patient quit before any frame was captured.
  const computeAvgScore = useCallback((history) => {
    if (!history || history.length === 0) return 0;
    const total = history.reduce((sum, s) => sum + s, 0);
    return Number((total / history.length).toFixed(1));
  }, []);

  //ends the exercise, computes the avg score, and reports it up via
  //onComplete. endedVia distinguishes 'finish' (Happy Path) from
  //'end_early' (Fatigue/Quit) — both still earn the partial score.
  //
  //Side effect (fire-and-forget): flush the buffered keypoint sequence
  //to the LSTM via /predict/form so form_predictions gets populated.
  //The backend skips the call internally for unsupported exercise types
  //(e.g. shoulder_flexion), so we don't need to filter here.
  const finishExercise = useCallback((endedVia = 'finish') => {
    if (finishingRef.current) return;
    finishingRef.current = true;

    clearIntervals();
    setIsExercising(false);
    stopDetection();
    inFlightRef.current = false;

    const avgFormScore = computeAvgScore(scoreHistory);

    // Snapshot the buffer and clear it so the next exercise's hook
    // instance starts fresh. Sequence stays in the closure for the POST.
    const sequenceSnapshot = keypointsBufferRef.current.slice();
    keypointsBufferRef.current = [];
    const exerciseTypeForLstm = (exercise?.exercise_type || '').toString();
    if (sequenceSnapshot.length > 0 && exerciseTypeForLstm) {
      classifyFormSequence(exerciseTypeForLstm, sequenceSnapshot)
        .then((res) => {
          if (res?.ok) {
            console.log('LSTM verdict:', res.data?.prediction);
          } else if (res?.reason && res.reason !== 'lstm_unsupported_exercise') {
            console.log('LSTM skipped:', res.reason);
          }
        })
        .catch((err) => console.log('LSTM dispatch error:', err?.message || err));
    }

    if (onComplete) {
      onComplete({
        avgFormScore,
        durationSeconds: elapsedSeconds,
        endedVia,
      });
    }
    // Intentionally do NOT reset finishingRef — the parent will swap
    // away from the active state (to rest), unmounting this active
    // camera tree. The next exercise mounts a fresh hook instance.
  }, [
    clearIntervals,
    stopDetection,
    scoreHistory,
    elapsedSeconds,
    onComplete,
    computeAvgScore,
    classifyFormSequence,
    exercise,
  ]);

  // Captures one frame from the camera and ships it down the WS as
  // binary. Sets the in-flight flag so the next call short-circuits
  // until the result lands. The watchdog backstops a missing result.
  //
  // Retry policy (CodeRabbit review 2026-06-04): the old loop retried
  // every 200ms on any send failure, which meant a closed mid-session
  // socket left captureAndSend calling takePictureAsync forever with no
  // chance of delivery. Now we distinguish:
  //   - 'not_open'  → handshake still in flight → schedule a 200ms retry
  //   - 'closed'    → socket is gone → STOP the loop (handlePoseClose
  //                   will already have run; nothing for us to send to)
  //   - 'send_failed' → runtime error → also stop; reconnect via the
  //                   higher-level session lifecycle, not in this loop
  // And the catch block now schedules a retry on transient capture
  // errors instead of silently parking the loop with inFlight cleared.
  const captureAndSend = useCallback(async () => {
    if (!timerRef.current || !cameraRef.current) return;
    if (inFlightRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.1,
        base64: true,
        shutterSound: false,
        // skipProcessing skips JPEG quality enhancement / orientation
        // metadata work that adds 20-40ms per capture. We don't need
        // those for pose inference — the model only reads pixels.
        skipProcessing: true,
      });
      // Bail if the session ended while the capture was in flight.
      if (!timerRef.current) return;

      frameCountRef.current += 1;

      const result = sendFrameBase64(photo?.base64);
      if (!result?.ok) {
        inFlightRef.current = false;
        if (result?.reason === 'not_open') {
          // Handshake not finished yet (first-frame race). Try again
          // shortly — no need to escalate.
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            if (timerRef.current) captureAndSend();
          }, 200);
          return;
        }
        // 'closed' or 'send_failed' — the socket is terminal. Stop the
        // loop entirely. The onClose callback registered with
        // startDetection has already (or will shortly) update the UI
        // state and tear down detection. Reconnect is a higher-level
        // concern — not the capture loop's job.
        return;
      }

      inFlightRef.current = true;
      // Watchdog: if no result comes back in 2s, drop the backpressure
      // flag so a flaky network can't deadlock the loop.
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        if (inFlightRef.current) {
          inFlightRef.current = false;
          if (timerRef.current) captureAndSend();
        }
      }, 2000);
    } catch (_) {
      // Capture exceptions are usually transient (camera busy, orientation
      // change, etc). Reschedule a fresh attempt instead of stalling the
      // loop forever with inFlight cleared and no follow-up timer.
      inFlightRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (timerRef.current) captureAndSend();
      }, 200);
    }
  }, [sendFrameBase64]);

  // Handler the WebSocket calls once per server message. Updates the UI
  // state, buffers keypoints for the end-of-session LSTM call, then
  // immediately kicks off the next capture (no fixed sleep — the
  // backend's response IS the pacing signal).
  //
  // Server may also send error payloads ({error: 'decode_failed' |
  // 'frame_too_large' | 'empty_frame' | 'inference_failed'}) for frames
  // it couldn't process. We treat those as "no-op for skeleton state,
  // just unblock the loop" — clearing setKeypoints([]) on every bad
  // frame would visibly flicker the overlay.
  const handlePoseResult = useCallback((result) => {
    // The reply landed — clear the watchdog before it fires a
    // duplicate capture.
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }

    const isErrorPayload = result && typeof result.error === 'string';

    if (result && !isErrorPayload) {
      const score = result.score;
      const colors = result.colors || {};
      if (result.imageWidth && result.imageHeight) {
        setInferenceSize({ width: result.imageWidth, height: result.imageHeight });
      }
      if (result.hint) setFeedbackText(result.hint);
      const frameKeypoints = result.keypoints || [];
      setKeypoints(frameKeypoints);
      // Only buffer frames that actually have keypoints so the LSTM
      // gets clean signal, not zero-padded "no body detected" frames.
      if (Array.isArray(frameKeypoints) && frameKeypoints.length > 0) {
        keypointsBufferRef.current.push(frameKeypoints);
      }
      // Only commit the frame to scoreHistory if MediaPipe actually
      // returned a score. Synthesising a fake number for missing
      // frames poisoned the per-exercise trend the trajectory
      // analyzer reads.
      if (score !== null && score !== undefined) {
        setCurrentScore(score);
        setScoreHistory((prev) => [...prev, score]);
      }
      setJointColors(colors);
    }
    // Error payload: deliberately do NOT clear keypoints / colors so
    // the existing skeleton keeps showing while the next good frame
    // catches up. The whole point of the server sending an error
    // payload (rather than silent drop) is to keep this loop moving.

    inFlightRef.current = false;
    // Self-pacing loop: as soon as the last result is processed, ship
    // the next frame. The slowest link (capture + WS + MediaPipe)
    // determines effective FPS — no fixed sleep on top.
    if (timerRef.current) {
      captureAndSend();
    }
  }, [captureAndSend]);

  // Called by usePoseDetection when the WebSocket closes mid-session
  // (server hung up, network dropped, etc). We stop the capture loop
  // so it doesn't burn camera cycles into a dead channel. The patient
  // sees the "🟢 Pose tracking active" indicator flip off via the
  // hook's isModelReady state; ending the exercise is their call.
  const handlePoseClose = useCallback(() => {
    inFlightRef.current = false;
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  //resets all state and starts the exercise timer + pose detection
  const startExercise = useCallback(() => {
    finishingRef.current = false;
    inFlightRef.current = false;
    setIsExercising(true);
    setElapsedSeconds(0);
    setCurrentScore(0);
    setScoreHistory([]);
    setJointColors({});
    setKeypoints([]);
    setFeedbackText('Preparing pose detection…');
    frameCountRef.current = 0;
    keypointsBufferRef.current = [];

    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 500);

    // Hint string the backend classifier uses to pick arm vs leg vs
    // both branches. body_area is the authoritative tag from the
    // catalog ("arms"/"legs"); exercise_type carries the body part
    // in its name (e.g. "shoulder_flexion", "knee_extension") so a
    // future exercise whose name doesn't contain an arm/leg keyword
    // still classifies correctly. The recommender returns body_area,
    // NOT affected_area — using the wrong field here was silently
    // falling through to the "both" branch and showing leg hints
    // during shoulder flexion.
    const exerciseHint = [
      exercise?.exercise_type || '',
      exercise?.name || '',
      exercise?.body_area || '',
      exercise?.focus || '',
    ].join(' ').toLowerCase();

    const loadModelAndStartDetection = async () => {
      try {
        const ready = await startDetection(
          exerciseHint,
          affectedSide,
          handlePoseResult,
          handlePoseClose,
        );
        if (!ready) {
          setFeedbackText('Pose detection unavailable — exercise without skeleton');
          return;
        }
        setFeedbackText('Pose detection active — step back to show your body');
        // Kick off the loop. captureAndSend self-perpetuates from here
        // via handlePoseResult.
        captureAndSend();
      } catch (err) {
        console.error('Model load error:', err);
        setFeedbackText('Pose detection failed to load');
      }
    };

    loadModelAndStartDetection();
  }, [startDetection, captureAndSend, handlePoseResult, handlePoseClose, exercise, affectedSide]);

  //auto-finish when time runs out
  useEffect(() => {
    if (isExercising && elapsedSeconds >= totalSeconds) {
      finishExercise('finish');
    }
  }, [elapsedSeconds, isExercising, totalSeconds, finishExercise]);

  //cleanup on unmount: only stop the timer + camera + ws. Score reporting
  //is the parent's responsibility now — if the parent swaps us out
  //(e.g. moving to rest state) it has already called finishExercise.
  useEffect(() => {
    return () => {
      clearIntervals();
      stopDetection();
      inFlightRef.current = false;
    };
  }, [clearIntervals, stopDetection]);

  //handles the camera view's onLayout event
  const handleCameraLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setCameraLayout({ width, height });
  }, []);

  return {
    //refs
    cameraRef,
    //exercise state
    isExercising,
    elapsedSeconds,
    totalSeconds,
    currentScore,
    scoreHistory,
    jointColors,
    keypoints,
    feedbackText,
    inferenceSize,
    cameraLayout,
    affectedSide,
    //pose detection state
    isModelReady,
    modelError,
    //actions
    startExercise,
    finishExercise,
    formatTime,
    handleCameraLayout,
  };
};

export default useCamera;
