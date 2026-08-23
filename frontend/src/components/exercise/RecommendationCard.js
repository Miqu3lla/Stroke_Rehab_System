import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';
import ExerciseModal from '../ui/ExerciseModal';
import Skeleton from '../ui/Skeleton';
import { formatExerciseSession } from '../../utils/duration';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { getExerciseVisual } from '../../utils/exerciseVisuals';

export default function RecommendationCard({ navigation }) {
  const {
    recommendedExercises,
    recommendationLoading,
    recommendationError,
    activeMode,
  } = usePatientStore();

  const [selectedExercise, setSelectedExercise] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  if (recommendationLoading) {
    return (
      <View className="my-2">
        <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Recommended today</Text>
        <View className="flex-col gap-3">
          <Skeleton height={80} borderRadius={18} className="w-full" />
          <Skeleton height={80} borderRadius={18} className="w-full" />
          <Skeleton height={80} borderRadius={18} className="w-full" />
        </View>
      </View>
    );
  }

  if (recommendationError) {
    return (
      <View className="my-2">
        <Text className="text-sm text-center" style={{ color: palette.amber, fontFamily: fonts.sansMedium }}>Unable to load recommendations</Text>
      </View>
    );
  }

  if (!recommendedExercises || recommendedExercises.length === 0) {
    return (
      <View className="my-2">
        <Text className="text-sm text-center py-4" style={{ color: palette.inkSoft, fontFamily: fonts.sansMedium }}>No exercise recommendations yet</Text>
      </View>
    );
  }

  const handleOpenModal = (exercise) => {
    setSelectedExercise(exercise);
    setModalVisible(true);
  };

  const modeTag = activeMode === 'strength' ? 'Strength' : 'Functionality';

  return (
    <View className="my-2">
      <Text className="text-lg ml-1 mb-3" style={{ color: palette.ink, fontFamily: fonts.serif }}>Recommended today</Text>
      <View className="flex-col gap-3">
        {recommendedExercises.map((exercise) => {
          const visual = getExerciseVisual(exercise.name);
          const Icon = visual.icon;
          return (
            <TouchableOpacity
              key={exercise.id}
              className="w-full flex-row items-center gap-3.5 p-4 rounded-[18px] border active:opacity-80"
              style={{ backgroundColor: palette.card, borderColor: palette.line }}
              onPress={() => handleOpenModal(exercise)}
            >
              <View className="w-[52px] h-[52px] rounded-2xl items-center justify-center" style={{ backgroundColor: visual.soft }}>
                <Icon size={24} color={visual.color} />
              </View>
              <View className="flex-1 pr-2">
                <Text className="text-[15px] flex-wrap leading-tight mb-1.5" style={{ color: palette.ink, fontFamily: fonts.sansBold }}>{exercise.name}</Text>
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: palette.primarySoft }}>
                    <Text className="text-[10px] uppercase tracking-wide" style={{ color: palette.primary, fontFamily: fonts.sansBold }}>{modeTag}</Text>
                  </View>
                  <Clock size={13} color={palette.inkSoft} />
                  <Text className="text-[12px]" style={{ color: palette.inkSoft, fontFamily: fonts.sansMedium }}>
                    {formatExerciseSession(exercise)}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color={palette.inkSoft} />
            </TouchableOpacity>
          );
        })}
      </View>

      <View className="mt-1 border border-dashed rounded-2xl p-5" style={{ borderColor: palette.line }}>
        <Text className="text-center text-[12.5px] leading-5" style={{ color: palette.inkSoft, fontFamily: fonts.sans }}>
          Reached the end of today's set.{' '}
          <Text style={{ color: palette.ink, fontFamily: fonts.sansBold }}>Nice work</Text> — check back tomorrow for the next set.
        </Text>
      </View>

      <ExerciseModal
        visible={modalVisible}
        exercise={selectedExercise}
        onClose={() => setModalVisible(false)}
        navigation={navigation}
      />
    </View>
  );
}
