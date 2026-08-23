import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { palette } from '../../constants/palette';

// "This week" hero card from the redesign — leads with the number patients
// actually want first (am I improving), instead of burying it below cards.
export default function WeeklyHeroCard({ overallAverage, topMover }) {
  const subtitle = topMover
    ? `${topMover.name} is trending ${topMover.direction}.`
    : 'Keep going — trends show up after a couple more sessions.';

  return (
    <View
      className="mx-4 mb-6 rounded-[22px] p-5 overflow-hidden"
      style={{ backgroundColor: palette.primaryDeep }}
    >
      {/* Decorative motion arc — nods to pose-tracking without being purely ornamental. */}
      <Svg
        width={140} height={140} viewBox="0 0 140 140"
        style={{ position: 'absolute', right: -30, top: -30, opacity: 0.5 }}
      >
        <Path d="M20 120 A 80 80 0 0 1 120 20" stroke="white" strokeWidth={2} strokeDasharray="4 7" opacity={0.6} />
        <Circle cx={20} cy={120} r={4} fill="white" />
        <Circle cx={120} cy={20} r={4} fill="white" />
      </Svg>

      <Text className="text-[11px] font-bold uppercase tracking-widest text-white/75 mb-2">
        This week
      </Text>
      <View className="flex-row items-baseline gap-2 mb-1">
        <Text className="text-[40px] font-black text-white">{overallAverage}%</Text>
        <Text className="text-[14px] text-white/80">avg. session score</Text>
      </View>
      <Text className="text-[13px] text-white/85 leading-5 max-w-[220px]">{subtitle}</Text>
    </View>
  );
}
