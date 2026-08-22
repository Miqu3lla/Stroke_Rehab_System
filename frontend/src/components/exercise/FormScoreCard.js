import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder } from 'react-native';

const COLLAPSED_HEIGHT = 56; // px — height of the peek strip when collapsed

// ─── FormScoreCard ────────────────────────────────────────────────────────────
// Swipeable bottom sheet showing the live form score, set timer, progress bar,
// and the Finish / End Early action buttons.
//
// Swipe down (or tap the drag handle) to collapse to a compact peek strip so
// the camera feed is fully visible. Swipe up or tap to restore.
export default function FormScoreCard({
  currentScore,
  setElapsedSeconds,
  setTotalSeconds,
  formatTime,
  finishCurrentSet,
  finishExercise,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const translateY   = useRef(new Animated.Value(0)).current;
  const cardHeightRef = useRef(0);

  const snapTo = (toCollapsed) => {
    const toValue = toCollapsed ? cardHeightRef.current - COLLAPSED_HEIGHT : 0;
    Animated.spring(translateY, {
      toValue,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
    setCollapsed(toCollapsed);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const max     = cardHeightRef.current - COLLAPSED_HEIGHT;
        const clamped = Math.max(0, Math.min(max, g.dy + (collapsed ? max : 0)));
        translateY.setValue(clamped);
      },
      onPanResponderRelease: (_, g) => {
        if      (g.vy > 0.3 || g.dy > 40)  snapTo(true);
        else if (g.vy < -0.3 || g.dy < -40) snapTo(false);
        else                                 snapTo(collapsed);
      },
    })
  ).current;

  const progress = Math.min(100, (setElapsedSeconds / Math.max(1, setTotalSeconds)) * 100);

  return (
    <Animated.View
      style={[styles.card, { transform: [{ translateY }] }]}
      onLayout={(e) => { cardHeightRef.current = e.nativeEvent.layout.height; }}
      {...panResponder.panHandlers}
    >
      {/* ── Drag handle + always-visible peek row ── */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => snapTo(!collapsed)}
        style={styles.peekStrip}
      >
        <View style={styles.dragPill} />
        <View style={styles.peekRow}>
          <Text style={styles.peekScore}>{currentScore}% Form</Text>
          <Text style={styles.peekTime}>
            {formatTime(setElapsedSeconds)} / {formatTime(setTotalSeconds)}
          </Text>
          <Text style={styles.peekChevron}>{collapsed ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {/* ── Expanded content — clipped away when card slides down ── */}
      <View style={styles.expandedContent}>
        {/* Score + time row */}
        <View className="flex-row justify-between mb-4">
          <View>
            <Text className="text-white text-3xl font-black tracking-tight">{currentScore}%</Text>
            <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Form Score</Text>
          </View>
          <View className="items-end">
            <Text className="text-white text-3xl font-black tracking-tight">
              {formatTime(setElapsedSeconds)}{' '}
              <Text className="text-2xl text-white/60">/ {formatTime(setTotalSeconds)}</Text>
            </Text>
            <Text className="text-[#d2d6e3] text-sm font-medium mt-1">Set Time</Text>
          </View>
        </View>

        {/* Set progress bar */}
        <View className="w-full h-2 rounded-full bg-white/20 overflow-hidden mb-5">
          <View
            className="h-full bg-[#4CAF50] rounded-full"
            style={{ width: `${progress}%` }}
          />
        </View>

        {/* Action buttons */}
        <View className="flex-row gap-3">
          <TouchableOpacity
            className="flex-1 bg-[#4CAF50] rounded-full items-center justify-center py-4"
            onPress={() => finishCurrentSet('finish')}
          >
            <Text className="text-white font-bold text-lg">Finish Current Set</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-[#ba1a1a] rounded-full items-center justify-center py-4"
            onPress={() => finishExercise('end_early')}
          >
            <Text className="text-white font-bold text-lg">End Early</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    paddingBottom: 24,
  },
  peekStrip: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 20,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
  },
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  peekScore: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  peekTime: {
    color: '#d2d6e3',
    fontWeight: '600',
    fontSize: 14,
  },
  peekChevron: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  expandedContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
});
