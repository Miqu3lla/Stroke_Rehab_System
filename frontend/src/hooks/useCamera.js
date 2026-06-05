import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import usePoseDetection from './usePoseDetection';
import RepCounter, {
  pickActiveColor,
  repAwareHint,
  COLOR_GREEN,
} from '../utils/repCounter';

// useCamera owns the per-exercise execution flow: the camera, the
// WebSocket pose loop, the per-set timer + rep counter, and the
// rest-between-sets pause. The parent (ExerciseScreen / CameraComponent)
// reads `isBetweenSets` to decide whether to render the BreakScreen
// overlay vs the active-set HUD.
//
// Phase C (2026-06-04) restructured this hook around sets:
//   - exercise.sets[] from the recommender drives execution
//   - Each rep set ends when RepCounter hits target_reps OR the per-set
//     2-minute cap elapses (whichever comes first)
//   - Each hold set ends when its hold_seconds cap elapses (Phase D
//     will refine this with form-broken detection)
//   - Between sets the capture loop pauses (no frames sent) until the
//     patient taps "Start Next Set" on the BreakScreen
//   - Across sets within an exercise the WebSocket stays connected so
//     pose detection doesn't re-handshake between sets
//
// Phase 2 frame loop (since 2026-06-04 earlier): backpressure-driven via
// WebSocket. Each capture+send is followed by an inFlight flag that's
// only cleared when the server's pose result arrives OR when a 2-second
// watchdog fires (network glitch recovery).

// Worst-case per-set timer caps. Rep sets have a hard 2-minute cap so a
// patient stalled at rep 5/12 still progresses to the next set. Hold
// sets run for their full hold_seconds target (300s = 5 min stretch
// goal). Phase D (2026-06-04) adds the form-broken-too-long auto-end
// for holds via HOLD_FORM_BROKEN_LIMIT_MS — a patient out of the green
// band for 30s straight auto-ends the hold without resetting
// (resetting would be too punishing in stroke rehab).
const REP_SET_CAP_SECONDS = 120;
const HOLD_FORM_BROKEN_LIMIT_MS = 30 * 1000;

// Default sets payload when an exercise is missing the sets[] field —
// shouldn't happen in production (recommender always returns sets), but
// keeps the hook safe against older response shapes during the deploy
// window.
const _fallbackSets = () => [
  { set_index: 0, format: 'reps', target_reps: 12, hold_seconds: null },
  { set_index: 1, format: 'reps', target_reps: 12, hold_seconds: null },
  { set_index: 2, format: 'reps', target_reps: 12, hold_seconds: null },
];

const _capForSet = (set) => {
  if (!set) return REP_SET_CAP_SECONDS;
  if (set.format === 'hold') {
    return Math.max(1, Number(set.hold_seconds) || 0);
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
  const [scoreHistory, setScoreHistory] = useState([]); // live current-set scores
  // Per-set RepCounter snapshot, surfaced for the HUD
  const [repProgress, setRepProgress] = useState({
    repsCompleted: 0,
    targetReps: 12,
    setComplete: false,
    state: 'initial',
  });
  // Per-set hold progress, surfaced for the HUD on hold sets. Phase D
  // tracks two things:
  //   - secondsInForm: cumulative time the patient held the green band
  //                    (used to compute the hold's completion %)
  //   - brokenSeconds: consecutive seconds out of the green band (resets
  //                    to 0 the moment they re-enter green). When this
  //                    reaches HOLD_FORM_BROKEN_LIMIT_MS the set auto-ends.
  // Both are 0 when format='reps'.
  const [holdProgress, setHoldProgress] = useState({
    secondsInForm: 0,
    brokenSeconds: 0,
    targetSeconds: 300,
  });
  // Completed sets' structured results — flushed to the parent on
  // exercise completion as setResults[]. Phase E (2026-06-04) replaced
  // the old parallel completedSetScores/completedSetReps arrays with a
  // single rich-object list so the backend can persist format-aware
  // data (rep form % vs hold completion %) for the therapist
  // dashboard's fatigue curve.
  //
  // Each entry: {
  //   set_index, format ('reps' | 'hold'), score,
  //   reps_completed, target_reps,                  // 'reps' only
  //   seconds_held, target_seconds,                 // 'hold' only
  //   ended_via                                     // per-set end reason
  // }
  const [completedSetResults, setCompletedSetResults] = useState([]);

  // ── Pose overlay state ────────────────────────────────────────────
  const [jointColors, setJointColors] = useState({});
  const [keypoints, setKeypoints] = useState([]);
  const [feedbackText, setFeedbackText] = useState('');
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
  // Per-set running score buffer (for computing this set's avg on
  // completion). Cleared on each set transition.
  const setScoreBufferRef = useRef([]);
  // Phase D hold-tracking accumulators. holdInFormMsRef integrates
  // frame deltas while the patient is in green; brokenMsRef counts
  // consecutive ms out of green (resets on re-entry). lastFrameTimeRef
  // is the Date.now() of the previous handlePoseResult call — used
  // to compute the dt between frames since the WS arrives at variable
  // intervals (8-15 FPS depending on backend speed).
  const holdInFormMsRef = useRef(0);
  const brokenMsRef = useRef(0);
  const lastFrameTimeRef = useRef(null);

  //derived values
  const currentSet = sets[currentSetIndex] || sets[0];
  const setTotalSeconds = _capForSet(currentSet);
  const affectedSide = (exercise?.affected_side || 'right').toLowerCase();

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

  // Finalize the entire exercise — flushes the LSTM sequence and calls
  // the parent's onComplete with the cumulative set results. endedVia
  // distinguishes natural completion ('finish') from early-exit
  // ('end_early'); both still earn whatever partial set scores were
  // captured.
  //
  // Three call paths:
  //   1. Last set completes naturally → finishCurrentSet passes
  //      extraSetResult so the last set is included without waiting
  //      for a React state flush.
  //   2. Patient taps "End Early" mid-set in the HUD → we're NOT
  //      paused, scoreBuffer has the partial set's frames. Roll the
  //      partial set up so a patient who quit at rep 6/12 still earns
  //      those reps.
  //   3. Patient taps "End Early" on the BreakScreen → we ARE paused,
  //      no partial to capture. Just use completedSetResults as-is.
  const finishExercise = useCallback((endedVia = 'finish', extraSetResult = null) => {
    if (finishingRef.current) return;
    finishingRef.current = true;

    clearIntervals();
    setIsExercising(false);
    stopDetection();
    inFlightRef.current = false;

    let finalSetResults;
    if (extraSetResult) {
      // Path 1: last-set natural completion.
      finalSetResults = [...completedSetResults, extraSetResult];
    } else if (!pausedRef.current && setScoreBufferRef.current.length > 0) {
      // Path 2: mid-set "End Early" — fold the partial set in.
      const isHoldSet = currentSet?.format === 'hold';
      let partial;
      if (isHoldSet) {
        const targetSeconds = _capForSet(currentSet);
        const heldMs = holdInFormMsRef.current;
        partial = {
          set_index: currentSetIndex,
          format: 'hold',
          score: targetSeconds > 0
            ? Math.min(100, Math.round((heldMs / (targetSeconds * 1000)) * 100))
            : 0,
          seconds_held: Math.floor(heldMs / 1000),
          target_seconds: targetSeconds,
          ended_via: endedVia,
        };
      } else {
        partial = {
          set_index: currentSetIndex,
          format: 'reps',
          score: computeAvgScore(setScoreBufferRef.current),
          reps_completed: repCounterRef.current.repsCompleted,
          target_reps: currentSet?.target_reps || 12,
          ended_via: endedVia,
        };
      }
      finalSetResults = [...completedSetResults, partial];
    } else {
      // Path 3: BreakScreen "End Early" — between sets, nothing to add.
      finalSetResults = completedSetResults;
    }

    pausedRef.current = false;

    // Headline avgFormScore is REP SETS ONLY so hold completion %
    // doesn't bleed into the form-quality number the trajectory
    // analyzer reads and the dashboard displays. Holds are tracked
    // separately as `holdScore` for the therapist's endurance view.
    const repResults = finalSetResults.filter((r) => r.format === 'reps');
    const avgFormScore = computeAvgScore(repResults.map((r) => r.score));
    const holdResult = finalSetResults.find((r) => r.format === 'hold') || null;
    const holdScore = holdResult ? holdResult.score : null;
    // Real elapsed wall-clock since startExercise (covers sets + break
    // time + the BeforeYouStart-to-first-frame delay). Falls back to
    // a cap-based estimate only if the start time was never recorded
    // (defensive — shouldn't happen).
    const durationSeconds = exerciseStartTimeRef.current
      ? Math.floor((Date.now() - exerciseStartTimeRef.current) / 1000)
      : finalSetResults.length * REP_SET_CAP_SECONDS;

    // Snapshot + clear the keypoint buffer so the next exercise's hook
    // instance starts clean.
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
        durationSeconds,
        endedVia,
        setResults: finalSetResults,
        holdScore,
        mode: exercise?.mode || null,
      });
    }
    // Don't reset finishingRef — the parent swaps us out of the active
    // tree (to RestState), and the next exercise gets a fresh hook
    // instance via key=exercise.id.
  }, [
    clearIntervals,
    stopDetection,
    completedSetResults,
    currentSet,
    currentSetIndex,
    onComplete,
    computeAvgScore,
    classifyFormSequence,
    exercise,
  ]);

  // Captures one frame from the camera and ships it down the WS as
  // binary. Sets the in-flight flag so the next call short-circuits
  // until the result lands. The watchdog backstops a missing result.
  //
  // Retry policy (CodeRabbit review 2026-06-04):
  //   - 'not_open'    → handshake still in flight → schedule a 200ms retry
  //   - 'closed'      → socket is gone → STOP the loop
  //   - 'send_failed' → runtime error → also stop
  //   - catch block   → transient capture error (orientation, busy
  //                     camera) → schedule a 200ms retry
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

  // Per-set RepCounter / score update on every WS pose result. Returns
  // a flag the caller checks: if the set just completed, the caller
  // skips the next captureAndSend (the set-end path will take over).
  // Server may also send error payloads ({error: 'decode_failed' | ...})
  // — treat those as no-op: don't clear the skeleton, don't advance
  // reps, just unblock the loop.
  const handlePoseResult = useCallback((result) => {
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
      const frameKeypoints = result.keypoints || [];
      setKeypoints(frameKeypoints);
      if (Array.isArray(frameKeypoints) && frameKeypoints.length > 0) {
        keypointsBufferRef.current.push(frameKeypoints);
      }
      if (score !== null && score !== undefined) {
        setCurrentScore(score);
        setScoreHistory((prev) => [...prev, score]);
        setScoreBufferRef.current.push(score);
      }
      setJointColors(colors);

      // Advance the rep counter for rep-format sets. Hold sets ignore
      // RepCounter entirely (handled by timer-only in Phase C; Phase D
      // will add form-broken-too-long tracking).
      //
      // Hint resolution order (rep sets):
      //   1. Run repAwareHint against the *new* state — overrides the
      //      backend's "Hold your arm at shoulder height" wording when
      //      the patient has just counted a rep (they should be
      //      returning to start, not holding).
      //   2. If no override applies, the WS hint stands (ascent
      //      guidance is correct mid-set).
      if (currentSet?.format === 'reps') {
        const activeColor = pickActiveColor(colors, exerciseHint);
        const snapshot = repCounterRef.current.update(activeColor);
        setRepProgress(snapshot);

        const hintForRep = repAwareHint(snapshot, activeColor, result.hint);
        if (hintForRep) setFeedbackText(hintForRep);

        if (snapshot.setComplete) {
          // Set finished by rep target. Cap is handled by the elapsed-
          // time effect below; this is the rep-driven path.
          finishCurrentSetRef.current?.('finish');
          inFlightRef.current = false;
          return;
        }
      } else if (currentSet?.format === 'hold') {
        // Phase D hold tracking. Integrate dt between frames so the
        // hold counter is accurate even when the WS frame rate jitters.
        // First frame of the set has no prior dt — bill it as 0.
        const now = Date.now();
        const dt = lastFrameTimeRef.current ? Math.max(0, now - lastFrameTimeRef.current) : 0;
        lastFrameTimeRef.current = now;

        const activeColor = pickActiveColor(colors, exerciseHint);
        const isInForm = activeColor === COLOR_GREEN;

        if (isInForm) {
          holdInFormMsRef.current += dt;
          brokenMsRef.current = 0;
        } else {
          brokenMsRef.current += dt;
        }

        // Surface the hold meters to the HUD. Keeping them in seconds
        // for display while the refs stay in ms for precision.
        setHoldProgress({
          secondsInForm: Math.floor(holdInFormMsRef.current / 1000),
          brokenSeconds: Math.floor(brokenMsRef.current / 1000),
          targetSeconds: setTotalSeconds,
        });

        // Hint for hold: when actively in form, encourage the patient
        // to hold; when broken, surface the countdown to auto-end.
        if (brokenMsRef.current >= 1000) {
          const remainingMs = Math.max(0, HOLD_FORM_BROKEN_LIMIT_MS - brokenMsRef.current);
          const remainingSec = Math.ceil(remainingMs / 1000);
          setFeedbackText(`Form broken — ${remainingSec}s before the set ends`);
        } else if (isInForm) {
          setFeedbackText('Keep holding — every second counts');
        } else if (result.hint) {
          // Brief out-of-form moments (< 1s) — show the backend hint
          // so the patient knows how to correct without the alarming
          // countdown text yet.
          setFeedbackText(result.hint);
        }

        // Auto-end if patient has been out of form for the full window.
        if (brokenMsRef.current >= HOLD_FORM_BROKEN_LIMIT_MS) {
          finishCurrentSetRef.current?.('form_broken');
          inFlightRef.current = false;
          return;
        }
      } else {
        // Unknown set format — fall back to the backend hint.
        if (result.hint) setFeedbackText(result.hint);
      }
    }

    inFlightRef.current = false;
    if (timerRef.current && !pausedRef.current) {
      captureAndSend();
    }
  }, [captureAndSend, currentSet?.format, exerciseHint]);

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

  // Begin set N: reset the per-set state, restart the wall-clock
  // timer, kick the capture loop. Called by startExercise (set 0) and
  // by startNextSet (subsequent sets). Does NOT touch the WS — that's
  // owned by startDetection / stopDetection and stays connected across
  // sets within an exercise.
  const beginSetTimers = useCallback((nextSet) => {
    const targetReps = nextSet?.target_reps || 12;
    const targetSeconds = _capForSet(nextSet);
    repCounterRef.current = new RepCounter(targetReps);
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
    setScoreHistory([]);
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
  // Held as a ref because handlePoseResult needs to call it inside its
  // closure, and we want to avoid stale-closure bugs when the set
  // index changes.
  const finishCurrentSetRef = useRef(() => {});
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
        reps_completed: repCounterRef.current.repsCompleted,
        target_reps: currentSet?.target_reps || 12,
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
  }, [computeAvgScore, currentSet, currentSetIndex, sets.length, finishExercise]);

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
          handlePoseResult,
          handlePoseClose,
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
    startDetection, captureAndSend, handlePoseResult, handlePoseClose,
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
    scoreHistory,
    repProgress,
    holdProgress,
    completedSetResults,
    //pose overlay
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
    finishCurrentSet,
    startNextSet,
    finishExercise,
    formatTime,
    handleCameraLayout,
  };
};

export default useCamera;
