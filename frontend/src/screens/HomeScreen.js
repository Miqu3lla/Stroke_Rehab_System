import React, { useEffect } from "react";
import { View, ScrollView } from "react-native";
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
      <View className="p-4 mt-4">
        {/* Recommended Exercise Card */}
        <RecommendationCard navigation={navigation} />
      </View>
    </ScrollView>
  );
};

export default HomeScreen;
