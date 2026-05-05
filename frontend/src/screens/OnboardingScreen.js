import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, Circle } from 'lucide-react-native';

const QUESTIONS = [
  {
    id: 'stroke_type',
    title: 'What type of stroke did you experience?',
    options: ['Ischemic', 'Hemorrhagic', 'TIA', 'Unknown'],
  },
  {
    id: 'months_in_recovery',
    title: 'How many months are you in recovery?',
    // We can map these to integers later for the backend
    options: ['Less than 3', '3 to 6', '6 to 12', 'More than 12'],
  },
  {
    id: 'affected_part',
    title: 'Which part did the stroke affect you?',
    options: ['Arms', 'Legs', 'Both'],
  },
  {
    id: 'affected_side',
    title: 'Left or right?',
    options: ['Left', 'Right', 'Both'],
  },
];

export default function OnboardingScreen({ navigation }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});

  const currentQuestion = QUESTIONS[currentStep];
  const selectedOption = answers[currentQuestion.id];

  const handleSelect = (option) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }));
  };

  const handleNext = () => {
    if (currentStep < QUESTIONS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Final step: Save data and navigate away
      console.log('Finished Onboarding! Answers:', answers);
      // Replace prevents the user from swiping back to the onboarding screen
      navigation.replace('Dashboard');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Step Indicator */}
        <Text style={styles.stepLabel}>
          STEP {currentStep + 1} OF {QUESTIONS.length}
        </Text>

        {/* Question Card */}
        <View style={styles.card}>
          <Text style={styles.questionTitle}>
            {currentQuestion.title}
          </Text>

          {/* Options */}
          <View style={styles.optionsContainer}>
            {currentQuestion.options.map((option, index) => {
              const isSelected = selectedOption === option;

              return (
                <Pressable
                  key={index}
                  onPress={() => handleSelect(option)}
                  style={[
                    styles.optionButton,
                    isSelected ? styles.optionSelected : styles.optionDefault,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      isSelected ? styles.optionTextSelected : styles.optionTextDefault,
                    ]}
                  >
                    {option}
                  </Text>

                  {isSelected ? (
                    <CheckCircle2 color="white" size={24} strokeWidth={2.5} />
                  ) : (
                    <Circle color="#cbd5e1" size={24} strokeWidth={2.5} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Next Button */}
        <View style={styles.bottomArea}>
          <TouchableOpacity
            disabled={!selectedOption}
            onPress={handleNext}
            style={[
              styles.nextButton,
              selectedOption ? styles.nextButtonActive : styles.nextButtonDisabled,
            ]}
          >
            <Text style={styles.nextButtonText}>
              {currentStep === QUESTIONS.length - 1 ? 'Finish' : 'Next'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  stepLabel: {
    color: '#64748b',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 32,
    padding: 24,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 32,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    // Shadow for Android
    elevation: 2,
  },
  questionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 32,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
  },
  optionSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  optionDefault: {
    backgroundColor: '#f8fafc',
    borderColor: '#f1f5f9',
  },
  optionText: {
    fontSize: 18,
    fontWeight: '700',
  },
  optionTextSelected: {
    color: '#ffffff',
  },
  optionTextDefault: {
    color: '#1e293b',
  },
  bottomArea: {
    marginTop: 'auto',
    marginBottom: 40,
  },
  nextButton: {
    paddingVertical: 16,
    borderRadius: 9999,
    alignItems: 'center',
  },
  nextButtonActive: {
    backgroundColor: '#2563eb',
  },
  nextButtonDisabled: {
    backgroundColor: '#bfdbfe',
  },
  nextButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
});
