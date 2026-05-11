import React, { useEffect } from "react";
import { Text, View, ScrollView } from "react-native";
import usePatientStore from "../store/usePatientStore";
import RecommendationCard from "../components/RecommendationCard";


const HomeScreen = ({ navigation }) => {
  const { fetchRecommendation } = usePatientStore();

  // Fetch recommended exercise when screen loads
  useEffect(() => {
    fetchRecommendation();
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
      <View className="gap-4 p-4">
        <View className="rounded-3xl bg-emerald-50 p-5">
          <Text className="text-base font-semibold text-emerald-900">Today's Overview</Text>
          <Text className="mt-2 text-sm text-emerald-800">
            Your personalized exercise plan for today's session.
          </Text>
        </View>

        {/* Recommended Exercise Card */}
        <RecommendationCard navigation={navigation} />

        <View className="rounded-3xl bg-slate-50 p-5">
          <Text className="text-base font-semibold text-slate-900">Quick Actions</Text>
          <Text className="mt-2 text-sm text-slate-600">
            Review your progress and session history.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

export default HomeScreen;
