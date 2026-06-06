import { create } from 'zustand';
import { supabase } from '../services/supabase';

const usePatientProfileStore = create((set) => ({
  profile: null,
  loading: false,
  error: null,

  fetchPatientProfile: async () => {
    set({ loading: true, error: null });
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error('User not authenticated');
      }

      const { data, error } = await supabase
        .from('patients')
        .select('first_name, last_name, created_at, affected_side, affected_area, months_in_recovery')
        .eq('id', user.id)
        .single();

      if (error) {
        throw error;
      }

      set({ profile: data });
    } catch (error) {
      console.error('Failed to fetch patient profile:', error.message);
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  // Update first + last name in one round-trip.
  updatePatientName: async ({ first_name, last_name }) => {
    set({ loading: true, error: null });
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('User not authenticated');

      const trimmedFirst = (first_name || '').trim();
      const trimmedLast = (last_name || '').trim();

      const { error } = await supabase
        .from('patients')
        .update({
          first_name: trimmedFirst,
          last_name: trimmedLast,
        })
        .eq('id', user.id);

      if (error) throw error;

      set((state) => ({
        profile: {
          ...state.profile,
          first_name: trimmedFirst,
          last_name: trimmedLast,
        },
      }));
    } catch (error) {
      console.error('Failed to update patient name:', error.message);
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
}));

export default usePatientProfileStore;
