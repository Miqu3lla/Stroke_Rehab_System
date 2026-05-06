import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import usePatientStore from '../store/usePatientStore';
import QuestionCard from '../components/onboarding/QuestionCard';
import OnboardingNav from '../components/onboarding/OnboardingNav';

export default function OnboardingScreen({ navigation }) {
  const {
    currentStep,
    questions,
    isSubmitting,
    getCurrentQuestion,
    getSelectedOption,
    setAnswer,
    handleNext,
    handleBack,
  } = usePatientStore();

  const currentQuestion = getCurrentQuestion();
  const selectedOption = getSelectedOption();
  const isLastStep = currentStep === questions.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-1 px-6 pt-12">
        {/* Step counter e.g. "STEP 2 OF 5" */}
        <Text className="text-xs font-bold text-slate-400 tracking-widest mb-4">
          STEP {currentStep + 1} OF {questions.length}
        </Text>

        {/* Card containing the question title and answer options / text input */}
        <QuestionCard
          question={currentQuestion}
          selectedOption={selectedOption}
          onSelect={setAnswer}
        />

        {/* Back and Next/Finish buttons */}
        <OnboardingNav
          currentStep={currentStep}
          isLastStep={isLastStep}
          isSubmitting={isSubmitting}
          hasAnswer={!!selectedOption}
          onBack={handleBack}
          onNext={() => handleNext(navigation)}
        />
      </View>
    </SafeAreaView>
  );
}
