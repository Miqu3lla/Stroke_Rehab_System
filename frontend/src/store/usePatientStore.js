import { create } from 'zustand';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

const QUESTIONS = [
  {
    id: 'name',
    title: 'What is your name?',
    options: [], // No options -> render a TextInput for free text
  },
  {
    id: 'stroke_type',
    title: 'What type of stroke did you experience?',
    options: ['Ischemic', 'Hemorrhagic'],
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


// ZUSTAND STORE
// The store holds the onboarding wizard state (current step, collected answers,
// and a submitting flag) and exposes actions that the UI can call.
// Using Zustand gives us a lightweight global store without the boilerplate of
// Redux, making the screen component purely presentational.
const usePatientStore = create((set, get) => ({
  // State
  currentStep: 0,               // Index of the currently displayed question
  answers: {},                  // { [questionId]: selectedOption }
  isSubmitting: false,          // Shows a loading spinner on the final button
  questions: QUESTIONS,         // Expose the static question list to the UI

  
  // Derived helpers – computed values that depend on the current state
  // Returns the question object for the current step
  getCurrentQuestion: () => QUESTIONS[get().currentStep],

  // Returns the answer that the user has already selected for the current question
  getSelectedOption: () => {
    const question = QUESTIONS[get().currentStep];
    return get().answers[question.id];
  },

  // Actions – functions that mutate the store state
  // Store a new answer for the currently displayed question
  setAnswer: (option) => {
    const question = QUESTIONS[get().currentStep];
    set((state) => ({
      answers: { ...state.answers, [question.id]: option },
    }));
  },

  // Advance to the next step or, if on the final step, submit the data to the backend.
  // The navigation object is passed in from the screen so we can route after a
  // successful save.
  handleNext: async (navigation) => {
    const { currentStep, answers } = get();

    // If we are not on the last question just move the step forward.
    if (currentStep < QUESTIONS.length - 1) {
      set({ currentStep: currentStep + 1 });
    } else {
      // FINAL STEP – POST the collected onboarding data to the API.
      set({ isSubmitting: true });
      try {
        // Get the current authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          throw new Error('User not authenticated');
        }

        const payload = {
          id: user.id,
          name: answers.name,
          stroke_type: answers.stroke_type,
          months_in_recovery: parseInt(answers.months_in_recovery, 10) || 0,
          affected_part: answers.affected_part,
          affected_side: answers.affected_side,
        };

        const response = await instance.post('/patients', payload);
        console.log('Saved patient profile:', response.data);
      } catch (error) {
        console.error('Failed to save patient profile:', error?.response?.data || error.message);
      } finally {
        set({ isSubmitting: false });
        // Replace removes the onboarding screen from the navigation stack so the user
        // cannot swipe back into it after completing the flow.
        navigation.replace('Dashboard');
      }
    }
  },

  // Go back one step – disabled on the first question.
  handleBack: () => {
    const { currentStep } = get();
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 });
    }
  },

  // Utility to reset the wizard – useful when a user wants to start over.
  reset: () => set({ currentStep: 0, answers: {}, isSubmitting: false }),
}));

export default usePatientStore;
