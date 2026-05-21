import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Calendar, CheckCircle2 } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';

const HistoryList = () => {
  const { history, historyLoading, historyError } = usePatientStore();

  if (historyLoading) {
    return (
      <View className="my-2 mb-6">
        <ActivityIndicator size="small" color="#0c56d0" />
        <Text className="mt-3 text-sm font-medium text-[#434654] text-center">Loading past exercises...</Text>
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
    return null; // Don't show the section if no history exists yet
  }

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <View className="my-2 mb-8">
      <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Past exercises</Text>
      <View className="flex-col gap-3">
        {history.slice(0, 3).map((item, index) => {
          const score = Math.round(Number(item.latest_form_score) || 0);
          const tone = score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';
          
          return (
            <View
              key={item.id || index}
              className="w-full flex-row items-center justify-between p-4 bg-white border-2 rounded-xl min-h-[60px]"
              style={{ borderColor: tone }}
            >
              <View className="flex-row items-center flex-1 pr-3">
                <CheckCircle2 size={22} color={tone} />
                <View className="ml-3 flex-1">
                  <Text className="text-[16px] font-bold text-[#191b23] flex-wrap leading-tight">{item.exercise_name}</Text>
                  <View className="flex-row items-center gap-1.5 mt-0.5">
                    <Calendar size={14} color="#8a8d9b" />
                    <Text className="text-[14px] font-medium text-[#8a8d9b]">
                      {formatDate(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>
              <Text className="text-2xl font-black" style={{ color: tone }}>
                {score}%
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default HistoryList;
