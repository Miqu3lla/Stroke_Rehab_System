import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';

// BlazePose connections — pairs of keypoint indices to draw as bones
const CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm: shoulder → elbow → wrist
  [11, 13], [13, 15],
  // Right arm: shoulder → elbow → wrist
  [12, 14], [14, 16],
  // Left leg: hip → knee → ankle
  [23, 25], [25, 27],
  // Right leg: hip → knee → ankle
  [24, 26], [26, 28],
];

// Which connections belong to which limb segment (keyed as "i1-i2")
const SEGMENT_MAP = {
  ARM_LEFT:  new Set(['11-13', '13-15']),
  ARM_RIGHT: new Set(['12-14', '14-16']),
  LEG_LEFT:  new Set(['23-25', '25-27']),
  LEG_RIGHT: new Set(['24-26', '26-28']),
};

// Cyan baseline matches the physiotherapy reference style; traffic-light colours override active segments.
const NEUTRAL = 'rgba(0, 229, 255, 0.75)';
// 0.4 is the rendering floor — the "full" BlazePose model already rejects
// background false-positives at the inference level, so a strict threshold
// here only hides valid joints in typical indoor lighting.
const MIN_CONFIDENCE = 0.4;

const isArmExercise = (name) =>
  /bicep|arm|reach|upper|curl|flex|shoulder/i.test(name);

const isLegExercise = (name) =>
  /leg|knee|squat|walk|gait|ankle|lunge|step/i.test(name);

const SkeletonOverlay = ({
  keypoints,
  jointColors,
  viewWidth,
  viewHeight,
  imageWidth,
  imageHeight,
  affectedSide = 'right',
  exerciseType = '',
}) => {
  if (
    !keypoints?.length ||
    !viewWidth || !viewHeight ||
    !imageWidth || !imageHeight
  ) return null;

  // The camera preview uses "cover" mode: the photo is scaled up and cropped
  // to fill the view. We must apply the same transform to the keypoints so
  // the skeleton aligns with what the user sees on screen.
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const offsetX = (viewWidth - imageWidth * scale) / 2;
  const offsetY = (viewHeight - imageHeight * scale) / 2;

  const getPoint = (idx) => {
    const kp = keypoints[idx];
    if (!kp || (kp.score ?? kp.confidence ?? 0) < MIN_CONFIDENCE) return null;
    const x = kp.x * scale + offsetX;
    const y = kp.y * scale + offsetY;
    // Discard joints that fall outside the visible camera area — cover-mode
    // crops the edges of the captured photo, so edge joints appear off-screen
    // and produce diagonal lines flying into the background.
    if (x < -10 || x > viewWidth + 10 || y < -10 || y > viewHeight + 10) return null;
    return { x, y };
  };

  const getLineColor = (i1, i2) => {
    const key = `${i1}-${i2}`;
    const side = affectedSide === 'left' ? 'LEFT' : 'RIGHT';

    if (isArmExercise(exerciseType)) {
      if (SEGMENT_MAP[`ARM_${side}`].has(key)) {
        return jointColors?.bicepCurl ?? NEUTRAL;
      }
    } else if (isLegExercise(exerciseType)) {
      if (SEGMENT_MAP[`LEG_${side}`].has(key)) {
        return jointColors?.kneeFlexion ?? NEUTRAL;
      }
    } else {
      // Generic fallback — highlight whichever angle was calculated
      if (SEGMENT_MAP.ARM_LEFT.has(key) || SEGMENT_MAP.ARM_RIGHT.has(key)) {
        return jointColors?.bicepCurl ?? NEUTRAL;
      }
      if (SEGMENT_MAP.LEG_LEFT.has(key) || SEGMENT_MAP.LEG_RIGHT.has(key)) {
        return jointColors?.kneeFlexion ?? NEUTRAL;
      }
    }

    return NEUTRAL;
  };

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONNECTIONS.map(([i1, i2]) => {
        const p1 = getPoint(i1);
        const p2 = getPoint(i2);
        if (!p1 || !p2) return null;
        const c1 = keypoints[i1]?.score ?? keypoints[i1]?.confidence ?? 0;
        const c2 = keypoints[i2]?.score ?? keypoints[i2]?.confidence ?? 0;
        if (Math.min(c1, c2) < 0.5) return null;
        // Skip bones longer than 55% of view height — filters spurious cross-frame
        // detections while allowing fully-extended arm bones to render.
        const boneLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (boneLen > viewHeight * 0.55) return null;
        const color = getLineColor(i1, i2);
        return (
          <Line
            key={`${i1}-${i2}`}
            x1={p1.x} y1={p1.y}
            x2={p2.x} y2={p2.y}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
          />
        );
      })}
      {keypoints.map((kp, idx) => {
        // Indices 0–10 are face landmarks (nose, eyes, ears, mouth) — skip them.
        if (idx < 11) return null;
        const p = getPoint(idx);
        if (!p) return null;
        // Pick the most relevant segment color for this joint if it's part of an active bone.
        const side = affectedSide === 'left' ? 'LEFT' : 'RIGHT';
        const isActiveArm = isArmExercise(exerciseType) && (
          [11, 13, 15].includes(idx) && side === 'LEFT' ||
          [12, 14, 16].includes(idx) && side === 'RIGHT'
        );
        const isActiveLeg = isLegExercise(exerciseType) && (
          [23, 25, 27].includes(idx) && side === 'LEFT' ||
          [24, 26, 28].includes(idx) && side === 'RIGHT'
        );
        const dotColor = isActiveArm
          ? (jointColors?.bicepCurl ?? NEUTRAL)
          : isActiveLeg
          ? (jointColors?.kneeFlexion ?? NEUTRAL)
          : NEUTRAL;
        return (
          <Circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={dotColor}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
        );
      })}
    </Svg>
  );
};

export default SkeletonOverlay;
