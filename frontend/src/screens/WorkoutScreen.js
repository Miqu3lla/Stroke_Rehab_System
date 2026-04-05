import React from "react";
import { Text, View } from "react-native";

const WorkoutScreen = () => {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50">
      <Text className="text-xl font-semibold text-slate-900">Workout Session</Text>
      <Text className="mt-2 px-6 text-center text-slate-600">
        Camera + AI pose feedback will be rendered on this screen.
      </Text>
    </View>
  );
};

export default WorkoutScreen;
