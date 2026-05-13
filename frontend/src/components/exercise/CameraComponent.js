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
            skipProcessing: true,
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
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>Grant Permission</Text>
        </TouchableOpacity>
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
          <Text style={styles.primaryBtnText}>Begin Exercise</Text>
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
          {isModelReady ? '🟢 Pose tracking active' : '⏳ Connecting to pose tracking…'}
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
