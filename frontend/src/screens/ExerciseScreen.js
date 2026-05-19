import React, { useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import CameraComponent from '../components/exercise/CameraComponent';
import RestState from '../components/exercise/RestState';
import useAuthStore from '../store/useAuthStore';
import usePatientStore from '../store/usePatientStore';

// ExerciseScreen hosts the session state machine:
//   Active (camera + HUD)  ←→  Rest (feedback + Next/End Workout)
// It owns the transitions but delegates score capture to useCamera and
// score persistence to the session actions in usePatientStore.
const ExerciseScreen = ({ navigation }) => {
  const { getAuthSession } = useAuthStore();
  const { session, saveCurrentScore, moveToNext, endSession } = usePatientStore();

  const playlist = session.playlist || [];
  const currentIndex = session.currentIndex || 0;
  const currentExercise = playlist[currentIndex];
  const isLastExercise = currentIndex >= playlist.length - 1;
  const upNextExercise = isLastExercise ? null : playlist[currentIndex + 1];
  const justFinishedResult = session.results[session.results.length - 1];

  // Guard: redirect to Login if no auth session
  useEffect(() => {
    const checkSession = async () => {
      const authed = await getAuthSession();
      if (!authed) {
        navigation.replace('Login');
      }
    };
    checkSession();
  }, []);

  // Allow-leave ref: set true when our own code (Move to Next on last
  // exercise, End Workout) is the one driving navigation, so the
  // beforeRemove listener below doesn't fire its confirmation alert
  // against our own intentional navigation.
  const allowLeaveRef = useRef(false);

  // When useCamera reports the exercise ended (Finish / End Early / timer),
  // push the score into the session store. This flips isResting=true.
  const handleExerciseComplete = useCallback(({ avgFormScore, durationSeconds, endedVia }) => {
    saveCurrentScore({ avgFormScore, durationSeconds, endedVia });
  }, [saveCurrentScore]);

  const handleMoveToNext = useCallback(async () => {
    // moveToNext only navigates when it ends up calling endSession
    // (last exercise). Setting the flag here is harmless for the
    // mid-session case since the screen doesn't unmount.
    allowLeaveRef.current = true;
    await moveToNext(navigation);
    // Re-arm the guard in case moveToNext didn't end the session.
    allowLeaveRef.current = false;
  }, [moveToNext, navigation]);

  const handleEndWorkout = useCallback(async () => {
    allowLeaveRef.current = true;
    await endSession(navigation);
  }, [endSession, navigation]);

  // Hardware back / nav back during active state — confirm exit since
  // the patient would lose this exercise's score otherwise.
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

  // beforeRemove intercepts EVERY navigation away from this screen —
  // hardware back on Android, swipe-back gesture on iOS, and the
  // back arrow in the header. Without this, native back actions bypass
  // handleBackPress and the patient loses their in-progress scores.
  // Internal endSession() / Finish Workout flows set allowLeaveRef so
  // their own navigation isn't blocked by the confirmation alert.
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

  // No active session — likely deep-linked here without a playlist.
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
        // Key on the exercise id so switching to the next exercise
        // forces a fresh useCamera instance (clean scoreHistory, fresh
        // timer, fresh BeforeYouStart overlay).
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
