import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import usePatientStore from '../store/usePatientStore';

const RecommendationCard = ({ navigation }) => {
  const {
    recommendedExercises,
    recommendationLoading,
    recommendationError,
    startExercise,
  } = usePatientStore();

  if (recommendationLoading) {
    return (
      <View className="my-4 mx-4">
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text className="mt-3 text-sm text-[#666] text-center">Loading your exercise options...</Text>
      </View>
    );
  }

  if (recommendationError) {
    return (
      <View className="my-4 mx-4">
        <Text className="text-sm text-[#f44336] text-center">Unable to load recommendations</Text>
      </View>
    );
  }

  if (!recommendedExercises || recommendedExercises.length === 0) {
    return (
      <View className="my-4 mx-4">
        <Text className="text-sm text-[#999] text-center py-6">No exercise recommendations yet</Text>
      </View>
    );
  }

  const handleStartExercise = async (exercise) => {
    await startExercise(exercise, navigation);
  };

  return (
    <View className="my-4 mx-4">
      {recommendedExercises.map((exercise, index) => (
        <View key={exercise.id} className="bg-white rounded-xl p-4 mb-3 shadow-sm elevation-3">
          {/* Exercise Header */}
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-lg font-semibold text-[#333] flex-1">{exercise.name}</Text>
            <View className="bg-[#f0f0f0] px-2 py-1 rounded-md">
              <Text className="text-sm">
                {'⭐'.repeat(exercise.level)}
              </Text>
            </View>
          </View>

          {/* Exercise Image/Placeholder */}
          <View className="w-full h-[200px] rounded-lg mb-3 bg-[#e3f2fd] justify-center items-center">
            <Text className="text-base text-[#1976d2] font-medium">Exercise Video</Text>
          </View>

          {/* Exercise Description */}
          <Text className="text-sm text-[#666] mb-3 leading-[20px]">
            {exercise.description}
          </Text>

          {/* Exercise Duration */}
          <View className="flex-row justify-between mb-4 pb-3 border-b border-[#eee]">
            <Text className="text-[13px] text-[#999] font-medium">Duration:</Text>
            <Text className="text-[13px] text-[#333] font-semibold">
              {exercise.duration_minutes} minutes
            </Text>
          </View>

          {/* Primary CTA Button */}
          <TouchableOpacity
            className="bg-[#4CAF50] py-3 rounded-lg items-center"
            onPress={() => handleStartExercise(exercise)}
            activeOpacity={0.8}
          >
            <Text className="text-white text-base font-semibold">Do This Exercise</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

export default RecommendationCard;
