import { create } from 'zustand';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';

const useAuthStore = create((set, get) => ({
  // State
  loading: false,

  // ─── Login ────────────────────────────────────────────────────────────────
  // Validates inputs, signs the user in via Supabase, then routes to the
  // correct screen depending on whether an onboarding profile already exists.
  handleLogin: async (email, password, navigation) => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    set({ loading: true });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert('Login Failed', error.message);
        return;
      }

      const userId = data?.user?.id;
      if (!userId) {
        Alert.alert('Login Failed', 'Could not determine authenticated user.');
        return;
      }

      // Check if a patient profile already exists for this user
      const { data: patientProfile, error: profileError } = await supabase
        .from('patients')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.log('Profile lookup failed, defaulting to onboarding:', profileError.message);
        navigation.replace('Onboarding');
        return;
      }

      if (patientProfile?.id) {
        navigation.replace('Dashboard');
      } else {
        navigation.replace('Onboarding');
      }
    } catch (error) {
      Alert.alert('Login Failed', error.message);
    } finally {
      set({ loading: false });
    }
  },

  // ─── Sign Up ──────────────────────────────────────────────────────────────
  // Validates inputs and registers a new user via Supabase Auth.
  // On success the user is directed back to the Login screen.
  handleSignUp: async (email, password, confirmPassword, navigation) => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return;
    } 
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    set({ loading: true });

    try {
      const {data, error} = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        Alert.alert('Signup Failed', error.message);
        return;
      }

      const userId = data?.user?.id;
      if (!userId) {
        Alert.alert('Signup Failed', 'Could not determine authenticated user.');
        return;
      }

      const { error: profileError } = await supabase
        .from('patients')
        .insert({
          id: userId,
        });

      if (profileError) {
        console.log('Profile creation failed:', profileError.message);
        Alert.alert('Signup Failed', 'Could not create patient profile.');
        return;
      }
      Alert.alert('Account created Succesfully!, Welcome to TheraMotion!')
      navigation.replace('Login');
    } catch (error) {
      Alert.alert('Signup Failed', error.message);
    } finally {
      set({ loading: false });
    }
  },

  // ─── Logout ───────────────────────────────────────────────────────────────
  // Signs the current user out of Supabase and clears the stored session token
  // (handled automatically by the ExpoSecureStoreAdapter in supabase.js).
  // Call this wherever you need a logout button (e.g. a settings or dashboard screen).
  logout: async (navigation) => {
    try {
      await supabase.auth.signOut();
      // Navigate to login
      navigation.replace('Login');
    } catch (error) {
      Alert.alert('Logout Failed', error.message);
    }
  },
}));

export default useAuthStore;
