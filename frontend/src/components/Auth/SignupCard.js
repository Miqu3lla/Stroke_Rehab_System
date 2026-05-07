import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../../services/supabase';

const SignupCard = ({ navigation }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    if (!fullName || !email || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    // You can pass the full name to the user's metadata in Supabase
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    if (error) {
      Alert.alert('Signup Failed', error.message);
    } else {
      Alert.alert('Success', 'Check your email for the login link! Or log in if email confirmation is off.');
      // Optionally navigate to login
      navigation.replace('Login');
    }
    setLoading(false);
  };

  const handleLoginNav = () => {
    navigation.replace('Login');
  };

  return (
    <View className="w-full max-w-sm p-6 bg-white rounded-[32px] shadow-sm border border-gray-100">
      <View className="mb-6">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Full Name</Text>
        <TextInput
          className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] px-6 text-xl text-gray-900"
          placeholder="Enter your full name"
          placeholderTextColor="#737685"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />
      </View>

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

      <View className="mb-6">
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

      <View className="mb-8">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Confirm Password</Text>
        <TextInput
          className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] px-6 text-xl text-gray-900"
          placeholder="Confirm your password"
          placeholderTextColor="#737685"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
      </View>

      <TouchableOpacity
        className="w-full h-[72px] bg-[#0052CC] rounded-full justify-center items-center mb-4"
        onPress={handleSignUp}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Text className="text-white text-[22px] font-bold">Sign Up ➔</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="w-full py-4 justify-center items-center"
        onPress={handleLoginNav}
        disabled={loading}
      >
        <Text className="text-[#0052CC] text-[20px] font-bold">Already have an account? Login</Text>
      </TouchableOpacity>
    </View>
  );
};

export default SignupCard;
