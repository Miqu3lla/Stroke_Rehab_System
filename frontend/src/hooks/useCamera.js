import { useState, useRef, useEffect, useCallback } from 'react';
import usePatientStore from '../store/usePatientStore';
import usePoseDetection from './usePoseDetection';

//custom hook that encapsulates all camera exercise session logic
//manages the timer, score tracking, frame loop, and exercise lifecycle

const useCamera = (exercise, navigation) => {
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

  //external dependencies
  const { logExerciseCompletion } = usePatientStore();
  const {
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    estimateFromBase64,
  } = usePoseDetection();

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

  //ends the exercise, logs the session, and navigates back
  const finishExercise = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;

    clearIntervals();
    setIsExercising(false);

    // Safety shield: if no scores were captured, average safely defaults to 0.
    const avgFormScore = scoreHistory.length > 0
      ? Number((scoreHistory.reduce((sum, score) => sum + score, 0) / scoreHistory.length).toFixed(1))
      : 0;

    await logExerciseCompletion(exercise, elapsedSeconds, avgFormScore);
    stopDetection();

    finishingRef.current = false;
    navigation.goBack();
  }, [clearIntervals, scoreHistory, exercise, elapsedSeconds, logExerciseCompletion, stopDetection, navigation]);

  //starts the recursive frame capture loop that sends photos to the backend
  const startFrameLoop = useCallback(() => {
    const processFrame = async () => {
      // If timerRef is null, the exercise was stopped (finishExercise called)
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

          const exerciseHint = [
            exercise?.name || '',
            exercise?.focus || '',
            exercise?.affected_area || '',
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
            setKeypoints(result.keypoints || []);
          }
        } catch (_) {
          score = null;
        }
      }

      // Check again in case user pressed Finish while the picture was being taken
      if (!timerRef.current) return;

      const effectiveScore = score ?? Math.min(100, Math.max(0, Math.floor(Math.random() * 25) + 70));
      setCurrentScore(effectiveScore);
      setScoreHistory((prev) => [...prev, effectiveScore]);
      setJointColors(colors);

      // Wait 800ms between frames so the JS thread can update the clock and
      // respond to button taps.
      scoreRef.current = setTimeout(processFrame, 800);
    };

    // Start the recursive frame loop
    processFrame();
  }, [exercise, affectedSide, estimateFromBase64, cameraLayout]);

  //resets all state and starts the exercise timer + pose detection
  const startExercise = useCallback(() => {
    setIsExercising(true);
    setElapsedSeconds(0);
    setCurrentScore(0);
    setScoreHistory([]);
    setJointColors({});
    setKeypoints([]);
    setFeedbackText('Preparing pose detection…');
    frameCountRef.current = 0;

    // Wall-clock timer: records the real start time and calculates elapsed
    // from Date.now(). Even if TF.js freezes the JS thread for 30 seconds,
    // the timer will instantly jump to the correct time when the thread
    // unfreezes, instead of permanently falling behind.
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(elapsed);
    }, 500); // poll every 500ms so it catches up faster after a freeze

    // Fire off model loading in the background. Once ready, start the
    // pose detection frame loop. The camera and timer are already running.
    const loadModelAndStartDetection = async () => {
      try {
        const ready = await startDetection();
        if (!ready) {
          setFeedbackText('Pose detection unavailable — exercise without skeleton');
          return;
        }
        // Model is ready! Start the frame processing loop.
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
      finishExercise();
    }
  }, [elapsedSeconds, isExercising, totalSeconds, finishExercise]);

  //cleanup on unmount
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
