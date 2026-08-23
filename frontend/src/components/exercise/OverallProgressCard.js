import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { TrendingUp, TrendingDown, Minus, Activity, Play } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import usePatientStore from '../../store/usePatientStore';
import useOverallProgress from '../../hooks/useOverallProgress';
import useWeeklyScores from '../../hooks/useWeeklyScores';
import WeeklyScoreChart from './WeeklyScoreChart';
import Skeleton from '../ui/Skeleton';
import { palette, scoreTone } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Trend pill — sage/amber/neutral, matches the redesign's .pill.stable style.
const TrendPill = ({ trend }) => {
  if (trend > 0) {
    return (
      <View className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-full" style={{ backgroundColor: palette.sageSoft }}>
        <TrendingUp size={12} color={palette.sage} />
        <Text className="text-xs" style={{ color: palette.sage, fontFamily: fonts.sansBold }}>+{trend}% improving</Text>
      </View>
    );
  }
  if (trend < 0) {
    return (
      <View className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-full" style={{ backgroundColor: palette.amberSoft }}>
        <TrendingDown size={12} color={palette.amber} />
        <Text className="text-xs" style={{ color: palette.amber, fontFamily: fonts.sansBold }}>{trend}% declining</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-full" style={{ backgroundColor: palette.primarySoft }}>
      <Minus size={12} color={palette.primary} />
      <Text className="text-xs" style={{ color: palette.primary, fontFamily: fonts.sansBold }}>Stable</Text>
    </View>
  );
};

export default function OverallProgressCard() {
  const { history, historyLoading } = usePatientStore();
  const { overallAverage, trend, hasData } = useOverallProgress(history);
  const weeklyDays = useWeeklyScores(history);
  const navigation = useNavigation();

  if (historyLoading) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Overall progress</Text>
        <Skeleton height={220} borderRadius={20} className="w-full" />
      </View>
    );
  }

  if (!hasData) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Overall progress</Text>
        <View className="rounded-[20px] p-6 items-center border" style={{ backgroundColor: palette.card, borderColor: palette.line }}>
          <View className="rounded-full p-4 mb-3" style={{ backgroundColor: palette.primarySoft }}>
            <Activity size={28} color={palette.primary} />
          </View>
          <Text className="text-[15px] mb-1" style={{ color: palette.ink, fontFamily: fonts.sansBold }}>No progress yet</Text>
          <Text className="text-[13px] text-center mb-4" style={{ color: palette.inkSoft, fontFamily: fonts.sans }}>
            Complete your first exercise to start tracking your overall progress.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Sessions')}
            className="px-5 py-2.5 rounded-full"
            style={{ backgroundColor: palette.primary }}
          >
            <Text className="text-white text-[13px]" style={{ fontFamily: fonts.sansBold }}>Start an exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="my-2 mb-8">
      <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Overall progress</Text>
      <View className="rounded-[20px] p-5 border" style={{ backgroundColor: palette.card, borderColor: palette.line }}>

        {/* Average score + trend pill */}
        <View className="flex-row items-start justify-between mb-4">
          <View>
            <Text className="text-[12px] mb-0.5" style={{ color: palette.inkSoft, fontFamily: fonts.sans }}>Latest score, per exercise</Text>
            <Text style={{ color: scoreTone(overallAverage), fontFamily: fonts.serif, fontSize: 32 }}>
              {overallAverage}%
            </Text>
          </View>
          <TrendPill trend={trend} />
        </View>

        <WeeklyScoreChart days={weeklyDays} />

        <TouchableOpacity
          onPress={() => navigation.navigate('Sessions')}
          className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl mt-4"
          style={{ backgroundColor: palette.coral }}
        >
          <Play size={15} color="#fff" fill="#fff" />
          <Text className="text-[14px] text-white" style={{ fontFamily: fonts.sansBold }}>Do it again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}