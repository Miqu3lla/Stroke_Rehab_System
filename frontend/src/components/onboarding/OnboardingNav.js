import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

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
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 'auto', marginBottom: 32 }}>
      {/* Only show Back if we are past the first step */}
      {currentStep > 0 && (
        <TouchableOpacity
          onPress={onBack}
          style={{
            flex: 1,
            paddingVertical: 18,
            borderRadius: 99,
            alignItems: 'center',
            backgroundColor: palette.line,
          }}
        >
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 16, color: palette.inkSoft }}>
            Back
          </Text>
        </TouchableOpacity>
      )}

      {/* Next advances the step; on the last step it submits and shows Finish */}
      <TouchableOpacity
        disabled={!nextEnabled}
        onPress={onNext}
        style={{
          flex: 2,
          paddingVertical: 18,
          borderRadius: 99,
          alignItems: 'center',
          backgroundColor: nextEnabled ? palette.primary : palette.primarySoft,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.sansBold,
            fontSize: 16,
            color: nextEnabled ? '#ffffff' : palette.inkSoft,
          }}
        >
          {isSubmitting ? 'Saving...' : isLastStep ? 'Finish' : 'Next'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
