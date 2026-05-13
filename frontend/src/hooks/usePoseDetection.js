import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-react-native';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import {
  calculateAngle,
  getColorAndScore,
  extractJointPoints,
  calculateArmAngles,
  calculateLegAngles,
  BLAZEPOSE_INDICES,
} from '../utils/angleCalculator';

const getArmHint = (angle) => {
  if (angle === null) return 'Show your full arm — elbow must be visible';
  const diff = angle - 90;
  const abs = Math.abs(diff);
  if (abs <= 10) return 'Great form! Hold it';
  if (abs <= 25) return diff > 0 ? 'Curl a little more' : 'Open your arm slightly';
  return diff > 0 ? 'Bend your elbow higher' : 'Lower your arm a bit';
};

const getLegHint = (angle) => {
  if (angle === null) return 'Show your full leg — knee must be visible';
  const diff = angle - 90;
  const abs = Math.abs(diff);
  if (abs <= 15) return 'Great form! Hold it';
  if (abs <= 30) return diff > 0 ? 'Bend your knee a bit more' : 'Straighten slightly';
  return diff > 0 ? 'Bend your knee deeper' : 'Straighten your leg';
};

const BLAZEPOSE_CONFIG = {
  runtime: 'tfjs',
  // 'lite' is ~2x faster than 'full' — critical on mobile devices where the
  // JS thread is shared with UI updates (clock, buttons, etc.).
  // The confidence filter in SkeletonOverlay (0.65–0.75) already rejects the
  // extra false-positives that 'lite' occasionally produces.
  modelType: 'lite',
  enableSmoothing: true,
};

// Target size for downscaling camera frames before inference.
// BlazePose internally resizes to 256×256 anyway, so feeding it a 3000px photo
// just wastes CPU cycles on the resize step. Pre-shrinking to ~256px here
// massively reduces the tensor memory and decode time.
const TARGET_INFERENCE_SIZE = 256;

const toScoreFromPose = (pose) => {
  const keypoints = pose?.keypoints || [];
  const confidences = keypoints
    .map((kp) => Number(kp?.score || 0))
    .filter((score) => Number.isFinite(score));

  if (confidences.length === 0) return 0;

  const avgConfidence = confidences.reduce((sum, score) => sum + score, 0) / confidences.length;
  return Math.round(Math.max(0, Math.min(100, avgConfidence * 100)));
};

const usePoseDetection = () => {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);
  const detectorRef = useRef(null);
  const isEstimatingRef = useRef(false);
  // Refs mirror state so interval closures always see current values.
  const isDetectingRef = useRef(false);
  const isModelReadyRef = useRef(false);

  const initModel = useCallback(async () => {
    if (detectorRef.current || isModelReadyRef.current) return true;

    try {
      const t0 = Date.now();
      await tf.ready();
      console.log(`[PoseDetection] tf.ready() took ${Date.now() - t0}ms — backend: ${tf.getBackend()}`);

      // Prefer rn-webgl for mobile performance, fall back silently if unavailable.
      if (tf.getBackend() !== 'rn-webgl') {
        try {
          const t1 = Date.now();
          await tf.setBackend('rn-webgl');
          await tf.ready();
          console.log(`[PoseDetection] Switched to rn-webgl in ${Date.now() - t1}ms`);
        } catch (_) {
          // Keep current backend when rn-webgl is unavailable.
          console.log(`[PoseDetection] rn-webgl unavailable — staying on: ${tf.getBackend()}`);
        }
      }

      console.log(`[PoseDetection] Active backend: ${tf.getBackend()}`);

      const t2 = Date.now();
      detectorRef.current = await poseDetection.createDetector(
        poseDetection.SupportedModels.BlazePose,
        BLAZEPOSE_CONFIG,
      );
      console.log(`[PoseDetection] BlazePose detector created in ${Date.now() - t2}ms`);
      console.log(`[PoseDetection] Total init time: ${Date.now() - t0}ms`);

      isModelReadyRef.current = true;
      setIsModelReady(true);
      setModelError(null);
      return true;
    } catch (error) {
      setModelError(error?.message || 'Failed to initialize BlazePose model');
      isModelReadyRef.current = false;
      setIsModelReady(false);
      return false;
    }
  }, []);

  // Empty deps: uses refs internally so the function reference never changes,
  // preventing stale-closure bugs in setInterval callbacks.
  const estimateFromBase64 = useCallback(async (base64Image, exerciseType = 'bicep_curl', affectedSide = 'right', viewWidth = null, viewHeight = null) => {
    if (!isDetectingRef.current || !isModelReadyRef.current || !detectorRef.current || !base64Image) {
      return null;
    }

    if (isEstimatingRef.current) {
      return null;
    }

    isEstimatingRef.current = true;
    let imageTensor = null;
    let resizedTensor = null;

    try {
      const imageBytes = Buffer.from(base64Image, 'base64');
      imageTensor = decodeJpeg(new Uint8Array(imageBytes));

      const origWidth  = imageTensor.shape[1];
      const origHeight = imageTensor.shape[0];

      // Downscale to ~256px on the longest side to dramatically reduce
      // the amount of work the model has to do on each frame.
      const longestSide = Math.max(origWidth, origHeight);
      let inferenceWidth = origWidth;
      let inferenceHeight = origHeight;

      if (longestSide > TARGET_INFERENCE_SIZE) {
        const ratio = TARGET_INFERENCE_SIZE / longestSide;
        inferenceWidth  = Math.round(origWidth * ratio);
        inferenceHeight = Math.round(origHeight * ratio);
        resizedTensor = tf.image.resizeBilinear(imageTensor, [inferenceHeight, inferenceWidth]);
        // Cast back to int32 — resizeBilinear outputs float32 but
        // BlazePose expects uint8/int32 pixel values.
        const castedTensor = resizedTensor.toInt();
        resizedTensor.dispose();
        resizedTensor = castedTensor;
      }

      const tensorForInference = resizedTensor || imageTensor;

      const poses = await detectorRef.current.estimatePoses(tensorForInference, {
        maxPoses: 1,
        flipHorizontal: Platform.OS === 'android',
      });

      const firstPose = poses?.[0] || null;
      if (!firstPose) return { score: 0, keypoints: [], angles: {}, colors: {} };

      // Scale keypoints back to original image coordinates so the
      // SkeletonOverlay lines up with the camera preview.
      const scaleX = origWidth / inferenceWidth;
      const scaleY = origHeight / inferenceHeight;
      const keypoints = (firstPose.keypoints || []).map((kp) => ({
        ...kp,
        x: kp.x * scaleX,
        y: kp.y * scaleY,
      }));
      
      // Calculate angles based on exercise type
      let angles = {};
      let colors = {};
      let overallScore = toScoreFromPose(firstPose);
      const exerciseLower = (exerciseType || 'general').toLowerCase();

      // Determine body area from the exercise hint string.
      // The hint contains name + focus + affected_area so patterns like
      // "upper-limb", "lower-limb", and "arms"/"legs"/"both" are all captured.
      const isArmExercise =
        exerciseLower.includes('upper-limb') ||
        exerciseLower.includes('upper limb') ||
        exerciseLower.includes('bicep') ||
        exerciseLower.includes('arm') ||
        exerciseLower.includes('reach') ||
        exerciseLower.includes('fine motor') ||
        (exerciseLower.includes('arms') && !exerciseLower.includes('lower'));

      const isLegExercise =
        exerciseLower.includes('lower-limb') ||
        exerciseLower.includes('lower limb') ||
        exerciseLower.includes('leg') ||
        exerciseLower.includes('knee') ||
        exerciseLower.includes('ankle') ||
        exerciseLower.includes('gait') ||
        exerciseLower.includes('squat') ||
        exerciseLower.includes('walk') ||
        exerciseLower.includes('balance');

      if (isArmExercise) {
        const armAngles = calculateArmAngles(keypoints, affectedSide);
        angles.bicepCurl = armAngles.bicepCurl;
        if (angles.bicepCurl !== null) {
          const colorData = getColorAndScore(angles.bicepCurl, 90, { green: 10, yellow: 25 });
          colors.bicepCurl = colorData.color;
          overallScore = Math.round((overallScore + colorData.score) / 2);
        } else {
          colors.bicepCurl = '#FFC107';
        }
      } else if (isLegExercise) {
        const legAngles = calculateLegAngles(keypoints, affectedSide);
        angles.kneeFlexion = legAngles.kneeFlexion;
        if (angles.kneeFlexion !== null) {
          const colorData = getColorAndScore(angles.kneeFlexion, 90, { green: 15, yellow: 30 });
          colors.kneeFlexion = colorData.color;
          overallScore = Math.round((overallScore + colorData.score) / 2);
        } else {
          colors.kneeFlexion = '#FFC107';
        }
      } else {
        // "both" / full-body exercises: track whichever joint is most visible.
        const armAngles = calculateArmAngles(keypoints, affectedSide);
        const legAngles = calculateLegAngles(keypoints, affectedSide);
        if (armAngles.bicepCurl !== null) {
          angles.bicepCurl = armAngles.bicepCurl;
          const colorData = getColorAndScore(angles.bicepCurl, 90, { green: 10, yellow: 25 });
          colors.bicepCurl = colorData.color;
          overallScore = Math.round((overallScore + colorData.score) / 2);
        }
        if (legAngles.kneeFlexion !== null) {
          angles.kneeFlexion = legAngles.kneeFlexion;
          const colorData = getColorAndScore(legAngles.kneeFlexion, 90, { green: 15, yellow: 30 });
          colors.kneeFlexion = colorData.color;
          overallScore = Math.round((overallScore + colorData.score) / 2);
        }
        if (angles.bicepCurl === null && angles.kneeFlexion === null) {
          colors.formDetected = '#4CAF50';
        }
      }

      let hint = null;
      if (isArmExercise) {
        hint = getArmHint(angles.bicepCurl ?? null);
      } else if (isLegExercise) {
        hint = getLegHint(angles.kneeFlexion ?? null);
      } else {
        hint = angles.bicepCurl !== null
          ? getArmHint(angles.bicepCurl)
          : angles.kneeFlexion !== null
          ? getLegHint(angles.kneeFlexion)
          : 'Step back — show your full body';
      }

      return {
        score: overallScore,
        keypoints,
        angles,
        colors,
        hint,
        imageWidth: inferenceWidth,
        imageHeight: inferenceHeight,
      };
    } catch (err) {
      console.log('Pose estimation error:', err);
      return null;
    } finally {
      if (resizedTensor) {
        resizedTensor.dispose();
      }
      if (imageTensor) {
        imageTensor.dispose();
      }
      isEstimatingRef.current = false;
    }
  }, [isDetecting, isModelReady]);

  const startDetection = useCallback(async () => {
    const ready = await initModel();
    isDetectingRef.current = ready;
    setIsDetecting(ready);
    return ready;
  }, [initModel]);

  const stopDetection = useCallback(() => {
    isDetectingRef.current = false;
    setIsDetecting(false);
  }, []);

  useEffect(() => {
    return () => {
      if (detectorRef.current?.dispose) {
        detectorRef.current.dispose();
      }
      detectorRef.current = null;
    };
  }, []);

  return {
    isDetecting,
    isModelReady,
    modelError,
    startDetection,
    stopDetection,
    estimateFromBase64,
  };
};

export default usePoseDetection;
