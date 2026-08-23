import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '../hooks/useOnboarding';
import QuestionCard from '../components/onboarding/QuestionCard';
import OnboardingNav from '../components/onboarding/OnboardingNav';
import useAuthStore from '../store/useAuthStore';
import { palette } from '../constants/palette';
import { fonts } from '../constants/fonts';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 40 }}>
        {/* Progress bar */}
        <View style={{ marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 10, color: palette.inkSoft, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Step {currentStep + 1} of {questions.length}
            </Text>
            <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 10, color: palette.primary, letterSpacing: 1 }}>
              {Math.round(((currentStep + 1) / questions.length) * 100)}%
            </Text>
          </View>
          {/* Track */}
          <View style={{ height: 4, backgroundColor: palette.line, borderRadius: 99 }}>
            <View
              style={{
                height: 4,
                backgroundColor: palette.primary,
                borderRadius: 99,
                width: `${Math.round(((currentStep + 1) / questions.length) * 100)}%`,
              }}
            />
          </View>
        </View>

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
