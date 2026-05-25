import { useState, useRef, useEffect, useCallback } from 'react';
import usePoseDetection from './usePoseDetection';

//custom hook that encapsulates all camera exercise session logic
//manages the timer, score tracking, frame loop, and exercise lifecycle.
//Score reporting is decoupled from persistence — the parent (ExerciseScreen)
//passes an onComplete callback that receives the final avg score and
//endedVia tag, then decides whether to save / transition / batch later.

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
  const scoreRef = useRef(null);
  const finishingRef = useRef(false);
  const cameraRef = useRef(null);
  const startTimeRef = useRef(null);

  //derived values
  const totalSeconds = Math.max(1, (Number(exercise?.duration_minutes) || 1) * 60);
  const affectedSide = (exercise?.affected_side || 'right').toLowerCase();

  //pose detection backend client
  const {
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    estimateFromBase64,
    classifyFormSequence,
  } = usePoseDetection();

  // Buffers the per-frame keypoint arrays as they come back from
  // /pose/estimate. On finish we flush this sequence to the LSTM via
  // /predict/form (fire-and-forget) so form_predictions gets populated.
  // Lives in a ref because the frame loop is closure-based.
  const keypointsBufferRef = useRef([]);

  //formats seconds into M:SS display string
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  //clears the wall clock timer and the frame loop timeout
  const clearIntervals = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (scoreRef.current) {
      clearTimeout(scoreRef.current);
      scoreRef.current = null;
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

  //starts the recursive frame capture loop that sends photos to the backend
  const startFrameLoop = useCallback(() => {
    const processFrame = async () => {
      if (!timerRef.current) return;

      let score = null;
      let colors = {};

      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.1,
            base64: true,
            shutterSound: false,
          });

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

          const result = await estimateFromBase64(
            photo?.base64,
            exerciseHint,
            affectedSide,
            cameraLayout.width || null,
            cameraLayout.height || null,
          );

          frameCountRef.current += 1;

          if (result) {
            score = result.score;
            colors = result.colors || {};
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
          }
        } catch (_) {
          score = null;
        }
      }

      if (!timerRef.current) return;

      // Only commit the frame to scoreHistory if MediaPipe actually
      // returned a score. Synthesising a fake number for missing frames
      // poisoned the per-exercise trend the trajectory analyzer reads.
      if (score !== null && score !== undefined) {
        setCurrentScore(score);
        setScoreHistory((prev) => [...prev, score]);
      }
      setJointColors(colors);

      scoreRef.current = setTimeout(processFrame, 800);
    };

    processFrame();
  }, [exercise, affectedSide, estimateFromBase64, cameraLayout]);

  //resets all state and starts the exercise timer + pose detection
  const startExercise = useCallback(() => {
    finishingRef.current = false;
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

    const loadModelAndStartDetection = async () => {
      try {
        const ready = await startDetection();
        if (!ready) {
          setFeedbackText('Pose detection unavailable — exercise without skeleton');
          return;
        }
        setFeedbackText('Pose detection active — step back to show your body');
        startFrameLoop();
      } catch (err) {
        console.error('Model load error:', err);
        setFeedbackText('Pose detection failed to load');
      }
    };

    loadModelAndStartDetection();
  }, [startDetection, startFrameLoop]);

  //auto-finish when time runs out
  useEffect(() => {
    if (isExercising && elapsedSeconds >= totalSeconds) {
      finishExercise('finish');
    }
  }, [elapsedSeconds, isExercising, totalSeconds, finishExercise]);

  //cleanup on unmount: only stop the timer + camera. Score reporting
  //is the parent's responsibility now — if the parent swaps us out
  //(e.g. moving to rest state) it has already called finishExercise.
  useEffect(() => {
    return () => {
      clearIntervals();
      stopDetection();
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
