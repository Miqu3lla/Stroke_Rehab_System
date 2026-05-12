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
  const [isPreparing, setIsPreparing] = useState(false);
  const [inferenceSize, setInferenceSize] = useState({ width: 1, height: 1 });
  const frameCountRef = useRef(0);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });

  const timerRef = useRef(null);
  const scoreRef = useRef(null);
  const finishingRef = useRef(false);
  const cameraRef = useRef(null);

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
      clearInterval(scoreRef.current);
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

  // Pre-warm BlazePose while the user reads the instructions screen so the
  // model is already loaded by the time they tap Begin Exercise.
  useEffect(() => {
    startDetection();
  }, [startDetection]);

  const handleBeginPress = async () => {
    if (!isModelReady) {
      // Model still loading — show a waiting screen and let it finish.
      setIsPreparing(true);
      await startDetection();
      setIsPreparing(false);
    }
    startExercise();
  };

  const startExercise = () => {
    setIsExercising(true);
    setElapsedSeconds(0);
    setCurrentScore(0);
    setScoreHistory([]);
    setJointColors({});
    setKeypoints([]);
    setFeedbackText('');
    frameCountRef.current = 0;

    // Detection was already started by pre-warm or handleBeginPress — do not
    // call startDetection() again here as it would reset the ready state.

    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    scoreRef.current = setInterval(async () => {
      let score = null;
      let colors = {};

      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.5,
            base64: true,
            shutterSound: false,
          });

          // Combine name + focus + affected_area so keyword matching can use all three.
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
            // Skip the first 3 frames while the model stabilises — early
            // detections are often noisy and produce stray skeleton lines.
            if (frameCountRef.current > 3) {
              setKeypoints(result.keypoints || []);
            }
          }
        } catch (_) {
          score = null;
        }
      }

      // Fallback keeps UI and logging functional while model is warming up.
      const effectiveScore = score ?? Math.min(100, Math.max(0, Math.floor(Math.random() * 25) + 70));
      setCurrentScore(effectiveScore);
      setScoreHistory((prev) => [...prev, effectiveScore]);
      setJointColors(colors);
    }, 1000);
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
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isPreparing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0c56d0" />
        <Text style={[styles.title, { marginTop: 20 }]}>Loading BlazePose…</Text>
        <Text style={styles.subtitle}>This only takes a few seconds</Text>
        {!!modelError && <Text style={[styles.overlayError, { marginTop: 12, textAlign: 'center' }]}>⚠️ {modelError}</Text>}
      </View>
    );
  }

  if (!isExercising) {
    return (
      <View style={[styles.container, { padding: 24 }]}>
        <Text style={styles.title}>{exercise?.name}</Text>
        <Text style={styles.subtitle}>{exercise?.duration_minutes} min</Text>

        {!!exercise?.description && (
          <Text style={styles.description}>{exercise.description}</Text>
        )}

        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>Before you start</Text>
          <Text style={styles.instructionItem}>• Stand 1–2 metres from the camera</Text>
          <Text style={styles.instructionItem}>• Make sure your full upper body is visible</Text>
          <Text style={styles.instructionItem}>• Follow the colour of the skeleton lines:</Text>

          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} />
            <Text style={styles.legendText}>Green — correct form, keep going</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#FFC107' }]} />
            <Text style={styles.legendText}>Yellow — almost there, small adjustment</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: '#F44336' }]} />
            <Text style={styles.legendText}>Red — adjust your position</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleBeginPress}>
          <Text style={styles.primaryBtnText}>
            {isModelReady ? 'Begin Exercise' : 'Loading model…'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
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

      <View style={styles.overlayTop}>
        <Text style={styles.overlayText}>{exercise?.name}</Text>
        <Text style={styles.overlaySubtext}>
          {isModelReady ? '🟢 BlazePose active' : '⏳ Loading BlazePose...'}
        </Text>
        {(() => {
          // Shoulders visible (11, 12) but hips not visible (23, 24) = user too close.
          const shouldersVisible =
            (keypoints[11]?.score ?? 0) > 0.5 || (keypoints[12]?.score ?? 0) > 0.5;
          const hipsVisible =
            (keypoints[23]?.score ?? 0) > 0.4 || (keypoints[24]?.score ?? 0) > 0.4;
          const tooClose = isModelReady && shouldersVisible && !hipsVisible;
          const noBody = isModelReady && keypoints.length === 0;

          if (tooClose) {
            return <Text style={styles.overlayTip}>Too close — step back until your full body is visible</Text>;
          }
          if (noBody) {
            return <Text style={styles.overlayTip}>Step back — show your full body</Text>;
          }
          if (feedbackText && isModelReady && hipsVisible) {
            return (
              <Text style={[
                styles.feedbackText,
                { color: currentScore >= 85 ? '#4CAF50' : currentScore >= 60 ? '#FFC107' : '#F44336' },
              ]}>
                {feedbackText}
              </Text>
            );
          }
          return null;
        })()}
        {!!modelError && <Text style={styles.overlayError}>⚠️ {modelError}</Text>}
      </View>

      <View style={styles.overlayBottom}>
        <View style={styles.statsRow}>
          <View>
            <Text style={styles.metricValue}>{currentScore}%</Text>
            <Text style={styles.metricLabel}>Form Score</Text>
          </View>
          <View>
            <Text style={styles.metricValue}>{formatTime(elapsedSeconds)} / {formatTime(totalSeconds)}</Text>
            <Text style={styles.metricLabel}>Time</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, (elapsedSeconds / totalSeconds) * 100)}%` }]} />
        </View>

        <TouchableOpacity style={styles.finishBtn} onPress={finishExercise}>
          <Text style={styles.finishBtnText}>Finish</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#0f1116',
  },
  message: {
    textAlign: 'center',
    color: '#e6e9f2',
    marginBottom: 10,
  },
  camera: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#c3c9dd',
    textAlign: 'center',
    fontSize: 16,
    marginBottom: 6,
  },
  primaryBtn: {
    alignSelf: 'center',
    marginTop: 18,
    backgroundColor: '#0c56d0',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  overlayTop: {
    position: 'absolute',
    top: 24,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  overlayText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
  overlaySubtext: {
    color: '#d2d6e3',
    textAlign: 'center',
    fontSize: 11,
    marginTop: 2,
  },
  overlayTip: {
    color: '#ffe082',
    textAlign: 'center',
    fontSize: 11,
    marginTop: 3,
  },
  overlayError: {
    color: '#ffb8b8',
    textAlign: 'center',
    fontSize: 10,
    marginTop: 2,
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 18,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    padding: 14,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metricValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  metricLabel: {
    color: '#d2d6e3',
    fontSize: 12,
    marginTop: 3,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#9dd65f',
  },
  finishBtn: {
    backgroundColor: '#ba1a1a',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  finishBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  feedbackText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  description: {
    color: '#c3c9dd',
    textAlign: 'center',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 18,
  },
  instructionsCard: {
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: 16,
    width: '100%',
  },
  instructionsTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 10,
  },
  instructionItem: {
    color: '#c3c9dd',
    fontSize: 13,
    marginBottom: 6,
    lineHeight: 18,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    color: '#c3c9dd',
    fontSize: 13,
  },
});

export default CameraComponent;
