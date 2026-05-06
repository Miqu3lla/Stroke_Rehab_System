import { create } from 'zustand';
import { instance } from '../lib/api';

const QUESTIONS = [
  {
    id: 'name',
    title: 'What is your name?',
    options: [],
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

const usePatientStore = create((set, get) => ({
  // State
  currentStep: 0,
  answers: {},
  isSubmitting: false,
  questions: QUESTIONS,

  // Derived helpers
  getCurrentQuestion: () => QUESTIONS[get().currentStep],
  getSelectedOption: () => {
    const question = QUESTIONS[get().currentStep];
    return get().answers[question.id];
  },

  // Actions
  setAnswer: (option) => {
    const question = QUESTIONS[get().currentStep];
    set((state) => ({
      answers: { ...state.answers, [question.id]: option },
    }));
  },

  handleNext: async (navigation) => {
    const { currentStep, answers } = get();

    if (currentStep < QUESTIONS.length - 1) {
      set({ currentStep: currentStep + 1 });
    } else {
      // Final step: Save the onboarding profile to the backend before navigating away.
      set({ isSubmitting: true });

      const payload = {
        name: answers.name,
        stroke_type: answers.stroke_type,
        months_in_recovery: answers.months_in_recovery,
        affected_part: answers.affected_part,
        affected_side: answers.affected_side,
      };

      try {
        const response = await instance.post('/patients', payload);
        console.log('Saved patient profile:', response.data);
      } catch (error) {
        console.error('Failed to save patient profile:', error?.response?.data || error.message);
      } finally {
        set({ isSubmitting: false });
        // Replace prevents the user from swiping back to the onboarding screen
        navigation.replace('Dashboard');
      }
    }
  },

  handleBack: () => {
    const { currentStep } = get();
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 });
    }
  },

  // Reset the store (useful for re-onboarding)
  reset: () => set({ currentStep: 0, answers: {}, isSubmitting: false }),
}));

export default usePatientStore;
