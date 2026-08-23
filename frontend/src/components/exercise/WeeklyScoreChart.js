import React from 'react';
import { View, Text } from 'react-native';
import { palette } from '../../constants/palette';

// 7-day bar chart, plain Views (matches redesign's flex-height div bars —
// no charting lib needed for something this simple). Data from useWeeklyScores.
export default function WeeklyScoreChart({ days }) {
  return (
    <View>
      <View className="flex-row items-end gap-1.5" style={{ height: 60 }}>
        {days.map((day) => {
          const pct = day.average != null ? Math.max(day.average, 8) : 8;
          const filled = day.average != null;
          return (
            <View
              key={day.key}
              className="flex-1 rounded-t"
              style={{
                height: `${pct}%`,
                backgroundColor: filled ? palette.primary : palette.primarySoft,
              }}
            />
          );
        })}
      </View>
      <View className="flex-row gap-1.5 mt-1.5">
        {days.map((day) => (
          <Text
            key={day.key}
            className="flex-1 text-center text-[10px]"
            style={{ color: palette.inkSoft }}
          >
            {day.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
