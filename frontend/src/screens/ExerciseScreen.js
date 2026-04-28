import React from 'react';
import { View, Text } from 'react-native';
import CameraComponent from '../components/exercise/CameraComponent';

const ExerciseScreen = () => {
  return (
    <View className="flex-1">
      <View className="mb-4">
        <Text className="text-2xl font-bold text-slate-900">Exercise</Text>
        <Text className="text-slate-500">Perform your exercises here. Position your camera to capture your full body.</Text>
      </View>
      <View className="flex-1 bg-slate-200 rounded-2xl overflow-hidden mt-4">
        <CameraComponent />
      </View>
    </View>
  );
};

export default ExerciseScreen;