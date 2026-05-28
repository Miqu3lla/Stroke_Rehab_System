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
        .select('name, created_at, affected_side, affected_area')
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
}));

export default usePatientProfileStore;
