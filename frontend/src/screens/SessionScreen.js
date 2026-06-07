import React, { useEffect } from "react";
import { View, ScrollView } from "react-native";
import usePatientStore from "../store/usePatientStore";
import useAuthStore from "../store/useAuthStore";
import RecommendationCard from "../components/exercise/RecommendationCard";
import SessionModeToggle from "../components/exercise/SessionModeToggle";

const SessionScreen = ({ navigation }) => {
  const { fetchRecommendation, loadActiveModeFromProfile } = usePatientStore();
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

  // Hydrate the recommendation list and the patient's last-chosen
  // Functionality/Strength mode in parallel. Both update the same
  // derived `recommendedExercises` state, so the cards render correctly
  // regardless of which finishes first (sets-and-modes Phase B).
  useEffect(() => {
    loadActiveModeFromProfile();
    fetchRecommendation();
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }}>
      <View className="p-4 mt-4">
        <SessionModeToggle />
        <RecommendationCard navigation={navigation} />
      </View>
    </ScrollView>
  );
};

export default SessionScreen;
