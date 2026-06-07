import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Play, X } from 'lucide-react-native';

// BreakScreen — overlay shown between sets of the same exercise.
// Sets-and-modes Phase C (2026-06-04). Designed with the user's
// "Happy Path" UX brief: massive primary "Start Next Set" button to
// reduce decision fatigue, plus a smaller secondary "End Early" for
// the patient to bail out when they're exhausted. Sits inside
// CameraComponent so the camera + WebSocket stay alive across sets
// (no re-handshake), but pauses frame capture while the screen is up.

export default function BreakScreen({
  justFinishedSetIndex,    // 0-indexed; +1 for display
  totalSets,
  justFinishedScore,       // 0-100 avg form score for the set just done
  justFinishedReps,        // reps actually completed (may be < target on cap)
  targetRepsForFinishedSet,
  upNextLabel,             // e.g. "Set 2 of 3" — caller computes
  onStartNextSet,
  onEndEarly,
}) {
  const score = Math.round(Number(justFinishedScore) || 0);
  const tone = score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';
  const encouragement = score >= 85
    ? 'Great form! Keep it up.'
    : score >= 60
      ? 'Good effort — push through.'
      : 'Catch your breath, then go again.';

  const reps = Math.max(0, Math.floor(Number(justFinishedReps) || 0));
  const repTarget = Math.max(1, Math.floor(Number(targetRepsForFinishedSet) || 12));

  return (
    <View className="absolute inset-0 bg-[#faf8ff] px-6 pt-12 pb-8">
      <View className="flex-1 items-center justify-center">
        <Text className="text-[#434654] text-base font-medium mb-1">
          Set {Math.max(1, (Number(justFinishedSetIndex) || 0) + 1)} of {Math.max(1, Number(totalSets) || 1)} complete
        </Text>
        <Text className="text-[#191b23] text-2xl font-bold text-center mb-6">
          Take a breather
        </Text>

        <View
          className="w-44 h-44 rounded-full items-center justify-center border-8 mb-5"
          style={{ borderColor: tone }}
        >
          <Text className="text-[#191b23] text-6xl font-black">{score}%</Text>
          <Text className="text-[#434654] text-sm font-semibold mt-1">Form Score</Text>
        </View>

        <Text className="text-[#434654] text-base font-medium mb-2">
          {reps} of {repTarget} reps completed
        </Text>
        <Text className="text-xl font-bold mb-2" style={{ color: tone }}>
          {encouragement}
        </Text>

        {upNextLabel ? (
          <Text className="text-[#434654] text-base font-medium mt-4 text-center">
            Up next: <Text className="font-bold text-[#191b23]">{upNextLabel}</Text>
          </Text>
        ) : null}
      </View>

      <View className="gap-3">
        {/* Happy Path primary action — massive button, hard to miss. */}
        <TouchableOpacity
          className="bg-[#0c56d0] rounded-full flex-row items-center justify-center min-h-[72px] active:bg-[#0a46a8]"
          onPress={onStartNextSet}
          accessibilityRole="button"
        >
          <Play size={26} color="white" />
          <Text className="text-white text-2xl font-black ml-3">Start Next Set</Text>
        </TouchableOpacity>

        {/* Secondary "end early" — visually deprioritized so an
            exhausted patient can still find the exit, but the eye
            naturally lands on Start Next Set first. */}
        <TouchableOpacity
          className="bg-transparent border-2 border-[#c3c6d6] rounded-full flex-row items-center justify-center min-h-[52px] active:bg-[#ededf8]"
          onPress={onEndEarly}
          accessibilityRole="button"
        >
          <X size={18} color="#434654" />
          <Text className="text-[#434654] text-base font-bold ml-2">End Early</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
