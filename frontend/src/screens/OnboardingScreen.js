import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, Circle } from 'lucide-react-native';
import usePatientStore from '../store/usePatientStore';

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Step Indicator */}
        <Text style={styles.stepLabel}>
          STEP {currentStep + 1} OF {questions.length}
        </Text>

        {/* Question Card */}
        <View style={styles.card}>
          <Text style={styles.questionTitle}>
            {currentQuestion.title}
          </Text>

          {/* Options or Text Input */}
          <View style={styles.optionsContainer}>
            {currentQuestion.options && currentQuestion.options.length > 0 ? (
              currentQuestion.options.map((option, index) => {
                const isSelected = selectedOption === option;

                return (
                  <Pressable
                    key={index}
                    onPress={() => setAnswer(option)}
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
              })
            ) : (
              <TextInput
                style={styles.textInput}
                placeholder="Type your answer here..."
                placeholderTextColor="#94a3b8"
                value={selectedOption || ''}
                onChangeText={setAnswer}
                autoFocus
              />
            )}
          </View>
        </View>

        {/* Navigation Buttons */}
        <View style={styles.bottomArea}>
          {currentStep > 0 && (
            <TouchableOpacity
              onPress={handleBack}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            disabled={!selectedOption || isSubmitting}
            onPress={() => handleNext(navigation)}
            style={[
              styles.nextButton,
              selectedOption && !isSubmitting ? styles.nextButtonActive : styles.nextButtonDisabled,
            ]}
          >
            <Text style={styles.nextButtonText}>
              {isSubmitting ? 'Saving...' : currentStep === questions.length - 1 ? 'Finish' : 'Next'}
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
  textInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 2,
    borderColor: '#f1f5f9',
    borderRadius: 16,
    padding: 20,
    fontSize: 18,
    fontWeight: '600',
    color: '#1e293b',
  },
  bottomArea: {
    marginTop: 'auto',
    marginBottom: 40,
    flexDirection: 'row',
    gap: 12,
  },
  backButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 9999,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
  },
  backButtonText: {
    color: '#64748b',
    fontSize: 18,
    fontWeight: '700',
  },
  nextButton: {
    flex: 2,
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
