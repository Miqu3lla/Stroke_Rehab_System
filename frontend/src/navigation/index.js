import React, { useEffect, useState } from "react";
import { createStackNavigator } from "@react-navigation/stack";
import HomeScreen from "../screens/HomeScreen";
import SessionScreen from "../screens/SessionScreen";
import ExerciseScreen from "../screens/ExerciseScreen";
import SessionSummaryScreen from "../screens/SessionSummaryScreen";
import PatientProfileScreen from "../screens/PatientProfileScreen.js";
import OnboardingScreen from "../screens/OnboardingScreen";
import LoginScreen from "../screens/LoginScreen";
import SignupScreen from "../screens/SignupScreen";
import ForgotPasswordScreen from "../screens/ForgotPasswordScreen";
import ResetPasswordScreen from "../screens/ResetPasswordScreen";
import useAuthStore from "../store/useAuthStore";
import { palette } from "../constants/palette";

const Stack = createStackNavigator();

// Slide the incoming screen in from the left or right. cardStyleInterpolator
// isn't given `route`, so direction must be resolved beforehand (from the
// navbar's `direction` param) and baked into the interpolator per-screen.
const makeDirectionalSlideInterpolator = (direction) => ({ current, next, layouts }) => {
  const translateX = current.progress.interpolate({
    inputRange:  [0, 1],
    outputRange: [direction === 'left' ? layouts.screen.width : -layouts.screen.width, 0],
  });
  const opacity = next
    ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
    : 1;
  return {
    cardStyle: { transform: [{ translateX }], opacity },
  };
};

// Defaults to 'left' (forward) when the navbar didn't pass a direction.
const directionalScreenOptions = ({ route }) => ({
  cardStyleInterpolator: makeDirectionalSlideInterpolator(route.params?.direction ?? 'left'),
});

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
        // Behind whatever each screen paints itself — was hardcoded white,
        // which showed through as a mismatched gap against the Navbar's
        // canvas-colored top/bottom bars.
        cardStyle: { backgroundColor: palette.canvas },
      }}
    >
      {/* Auth screens — keep default slide-from-right */}
      <Stack.Screen name="Login"          component={LoginScreen} />
      <Stack.Screen name="Signup"         component={SignupScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="ResetPassword"  component={ResetPasswordScreen} />
      <Stack.Screen name="Onboarding"     component={OnboardingScreen} />

      {/* Tab screens — directional slide based on navbar direction param */}
      <Stack.Screen
        name="Dashboard"
        component={HomeScreen}
        options={directionalScreenOptions}
      />
      <Stack.Screen
        name="Sessions"
        component={SessionScreen}
        options={directionalScreenOptions}
      />
      <Stack.Screen
        name="Exercise"
        component={ExerciseScreen}
        options={directionalScreenOptions}
      />

      {/* Detail screens — default slide-from-right */}
      <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} />
      <Stack.Screen name="PatientProfile" component={PatientProfileScreen} />
    </Stack.Navigator>
  );
};

export default AppNavigator;
