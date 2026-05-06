import React from "react";
import { Text, View } from "react-native";


const HomeScreen = () => {
  return (
    <View style={{ flex: 1 }}>
      <View className="gap-4">
        <View className="rounded-3xl bg-emerald-50 p-5">
          <Text className="text-base font-semibold text-emerald-900">Today's Overview</Text>
          <Text className="mt-2 text-sm text-emerald-800">
            Placeholder metrics for assigned sessions, completed reps, and patient notes.
          </Text>
        </View>

        <View className="rounded-3xl bg-slate-50 p-5">
          <Text className="text-base font-semibold text-slate-900">Quick Actions</Text>
          <Text className="mt-2 text-sm text-slate-600">
            Placeholder space for start session, review form, and clinician insights.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default HomeScreen;
