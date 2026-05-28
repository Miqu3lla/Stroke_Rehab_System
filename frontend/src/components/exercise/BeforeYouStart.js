import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

//color legend items displayed on the "Before you start" card
const COLOR_LEGEND = [
  { color: '#4CAF50', label: 'Green — correct form, keep going' },
  { color: '#FFC107', label: 'Yellow — almost there, small adjustment' },
  { color: '#F44336', label: 'Red — adjust your position' },
];

export default function BeforeYouStart({ exercise, onBegin }) {
  return (
    <View className="flex-1 justify-center bg-[#0f1116] p-6">
      <Text className="text-white text-2xl font-bold text-center mb-2">{exercise?.name}</Text>
      <Text className="text-[#c3c9dd] text-center text-base mb-1.5">{exercise?.duration_minutes} min</Text>

      {!!exercise?.description && (
        <Text className="text-[#c3c9dd] text-center text-[13px] mt-2 mb-1 leading-[18px]">{exercise.description}</Text>
      )}

      <View className="mt-4 bg-white/5 rounded-2xl p-4 w-full">
        <Text className="text-white font-bold text-[15px] mb-2.5">Before you start</Text>
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Stand 1–2 metres from the camera</Text>
        <Text className="text-[#c3c9dd] text-[13px] mb-1.5 leading-[18px]">• Make sure your full upper body is visible</Text>
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
