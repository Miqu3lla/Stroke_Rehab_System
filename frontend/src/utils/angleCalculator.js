/**
 * Calculate the angle at a joint given three points (shoulder, elbow, wrist for example).
 * Uses the standard 2D angle formula with atan2.
 * @param {Object} pointA - { x, y } - start point (e.g., shoulder)
 * @param {Object} pointB - { x, y } - vertex point (e.g., elbow)
 * @param {Object} pointC - { x, y } - end point (e.g., wrist)
 * @returns {number} Angle in degrees (0-180)
 */
export const calculateAngle = (pointA, pointB, pointC) => {
  if (!pointA || !pointB || !pointC) return null;

  // Vectors from B to A and B to C
  const vector1 = {
    x: pointA.x - pointB.x,
    y: pointA.y - pointB.y,
  };

  const vector2 = {
    x: pointC.x - pointB.x,
    y: pointC.y - pointB.y,
  };

  // Calculate magnitudes
  const mag1 = Math.sqrt(vector1.x ** 2 + vector1.y ** 2);
  const mag2 = Math.sqrt(vector2.x ** 2 + vector2.y ** 2);

  // Avoid division by zero
  if (mag1 === 0 || mag2 === 0) return null;

  // Normalize vectors
  const norm1 = { x: vector1.x / mag1, y: vector1.y / mag1 };
  const norm2 = { x: vector2.x / mag2, y: vector2.y / mag2 };

  // Dot product
  const dotProduct = norm1.x * norm2.x + norm1.y * norm2.y;

  // Clamp to avoid floating-point errors in acos
  const clamped = Math.max(-1, Math.min(1, dotProduct));

  // Calculate angle in radians, then convert to degrees
  const angleRad = Math.acos(clamped);
  const angleDeg = (angleRad * 180) / Math.PI;

  return Math.round(angleDeg);
};

/**
 * Determine the color and score for a given angle vs target.
 * Uses threshold logic: green (perfect), yellow (warning), red (danger).
 * @param {number} currentAngle - The measured angle
 * @param {number} targetAngle - The target/perfect angle
 * @param {Object} thresholds - { green, yellow } thresholds in degrees
 * @returns {Object} { color: 'red'|'yellow'|'green', score: 0-100 }
 */
export const getColorAndScore = (currentAngle, targetAngle, thresholds = {}) => {
  if (currentAngle === null || currentAngle === undefined) {
    return { color: '#888888', score: 0 }; // Gray for missing data
  }

  // Default thresholds if not provided
  const greenThreshold = thresholds.green ?? 10; // Within 10 degrees = green
  const yellowThreshold = thresholds.yellow ?? 25; // Within 25 degrees = yellow

  // Calculate error from target
  const angleDiff = Math.abs(currentAngle - targetAngle);

  if (angleDiff <= greenThreshold) {
    // Perfect form
    const score = Math.round(100 - (angleDiff / greenThreshold) * 5);
    return { color: '#4CAF50', score: Math.max(90, score) }; // Green
  } else if (angleDiff <= yellowThreshold) {
    // Warning
    const score = Math.round(70 - ((angleDiff - greenThreshold) / (yellowThreshold - greenThreshold)) * 20);
    return { color: '#FFC107', score: Math.max(50, score) }; // Yellow
  } else {
    // Danger
    const score = Math.max(20, Math.round(50 - (angleDiff - yellowThreshold) * 0.5));
    return { color: '#F44336', score }; // Red
  }
};

/**
 * Extract MediaPipe landmarks for a specific joint triple.
 * @param {Array} keypoints - MediaPipe keypoints array
 * @param {number} idx1 - First landmark index
 * @param {number} idx2 - Second landmark index (vertex)
 * @param {number} idx3 - Third landmark index
 * @param {number} minConfidence - Minimum confidence threshold (0-1)
 * @returns {Object} { pointA, pointB, pointC } or null if confidence is too low
 */
export const extractJointPoints = (keypoints, idx1, idx2, idx3, minConfidence = 0.3) => {
  if (!keypoints || keypoints.length < idx3 + 1) return null;

  const kp1 = keypoints[idx1];
  const kp2 = keypoints[idx2];
  const kp3 = keypoints[idx3];

  // Handle different keypoint formats (score or confidence field)
  const getConfidence = (kp) => kp?.score ?? kp?.confidence ?? 0;

  // Check confidence scores with lowered threshold
  if (
    !kp1 ||
    !kp2 ||
    !kp3 ||
    getConfidence(kp1) < minConfidence ||
    getConfidence(kp2) < minConfidence ||
    getConfidence(kp3) < minConfidence
  ) {
    return null;
  }

  return {
    pointA: { x: kp1.x, y: kp1.y },
    pointB: { x: kp2.x, y: kp2.y },
    pointC: { x: kp3.x, y: kp3.y },
  };
};

/**
 * MediaPipe BlazePose landmark indices for common joints.
 */
export const BLAZEPOSE_INDICES = {
  // Left side
  LEFT_SHOULDER: 11,
  LEFT_ELBOW: 13,
  LEFT_WRIST: 15,
  LEFT_HIP: 23,
  LEFT_KNEE: 25,
  LEFT_ANKLE: 27,

  // Right side
  RIGHT_SHOULDER: 12,
  RIGHT_ELBOW: 14,
  RIGHT_WRIST: 16,
  RIGHT_HIP: 24,
  RIGHT_KNEE: 26,
  RIGHT_ANKLE: 28,

  // Center
  NOSE: 0,
  NECK: 0, // Approximate (midpoint of shoulders in some systems)
};

/**
 * Calculate angles for common arm exercises.
 * @param {Array} keypoints - MediaPipe keypoints
 * @param {string} side - 'left' or 'right'
 * @returns {Object} { bicepCurl, shoulderRaise, elbowFlexion } with angle values
 */
export const calculateArmAngles = (keypoints, side = 'left') => {
  const idx = side === 'left' ? {
    shoulder: BLAZEPOSE_INDICES.LEFT_SHOULDER,
    elbow: BLAZEPOSE_INDICES.LEFT_ELBOW,
    wrist: BLAZEPOSE_INDICES.LEFT_WRIST,
    hip: BLAZEPOSE_INDICES.LEFT_HIP,
  } : {
    shoulder: BLAZEPOSE_INDICES.RIGHT_SHOULDER,
    elbow: BLAZEPOSE_INDICES.RIGHT_ELBOW,
    wrist: BLAZEPOSE_INDICES.RIGHT_WRIST,
    hip: BLAZEPOSE_INDICES.RIGHT_HIP,
  };

  const bicepCurlPoints = extractJointPoints(
    keypoints,
    idx.shoulder,
    idx.elbow,
    idx.wrist
  );
  const bicepCurlAngle = bicepCurlPoints ? calculateAngle(bicepCurlPoints.pointA, bicepCurlPoints.pointB, bicepCurlPoints.pointC) : null;

  const shoulderRaisePoints = extractJointPoints(
    keypoints,
    idx.hip,
    idx.shoulder,
    idx.elbow
  );
  const shoulderRaiseAngle = shoulderRaisePoints ? calculateAngle(shoulderRaisePoints.pointA, shoulderRaisePoints.pointB, shoulderRaisePoints.pointC) : null;

  return {
    bicepCurl: bicepCurlAngle, // Target: ~90 degrees
    shoulderRaise: shoulderRaiseAngle, // Target: ~120 degrees
  };
};

/**
 * Calculate angles for common leg exercises.
 * @param {Array} keypoints - MediaPipe keypoints
 * @param {string} side - 'left' or 'right'
 * @returns {Object} { kneeFlexion, legExtension } with angle values
 */
export const calculateLegAngles = (keypoints, side = 'left') => {
  const idx = side === 'left' ? {
    hip: BLAZEPOSE_INDICES.LEFT_HIP,
    knee: BLAZEPOSE_INDICES.LEFT_KNEE,
    ankle: BLAZEPOSE_INDICES.LEFT_ANKLE,
  } : {
    hip: BLAZEPOSE_INDICES.RIGHT_HIP,
    knee: BLAZEPOSE_INDICES.RIGHT_KNEE,
    ankle: BLAZEPOSE_INDICES.RIGHT_ANKLE,
  };

  const kneeFlexionPoints = extractJointPoints(
    keypoints,
    idx.hip,
    idx.knee,
    idx.ankle
  );
  const kneeFlexionAngle = kneeFlexionPoints ? calculateAngle(kneeFlexionPoints.pointA, kneeFlexionPoints.pointB, kneeFlexionPoints.pointC) : null;

  return {
    kneeFlexion: kneeFlexionAngle, // Target: ~90 degrees for squat
  };
};

export default {
  calculateAngle,
  getColorAndScore,
  extractJointPoints,
  calculateArmAngles,
  calculateLegAngles,
  BLAZEPOSE_INDICES,
};
