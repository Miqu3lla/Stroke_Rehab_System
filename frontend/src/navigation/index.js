import React, { useEffect, useState } from "react";
import { createStackNavigator } from "@react-navigation/stack";
import HomeScreen from "../screens/HomeScreen";
import ExerciseScreen from "../screens/ExerciseScreen";
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
      const session = await getAuthSession();
      // Set to true if session exists, false if not. 
      // (This safely transitions user from 'null' loading state)
      setUser(!!session); 
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
        cardStyle: { backgroundColor: '#faf8ff' }, // VitalMotion design system background
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Dashboard" component={HomeScreen} />
      <Stack.Screen name="Exercise" component={ExerciseScreen} />
    </Stack.Navigator>
  );
};

export default AppNavigator;
