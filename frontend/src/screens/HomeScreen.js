import React, { useEffect } from "react";
import { View, ScrollView } from "react-native";
import usePatientStore from "../store/usePatientStore";
import useAuthStore from "../store/useAuthStore";
import RecommendationCard from "../components/exercise/RecommendationCard";
import HistoryList from "../components/exercise/HistoryList";

const HomeScreen = ({ navigation }) => {
  const { fetchRecommendation, fetchHistory } = usePatientStore();
  const { getAuthSession } = useAuthStore();

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

  // Fetch recommended exercises and past history when screen loads
  useEffect(() => {
    fetchRecommendation();
    fetchHistory();
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
      <View className="p-4 mt-4">
        <HistoryList />
        {/* Recommended Exercise Card */}
        <RecommendationCard navigation={navigation} />
      </View>
    </ScrollView>
  );
};

export default HomeScreen;
