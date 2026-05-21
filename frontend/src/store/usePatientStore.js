import { create } from 'zustand';
import { instance } from '../lib/api';
import { supabase } from '../services/supabase';

const usePatientStore = create((set, get) => ({
  // ── Recommendation state ────────────────────────────────────────────
  recommendedExercises: [],
  recommendationLoading: false,
  recommendationError: null,

  // ── History state ───────────────────────────────────────────────────
  history: [],
  historyLoading: false,
  historyError: null,

  // ── Recommendation actions ──────────────────────────────────────────
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

  updateRecommendations: (exercises) => {
    set({ recommendedExercises: exercises || [] });
  },

  fetchHistory: async () => {
    set({ historyLoading: true, historyError: null });
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('User not authenticated');
      }
      
      const { data, error } = await supabase
        .from('recommendation_logs')
        .select('id, latest_form_score, recommendation, created_at')
        .eq('patient_id', user.id)
        .gt('latest_form_score', 0)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const history = data.map(row => ({
        id: row.id,
        latest_form_score: row.latest_form_score,
        exercise_id: row.recommendation?.recommendation_id,
        exercise_name: row.recommendation?.exercise_name || 'Exercise',
        created_at: row.created_at,
      }));

      set({ history });
    } catch (error) {
      console.error('Failed to fetch history from supabase:', error.message);
      set({ historyError: error.message });
    } finally {
      set({ historyLoading: false });
    }
  },

}));

export default usePatientStore;
