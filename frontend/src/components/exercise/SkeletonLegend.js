import React from 'react';
import { View, Text } from 'react-native';
import { palette } from '../../constants/palette';

// Matches the skeleton's band colors (see mapBandColor in SkeletonOverlay.js)
// so a patient doesn't need to already know what red/amber/green means.
const BANDS = [
  { color: palette.sage, label: 'On track' },
  { color: palette.amber, label: 'Adjust' },
  { color: palette.danger, label: 'Off form' },
];

export default function SkeletonLegend() {
  return (
    <View
      className="absolute right-3 bg-black/60 rounded-xl py-3 px-3 border border-white/10 gap-2.5"
      style={{ top: '42%' }}
    >
      {BANDS.map(({ color, label }) => (
        <View key={label} className="flex-row items-center gap-1.5">
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
          <Text className="text-white text-[10px] font-semibold">{label}</Text>
        </View>
      ))}
    </View>
  );
}
