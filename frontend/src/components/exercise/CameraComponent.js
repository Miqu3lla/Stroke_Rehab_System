import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useCamera from '../../hooks/useCamera';
import SkeletonOverlay from './SkeletonOverlay';
import BeforeYouStart from './BeforeYouStart';

const CameraComponent = ({ exercise, navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();

  const {
    cameraRef,
    isExercising,
    elapsedSeconds,
    totalSeconds,
    currentScore,
    jointColors,
    keypoints,
    feedbackText,
    inferenceSize,
    cameraLayout,
    affectedSide,
    isModelReady,
    modelError,
    startExercise,
    finishExercise,
    formatTime,
    handleCameraLayout,
  } = useCamera(exercise, navigation);

  // Camera permissions are still loading.
  if (!permission) {
    return <View />;
  }

  // Camera permissions are not granted yet.
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

  // Show the "Before you start" instructions before the exercise begins.
  if (!isExercising) {
    return <BeforeYouStart exercise={exercise} onBegin={startExercise} />;
  }

  return (
    <View className="flex-1 justify-center bg-[#0f1116]">
      <CameraView
        ref={cameraRef}
        className="flex-1"
        facing="front"
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

      {/* ── Top HUD: exercise name, tracking status, posture feedback ── */}
      <View className="absolute top-6 left-4 right-4 bg-black/45 rounded-xl py-2 px-3">
        <Text className="text-white text-center font-semibold">{exercise?.name}</Text>
        <Text className="text-[#d2d6e3] text-center text-[11px] mt-0.5">
          {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
        </Text>
        <PostureFeedback
          exercise={exercise}
          keypoints={keypoints}
          isModelReady={isModelReady}
          feedbackText={feedbackText}
          currentScore={currentScore}
        />
        {!!modelError && <Text className="text-[#ffb8b8] text-center text-[10px] mt-0.5">⚠️ {modelError}</Text>}
      </View>

      {/* ── Bottom HUD: score, timer, progress bar, finish button ── */}
      <View className="absolute bottom-4 left-4 right-4 bg-black/45 rounded-2xl p-3.5">
        <View className="flex-row justify-between mb-3">
          <View>
            <Text className="text-white text-xl font-bold">{currentScore}%</Text>
            <Text className="text-[#d2d6e3] text-xs mt-1">Form Score</Text>
          </View>
          <View>
            <Text className="text-white text-xl font-bold">{formatTime(elapsedSeconds)} / {formatTime(totalSeconds)}</Text>
            <Text className="text-[#d2d6e3] text-xs mt-1">Time</Text>
          </View>
        </View>

        <View className="w-full h-1.5 rounded-full bg-white/25 overflow-hidden mb-3.5">
          <View className="h-full bg-[#9dd65f]" style={{ width: `${Math.min(100, (elapsedSeconds / totalSeconds) * 100)}%` }} />
        </View>

        <TouchableOpacity className="bg-[#ba1a1a] rounded-full items-center justify-center py-3" onPress={finishExercise}>
          <Text className="text-white font-bold text-base">Finish</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Inline sub-component: posture guidance text shown in the top HUD ──
const PostureFeedback = ({ exercise, keypoints, isModelReady, feedbackText, currentScore }) => {
  const exerciseHint = [
    exercise?.name || '',
    exercise?.focus || '',
    exercise?.affected_area || '',
  ].join(' ').toLowerCase();

  const isLegExercise = /leg|knee|lower|squat|gait|step/i.test(exerciseHint);

  // Shoulders visible (11, 12)
  const shouldersVisible =
    (keypoints[11]?.score ?? 0) > 0.5 || (keypoints[12]?.score ?? 0) > 0.5;

  // Hips visible (23, 24)
  const hipsVisible =
    (keypoints[23]?.score ?? 0) > 0.4 || (keypoints[24]?.score ?? 0) > 0.4;

  // Only force the user to show hips if they are doing a leg/lower body exercise.
  // Otherwise, if they are doing bicep curls, showing just the upper body is perfectly fine!
  const tooClose = isModelReady && shouldersVisible && !hipsVisible && isLegExercise;
  const noBody = isModelReady && keypoints.length === 0;

  if (tooClose) {
    return <Text className="text-[#ffe082] text-center text-[11px] mt-1">Too close — step back to show your hips and knees</Text>;
  }
  if (noBody) {
    return <Text className="text-[#ffe082] text-center text-[11px] mt-1">Step back — show your body</Text>;
  }

  // For feedback text, we consider it valid if they are showing the required parts
  const isValidPosture = isLegExercise ? hipsVisible : shouldersVisible;

  if (feedbackText && isModelReady && isValidPosture) {
    return (
      <Text className="text-center text-sm font-bold mt-1.5" style={{ color: currentScore >= 85 ? '#4CAF50' : currentScore >= 60 ? '#FFC107' : '#F44336' }}>
        {feedbackText}
      </Text>
    );
  }
  return null;
};

export default CameraComponent;
