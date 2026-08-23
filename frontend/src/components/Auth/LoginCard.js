import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import useAuthStore from '../../store/useAuthStore';
import AuthBrandHeader from './AuthBrandHeader';
import AuthTextInput from './AuthTextInput';
import AuthPrimaryButton from './AuthPrimaryButton';
import AuthBadgeRow from './AuthBadgeRow';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

export default function LoginCard({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { handleLogin, loading } = useAuthStore();

  return (
    <View className="w-full max-w-sm">
      <AuthBrandHeader
        eyebrow="Welcome back"
        title={'Continue your\nrecovery'}
        subtitle="Sign in to pick up right where your last session left off."
      />

      <AuthTextInput
        label="Email address"
        placeholder="you@email.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
      />
      <AuthTextInput
        label="Password"
        placeholder="Enter your password"
        value={password}
        onChangeText={setPassword}
        isPassword
      />

      <TouchableOpacity
        className="self-end -mt-2 mb-5"
        onPress={() => navigation.navigate('ForgotPassword')}
        disabled={loading}
      >
        <Text style={{ color: palette.primary, fontFamily: fonts.sansBold, fontSize: 13 }}>
          Forgot password?
        </Text>
      </TouchableOpacity>

      <AuthPrimaryButton
        label="Sign in"
        onPress={() => handleLogin(email, password, navigation)}
        disabled={loading}
        loading={loading}
      />

      <AuthBadgeRow />

      <TouchableOpacity className="mt-6 items-center" onPress={() => navigation.replace('Signup')} disabled={loading}>
        <Text style={{ color: palette.inkSoft, fontFamily: fonts.sans, fontSize: 13.5 }}>
          New here?{' '}
          <Text style={{ color: palette.primary, fontFamily: fonts.sansBold }}>Create an account</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}
