import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { isArmExercise, isLegExercise } from '../../utils/repCounter';
import { palette } from '../../constants/palette';

// MediaPipe Pose connections — pairs of keypoint indices to draw as bones
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


// White so the untracked rest-of-skeleton stays legible instead of blending into the app palette.
const NEUTRAL = '#FFFFFF';
const NEUTRAL_OPACITY = 0.8;
// 0.4 is the rendering floor — MediaPipe already rejects background
// false-positives server-side, so stricter here would just hide valid joints.
const MIN_CONFIDENCE = 0.4;


const BAND_COLOR_MAP = {
  '#4CAF50': palette.sage,
  '#FFC107': palette.amber,
  '#F44336': palette.danger,
  '#888888': NEUTRAL,
};
function mapBandColor(hex) {
  if (!hex) return null;
  return BAND_COLOR_MAP[hex.toUpperCase()] ?? hex;
}

// WS pose updates land at ~8-12 FPS; without smoothing the skeleton visibly
// steps between frames. We LERP position every animation frame toward the
// latest WS value so it renders at 60 FPS. 0.45 closes ~97% of the gap
// within ~100ms (about one WS interval) without feeling laggy or twitchy.
const SMOOTHING_FACTOR = 0.45;
// Below this distance we snap instead of animating, so the RAF loop isn't
// spinning on sub-pixel deltas forever.
const SNAP_DISTANCE_PX = 0.5;

// Takes raw WS keypoints and returns the same list smoothed to 60 FPS via RAF.
function useSmoothedKeypoints(rawKeypoints) {
  const targetRef = useRef([]);
  const displayedRef = useRef([]);
  const rafRef = useRef(null);
  const [, forceRender] = useState(0);

  // New WS keypoints become the interpolation target. Snap immediately (no
  // fly-in from origin) on the first frame or after a reset.
  useEffect(() => {
    if (!Array.isArray(rawKeypoints) || rawKeypoints.length === 0) {
      targetRef.current = [];
      displayedRef.current = [];
      forceRender((n) => n + 1);
      return;
    }
    targetRef.current = rawKeypoints;
    if (displayedRef.current.length !== rawKeypoints.length) {
      displayedRef.current = rawKeypoints.map((kp) => ({ ...kp }));
      forceRender((n) => n + 1);
    }
  }, [rawKeypoints]);

  // Runs for the component's lifetime; short-circuits cheaply when idle.
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const target = targetRef.current;
      const displayed = displayedRef.current;

      if (target.length > 0 && displayed.length === target.length) {
        let needsRender = false;
        const next = new Array(displayed.length);
        for (let i = 0; i < displayed.length; i += 1) {
          const d = displayed[i];
          const t = target[i];
          if (!d || !t) {
            next[i] = t || d;
            continue;
          }
          const dx = t.x - d.x;
          const dy = t.y - d.y;
          // A joint can settle positionally but still need a repaint if its
          // MediaPipe confidence crossed MIN_CONFIDENCE (hides/shows a bone).
          const scoreChanged = Math.abs((d.score || 0) - (t.score || 0)) > 0.01;
          if (Math.abs(dx) < SNAP_DISTANCE_PX && Math.abs(dy) < SNAP_DISTANCE_PX) {
            next[i] = { x: t.x, y: t.y, z: t.z, score: t.score };
            if (scoreChanged) needsRender = true;
            continue;
          }
          needsRender = true;
          next[i] = {
            x: d.x + dx * SMOOTHING_FACTOR,
            y: d.y + dy * SMOOTHING_FACTOR,
            z: t.z,
            // Use the target's confidence directly - interpolating a
            // probability would produce a value the server never returned.
            score: t.score,
          };
        }
        displayedRef.current = next;
        if (needsRender) forceRender((n) => n + 1);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return displayedRef.current;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex([r, g, b]) {
  const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Same RAF-LERP approach as useSmoothedKeypoints, applied to color channels
// instead of position - an instant green/amber/red snap read as raw sensor
// output, this makes band changes feel like an intentional UI response.
function useSmoothedColor(targetHex) {
  const fallback = hexToRgb(targetHex) || [0, 0, 0];
  const displayedRef = useRef(fallback);
  const targetRef = useRef(fallback);
  const rafRef = useRef(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const rgb = hexToRgb(targetHex);
    if (rgb) targetRef.current = rgb;
  }, [targetHex]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const d = displayedRef.current;
      const t = targetRef.current;
      const delta = [t[0] - d[0], t[1] - d[1], t[2] - d[2]];
      if (delta.some((v) => Math.abs(v) > 0.5)) {
        displayedRef.current = [
          d[0] + delta[0] * SMOOTHING_FACTOR,
          d[1] + delta[1] * SMOOTHING_FACTOR,
          d[2] + delta[2] * SMOOTHING_FACTOR,
        ];
        forceRender((n) => n + 1);
      } else if (d !== t && (d[0] !== t[0] || d[1] !== t[1] || d[2] !== t[2])) {
        displayedRef.current = t;
        forceRender((n) => n + 1);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return rgbToHex(displayedRef.current);
}

export default function SkeletonOverlay({
  keypoints,
  jointColors,
  viewWidth,
  viewHeight,
  imageWidth,
  imageHeight,
  affectedSide = 'right',
  exerciseType = '',
}) {
  // Smoothed keypoints/colors update at 60 FPS via RAF; raw props only
  // change when the WS delivers a new pose result.
  const smoothedKeypoints = useSmoothedKeypoints(keypoints);
  const bicepColor = useSmoothedColor(mapBandColor(jointColors?.bicepCurl) ?? NEUTRAL);
  const kneeColor = useSmoothedColor(mapBandColor(jointColors?.kneeFlexion) ?? NEUTRAL);

  if (
    !smoothedKeypoints?.length ||
    !viewWidth || !viewHeight ||
    !imageWidth || !imageHeight
  ) return null;

  // Camera preview uses "cover" mode (scaled + cropped to fill the view) -
  // apply the same transform to keypoints so the skeleton lines up on screen.
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const offsetX = (viewWidth - imageWidth * scale) / 2;
  const offsetY = (viewHeight - imageHeight * scale) / 2;

  const getPoint = (idx) => {
    const kp = smoothedKeypoints[idx];
    if (!kp || (kp.score ?? kp.confidence ?? 0) < MIN_CONFIDENCE) return null;
    const x = kp.x * scale + offsetX;
    const y = kp.y * scale + offsetY;
    // Cover-mode crops the captured photo's edges, so an off-screen joint
    // here would otherwise draw a stray diagonal line into empty space.
    if (x < -10 || x > viewWidth + 10 || y < -10 || y > viewHeight + 10) return null;
    return { x, y };
  };

  // Front camera feed is mirrored, so clinical RIGHT maps to MediaPipe's LEFT
  // landmarks (11/13/15/23/25/27) and vice-versa - kept in sync with the
  // backend's score_pose tracked_sides mapping. Swap the two lines below if
  // testing ever shows the highlight on the wrong side.
  const normalizedSide = (affectedSide || 'right').toString().trim().toLowerCase();
  const trackedSegSides =
    normalizedSide === 'both' ? ['LEFT', 'RIGHT']
      : normalizedSide === 'left' ? ['RIGHT']
        : ['LEFT'];

  const getLineColor = (i1, i2) => {
    const key = `${i1}-${i2}`;

    if (isArmExercise(exerciseType)) {
      if (trackedSegSides.some((s) => SEGMENT_MAP[`ARM_${s}`].has(key))) {
        return { color: bicepColor, opacity: 1 };
      }
    } else if (isLegExercise(exerciseType)) {
      if (trackedSegSides.some((s) => SEGMENT_MAP[`LEG_${s}`].has(key))) {
        return { color: kneeColor, opacity: 1 };
      }
    } else {
      // Generic fallback — highlight whichever angle was calculated
      if (SEGMENT_MAP.ARM_LEFT.has(key) || SEGMENT_MAP.ARM_RIGHT.has(key)) {
        return { color: bicepColor, opacity: 1 };
      }
      if (SEGMENT_MAP.LEG_LEFT.has(key) || SEGMENT_MAP.LEG_RIGHT.has(key)) {
        return { color: kneeColor, opacity: 1 };
      }
    }

    return { color: NEUTRAL, opacity: NEUTRAL_OPACITY };
  };

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {CONNECTIONS.map(([i1, i2]) => {
        const p1 = getPoint(i1);
        const p2 = getPoint(i2);
        if (!p1 || !p2) return null;
        const c1 = smoothedKeypoints[i1]?.score ?? smoothedKeypoints[i1]?.confidence ?? 0;
        const c2 = smoothedKeypoints[i2]?.score ?? smoothedKeypoints[i2]?.confidence ?? 0;
        if (Math.min(c1, c2) < 0.5) return null;
        // Skip bones longer than 55% of view height — filters spurious cross-frame
        // detections while allowing fully-extended arm bones to render.
        const boneLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (boneLen > viewHeight * 0.55) return null;
        const { color, opacity } = getLineColor(i1, i2);
        return (
          <Line
            key={`${i1}-${i2}`}
            x1={p1.x} y1={p1.y}
            x2={p2.x} y2={p2.y}
            stroke={color}
            strokeOpacity={opacity}
            strokeWidth={5}
            strokeLinecap="round"
          />
        );
      })}
      {smoothedKeypoints.map((kp, idx) => {
        // Indices 0–10 are face landmarks (nose, eyes, ears, mouth) — skip them.
        if (idx < 11) return null;
        const p = getPoint(idx);
        if (!p) return null;
        // Same trackedSegSides as the bone lines, so dots and bones agree on
        // which limb is highlighted.
        const isActiveArm = isArmExercise(exerciseType) && (
          ([11, 13, 15].includes(idx) && trackedSegSides.includes('LEFT')) ||
          ([12, 14, 16].includes(idx) && trackedSegSides.includes('RIGHT'))
        );
        const isActiveLeg = isLegExercise(exerciseType) && (
          ([23, 25, 27].includes(idx) && trackedSegSides.includes('LEFT')) ||
          ([24, 26, 28].includes(idx) && trackedSegSides.includes('RIGHT'))
        );
        const dotColor = isActiveArm ? bicepColor : isActiveLeg ? kneeColor : NEUTRAL;
        const dotOpacity = isActiveArm || isActiveLeg ? 1 : NEUTRAL_OPACITY;
        return (
          <Circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={dotColor}
            fillOpacity={dotOpacity}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={1}
          />
        );
      })}
    </Svg>
  );
}
