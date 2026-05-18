import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Clock, X, Play } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';

const ExerciseModal = ({ visible, exercise, onClose, navigation }) => {
  const { recommendedExercises, beginSession } = usePatientStore();

  if (!exercise) return null;

  // Tapping a card starts a workout session with the full recommended
  // playlist, entering at the tapped exercise's index. Falls back to a
  // single-exercise playlist if the recommendations list isn't loaded.
  const handleStartExercise = () => {
    const playlist = (recommendedExercises && recommendedExercises.length > 0)
      ? recommendedExercises
      : [exercise];
    const startIndex = playlist.findIndex((e) => e.id === exercise.id);
    beginSession(playlist, startIndex >= 0 ? startIndex : 0);
    onClose();
    navigation.navigate('Exercise');
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} />
        
        {/* Modal Content */}
        <View className="bg-[#faf8ff] rounded-t-3xl pt-2 px-6 pb-10 max-h-[90%]">
          
          {/* Drag Indicator */}
          <View className="w-12 h-1.5 bg-[#c3c6d6] rounded-full self-center mb-4" />
          
          {/* Header Row */}
          <View className="flex-row justify-between items-start mb-6">
            <View className="flex-1 pr-4">
              <Text className="text-[28px] font-bold text-[#191b23] leading-tight">
                {exercise.name}
              </Text>
              <View className="flex-row items-center gap-2 mt-2">
                <Clock size={18} color="#434654" />
                <Text className="text-[16px] font-medium text-[#434654]">
                  {exercise.duration_minutes} minutes
                </Text>
              </View>
            </View>
            
            <TouchableOpacity 
              onPress={onClose}
              className="bg-[#e7e7f2] p-2 rounded-full mt-1"
            >
              <X size={24} color="#191b23" />
            </TouchableOpacity>
          </View>

          {/* Video Placeholder */}
          <View className="w-full aspect-video bg-[#e7e7f2] rounded-2xl mb-6 items-center justify-center border-4 border-[#ededf8]">
            <Play size={48} color="#c3c6d6" />
            <Text className="text-[#434654] font-medium mt-2">Video Demonstration</Text>
          </View>

          {/* Description */}
          <View className="mb-8">
            <Text className="text-[18px] font-bold text-[#191b23] mb-2">Instructions</Text>
            <Text className="text-[16px] text-[#434654] leading-relaxed">
              {exercise.description || "Follow along with the video to safely and effectively perform this exercise."}
            </Text>
          </View>

          {/* Start Button */}
          <TouchableOpacity 
            className="w-full bg-[#0c56d0] min-h-[64px] rounded-full flex-row items-center justify-center active:bg-[#0a46a8]"
            onPress={handleStartExercise}
          >
            <Text className="text-white text-[20px] font-bold">Start Exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default ExerciseModal;
