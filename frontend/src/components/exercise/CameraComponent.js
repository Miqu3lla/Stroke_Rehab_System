import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useCamera from '../../hooks/useCamera';
import SkeletonOverlay from './SkeletonOverlay';
import BeforeYouStart from './BeforeYouStart';
import BreakScreen from './BreakScreen';
import ExerciseInfoCard from './ExerciseInfoCard';
import FormScoreCard from './FormScoreCard';

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
  const lastFinishedScore  = lastFinishedResult.score ?? 0;
  const lastFinishedReps   = lastFinishedResult.reps_completed ?? 0;
  const lastFinishedTarget = lastFinishedResult.target_reps
    || exercise?.sets?.[currentSetIndex]?.target_reps
    || 12;
  const nextSet     = exercise?.sets?.[currentSetIndex + 1];
  const upNextLabel = nextSet
    ? (nextSet.format === 'hold'
        ? `5-minute hold (Set ${currentSetIndex + 2} of ${totalSets})`
        : `Set ${currentSetIndex + 2} of ${totalSets}`)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#0f1116' }}>
      {/* ── Camera feed ── */}
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

      {/* ── Skeleton pose overlay ── */}
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

      {/* ── Pre-exercise overlay ── */}
      {!isExercising && (
        <View style={StyleSheet.absoluteFill}>
          <BeforeYouStart exercise={exercise} onBegin={startExercise} />
        </View>
      )}

      {/* ── Active-set HUD — hidden when between sets ── */}
      {isExercising && !isBetweenSets && (
        <>
          <ExerciseInfoCard
            exercise={exercise}
            currentSetIndex={currentSetIndex}
            totalSets={totalSets}
            currentSet={currentSet}
            repProgress={repProgress}
            holdProgress={holdProgress}
            setTotalSeconds={setTotalSeconds}
            currentScore={currentScore}
            isModelReady={isModelReady}
            isStrengthMode={isStrengthMode}
            currentWeightKg={currentWeightKg}
            adjustWeight={adjustWeight}
            WEIGHT_STEP_KG={WEIGHT_STEP_KG}
            feedbackText={feedbackText}
            feedbackColor={feedbackColor}
            keypoints={keypoints}
            modelError={modelError}
            formatTime={formatTime}
          />

          <FormScoreCard
            currentScore={currentScore}
            setElapsedSeconds={setElapsedSeconds}
            setTotalSeconds={setTotalSeconds}
            formatTime={formatTime}
            finishCurrentSet={finishCurrentSet}
            finishExercise={finishExercise}
          />
        </>
      )}

      {/* ── Between-set overlay ── */}
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
}
