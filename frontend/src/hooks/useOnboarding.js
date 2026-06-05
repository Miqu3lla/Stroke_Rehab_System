import { useState } from 'react';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

//custom hook for onboarding Screen Logic

//set the questions for the onboarding screen
const QUESTIONS = [
  {
    id: 'name',
    title: 'What is your name?',
    options: [],
  },
  {
    id: 'months_in_recovery',
    title: 'How many months are you in recovery?',
    options: ['1 Month', '2 months', '3 months'],
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

export function useOnboarding(navigation) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  //get the question for the current step
  const currentQuestion = QUESTIONS[currentStep];
  //get the answer for the current question
  const selectedOption = answers[currentQuestion.id];
  //check if the current step is the last step
  const isLastStep = currentStep === QUESTIONS.length - 1;

  //set the answer for the current question
  const setAnswer = (option) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }));
  };
  //navigates to the next page of the onboarding
  //or submits the data to the backend if on the last page
  const handleNext = async () => {
    if (!isLastStep) {
      setCurrentStep((s) => s + 1);
      return;
    }
    //handle form submition after patient fills out the form
    setIsSubmitting(true);
    try {
      //checks to see if the user is authenticated first before submitting the form data into the patients table
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('User not authenticated');
      //sends the form to the backend
      await instance.post('/patients', {
        id: user.id,
        name: answers.name,
        months_in_recovery: parseInt(answers.months_in_recovery, 10) || 0,
        affected_area: answers.affected_area,
        affected_side: answers.affected_side,
      });
      // Only navigate on success
      navigation.replace('Dashboard');
    } catch (error) {
      console.error('Failed to save patient profile:', error?.response?.data || error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const reset = () => {
    setCurrentStep(0);
    setAnswers({});
    setIsSubmitting(false);
  };

  return {
    questions: QUESTIONS,
    currentStep,
    currentQuestion,
    selectedOption,
    isLastStep,
    isSubmitting,
    setAnswer,
    handleNext,
    handleBack,
    reset,
  };
}
