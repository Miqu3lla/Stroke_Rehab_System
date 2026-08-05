import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import usePoseDetection from './usePoseDetection';
import useVoicePlayback from './useVoicePlayback';
import usePoseResultHandler from './usePoseResultHandler';
import RepCounter from '../utils/repCounter';
import ShoulderFlexionGuide from '../utils/shoulderFlexionGuide';

//timer for reps sets
const REP_SET_CAP_SECONDS = 120;
//for hold sets
const HOLD_DEFAULT_SECONDS = 300;
const HOLD_MIN_SECONDS = 60;

//fallback sets if the exercise does not have sets
const _fallbackSets = () => [
  { set_index: 0, format: 'reps', target_reps: 12, hold_seconds: null },
  { set_index: 1, format: 'reps', target_reps: 12, hold_seconds: null },
  { set_index: 2, format: 'reps', target_reps: 12, hold_seconds: null },
];

//timer for hold sets
const _capForSet = (set) => {
  if (!set) return REP_SET_CAP_SECONDS;
  if (set.format === 'hold') {
    const raw = Number(set.hold_seconds);
    if (!Number.isFinite(raw) || raw <= 0) return HOLD_DEFAULT_SECONDS;
    return Math.max(HOLD_MIN_SECONDS, raw);
  }
  return REP_SET_CAP_SECONDS;
};

const useCamera = (exercise, { onComplete } = {}) => {
  // ── Sets layout for this exercise ─────────────────────────────────
  // useMemo so the array identity is stable across renders unless the
  // exercise itself changes (key=exercise.id remounts trigger a new
  // memo). State derived from `sets` should never change unexpectedly.
  const sets = useMemo(
    () => (Array.isArray(exercise?.sets) && exercise.sets.length > 0 ? exercise.sets : _fallbackSets()),
    [exercise?.id, exercise?.sets],
  );

  // ── Exercise / set lifecycle state ────────────────────────────────
  const [isExercising, setIsExercising] = useState(false);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [isBetweenSets, setIsBetweenSets] = useState(false);
  // Per-set timer + score
  const [setElapsedSeconds, setSetElapsedSeconds] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  // Per-set RepCounter snapshot, surfaced for the HUD
  const [repProgress, setRepProgress] = useState({
    repsCompleted: 0,
    targetReps: 12,
    setComplete: false,
    state: 'initial',
  });
  // Per-set hold progress, surfaced for the HUD on hold sets. 
  // Both are 0 when format='reps'.
  const [holdProgress, setHoldProgress] = useState({
    secondsInForm: 0,
    brokenSeconds: 0,
    targetSeconds: 300,
  });
  // Completed sets' structured results — flushed to the parent on
  // exercise completion as setResults[].
  const [completedSetResults, setCompletedSetResults] = useState([]);

  // ── Strength load (kg) 
  // The camera can't measure weight, so Strength mode carries a
  // patient-entered load. Seeded from the recommender's suggested weight
  // between sets, and recorded into each Strength set's result so the
  // recommender can progress it next session. Lazy initializer runs once
  // per exercise (the hook remounts on key=exercise.id).
  const [currentWeightKg, setCurrentWeightKg] = useState(() => {
    const s0 = Array.isArray(exercise?.sets) ? exercise.sets[0] : null;
    const w = Number(s0?.target_weight_kg ?? exercise?.suggested_weight_kg);
    return Number.isFinite(w) && w >= 0 ? w : 0;
  });

  // ── Pose overlay state 
  const [jointColors, setJointColors] = useState({});
  const [keypoints, setKeypoints] = useState([]);
  const [feedbackText, setFeedbackText] = useState('');
  // Coaching-banner color override. When set (e.g. the shoulder-flexion
  // two-checkpoint guide), the banner uses this instead of deriving its color
  // from the numeric score. null = fall back to the score-based color.
  const [feedbackColor, setFeedbackColor] = useState(null);
  const [inferenceSize, setInferenceSize] = useState({ width: 1, height: 1 });
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });

  // ── Refs for the frame loop + lifecycle ───────────────────────────
  const frameCountRef = useRef(0);
  const timerRef = useRef(null);
  const watchdogRef = useRef(null);
  const finishingRef = useRef(false);
  const cameraRef = useRef(null);
  const setStartTimeRef = useRef(null);
  // Wall-clock time when startExercise fired — used to report the
  // patient's real elapsed time on the exercise (including break
  // screens) rather than estimating from set count × cap.
  const exerciseStartTimeRef = useRef(null);
  // True between sendFrame and the matching pose result.
  const inFlightRef = useRef(false);
  // Retry handle for "WS not open yet" / "capture error" → try again soon.
  const retryRef = useRef(null);
  // True while showing BreakScreen — captureAndSend short-circuits so
  // we don't burn camera + WS while the patient is resting.
  const pausedRef = useRef(false);
  // Per-set RepCounter — replaced on each set transition.
  const repCounterRef = useRef(new RepCounter(12));
  // Per-set two-checkpoint guide for shoulder flexion — replaced alongside the
  // RepCounter on each set transition. Only used when the exercise is shoulder
  // flexion; the generic RepCounter drives every other exercise.
  const sfGuideRef = useRef(new ShoulderFlexionGuide(12));
  // Per-set running score buffer (for computing this set's avg on
  // completion). Cleared on each set transition.
  const setScoreBufferRef = useRef([]);
  // holdInFormMsRef integrates
  // frame deltas while the patient is in green; brokenMsRef counts
  // consecutive ms out of green (resets on re-entry). lastFrameTimeRef
  // is the Date.now() of the previous handlePoseResult call — used
  // to compute the dt between frames since the WS arrives at variable
  // intervals (8-15 FPS depending on backend speed).
  const holdInFormMsRef = useRef(0);
  const brokenMsRef = useRef(0);
  const lastFrameTimeRef = useRef(null);
  // Latest finishCurrentSet — handlePoseResult (in usePoseResultHandler)
  // calls through this ref so it always dispatches to the current
  // version even though finishCurrentSet is defined later in this hook.
  const finishCurrentSetRef = useRef(() => {});

  //derived values
  const currentSet = sets[currentSetIndex] || sets[0];
  const setTotalSeconds = _capForSet(currentSet);
  const affectedSide = (exercise?.affected_side || 'right').toLowerCase();
  // Strength mode records a kg load per set; Functionality does not.
  const isStrengthMode = (exercise?.mode || '') === 'strength';

  // Hint string used to determine which color band to read for rep
  // counting AND used by the backend's exercise classifier. Same heuristic
  // SkeletonOverlay applies for limb-segment highlighting.
  const exerciseHint = useMemo(() => [
    exercise?.exercise_type || '',
    exercise?.name || '',
    exercise?.body_area || '',
    exercise?.focus || '',
  ].join(' ').toLowerCase(), [
    exercise?.exercise_type, exercise?.name, exercise?.body_area, exercise?.focus,
  ]);

  // Voice-over: plays the pre-generated clip for the backend's hint_key.
  // Edge-triggered + debounced inside the hook; missing clips fall back to
  // text-only. voicePlayRef keeps handlePoseResult off playHintKey's identity
  // so the frame handler's deps don't churn.
  const { playHintKey, muted: voiceMuted, toggleMute: toggleVoiceMute, voiceReady } =
    useVoicePlayback(exercise?.exercise_type);
  const voicePlayRef = useRef(null);
  useEffect(() => { voicePlayRef.current = playHintKey; }, [playHintKey]);

  //pose detection backend client
  const {
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    sendFrameBase64,
    classifyFormSequence,
  } = usePoseDetection();

  // Cross-set keypoint buffer for the end-of-exercise LSTM call. Stays
  // accumulating across sets within one exercise so the LSTM sees the
  // whole motion sequence; cleared on unmount via finishExercise.
  const keypointsBufferRef = useRef([]);

  //formats seconds into M:SS display string
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Cleanup helper — kills the wall-clock timer and any pending
  // watchdog/retry timers. Used by both finishExercise and unmount.
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

  const computeAvgScore = useCallback((history) => {
    if (!history || history.length === 0) return 0;
    const total = history.reduce((sum, s) => sum + s, 0);
    return Number((total / history.length).toFixed(1));
  }, []);

  const captureAndSend = useCallback(async () => {
    if (!timerRef.current || !cameraRef.current) return;
    if (inFlightRef.current) return;
    // Skip while paused (BreakScreen showing) so we're not feeding
    // frames into a session the patient is resting from.
    if (pausedRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.1,
        base64: true,
        shutterSound: false,
        skipProcessing: true,
      });
      if (!timerRef.current || pausedRef.current) return;

      frameCountRef.current += 1;

      const result = sendFrameBase64(photo?.base64);
      if (!result?.ok) {
        inFlightRef.current = false;
        if (result?.reason === 'not_open') {
          if (retryRef.current) clearTimeout(retryRef.current);
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            if (timerRef.current && !pausedRef.current) captureAndSend();
          }, 200);
          return;
        }
        return;
      }

      inFlightRef.current = true;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        if (inFlightRef.current) {
          inFlightRef.current = false;
          if (timerRef.current && !pausedRef.current) captureAndSend();
        }
      }, 2000);
    } catch (_) {
      inFlightRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (timerRef.current && !pausedRef.current) captureAndSend();
      }, 200);
    }
  }, [sendFrameBase64]);

  // Frame-result processing (rep/hold tracking, HUD state, voice cues)
  // and end-of-exercise finalization live in usePoseResultHandler —
  // extracted out since this hook's body was getting unwieldy. See
  // that file for the per-frame logic and the finishExercise call paths.
  const { stableHandlePoseResult, handlePoseClose, finishExercise } = usePoseResultHandler({
    exercise,
    onComplete,
    currentSet,
    currentSetIndex,
    currentWeightKg,
    exerciseHint,
    setTotalSeconds,
    completedSetResults,
    setInferenceSize,
    setKeypoints,
    setCurrentScore,
    setJointColors,
    setRepProgress,
    setHoldProgress,
    setFeedbackText,
    setFeedbackColor,
    setIsExercising,
    watchdogRef,
    retryRef,
    pausedRef,
    inFlightRef,
    keypointsBufferRef,
    setScoreBufferRef,
    lastFrameTimeRef,
    repCounterRef,
    sfGuideRef,
    holdInFormMsRef,
    brokenMsRef,
    voicePlayRef,
    finishingRef,
    exerciseStartTimeRef,
    finishCurrentSetRef,
    captureAndSend,
    clearIntervals,
    computeAvgScore,
    stopDetection,
    classifyFormSequence,
  });

  
  const beginSetTimers = useCallback((nextSet) => {
    const targetReps = nextSet?.target_reps || 12;
    const targetSeconds = _capForSet(nextSet);
    // Functionality sets carry hold_seconds_per_rep → the RepCounter only
    // counts a rep after that sustained green hold. Strength/plain sets pass
    // 0 and count on entry, as before.
    const holdMsPerRep = Number(nextSet?.hold_seconds_per_rep || 0) * 1000;
    repCounterRef.current = new RepCounter(targetReps, holdMsPerRep);
    // Fresh shoulder-flexion guide for the set. Uses the SAME per-rep hold as
    // the RepCounter (0 = count on reaching the top, like plain-rep sets; a
    // Functionality set's hold_seconds_per_rep makes each top a sustained
    // hold). Passing 0 rather than forcing 6s keeps a 12-rep set inside the
    // time cap.
    sfGuideRef.current = new ShoulderFlexionGuide(targetReps, holdMsPerRep);
    setScoreBufferRef.current = [];
    holdInFormMsRef.current = 0;
    brokenMsRef.current = 0;
    lastFrameTimeRef.current = null;
    setRepProgress({
      repsCompleted: 0,
      targetReps,
      setComplete: false,
      state: 'initial',
    });
    setHoldProgress({
      secondsInForm: 0,
      brokenSeconds: 0,
      targetSeconds,
    });
    setCurrentScore(0);
    setSetElapsedSeconds(0);

    setStartTimeRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - setStartTimeRef.current) / 1000);
      setSetElapsedSeconds(elapsed);
    }, 500);
  }, []);

  // Internal: wrap up the current set, transition to break OR to
  // finishExercise if this was the last set. Saves the set's avg score
  // and reps to the completed arrays. Pauses the capture loop until
  // the patient taps "Start Next Set".
  //
  // finishCurrentSetRef (declared with the other refs above) is used
  // because handlePoseResult, in usePoseResultHandler, needs to call
  // it inside its closure, and we want to avoid stale-closure bugs
  // when the set index changes.
  const finishCurrentSet = useCallback((endedVia = 'finish') => {
    if (pausedRef.current) return; // already between sets
    pausedRef.current = true;

    // Build the structured set result. Score calculation depends on
    // the format:
    //   - reps: average form quality across the set's frames.
    //   - hold: completion % = (seconds in form / target) × 100,
    //           capped at 100 to absorb clock drift.
    const isHoldSet = currentSet?.format === 'hold';
    const targetSeconds = _capForSet(currentSet);
    let setResult;
    if (isHoldSet) {
      const heldMs = holdInFormMsRef.current;
      const heldSeconds = Math.floor(heldMs / 1000);
      const score = targetSeconds > 0
        ? Math.min(100, Math.round((heldMs / (targetSeconds * 1000)) * 100))
        : 0;
      setResult = {
        set_index: currentSetIndex,
        format: 'hold',
        score,
        seconds_held: heldSeconds,
        target_seconds: targetSeconds,
        ended_via: endedVia,
      };
    } else {
      const score = computeAvgScore(setScoreBufferRef.current);
      setResult = {
        set_index: currentSetIndex,
        format: 'reps',
        score,
        // Shoulder flexion counts reps in sfGuideRef; every other exercise in
        // repCounterRef. Only one is ever advanced per exercise, so max() picks
        // the live counter without needing the exercise check here.
        reps_completed: Math.max(
          repCounterRef.current.repsCompleted,
          sfGuideRef.current.repsCompleted,
        ),
        target_reps: currentSet?.target_reps || 12,
        hold_seconds_per_rep: currentSet?.hold_seconds_per_rep ?? null,
        weight_kg: currentSet?.target_weight_kg != null ? currentWeightKg : null,
        ended_via: endedVia,
      };
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const isLastSet = currentSetIndex >= sets.length - 1;
    if (isLastSet) {
      // Last set: finish the entire exercise. Pass this set's full
      // result so finishExercise can include it without waiting for
      // a React state flush.
      finishExercise(endedVia, setResult);
      return;
    }

    // Save this set's result and pop the BreakScreen.
    setCompletedSetResults((prev) => [...prev, setResult]);
    setIsBetweenSets(true);
  }, [computeAvgScore, currentSet, currentSetIndex, sets.length, finishExercise, isStrengthMode, currentWeightKg]);

  // Keep the ref pointing at the latest finishCurrentSet so the
  // handlePoseResult closure always calls the current version.
  useEffect(() => {
    finishCurrentSetRef.current = finishCurrentSet;
  }, [finishCurrentSet]);

  // Exit the BreakScreen and begin the next set. Called by the
  // BreakScreen's "Start Next Set" button.
  const startNextSet = useCallback(() => {
    if (!isBetweenSets) return;
    const nextIndex = currentSetIndex + 1;
    if (nextIndex >= sets.length) {
      // Defensive: shouldn't happen (BreakScreen wouldn't render on
      // the last set), but if it does, finish cleanly instead of
      // running off the end of the sets array.
      finishExercise('finish');
      return;
    }
    const nextSet = sets[nextIndex];
    setCurrentSetIndex(nextIndex);
    setIsBetweenSets(false);
    pausedRef.current = false;
    beginSetTimers(nextSet);
    // Restart the capture loop.
    captureAndSend();
  }, [isBetweenSets, currentSetIndex, sets, beginSetTimers, captureAndSend, finishExercise]);

  // Initial start: from BeforeYouStart's "I'm ready" button. Connects
  // the WS, begins set 0, kicks the frame loop.
  const startExercise = useCallback(() => {
    finishingRef.current = false;
    inFlightRef.current = false;
    pausedRef.current = false;
    setIsExercising(true);
    setIsBetweenSets(false);
    setCurrentSetIndex(0);
    setJointColors({});
    setKeypoints([]);
    setFeedbackText('Preparing pose detection…');
    setCompletedSetResults([]);
    frameCountRef.current = 0;
    keypointsBufferRef.current = [];
    // Capture start time so finishExercise can report real elapsed
    // (instead of the worst-case sets-times-cap estimate).
    exerciseStartTimeRef.current = Date.now();

    beginSetTimers(sets[0]);

    const loadModelAndStartDetection = async () => {
      try {
        const ready = await startDetection(
          exerciseHint,
          affectedSide,
          stableHandlePoseResult,
          handlePoseClose,
          exercise?.exercise_type || '',
        );
        if (!ready) {
          setFeedbackText('Pose detection unavailable — exercise without skeleton');
          return;
        }
        setFeedbackText('Pose detection active — step back to show your body');
        captureAndSend();
      } catch (err) {
        console.error('Model load error:', err);
        setFeedbackText('Pose detection failed to load');
      }
    };

    loadModelAndStartDetection();
  }, [
    startDetection, captureAndSend, stableHandlePoseResult, handlePoseClose,
    exerciseHint, affectedSide, sets, beginSetTimers,
  ]);

  // Per-set time-cap auto-finish. Rep sets cap at REP_SET_CAP_SECONDS
  // (2 min); hold sets cap at their hold_seconds (5 min for now). When
  // the cap hits, finishCurrentSet handles transition to break or to
  // finishExercise if this was the last set.
  useEffect(() => {
    if (!isExercising || isBetweenSets) return;
    if (setElapsedSeconds >= setTotalSeconds) {
      finishCurrentSet('finish');
    }
  }, [setElapsedSeconds, isExercising, isBetweenSets, setTotalSeconds, finishCurrentSet]);

  // Cleanup on unmount — kill timers + close WS. Score reporting is the
  // parent's job; if it swapped us out (rest state, next exercise) it
  // already called finishExercise.
  useEffect(() => {
    return () => {
      clearIntervals();
      stopDetection();
      inFlightRef.current = false;
      pausedRef.current = false;
    };
  }, [clearIntervals, stopDetection]);

  const handleCameraLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setCameraLayout({ width, height });
  }, []);

  return {
    //refs
    cameraRef,
    //exercise state (per-set)
    isExercising,
    isBetweenSets,
    currentSetIndex,
    totalSets: sets.length,
    currentSet,
    setElapsedSeconds,
    setTotalSeconds,
    currentScore,
    repProgress,
    holdProgress,
    completedSetResults,
    //strength load (kg)
    isStrengthMode,
    currentWeightKg,
    setCurrentWeightKg,
    //pose overlay
    jointColors,
    keypoints,
    feedbackText,
    feedbackColor,
    inferenceSize,
    cameraLayout,
    affectedSide,
    //pose detection state
    isModelReady,
    modelError,
    //voice-over
    voiceMuted,
    toggleVoiceMute,
    voiceReady,
    //actions
    startExercise,
    finishCurrentSet,
    startNextSet,
    finishExercise,
    formatTime,
    handleCameraLayout,
  };
};

export default useCamera;
