import React, { useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useKeepAwake } from 'expo-keep-awake';
import CameraComponent from '../components/exercise/CameraComponent';
import RestState from '../components/exercise/RestState';
import useAuthStore from '../store/useAuthStore';
import useSessionStore from '../store/useSessionStore';

// This screen manages the workout session, switching between two views:
// 1. Active: Doing the exercise with the camera on.
// 2. Rest: Seeing your score and resting before the next exercise.
const ExerciseScreen = ({ navigation }) => {
  const { getAuthSession } = useAuthStore();
  const { session, saveCurrentScore, moveToNext, endSession } = useSessionStore();

  // Keep the screen awake for the entire session so the camera feed
  // and pose-tracking don't get interrupted by the device's auto-lock.
  // The wake lock is released automatically when this screen unmounts.
  useKeepAwake();


  const playlist = session.playlist || [];
  const currentIndex = session.currentIndex || 0;
  const currentExercise = playlist[currentIndex];
  const isLastExercise = currentIndex >= playlist.length - 1;
  const upNextExercise = isLastExercise ? null : playlist[currentIndex + 1];
  const justFinishedResult = session.results[session.results.length - 1];

  // Check if the user is logged in. If not, send them back to the Login screen.
  useEffect(() => {
    const checkSession = async () => {
      const authed = await getAuthSession();
      if (!authed) {
        navigation.replace('Login');
      }
    };
    checkSession();
  }, []);

  // Keeps track of whether we're allowed to leave this screen without asking for confirmation.
  // Set to true only when the user finishes a workout or taps the intended "End Workout" button.
  const allowLeaveRef = useRef(false);

  // Saves the exercise score when the user finishes it (or the timer runs out),
  // and switches the view to the Rest screen.
  //
  // Phase E (sets-and-modes, 2026-06-04): forward the structured
  // setResults[], holdScore, and mode fields useCamera now emits. Dropping
  // them here would silently zero out the therapist dashboard's per-set
  // fatigue curve, lose every Strength-mode hold score, and tag every
  // session with mode=null — defeating Phase E end-to-end.
  const handleExerciseComplete = useCallback((payload) => {
    saveCurrentScore(payload);
  }, [saveCurrentScore]);

  const handleMoveToNext = useCallback(async () => {
    // Allow navigating away safely, then proceed to the next exercise.
    // (If this was the last exercise, it will end the session and leave this screen).
    allowLeaveRef.current = true;
    await moveToNext(navigation);
    // Reset the leave protection so the user doesn't accidentally exit mid-workout.
    allowLeaveRef.current = false;
  }, [moveToNext, navigation]);

  const handleEndWorkout = useCallback(async () => {
    allowLeaveRef.current = true;
    await endSession(navigation);
  }, [endSession, navigation]);

  // Shows a warning when the user tries to go back during a workout.
  // We want to make sure they don't accidentally lose their progress!
  const handleBackPress = useCallback(() => {
    if (!session.sessionId) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      'End workout?',
      'Your scores so far will be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End workout', style: 'destructive', onPress: handleEndWorkout },
      ],
    );
  }, [session.sessionId, navigation, handleEndWorkout]);

  // Catches all attempts to leave this screen (like physical back buttons or swipe gestures).
  // Shows a confirmation dialog to prevent accidental exits unless it's an intended finish.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (allowLeaveRef.current) return;
      if (!session.sessionId) return; // no active session, let it through
      event.preventDefault();
      Alert.alert(
        'End workout?',
        'Your scores so far will be saved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'End workout',
            style: 'destructive',
            onPress: async () => {
              allowLeaveRef.current = true;
              await endSession(navigation);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, session.sessionId, endSession]);

  // If there's no workout session found, show an error and a button to go back.
  if (!session.sessionId || !currentExercise) {
    return (
      <View className="flex-1 items-center justify-center bg-[#faf8ff] px-6">
        <Text className="text-[#191b23] text-base font-semibold mb-4">No active workout.</Text>
        <TouchableOpacity
          className="bg-[#0c56d0] px-5 py-3 rounded-full"
          onPress={() => navigation.replace('Dashboard')}
        >
          <Text className="text-white font-semibold">Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#faf8ff' }}>
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-[#e7e7f2]">
        <TouchableOpacity onPress={handleBackPress} className="flex-row items-center">
          <ChevronLeft size={22} color="#0c56d0" />
          <Text className="text-[#0c56d0] font-semibold ml-1">Back</Text>
        </TouchableOpacity>
        <Text className="text-[#191b23] font-semibold text-base ml-3 flex-1" numberOfLines={1}>
          Exercise {currentIndex + 1} of {playlist.length}: {currentExercise.name}
        </Text>
      </View>

      {session.isResting ? (
        <RestState
          justFinishedName={currentExercise.name}
          justFinishedScore={justFinishedResult?.avg_form_score ?? 0}
          isLastExercise={isLastExercise}
          upNextName={upNextExercise?.name}
          onNext={handleMoveToNext}
          onEndWorkout={handleEndWorkout}
        />
      ) : (
        // The "key" makes sure that when a new exercise starts, the camera view resets 
        // completely (timer resets, previous scores are cleared, etc.).
        <CameraComponent
          key={currentExercise.id}
          exercise={currentExercise}
          onComplete={handleExerciseComplete}
        />
      )}
    </View>
  );
};

export default ExerciseScreen;
