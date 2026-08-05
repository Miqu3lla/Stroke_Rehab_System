import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useCamera from '../../hooks/useCamera';
import SkeletonOverlay from './SkeletonOverlay';
import BeforeYouStart from './BeforeYouStart';
import BreakScreen from './BreakScreen';
import { isLegExercise } from '../../utils/repCounter';

// CameraComponent runs a single exercise from the session playlist.
// Phase C (2026-06-04) restructured it around sets — the camera and
// WebSocket stay mounted across sets within an exercise; only the HUD
// content swaps between the active-set display and the BreakScreen
// overlay. onComplete is called once at the end of the LAST set (or
// when the patient taps "End Early" anywhere mid-exercise).
export default function CameraComponent({ exercise, onComplete }) {
  const [permission, requestPermission] = useCameraPermissions();

  // Small capture size for Android so each frame is grabbed cheaply instead
  // of at full sensor resolution. Null until the camera picks one.
  const [pictureSize, setPictureSize] = useState(null);

  const {
    cameraRef,
    isExercising,
    isBetweenSets,
    currentSetIndex,
    totalSets,
    currentSet,
    setElapsedSeconds,
    setTotalSeconds,
    currentScore,
    jointColors,
    keypoints,
    feedbackText,
    feedbackColor,
    inferenceSize,
    cameraLayout,
    affectedSide,
    repProgress,
    holdProgress,
    completedSetResults,
    isStrengthMode,
    currentWeightKg,
    setCurrentWeightKg,
    isModelReady,
    modelError,
    startExercise,
    finishCurrentSet,
    startNextSet,
    finishExercise,
    formatTime,
    handleCameraLayout,
  } = useCamera(exercise, { onComplete });

  // Android only: pick the smallest supported capture size >= 640px wide so
  // frames are cheap to grab. iOS is already fast, so we leave it alone.
  const handleCameraReady = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync?.();
      if (!Array.isArray(sizes) || sizes.length === 0) return;
      // Sizes are "WIDTHxHEIGHT" strings; sort by area, smallest first.
      const parsed = sizes
        .map((s) => {
          const [w, h] = String(s).split('x').map(Number);
          return { size: s, w, h };
        })
        .filter((p) => Number.isFinite(p.w) && Number.isFinite(p.h))
        .sort((a, b) => a.w * a.h - b.w * b.h);
      const pick = parsed.find((p) => p.w >= 640) || parsed[parsed.length - 1];
      if (pick) setPictureSize(pick.size);
    } catch (_) {
      // Non-fatal — camera just uses its default size.
    }
  }, [cameraRef]);

  // Strength load stepper: patient enters the kg they're actually using.
  // 0.5 kg steps, floored at 0 (unloaded). Applies to the current set and
  // carries forward as the default for the next.
  const WEIGHT_STEP_KG = Number(exercise?.weight_increment_kg) || 0.5;
  const adjustWeight = (delta) =>
    setCurrentWeightKg((w) => Math.max(0, Math.round((Number(w || 0) + delta) * 10) / 10));

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 justify-center bg-[#0f1116]">
        <Text className="text-center text-[#e6e9f2] mb-2.5">We need your permission to show the camera</Text>
        <TouchableOpacity className="self-center mt-4 bg-[#0c56d0] rounded-full py-3.5 px-6" onPress={requestPermission}>
          <Text className="text-white font-bold text-base">Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // BreakScreen needs labels for the set just completed and the next.
  // Holds are always the last set (see _build_sets), so the BreakScreen
  // only ever shows after a rep set — the structured result we read
  // here will always have format='reps'.
  const lastFinishedResult = completedSetResults[completedSetResults.length - 1] || {};
  const lastFinishedScore = lastFinishedResult.score ?? 0;
  const lastFinishedReps = lastFinishedResult.reps_completed ?? 0;
  const lastFinishedTarget = lastFinishedResult.target_reps
    || exercise?.sets?.[currentSetIndex]?.target_reps
    || 12;
  const nextSet = exercise?.sets?.[currentSetIndex + 1];
  const upNextLabel = nextSet
    ? (nextSet.format === 'hold'
        ? `5-minute hold (Set ${currentSetIndex + 2} of ${totalSets})`
        : `Set ${currentSetIndex + 2} of ${totalSets}`)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#0f1116' }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="front"
        animateShutter={false}
        mute
        pictureSize={pictureSize || undefined}
        onCameraReady={handleCameraReady}
        onLayout={handleCameraLayout}
      />

      <SkeletonOverlay
        keypoints={keypoints}
        jointColors={jointColors}
        viewWidth={cameraLayout.width}
        viewHeight={cameraLayout.height}
        imageWidth={inferenceSize.width}
        imageHeight={inferenceSize.height}
        affectedSide={affectedSide}
        exerciseType={exercise?.name || ''}
      />

      {/* Pre-exercise overlay */}
      {!isExercising && (
        <View style={StyleSheet.absoluteFill}>
          <BeforeYouStart exercise={exercise} onBegin={startExercise} />
        </View>
      )}

      {/* Active-set HUD — hidden when between sets so the BreakScreen
          gets the full canvas without competing labels/buttons. */}
      {isExercising && !isBetweenSets && (
        <>
          <View className="absolute top-8 left-4 right-4 bg-black/60 rounded-2xl py-4 px-5 border border-white/10 shadow-lg">
            <Text className="text-white text-center text-xl font-bold tracking-wide">{exercise?.name}</Text>
            <Text className="text-[#d2d6e3] text-center text-[13px] mt-1 font-medium">
              {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
            </Text>

            {/* Set + rep/hold progress: the per-set HUD the patient
                watches. Phase D shows the hold's "time in form" meter
                for hold sets — patients can see they're earning
                seconds and tell the difference between "broken form
                mid-hold" (counter pauses) and "no signal" (counter
                also pauses, but for a different reason). */}
            <View className="flex-row items-center justify-center gap-4 mt-2">
              <Text className="text-white text-[15px] font-bold">
                Set {currentSetIndex + 1}/{totalSets}
              </Text>
              {currentSet?.format === 'reps' ? (
                <Text className="text-white text-[15px] font-bold">
                  Reps {repProgress.repsCompleted}/{repProgress.targetReps}
                </Text>
              ) : (
                <Text className="text-white text-[15px] font-bold">
                  Held {formatTime(holdProgress?.secondsInForm ?? 0)} / {formatTime(holdProgress?.targetSeconds ?? setTotalSeconds)}
                </Text>
              )}
            </View>

            {/* Functionality tolerance cue: each rep is held before it counts. */}
            {!isStrengthMode && currentSet?.hold_seconds_per_rep ? (
              <Text className="text-[#9fe0a6] text-center text-[13px] mt-1 font-semibold">
                Hold each rep {currentSet.hold_seconds_per_rep}
                {currentSet.hold_seconds_max ? `–${currentSet.hold_seconds_max}` : ''}s
              </Text>
            ) : null}

            {/* Strength load stepper: only for exercises that carry a
                weight slot (upper-limb). Leg Strength work is reps-only. */}
            {isStrengthMode && currentSet?.target_weight_kg != null ? (
              <View className="flex-row items-center justify-center gap-4 mt-2">
                <TouchableOpacity
                  className="w-10 h-10 rounded-full bg-white/15 items-center justify-center"
                  onPress={() => adjustWeight(-WEIGHT_STEP_KG)}
                >
                  <Text className="text-white text-2xl font-black">−</Text>
                </TouchableOpacity>
                <View className="items-center min-w-[92px]">
                  <Text className="text-white text-xl font-black">{currentWeightKg} kg</Text>
                  <Text className="text-[#d2d6e3] text-[11px] font-medium">Weight used</Text>
                </View>
                <TouchableOpacity
                  className="w-10 h-10 rounded-full bg-white/15 items-center justify-center"
                  onPress={() => adjustWeight(WEIGHT_STEP_KG)}
                >
                  <Text className="text-white text-2xl font-black">+</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <PostureFeedback
              exercise={exercise}
              keypoints={keypoints}
              isModelReady={isModelReady}
              feedbackText={feedbackText}
              currentScore={currentScore}
              feedbackColor={feedbackColor}
            />
            {!!modelError && <Text className="text-[#ffb8b8] text-center text-sm font-bold mt-2">⚠️ {modelError}</Text>}
          </View>

          <View className="absolute bottom-6 left-4 right-4 bg-black/60 rounded-3xl p-5 border border-white/10 shadow-lg">
            <View className="flex-row justify-between mb-4">
              <View>
                <Text className="text-white text-3xl font-black tracking-tight">{currentScore}%</Text>
                <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Form Score</Text>
              </View>
              <View className="items-end">
                <Text className="text-white text-3xl font-black tracking-tight">
                  {formatTime(setElapsedSeconds)} <Text className="text-2xl text-white/60">/ {formatTime(setTotalSeconds)}</Text>
                </Text>
                <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Set Time</Text>
              </View>
            </View>

            {/* Set progress bar — fills as the per-set timer counts up to
                the cap (2 min for rep sets, 5 min for hold sets). */}
            <View className="w-full h-2 rounded-full bg-white/20 overflow-hidden mb-5">
              <View
                className="h-full bg-[#4CAF50] rounded-full"
                style={{ width: `${Math.min(100, (setElapsedSeconds / Math.max(1, setTotalSeconds)) * 100)}%` }}
              />
            </View>

            {/* Two-action footer:
                - "Finish Current Set" (green) ends THIS set and triggers
                  the BreakScreen (or the exercise if last set).
                - "End Early" (red) skips remaining sets and ends the
                  entire exercise — same behavior as the BreakScreen's
                  secondary action. */}
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 bg-[#4CAF50] rounded-full items-center justify-center py-4"
                onPress={() => finishCurrentSet('finish')}
              >
                <Text className="text-white font-bold text-lg">Finish Current Set</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-[#ba1a1a] rounded-full items-center justify-center py-4"
                onPress={() => finishExercise('end_early')}
              >
                <Text className="text-white font-bold text-lg">End Early</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Between-set overlay — Happy Path layout. Renders ON TOP of the
          camera so we don't have to tear down the WS between sets. */}
      {isExercising && isBetweenSets && (
        <BreakScreen
          justFinishedSetIndex={currentSetIndex}
          totalSets={totalSets}
          justFinishedScore={lastFinishedScore}
          justFinishedReps={lastFinishedReps}
          targetRepsForFinishedSet={lastFinishedTarget}
          upNextLabel={upNextLabel}
          onStartNextSet={startNextSet}
          onEndEarly={() => finishExercise('end_early')}
        />
      )}
    </View>
  );
};

const PostureFeedback = ({ exercise, keypoints, isModelReady, feedbackText, currentScore, feedbackColor }) => {
  const exerciseHint = [
    exercise?.name || '',
    exercise?.focus || '',
    exercise?.affected_area || '',
  ].join(' ').toLowerCase();

  // Shared with the skeleton overlay + rep-color logic (utils/repCounter) so
  // arm/leg classification has ONE source of truth — a second local regex here
  // could silently diverge for a future exercise (e.g. posture gate checks
  // hips while the skeleton colors the arm).
  const isLeg = isLegExercise(exerciseHint);

  const shouldersVisible =
    (keypoints[11]?.score ?? 0) > 0.5 || (keypoints[12]?.score ?? 0) > 0.5;
  const hipsVisible =
    (keypoints[23]?.score ?? 0) > 0.4 || (keypoints[24]?.score ?? 0) > 0.4;

  const tooClose = isModelReady && shouldersVisible && !hipsVisible && isLeg;
  const noBody = isModelReady && keypoints.length === 0;

  if (tooClose) {
    return <Text className="text-[#ffe082] text-center text-lg font-bold mt-3">Too close — step back to show your hips and knees</Text>;
  }
  if (noBody) {
    return <Text className="text-[#ffe082] text-center text-lg font-bold mt-3">Step back — show your body</Text>;
  }

  const isValidPosture = isLeg ? hipsVisible : shouldersVisible;

  if (feedbackText && isModelReady && isValidPosture) {
    return (
      <View className="mt-3 bg-black/20 py-2 px-1 rounded-lg">
        <Text className="text-center text-[22px] leading-7 font-black tracking-wide" style={{ color: feedbackColor || (currentScore >= 85 ? '#4CAF50' : currentScore >= 60 ? '#FFC107' : '#FF5252') }}>
          {feedbackText}
        </Text>
      </View>
    );
  }
  return null;
};
