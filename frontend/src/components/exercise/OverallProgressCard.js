import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import usePatientStore from '../../store/usePatientStore';
import useOverallProgress from '../../hooks/useOverallProgress';
import Skeleton from '../ui/Skeleton';

const ScoreColor = (score) =>
  score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';


const TrendBadge = ({ trend }) => {
  if (trend > 0) {
    return (
      <View className="flex-row items-center gap-1 bg-[#e8f5e9] px-2 py-1 rounded-full">
        <TrendingUp size={12} color="#4CAF50" />
        <Text className="text-[#4CAF50] text-xs font-bold">+{trend}% improving!!</Text>
      </View>
    );
  }
  if (trend < 0) {
    return (
      <View className="flex-row items-center gap-1 bg-[#ffebee] px-2 py-1 rounded-full">
        <TrendingDown size={12} color="#FF5252" />
        <Text className="text-[#FF5252] text-xs font-bold">{trend}% declining</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1 bg-[#f0f0f5] px-2 py-1 rounded-full">
      <Minus size={12} color="#8a8d9b" />
      <Text className="text-[#8a8d9b] text-xs font-bold">Stable</Text>
    </View>
  );
};

const OverallProgressCard = () => {
  const { history, historyLoading } = usePatientStore();
  const { overallAverage, trend, hasData } = useOverallProgress(history);
  const navigation = useNavigation();

  if (historyLoading) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Overall Progress</Text>
        <Skeleton height={200} borderRadius={16} className="w-full" />
      </View>
    );
  }

  if (!hasData) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Overall Progress</Text>
        <View className="bg-white border border-[#e7e7f2] rounded-2xl shadow-sm p-6 items-center">
          <View className="bg-[#f0f0f5] rounded-full p-4 mb-3">
            <Activity size={28} color="#8a8d9b" />
          </View>
          <Text className="text-[15px] font-bold text-[#191b23] mb-1">No progress yet</Text>
          <Text className="text-[13px] text-[#8a8d9b] text-center mb-4">
            Complete your first exercise to start tracking your overall progress.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Sessions')}
            className="bg-[#191b23] px-5 py-2.5 rounded-full"
          >
            <Text className="text-white text-[13px] font-bold">Start an exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const scoreColor = ScoreColor(overallAverage);

  return (
    <View className="my-2 mb-8">
      <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Overall Progress</Text>
      <View className="bg-white border border-[#e7e7f2] rounded-2xl shadow-sm p-4">

        {/* Average score + trend badge */}
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-[13px] font-medium text-[#8a8d9b] mb-0.5">Average score</Text>
            <Text className="text-5xl font-black" style={{ color: scoreColor }}>
              {overallAverage}%
            </Text>
          </View>
          <TrendBadge trend={trend} />
        </View>

        <View className="h-px bg-[#e7e7f2] mb-3" />

        <TouchableOpacity
          onPress={() => navigation.navigate('Sessions')}
          className="flex-row items-center justify-center gap-1.5 bg-[#f0f0f5] py-2.5 rounded-xl"
        >
          <Activity size={13} color="#191b23" />
          <Text className="text-[13px] font-bold text-[#191b23]">Do it again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default OverallProgressCard;