import React, { useEffect, useState } from "react";
import { createStackNavigator } from "@react-navigation/stack";
import HomeScreen from "../screens/HomeScreen";
import SessionScreen from "../screens/SessionScreen";
import ExerciseScreen from "../screens/ExerciseScreen";
import SessionSummaryScreen from "../screens/SessionSummaryScreen";
import PatientProfileScreen from "../screens/PatientProfileScreen";
import OnboardingScreen from "../screens/OnboardingScreen";
import LoginScreen from "../screens/LoginScreen";
import SignupScreen from "../screens/SignupScreen";
import useAuthStore from "../store/useAuthStore";

const Stack = createStackNavigator();

const AppNavigator = () => {
  const [user, setUser] = useState(null);
  const { getAuthSession } = useAuthStore();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const session = await getAuthSession();
        // Set to true if session exists, false if not.
        // (This safely transitions user from 'null' loading state)
        setUser(!!session);
      } catch (error) {
        console.error("[AppNavigator] checkAuth failed:", error);
        // Ensure user exits the null/loading state so the navigator can render
        setUser(false);
      }
    };
    checkAuth();
  }, []);

  // Show nothing (or a loading spinner) while we check the auth state
  if (user === null) {
    return null; 
  }

  return (
    <Stack.Navigator
      initialRouteName={user ? "Dashboard" : "Login"}
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#ffffff' },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Dashboard" component={HomeScreen} />
      <Stack.Screen name="Sessions" component={SessionScreen} />
      <Stack.Screen name="Exercise" component={ExerciseScreen} />
      <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} />
      <Stack.Screen name="PatientProfile" component={PatientProfileScreen} />
    </Stack.Navigator>
  );
};

export default AppNavigator;
