import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOnboarding } from '../hooks/useOnboarding';
import QuestionCard from '../components/onboarding/QuestionCard';
import OnboardingNav from '../components/onboarding/OnboardingNav';

export default function OnboardingScreen({ navigation }) {
  const {
    questions,
    currentStep,
    currentQuestion,
    selectedOption,
    isLastStep,
    isSubmitting,
    setAnswer,
    handleNext,
    handleBack,
  } = useOnboarding(navigation);

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
        />

        <OnboardingNav
          currentStep={currentStep}
          isLastStep={isLastStep}
          isSubmitting={isSubmitting}
          hasAnswer={!!selectedOption}
          onBack={handleBack}
          onNext={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}
