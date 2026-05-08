import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';


// This adapter tells Supabase to securely save the user's login token
// using React Native's native secure storage, rather than web cookies.
const ExpoSecureStoreAdapter = {
  //get item gets the users token to verify if its logged on or not 
  getItem: (key) => SecureStore.getItemAsync(key),
  //sets the token after logging in
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  //removes the token after logging out
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

// You will need to replace these with your actual keys
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;


//sets up how the frontend talks to supabase and stores the users data
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    //tells to use the auth manager
    storage: ExpoSecureStoreAdapter,
    //automatically refresh the token so the user stays logged in
    autoRefreshToken: true,
    //tells the app to remember the user
    persistSession: true,
    //tells the app not to detect the session in the url
    detectSessionInUrl: false,
  },
});