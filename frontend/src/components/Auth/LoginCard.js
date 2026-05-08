import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../../services/supabase';

const LoginCard = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter both email and password');
      return;
    }
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpNav = () => {
    navigation.replace('Signup');
  };

  return (
    <View className="w-full max-w-sm p-6 bg-white rounded-[32px] shadow-sm border border-gray-100">
      <View className="mb-6">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Email Address</Text>
        <TextInput
          className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] px-6 text-xl text-gray-900"
          placeholder="Enter your email"
          placeholderTextColor="#737685"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </View>

      <View className="mb-8">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Password</Text>
        <TextInput
          className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] px-6 text-xl text-gray-900"
          placeholder="Enter your password"
          placeholderTextColor="#737685"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
      </View>

      <TouchableOpacity
        className="w-full h-[72px] bg-[#0052CC] rounded-full justify-center items-center mb-4"
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Text className="text-white text-[22px] font-bold">Login</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="w-full py-4 justify-center items-center"
        onPress={handleSignUpNav}
        disabled={loading}
      >
        <Text className="text-[#0052CC] text-[20px] font-bold">New user? Sign Up</Text>
      </TouchableOpacity>
    </View>
  );
};

export default LoginCard;
