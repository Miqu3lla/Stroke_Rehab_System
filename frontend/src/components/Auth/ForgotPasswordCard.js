import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import useAuthStore from '../../store/useAuthStore';
import AuthBrandHeader from './AuthBrandHeader';
import AuthTextInput from './AuthTextInput';
import AuthPrimaryButton from './AuthPrimaryButton';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

export default function ForgotPasswordCard({ navigation }) {
  const [email, setEmail] = useState('');
  const { handleForgotPassword, loading } = useAuthStore();

  return (
    <View className="w-full max-w-sm">
      <AuthBrandHeader
        eyebrow="Account recovery"
        title={'Forgot your\npassword?'}
        subtitle="Enter your email and we'll send you a reset code."
      />

      <AuthTextInput
        label="Email address"
        placeholder="you@email.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
      />

      <AuthPrimaryButton
        label="Send code"
        onPress={() => handleForgotPassword(email, navigation)}
        disabled={loading}
        loading={loading}
      />

      <TouchableOpacity className="mt-6 items-center" onPress={() => navigation.replace('Login')} disabled={loading}>
        <Text style={{ color: palette.primary, fontFamily: fonts.sansBold, fontSize: 13.5 }}>Back to login</Text>
      </TouchableOpacity>
    </View>
  );
}
