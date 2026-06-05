import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

//color legend items displayed on the "Before you start" card
const COLOR_LEGEND = [
  { color: '#4CAF50', label: 'Green — correct form, rep counts here' },
  { color: '#FFC107', label: 'Yellow — almost there, small adjustment' },
  { color: '#F44336', label: 'Red — adjust your position' },
];

// Summarize the exercise's sets[] composition for the pre-start card.
// Patient sees what they're actually signing up for: number of sets,
// reps per set, and whether there's a hold finisher (Strength mode).
// Falls back to "Exercise" when sets is missing (older recommender
// shapes during the deploy window).
function describeSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 'Exercise';

  const repSets = sets.filter((s) => s.format === 'reps');
  const holdSets = sets.filter((s) => s.format === 'hold');

  const parts = [];
  if (repSets.length > 0) {
    const reps = repSets[0]?.target_reps || 12;
    parts.push(`${repSets.length} sets × ${reps} reps`);
  }
  if (holdSets.length > 0) {
    const seconds = holdSets[0]?.hold_seconds || 0;
    const minutes = Math.round(seconds / 60);
    parts.push(`${minutes}-min hold finisher`);
  }
  return parts.join(' + ');
}

export default function BeforeYouStart({ exercise, onBegin }) {
  const setsLabel = describeSets(exercise?.sets);
  const hasHold = Array.isArray(exercise?.sets)
    && exercise.sets.some((s) => s.format === 'hold');

  return (
    <View className="flex-1 justify-center bg-[#0f1116] p-6">
      <Text className="text-white text-2xl font-bold text-center mb-2">{exercise?.name}</Text>
      {/* Replaces the old "X min" label — sets composition is what the
          patient actually needs to know (the duration was misleading
          worst-case time anyway, e.g. "6 min" for 3 sets that finish
          in 2-3 min when reps go smoothly). */}
      <Text className="text-[#c3c9dd] text-center text-base mb-1.5">{setsLabel}</Text>

      {!!exercise?.description && (
        <Text className="text-[#c3c9dd] text-center text-[13px] mt-2 mb-1 leading-[18px]">{exercise.description}</Text>
      )}

      <View className="mt-4 bg-white/5 rounded-2xl p-4 w-full">
        <Text className="text-white font-bold text-[15px] mb-2.5">Before you start</Text>
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Stand 1–2 metres from the camera</Text>
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Make sure your full upper body is visible</Text>
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• You'll get a short break between each set</Text>
        {hasHold && (
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Hold finisher comes last — hold as long as you can</Text>
        )}
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Follow the colour of the skeleton lines:</Text>

        {COLOR_LEGEND.map(({ color, label }) => (
          <View key={color} className="flex-row items-center mt-1.5">
            <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: color }} />
            <Text className="text-[#c3c9dd] text-[13px]">{label}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity className="self-center mt-4 bg-[#0c56d0] rounded-full py-3.5 px-6" onPress={onBegin}>
        <Text className="text-white font-bold text-base">Begin Exercise</Text>
      </TouchableOpacity>
    </View>
  );
}
