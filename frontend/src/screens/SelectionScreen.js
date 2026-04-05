import React from "react";
import { Text, View } from "react-native";

const SelectionScreen = () => {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50">
      <Text className="text-xl font-semibold text-slate-900">Exercise Selection</Text>
      <Text className="mt-2 px-6 text-center text-slate-600">
        Choose upper-body or lower-body therapy sessions.
      </Text>
    </View>
  );
};

export default SelectionScreen;
