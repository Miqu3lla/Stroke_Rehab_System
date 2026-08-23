import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Calendar, TrendingUp, TrendingDown } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';
import Skeleton from '../ui/Skeleton';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { getExerciseVisual } from '../../utils/exerciseVisuals';

export default function HistoryList() {
  const { history, historyLoading, historyError } = usePatientStore();

  if (historyLoading) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Recent activity</Text>
        <View className="flex-col gap-3">
          <Skeleton height={80} borderRadius={18} className="w-full" />
          <Skeleton height={80} borderRadius={18} className="w-full" />
          <Skeleton height={80} borderRadius={18} className="w-full" />
        </View>
      </View>
    );
  }

  if (historyError) {
    return (
      <View className="my-2 mb-6">
        <Text className="text-sm text-center" style={{ color: palette.amber, fontFamily: fonts.sansMedium }}>Unable to load history</Text>
      </View>
    );
  }

  if (!history || history.length === 0) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Recent activity</Text>
        <View className="p-5">
          <Text className="text-[14px] text-center" style={{ color: palette.inkSoft, fontFamily: fonts.sansMedium }}>
            No current exercises done yet. Start now!
          </Text>
        </View>
      </View>
    );
  }

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <View className="my-2 mb-8">
      <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Recent activity</Text>
      <View className="flex-col gap-3">
        {history
          .filter((item, index, self) =>
            // Keep only the first occurrence of each exercise_id
            index === self.findIndex((t) => t.exercise_id === item.exercise_id)
          )
          .slice(0, 3)
          .map((item, index) => {
            const score = Math.round(Number(item.latest_form_score) || 0);
            const visual = getExerciseVisual(item.exercise_name);
            const Icon = visual.icon;

            // Find the index in the original history array
            const historyIndex = history.findIndex(h => h.id === item.id);
            const prevItem = item.exercise_id && historyIndex !== -1
              ? history.slice(historyIndex + 1).find(h => h.exercise_id === item.exercise_id)
              : null;
            let diffElement = null;
            if (prevItem) {
              const prevScoreRounded = Math.round(Number(prevItem.latest_form_score) || 0);
              const diff = score - prevScoreRounded;
              if (diff > 0) {
                diffElement = (
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <TrendingUp size={12} color={palette.sage} />
                    <Text className="text-xs" style={{ color: palette.sage, fontFamily: fonts.sansBold }}>+{diff}% better on average</Text>
                  </View>
                );
              } else if (diff < 0) {
                diffElement = (
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <TrendingDown size={12} color={palette.amber} />
                    <Text className="text-xs" style={{ color: palette.amber, fontFamily: fonts.sansBold }}>{Math.abs(diff)}% less on average</Text>
                  </View>
                );
              } else {
                diffElement = <Text className="text-xs mt-0.5" style={{ color: palette.inkSoft, fontFamily: fonts.sansBold }}>Same as before</Text>;
              }
            }

            return (
            <View
              key={item.id || index}
              className="w-full flex-row items-center gap-3.5 p-4 rounded-[18px] border"
              style={{ backgroundColor: palette.card, borderColor: palette.line }}
            >
              <View className="w-11 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: visual.soft }}>
                <Icon size={20} color={visual.color} />
              </View>
              <View className="flex-1 pr-3">
                <Text className="text-[15px] flex-wrap leading-tight mb-1" style={{ color: palette.ink, fontFamily: fonts.sansBold }}>{item.exercise_name}</Text>
                <View className="flex-row items-center gap-1.5 mb-1">
                  <Calendar size={14} color={palette.inkSoft} />
                  <Text className="text-[12px]" style={{ color: palette.inkSoft, fontFamily: fonts.sansMedium }}>
                    {formatDate(item.created_at)}
                  </Text>
                </View>
                {diffElement}
              </View>
              <View className="items-end">
                <Text className="text-[22px] leading-none" style={{ color: palette.ink, fontFamily: fonts.monoSemibold }}>
                  {score}
                </Text>
                <Text className="text-[9px] mt-0.5 uppercase tracking-wider" style={{ color: palette.inkSoft, fontFamily: fonts.monoSemibold }}>
                  Score
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
