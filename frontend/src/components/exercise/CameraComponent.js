import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

  return (
    // Explicit style — NativeWind className is NOT reliably forwarded to
    // expo-camera's native CameraView, so we use style props throughout
    // this tree to guarantee the flex layout resolves correctly.
    <View style={{ flex: 1, backgroundColor: '#0f1116' }}>
      {/*
        CameraView is ALWAYS mounted once permissions are granted.
        This lets the camera hardware warm up during the "Before you start"
        instructions phase, so there is no black-screen flash when the
        exercise begins.
      */}
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
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

      {/* ── Pre-exercise overlay — covers the camera until user taps Begin ── */}
      {!isExercising && (
        <View style={StyleSheet.absoluteFill}>
          <BeforeYouStart exercise={exercise} onBegin={startExercise} />
        </View>
      )}

      {/* ── Exercise HUD — only visible once the session is active ── */}
      {isExercising && (
        <>
          {/* Top HUD: exercise name, tracking status, posture feedback */}
          <View className="absolute top-8 left-4 right-4 bg-black/60 rounded-2xl py-4 px-5 border border-white/10 shadow-lg">
            <Text className="text-white text-center text-xl font-bold tracking-wide">{exercise?.name}</Text>
            <Text className="text-[#d2d6e3] text-center text-[13px] mt-1 font-medium">
              {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
            </Text>
            <PostureFeedback
              exercise={exercise}
              keypoints={keypoints}
              isModelReady={isModelReady}
              feedbackText={feedbackText}
              currentScore={currentScore}
            />
            {!!modelError && <Text className="text-[#ffb8b8] text-center text-sm font-bold mt-2">⚠️ {modelError}</Text>}
          </View>

          {/* Bottom HUD: score, timer, progress bar, finish button */}
          <View className="absolute bottom-6 left-4 right-4 bg-black/60 rounded-3xl p-5 border border-white/10 shadow-lg">
            <View className="flex-row justify-between mb-4">
              <View>
                <Text className="text-white text-3xl font-black tracking-tight">{currentScore}%</Text>
                <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Form Score</Text>
              </View>
              <View className="items-end">
                <Text className="text-white text-3xl font-black tracking-tight">{formatTime(elapsedSeconds)} <Text className="text-2xl text-white/60">/ {formatTime(totalSeconds)}</Text></Text>
                <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Time</Text>
              </View>
            </View>

            <View className="w-full h-2 rounded-full bg-white/20 overflow-hidden mb-5">
              <View className="h-full bg-[#4CAF50] rounded-full" style={{ width: `${Math.min(100, (elapsedSeconds / totalSeconds) * 100)}%` }} />
            </View>

            <TouchableOpacity className="bg-[#ba1a1a] rounded-full items-center justify-center py-4" onPress={finishExercise}>
              <Text className="text-white font-bold text-lg">Finish Exercise</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
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
    return <Text className="text-[#ffe082] text-center text-lg font-bold mt-3">Too close — step back to show your hips and knees</Text>;
  }
  if (noBody) {
    return <Text className="text-[#ffe082] text-center text-lg font-bold mt-3">Step back — show your body</Text>;
  }

  // For feedback text, we consider it valid if they are showing the required parts
  const isValidPosture = isLegExercise ? hipsVisible : shouldersVisible;

  if (feedbackText && isModelReady && isValidPosture) {
    return (
      <View className="mt-3 bg-black/20 py-2 px-1 rounded-lg">
        <Text className="text-center text-[22px] leading-7 font-black tracking-wide" style={{ color: currentScore >= 85 ? '#4CAF50' : currentScore >= 60 ? '#FFC107' : '#FF5252' }}>
          {feedbackText}
        </Text>
      </View>
    );
  }
  return null;
};

export default CameraComponent;
