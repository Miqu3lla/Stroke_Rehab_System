import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { isLegExercise } from '../../utils/repCounter';

// ─── PostureFeedback ──────────────────────────────────────────────────────────
// Inline here since it's tightly coupled to the info card's layout and
// shares the same keypoints/exercise context.
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
  const noBody   = isModelReady && keypoints.length === 0;

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
        <Text
          className="text-center text-[22px] leading-7 font-black tracking-wide"
          style={{ color: feedbackColor || (currentScore >= 85 ? '#4CAF50' : currentScore >= 60 ? '#FFC107' : '#FF5252') }}
        >
          {feedbackText}
        </Text>
      </View>
    );
  }
  return null;
};

// ─── ExerciseInfoCard ─────────────────────────────────────────────────────────
// Top overlay card: exercise name, tracking status, set/rep progress,
// hold cue, strength weight stepper, and posture feedback text.
export default function ExerciseInfoCard({
  exercise,
  currentSetIndex,
  totalSets,
  currentSet,
  repProgress,
  holdProgress,
  setTotalSeconds,
  currentScore,
  isModelReady,
  isStrengthMode,
  currentWeightKg,
  adjustWeight,
  WEIGHT_STEP_KG,
  feedbackText,
  feedbackColor,
  keypoints,
  modelError,
  formatTime,
}) {
  return (
    <View className="absolute top-8 left-4 right-4 bg-black/60 rounded-2xl py-4 px-5 border border-white/10 shadow-lg">
      <Text className="text-white text-center text-xl font-bold tracking-wide">{exercise?.name}</Text>
      <Text className="text-[#d2d6e3] text-center text-[13px] mt-1 font-medium">
        {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
      </Text>

      {/* Set + rep/hold progress */}
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

      {/* Functionality hold cue */}
      {!isStrengthMode && currentSet?.hold_seconds_per_rep ? (
        <Text className="text-[#9fe0a6] text-center text-[13px] mt-1 font-semibold">
          Hold each rep {currentSet.hold_seconds_per_rep}
          {currentSet.hold_seconds_max ? `–${currentSet.hold_seconds_max}` : ''}s
        </Text>
      ) : null}

      {/* Strength weight stepper */}
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

      {!!modelError && (
        <Text className="text-[#ffb8b8] text-center text-sm font-bold mt-2">⚠️ {modelError}</Text>
      )}
    </View>
  );
}
