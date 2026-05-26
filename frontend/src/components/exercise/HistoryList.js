import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Calendar } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';
import Skeleton from '../ui/Skeleton';

export default function HistoryList() {
  const { history, historyLoading, historyError } = usePatientStore();

  if (historyLoading) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Past exercises</Text>
        <View className="flex-col gap-3">
          <Skeleton height={80} borderRadius={16} className="w-full" />
          <Skeleton height={80} borderRadius={16} className="w-full" />
          <Skeleton height={80} borderRadius={16} className="w-full" />
        </View>
      </View>
    );
  }

  if (historyError) {
    return (
      <View className="my-2 mb-6">
        <Text className="text-sm font-medium text-[#ba1a1a] text-center">Unable to load history</Text>
      </View>
    );
  }

  if (!history || history.length === 0) {
    return (
      <View className="my-2 mb-8">
        <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Recent Activity</Text>
        <View className="p-5">
          <Text className="text-[14px] font-medium text-[#8a8d9b] text-center">
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
      <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Recent Activity</Text>
      <View className="flex-col gap-3">
        {history
          .filter((item, index, self) => 
            // Keep only the first occurrence of each exercise_id
            index === self.findIndex((t) => t.exercise_id === item.exercise_id)
          )
          .slice(0, 3)
          .map((item, index) => {
            const score = Math.round(Number(item.latest_form_score) || 0);
            const tone = score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';
            
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
                diffElement = <Text className="text-[#4CAF50] text-xs font-bold mt-0.5">+{diff}% better on average</Text>;
              } else if (diff < 0) {
                diffElement = <Text className="text-[#FF5252] text-xs font-bold mt-0.5">{Math.abs(diff)}% less on average</Text>;
              } else {
                diffElement = <Text className="text-[#8a8d9b] text-xs font-bold mt-0.5">Same as before</Text>;
              }
            }
            
            return (
            <View
              key={item.id || index}
              className="w-full flex-row items-center justify-between p-4 bg-white border border-[#e7e7f2] rounded-2xl shadow-sm"
            >
              <View className="flex-1 pr-3">
                <Text className="text-[16px] font-bold text-[#191b23] flex-wrap leading-tight mb-1">{item.exercise_name}</Text>
                <View className="flex-row items-center gap-1.5 mb-1">
                  <Calendar size={14} color="#8a8d9b" />
                  <Text className="text-[14px] font-medium text-[#8a8d9b]">
                    {formatDate(item.created_at)}
                  </Text>
                </View>
                {diffElement}
              </View>
              <View className="items-end pl-2 border-l border-[#e7e7f2]">
                <Text className="text-2xl font-black" style={{ color: tone }}>
                  {score}%
                </Text>
                <Text className="text-[10px] font-bold text-[#8a8d9b] mt-0.5 uppercase tracking-wider">
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
