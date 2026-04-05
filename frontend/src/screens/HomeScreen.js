import React from "react";
import { Text, View } from "react-native";

const HomeScreen = () => {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50">
      <Text className="text-xl font-semibold text-slate-900">Stroke Rehab Home</Text>
      <Text className="mt-2 px-6 text-center text-slate-600">
        Track progress, start sessions, and view recommendations.
      </Text>
    </View>
  );
};

export default HomeScreen;
