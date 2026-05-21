import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';
import ExerciseModal from '../ui/ExerciseModal';

const RecommendationCard = ({ navigation }) => {
  const {
    recommendedExercises,
    recommendationLoading,
    recommendationError,
  } = usePatientStore();

  const [selectedExercise, setSelectedExercise] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  if (recommendationLoading) {
    return (
      <View className="my-2">
        <ActivityIndicator size="small" color="#0c56d0" />
        <Text className="mt-3 text-sm font-medium text-[#434654] text-center">Loading your exercise options...</Text>
      </View>
    );
  }

  if (recommendationError) {
    return (
      <View className="my-2">
        <Text className="text-sm font-medium text-[#ba1a1a] text-center">Unable to load recommendations</Text>
      </View>
    );
  }

  if (!recommendedExercises || recommendedExercises.length === 0) {
    return (
      <View className="my-2">
        <Text className="text-sm font-medium text-[#434654] text-center py-4">No exercise recommendations yet</Text>
      </View>
    );
  }

  const handleOpenModal = (exercise) => {
    setSelectedExercise(exercise);
    setModalVisible(true);
  };

  return (
    <View className="my-2">
      <Text className="text-lg font-bold text-[#191b23] ml-1 mb-3">Recommended exercises</Text>
      <View className="flex-col gap-3">
        {recommendedExercises.map((exercise, index) => (
          <TouchableOpacity
            key={exercise.id}
            className="w-full flex-row items-center justify-between p-4 bg-[#ededf8] border-2 border-[#e7e7f2] rounded-xl active:opacity-80 min-h-[60px]"
            onPress={() => handleOpenModal(exercise)}
          >
            <View className="flex-col gap-1 flex-1 pr-3">
              <Text className="text-[16px] font-bold text-[#191b23] flex-wrap leading-tight">{exercise.name}</Text>
              <View className="flex-row items-center gap-1.5 mt-0.5">
                <Clock size={14} color="#434654" />
                <Text className="text-[14px] font-medium text-[#434654]">
                  {exercise.duration_minutes} min
                </Text>
              </View>
            </View>
            <ChevronRight size={20} color="#0c56d0" />
          </TouchableOpacity>
        ))}
      </View>

      <ExerciseModal 
        visible={modalVisible}
        exercise={selectedExercise}
        onClose={() => setModalVisible(false)}
        navigation={navigation}
      />
    </View>
  );
};

export default RecommendationCard;
