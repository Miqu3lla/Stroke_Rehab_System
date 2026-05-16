import { create } from 'zustand';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';

const useAuthStore = create((set, get) => ({
  // State
  loading: false,

  //checks if the user is logged in or not
  getAuthSession: async() => {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('Error fetching session:', error.message);
      set({ user: null });
      return null;
    }

    if (session) {
      set({ user: session.user });
    } else {
      set({ user: null });
    }

    return session;
  },

  //handles the user logins with validation checks
  handleLogin: async (email, password, navigation) => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }
    //email validation check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    set({ loading: true });

    try {
      //supabase built in function that signs in the user with the email and password
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

      // Check if onboarding has been completed (name is filled in during onboarding)
      const { data: patientProfile, error: profileError } = await supabase
        .from('patients')
        .select('name')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        console.log('Profile lookup failed, defaulting to onboarding:', profileError.message);
        navigation.replace('Onboarding');
        return;
      }

      if (patientProfile?.name) {
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
  //handles the user registration and checks the validation of the inputs
  handleSignUp: async (email, password, confirmPassword, navigation) => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    //email validation check
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

      Alert.alert('Account created Succesfully!, Welcome to TheraMotion!')
      navigation.replace('Onboarding');
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
      // Navigate to login BEFORE signing out to prevent the navigation object
      // from being destroyed when the session listener unmounts the Sidebar
      if (navigation) {
        try {
          if (typeof navigation.reset === 'function') {
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          } else if (typeof navigation.replace === 'function') {
            navigation.replace('Login');
          } else if (typeof navigation.navigate === 'function') {
            navigation.navigate('Login');
          }
        } catch (navErr) {
          console.warn('Navigation before logout failed:', navErr);
        }
      }
      
      // Now destroy the session
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.error('[useAuthStore] signOut failed:', signOutError.message);
        Alert.alert('Logout Failed', signOutError.message);
      }
    } catch (error) {
      Alert.alert('Logout Failed', error.message);
    }
  },
}));

export default useAuthStore;
