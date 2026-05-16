import { create } from 'zustand';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

const usePatientStore = create((set) => ({
  // State
  recommendedExercises: [],
  recommendationLoading: false,
  recommendationError: null,

  // Fetch 3 recommended exercises for the patient dashboard
  fetchRecommendation: async () => {
    set({ recommendationLoading: true, recommendationError: null });
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }
      
      const response = await instance.get(`/recommendation/${user.id}`);
      set({ recommendedExercises: response.data.exercises || [] });
    } catch (error) {
      console.error('Failed to fetch recommendation:', error?.response?.data || error.message);
      set({ recommendationError: error.message });
    } finally {
      set({ recommendationLoading: false });
    }
  },

  // Start a selected exercise – log it and navigate
  startExercise: async (exercise, navigation) => {
    if (!exercise) return;
    
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }
      
      // Log the exercise start to backend
      await instance.post('/recommendation_logs', {
        patient_id: user.id,
        recommendation_id: exercise.id,
        action: 'started',
        ts: new Date().toISOString(),
      });
      
      // Navigate to exercise screen
      navigation.navigate('Exercise', { exercise });
    } catch (error) {
      console.error('Failed to start exercise:', error?.response?.data || error.message);
    }
  },

  // Log completed exercise with safe aggregate metrics.
  logExerciseCompletion: async (exercise, durationSeconds, avgFormScore = 0) => {
    if (!exercise) return;

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }

      await instance.post('/recommendation_logs', {
        patient_id: user.id,
        recommendation_id: exercise.id,
        action: 'completed',
        duration_seconds: Math.max(0, Number(durationSeconds) || 0),
        avg_form_score: Math.max(0, Number(avgFormScore) || 0),
        ts: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log exercise completion:', error?.response?.data || error.message);
    }
  },

  // Utility to reset the wizard – useful when a user wants to start over.
  reset: () => set({ currentStep: 0, answers: {}, isSubmitting: false }),
  // Update recommendations from backend response (used after onboarding)
  updateRecommendations: (exercises) => {
    set({ recommendedExercises: exercises || [] });
  },
}));

export default usePatientStore;
