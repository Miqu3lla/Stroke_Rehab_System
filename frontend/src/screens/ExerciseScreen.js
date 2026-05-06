import React from 'react';
import { View, Text } from 'react-native';
import CameraComponent from '../components/exercise/CameraComponent';

const ExerciseScreen = () => {
  return (
    <View className="flex-1">
        <CameraComponent />
    </View>
  );
};

export default ExerciseScreen;