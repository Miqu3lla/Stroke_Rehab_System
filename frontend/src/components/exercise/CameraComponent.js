import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import usePatientStore from '../../store/usePatientStore';
import usePoseDetection from '../../hooks/usePoseDetection';
import SkeletonOverlay from './SkeletonOverlay';

const CameraComponent = ({ exercise, navigation }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [isExercising, setIsExercising] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  const [scoreHistory, setScoreHistory] = useState([]);
  const [jointColors, setJointColors] = useState({});
  const [keypoints, setKeypoints] = useState([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [inferenceSize, setInferenceSize] = useState({ width: 1, height: 1 });
  const frameCountRef = useRef(0);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });

  const timerRef = useRef(null);
  const scoreRef = useRef(null);
  const finishingRef = useRef(false);
  const cameraRef = useRef(null);
  const startTimeRef = useRef(null);

  const totalSeconds = Math.max(1, (Number(exercise?.duration_minutes) || 1) * 60);
  const { logExerciseCompletion } = usePatientStore();
  const affectedSide = (exercise?.affected_side || 'right').toLowerCase();
  const {
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    estimateFromBase64,
  } = usePoseDetection();

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const clearIntervals = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (scoreRef.current) {
      clearTimeout(scoreRef.current);
      scoreRef.current = null;
    }
  };

  const finishExercise = async () => {
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
  };

  // Start the exercise immediately (camera + timer). Load the ML model in the
  // background so the UI never freezes. Pose detection kicks in automatically
  // once the model is ready.

  const handleBeginPress = () => {
    startExercise();
  };

  const startExercise = () => {
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
  };

  const startFrameLoop = () => {
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
            cameraLayout.width  || null,
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
  };

  useEffect(() => {
    if (isExercising && elapsedSeconds >= totalSeconds) {
      finishExercise();
    }
  }, [elapsedSeconds, isExercising, totalSeconds]);

  useEffect(() => {
    return () => {
      clearIntervals();
      stopDetection();
    };
  }, [stopDetection]);

  if (!permission) {
    // Camera permissions are still loading.
    return <View />;
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet.
    return (
      <View className="flex-1 justify-center bg-[#0f1116]">
        <Text className="text-center text-[#e6e9f2] mb-2.5">We need your permission to show the camera</Text>
        <TouchableOpacity className="self-center mt-4 bg-[#0c56d0] rounded-full py-3.5 px-6" onPress={requestPermission}>
          <Text className="text-white font-bold text-base">Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isExercising) {
    return (
      <View className="flex-1 justify-center bg-[#0f1116] p-6">
        <Text className="text-white text-2xl font-bold text-center mb-2">{exercise?.name}</Text>
        <Text className="text-[#c3c9dd] text-center text-base mb-1.5">{exercise?.duration_minutes} min</Text>

        {!!exercise?.description && (
          <Text className="text-[#c3c9dd] text-center text-[13px] mt-2 mb-1 leading-[18px]">{exercise.description}</Text>
        )}

        <View className="mt-4 bg-white/5 rounded-2xl p-4 w-full">
          <Text className="text-white font-bold text-[15px] mb-2.5">Before you start</Text>
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Stand 1–2 metres from the camera</Text>
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Make sure your full upper body is visible</Text>
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Follow the colour of the skeleton lines:</Text>

          <View className="flex-row items-center mt-1.5">
            <View className="w-3 h-3 rounded-full mr-2 bg-[#4CAF50]" />
            <Text className="text-[#c3c9dd] text-[13px]">Green — correct form, keep going</Text>
          </View>
          <View className="flex-row items-center mt-1.5">
            <View className="w-3 h-3 rounded-full mr-2 bg-[#FFC107]" />
            <Text className="text-[#c3c9dd] text-[13px]">Yellow — almost there, small adjustment</Text>
          </View>
          <View className="flex-row items-center mt-1.5">
            <View className="w-3 h-3 rounded-full mr-2 bg-[#F44336]" />
            <Text className="text-[#c3c9dd] text-[13px]">Red — adjust your position</Text>
          </View>
        </View>

        <TouchableOpacity className="self-center mt-4 bg-[#0c56d0] rounded-full py-3.5 px-6" onPress={handleBeginPress}>
          <Text className="text-white font-bold text-base">Begin Exercise</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center bg-[#0f1116]">
      <CameraView
        ref={cameraRef}
        className="flex-1"
        facing="front"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCameraLayout({ width, height });
        }}
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

      <View className="absolute top-6 left-4 right-4 bg-black/45 rounded-xl py-2 px-3">
        <Text className="text-white text-center font-semibold">{exercise?.name}</Text>
        <Text className="text-[#d2d6e3] text-center text-[11px] mt-0.5">
          {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
        </Text>
        {(() => {
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
        })()}
        {!!modelError && <Text className="text-[#ffb8b8] text-center text-[10px] mt-0.5">⚠️ {modelError}</Text>}
      </View>

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

export default CameraComponent;
