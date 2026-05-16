import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import CameraComponent from '../components/exercise/CameraComponent';
import useAuthStore from '../store/useAuthStore';

const ExerciseScreen = ({ route, navigation }) => {
  const { getAuthSession } = useAuthStore();
  const exercise = route?.params?.exercise;

  // Guard: redirect to Login if there is no active session
  useEffect(() => {
    const checkSession = async () => {
      const session = await getAuthSession();
      if (!session) {
        navigation.replace('Login');
      }
    };
    checkSession();
  }, []);

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-[#faf8ff] px-6">
        <Text className="text-[#191b23] text-base font-semibold">Exercise not found.</Text>
        <TouchableOpacity
          className="mt-4 bg-[#0c56d0] px-4 py-2 rounded-lg"
          onPress={() => navigation.goBack()}
        >
          <Text className="text-white font-semibold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#faf8ff]">
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-[#e7e7f2]">
        <TouchableOpacity onPress={() => navigation.goBack()} className="flex-row items-center">
          <ChevronLeft size={22} color="#0c56d0" />
          <Text className="text-[#0c56d0] font-semibold ml-1">Back</Text>
        </TouchableOpacity>
        <Text className="text-[#191b23] font-semibold text-base ml-3 flex-1" numberOfLines={1}>
          {exercise.name}
        </Text>
      </View>

      <CameraComponent exercise={exercise} navigation={navigation} />
    </View>
  );
};

export default ExerciseScreen;