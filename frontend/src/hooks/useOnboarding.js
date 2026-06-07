import { useState } from 'react';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

//custom hook for onboarding Screen Logic

// QUESTIONS shape:
//   id      — answer key in `answers` for single-input/options steps. Not
//             used as an answer key for `fields`-based steps (the fields
//             carry their own ids).
//   title   — header rendered by QuestionCard
//   options — list of choices for choice-style steps; empty = free-text
//   fields  — optional array of { id, placeholder, required? } for
//             multi-input steps (e.g. first/last name on one card). When
//             present, each field writes to answers[field.id] so the
//             submit payload stays flat.
const QUESTIONS = [
  {
    id: 'full_name',
    title: 'What is your name?',
    options: [],
    fields: [
      { id: 'first_name', placeholder: 'First name', required: true },
      { id: 'last_name', placeholder: 'Last name', required: false },
    ],
  },
  {
    id: 'months_in_recovery',
    title: 'How many months are you in recovery?',
    options: ['1 Month', '2 months', '3 months'],
  },
  {
    id: 'affected_area',
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
  //get the answer for the current question (single-input/options steps)
  const selectedOption = answers[currentQuestion.id];
  //check if the current step is the last step
  const isLastStep = currentStep === QUESTIONS.length - 1;

  //set the answer for the current question (single-input/options path)
  const setAnswer = (option) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }));
  };

  // Write one field's value on a multi-field step. Keyed by field.id so
  // each input stays addressable in the flat `answers` object.
  const setFieldAnswer = (fieldId, value) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  };

  // True when the current step has enough input to allow Next.
  // Multi-field: every REQUIRED field must be non-empty. Optional fields
  // (e.g. last_name for single-name patients) don't block progression.
  const hasAnswer = currentQuestion.fields
    ? currentQuestion.fields
        .filter((f) => f.required !== false)
        .every((f) => !!(answers[f.id] || '').toString().trim())
    : !!selectedOption;

  //navigates to the next page of the onboarding
  //or submits the data to the backend if on the last page
  const handleNext = async () => {
    // Belt-and-suspenders: block if the current step doesn't have enough
    // input yet. Uses `hasAnswer` (not `selectedOption`) so multi-field
    // steps — where the answer lives in fields[*].id, not the step's own
    // id — pass the check once their required fields are non-empty.
    if (!hasAnswer) return;

    if (!isLastStep) {
      setCurrentStep((s) => s + 1);
      return;
    }

    // Validate all required answers exist before submitting. Covers both
    // options-style steps (the answer key matches the step id) AND
    // fields-style steps (each required field carries its own key).
    const missing = [];
    QUESTIONS.forEach((q) => {
      if (Array.isArray(q.fields) && q.fields.length > 0) {
        q.fields
          .filter((f) => f.required !== false)
          .forEach((f) => {
            if (!(answers[f.id] || '').toString().trim()) missing.push(f.id);
          });
      } else if (q.options.length > 0 && !answers[q.id]) {
        missing.push(q.id);
      }
    });
    if (missing.length > 0) {
      console.error('Missing answers for:', missing);
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
        first_name: answers.first_name,
        last_name: answers.last_name,
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
    answers,
    hasAnswer,
    isLastStep,
    isSubmitting,
    setAnswer,
    setFieldAnswer,
    handleNext,
    handleBack,
    reset,
  };
}
