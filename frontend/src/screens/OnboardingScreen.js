import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '../hooks/useOnboarding';
import QuestionCard from '../components/onboarding/QuestionCard';
import OnboardingNav from '../components/onboarding/OnboardingNav';
import useAuthStore from '../store/useAuthStore';

export default function OnboardingScreen({ navigation }) {
  const { getAuthSession } = useAuthStore();
  const {
    questions,
    currentStep,
    currentQuestion,
    selectedOption,
    answers,
    hasAnswer,
    isLastStep,
    isSubmitting,
    setAnswer,
    setFieldAnswer,
    handleNext,
    handleBack,
  } = useOnboarding(navigation);

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

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-1 px-6 pt-12">
        <Text className="text-xs font-bold text-slate-400 tracking-widest mb-4">
          STEP {currentStep + 1} OF {questions.length}
        </Text>

        <QuestionCard
          question={currentQuestion}
          selectedOption={selectedOption}
          onSelect={setAnswer}
          answers={answers}
          setFieldAnswer={setFieldAnswer}
        />

        <OnboardingNav
          currentStep={currentStep}
          isLastStep={isLastStep}
          isSubmitting={isSubmitting}
          hasAnswer={hasAnswer}
          onBack={handleBack}
          onNext={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}
