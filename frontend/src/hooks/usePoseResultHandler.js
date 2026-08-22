import { useRef, useEffect, useCallback } from 'react';
import { pickActiveColor, repAwareHint, COLOR_GREEN } from '../utils/repCounter';

const REP_SET_CAP_SECONDS = 120;
const HOLD_FORM_BROKEN_LIMIT_MS = 30 * 1000;
const MAX_FRAME_DT_MS = 500;

const _capForSet = (set) => {
  if (!set) return REP_SET_CAP_SECONDS;
  if (set.format === 'hold') {
    const raw = Number(set.hold_seconds);
    if (!Number.isFinite(raw) || raw <= 0) return 300;
    return Math.max(60, raw);
  }
  return REP_SET_CAP_SECONDS;
};

// Owns the per-frame pose result handling (rep/hold tracking, HUD
// state, voice cues) and the end-of-exercise finalization. Extracted
// from useCamera so that hook's per-render body stays focused on
// wiring state/refs together rather than the frame-processing logic
// itself. Every param below used to be a local var/setter/ref inside
// useCamera — nothing here changed behavior, only location.
const usePoseResultHandler = ({
  // exercise/session context
  exercise,
  onComplete,
  currentSet,
  currentSetIndex,
  currentWeightKg,
  exerciseHint,
  setTotalSeconds,
  completedSetResults,
  // state setters
  setInferenceSize,
  setKeypoints,
  setCurrentScore,
  setJointColors,
  setRepProgress,
  setHoldProgress,
  setFeedbackText,
  setFeedbackColor,
  setIsExercising,
  // refs shared with useCamera
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
  // callbacks from sibling hooks/callbacks
  captureAndSend,
  clearIntervals,
  computeAvgScore,
  stopDetection,
  classifyFormSequence,
}) => {
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
          // Shoulder flexion counts in sfGuideRef, others in repCounterRef;
          // only one advances per exercise, so max() picks the live one.
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
    currentWeightKg,
    finishingRef,
    setIsExercising,
    inFlightRef,
    pausedRef,
    setScoreBufferRef,
    holdInFormMsRef,
    repCounterRef,
    exerciseStartTimeRef,
    keypointsBufferRef,
  ]);

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

    // Drop late frames that arrive after the BreakScreen took over —
    // processing them would advance reps/hold counters for a set the
    // patient already finished.
    if (pausedRef.current) {
      inFlightRef.current = false;
      return;
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
        setScoreBufferRef.current.push(score);
      }
      // Time since the previous processed frame. The WS arrives at a
      // jittery 8-15 FPS, so every per-frame accumulator (functionality
      // hold-per-rep AND hold-set tracking) integrates this dt instead of
      // assuming a fixed rate. First frame of a set has no prior dt → 0.
      const now = Date.now();
      const dt = lastFrameTimeRef.current
        ? Math.min(MAX_FRAME_DT_MS, Math.max(0, now - lastFrameTimeRef.current))
        : 0;
      lastFrameTimeRef.current = now;

      // ── Shoulder flexion: two-checkpoint guided flow ───────────────────
      // Its own state machine (START arm-down = green → raise → TOP overhead =
      // green → hold N s → rep) drives the banner color, skeleton color, reps,
      // and voice for this exercise, replacing the generic RepCounter. It reads
      // the raw shoulder angle (result.angles.bicepCurl), so the two green ends
      // are unambiguous. currentScore/scoreBuffer above stay the raw overhead
      // form quality, so the analytics average isn't skewed by the checkpoints.
      const isShoulderFlexion = /shoulder[_ ]?flexion/i.test(exerciseHint || '');
      if (isShoulderFlexion && currentSet?.format === 'reps') {
        const snap = sfGuideRef.current.update(
          result.angles?.bicepCurl ?? null,
          result.angles?.elbowAngle ?? null,
          dt,
        );
        // Skeleton arm + banner both follow the checkpoint color.
        setJointColors({ ...colors, bicepCurl: snap.color });
        setFeedbackColor(snap.color);
        voicePlayRef.current?.(snap.hintKey);
        setRepProgress((prev) =>
          prev.repsCompleted === snap.repsCompleted
            && prev.state === snap.state
            && prev.setComplete === snap.setComplete
            && prev.targetReps === snap.targetReps
            ? prev
            : {
                repsCompleted: snap.repsCompleted,
                targetReps: snap.targetReps,
                setComplete: snap.setComplete,
                state: snap.state,
              }
        );
        if (snap.feedbackText) setFeedbackText(snap.feedbackText);
        if (snap.setComplete) {
          finishCurrentSetRef.current?.('finish');
          inFlightRef.current = false;
          return;
        }
        inFlightRef.current = false;
        if (captureAndSend) captureAndSend();
        return;
      }

      setJointColors(colors);
      setFeedbackColor(null);

      // Voice cue for this frame's form state. The hook edge-triggers on
      // hint_key change (with a cooldown) so this fires every frame cheaply.
      voicePlayRef.current?.(result.hint_key);

      // Advance the rep counter for rep-format sets. Hold sets ignore
      // RepCounter entirely (handled by the timer + form-broken tracking).
      //
      // Hint resolution order (rep sets):
      //   1. Functionality hold-per-rep in progress → show the live
      //      "hold Ns of Ms" countdown so the patient knows to keep still.
      //   2. Otherwise repAwareHint overrides the backend wording when a
      //      rep just counted (return to start, not hold).
      //   3. Else the WS hint stands (ascent guidance is correct mid-set).
      if (currentSet?.format === 'reps') {
        const activeColor = pickActiveColor(colors, exerciseHint);
        const snapshot = repCounterRef.current.update(activeColor, dt);
        // 8-15Hz rerenders cost: only flush if something user-visible
        // changed. The rep state machine churns AT_TOP↔WAITING_FOR_TOP
        // many times per rep — only the counted-reps and the
        // state-name matter to the HUD. (currentHoldMs is surfaced via
        // feedbackText instead, so it stays out of this diff.)
        setRepProgress((prev) =>
          prev.repsCompleted === snapshot.repsCompleted
            && prev.state === snapshot.state
            && prev.setComplete === snapshot.setComplete
            && prev.targetReps === snapshot.targetReps
            ? prev
            : snapshot
        );

        let hintForRep;
        if (snapshot.holdMsPerRep > 0
            && activeColor === COLOR_GREEN
            && snapshot.state === 'waiting_for_top'
            && snapshot.currentHoldMs > 0) {
          const heldS = Math.floor(snapshot.currentHoldMs / 1000);
          const targetS = Math.round(snapshot.holdMsPerRep / 1000);
          hintForRep = `Hold it — ${heldS}s of ${targetS}s`;
        } else {
          hintForRep = repAwareHint(snapshot, activeColor, result.hint);
        }
        if (hintForRep) setFeedbackText(hintForRep);

        if (snapshot.setComplete) {
          // Set finished by rep target. Cap is handled by the elapsed-
          // time effect below; this is the rep-driven path.
          finishCurrentSetRef.current?.('finish');
          inFlightRef.current = false;
          return;
        }
      } else if (currentSet?.format === 'hold') {
        const activeColor = pickActiveColor(colors, exerciseHint);
        const isInForm = activeColor === COLOR_GREEN;

        if (isInForm) {
          holdInFormMsRef.current += dt;
          brokenMsRef.current = 0;
        } else {
          brokenMsRef.current += dt;
        }

        // Surface the hold meters to the HUD. Keeping them in seconds
        // for display while the refs stay in ms for precision. Diff-
        // check to avoid 8-15Hz rerenders when the second hasn't
        // ticked over yet.
        const nextSecondsInForm = Math.floor(holdInFormMsRef.current / 1000);
        const nextBrokenSeconds = Math.floor(brokenMsRef.current / 1000);
        setHoldProgress((prev) =>
          prev.secondsInForm === nextSecondsInForm
            && prev.brokenSeconds === nextBrokenSeconds
            && prev.targetSeconds === setTotalSeconds
            ? prev
            : {
                secondsInForm: nextSecondsInForm,
                brokenSeconds: nextBrokenSeconds,
                targetSeconds: setTotalSeconds,
              }
        );

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
    if (captureAndSend) {
      captureAndSend();
    }
  }, [captureAndSend, currentSet?.format, exerciseHint, setTotalSeconds]);

  // Latest handlePoseResult — kept in a ref so the stable wrapper
  // passed to startDetection never reads a stale closure when
  // currentSet.format flips mid-exercise (reps → hold transition).
  const handlePoseResultRef = useRef(() => {});
  useEffect(() => {
    handlePoseResultRef.current = handlePoseResult;
  }, [handlePoseResult]);

  // Stable wrapper handed to startDetection — identity never changes,
  // so the WS handler set up at startDetection time always dispatches
  // to the LATEST handlePoseResult via the ref.
  const stableHandlePoseResult = useCallback((result) => {
    handlePoseResultRef.current?.(result);
  }, []);

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
  }, [inFlightRef, watchdogRef, retryRef]);

  return { stableHandlePoseResult, handlePoseClose, finishExercise };
};

export default usePoseResultHandler;
