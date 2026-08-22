import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import useAuthStore from '../../store/useAuthStore';

export default function ForgotPasswordCard({ navigation }) {
  const [email, setEmail] = useState('');

  const { handleForgotPassword, loading } = useAuthStore();

  return (
    <View className="w-full max-w-sm p-6 bg-white rounded-[32px] shadow-sm border border-gray-100">
      <View className="mb-8">
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

      <TouchableOpacity
        className="w-full h-[72px] bg-[#0052CC] rounded-full justify-center items-center mb-4"
        onPress={() => handleForgotPassword(email, navigation)}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Text className="text-white text-[22px] font-bold">Send Code</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="w-full py-4 justify-center items-center"
        onPress={() => navigation.replace('Login')}
        disabled={loading}
      >
        <Text className="text-[#0052CC] text-[20px] font-bold">Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}
