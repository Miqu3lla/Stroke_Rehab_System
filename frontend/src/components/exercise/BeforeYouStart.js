import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { formatExerciseSession } from '../../utils/duration';
import { isLegExercise } from '../../utils/repCounter';

//color legend items displayed on the "Before you start" card
const COLOR_LEGEND = [
  { color: '#4CAF50', label: 'Green — correct form, rep counts here' },
  { color: '#FFC107', label: 'Yellow — almost there, small adjustment' },
  { color: '#F44336', label: 'Red — adjust your position' },
];

export default function BeforeYouStart({ exercise, onBegin }) {
  // Same composition string the catalog card shows ("3 sets × 12 reps
  // [+ 5-min hold]") — kept in sync via the shared helper so a wording
  // change here doesn't drift from the card the patient just tapped.
  const setsLabel = formatExerciseSession(exercise) || 'Exercise';
  // Mode-specific coaching line. Functionality = hold each rep (tolerance);
  // Strength = reps with a patient-entered weight the app suggests.
  const isStrength = (exercise?.mode || '') === 'strength';
  const holdPerRep = exercise?.hold_seconds_per_rep
    ?? exercise?.sets?.find((s) => s?.hold_seconds_per_rep)?.hold_seconds_per_rep;
  const holdMax = exercise?.hold_seconds_max
    ?? exercise?.sets?.find((s) => s?.hold_seconds_max)?.hold_seconds_max;
  const suggestedWeight = exercise?.suggested_weight_kg
    ?? exercise?.sets?.find((s) => s?.target_weight_kg != null)?.target_weight_kg;

  // Same classifier + fields as ExerciseInfoCard's PostureFeedback, so this
  // pre-session guidance stays consistent with the in-session HUD.
  const exerciseHint = [
    exercise?.name || '',
    exercise?.focus || '',
    exercise?.affected_area || '',
  ].join(' ').toLowerCase();
  const isLeg = isLegExercise(exerciseHint);

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
        {isLeg ? (
          <>
            <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Stand 1.5–2 metres from the camera</Text>
            <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Make sure your full body (head to feet) is visible</Text>
          </>
        ) : (
          <>
            <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Stand 0.5–1 metre from the camera</Text>
            <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Make sure your full upper body is visible</Text>
          </>
        )}
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• You'll get a short break between each set</Text>
        {!isStrength && holdPerRep ? (
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">
            • Hold each rep {holdPerRep}{holdMax ? `–${holdMax}` : ''}s in the green band before it counts
          </Text>
        ) : null}
        {isStrength && suggestedWeight != null ? (
          <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">
            • Suggested weight: {suggestedWeight} kg — set the weight you actually use with the +/− buttons
          </Text>
        ) : null}
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
