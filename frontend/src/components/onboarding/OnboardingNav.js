import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

/**
 * OnboardingNav
 *
 * Renders the Back and Next/Finish navigation buttons at the bottom of the
 * onboarding wizard.
 *
 * Props:
 *   currentStep  – the current step index (Back is hidden on step 0)
 *   isLastStep   – true when on the last question (shows "Finish" instead of "Next")
 *   isSubmitting – disables the Next button and shows "Saving..." while the API call runs
 *   hasAnswer    – whether the user has answered the current question (gates the Next button)
 *   onBack       – called when the Back button is pressed
 *   onNext       – called when the Next/Finish button is pressed
 */
export default function OnboardingNav({
  currentStep,
  isLastStep,
  isSubmitting,
  hasAnswer,
  onBack,
  onNext,
}) {
  const nextEnabled = hasAnswer && !isSubmitting;

  return (
    <View className="flex-row gap-3 mt-auto mb-10">
      {/* Only show Back if we are past the first step */}
      {currentStep > 0 && (
        <TouchableOpacity
          onPress={onBack}
          className="flex-1 py-4 rounded-full items-center bg-slate-100"
        >
          <Text className="text-slate-500 text-lg font-bold">Back</Text>
        </TouchableOpacity>
      )}

      {/* Next advances the step; on the last step it submits and shows Finish */}
      <TouchableOpacity
        disabled={!nextEnabled}
        onPress={onNext}
        className={`flex-[2] py-4 rounded-full items-center ${
          nextEnabled ? 'bg-blue-600' : 'bg-blue-200'
        }`}
      >
        <Text className="text-white text-lg font-bold">
          {isSubmitting ? 'Saving...' : isLastStep ? 'Finish' : 'Next'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
