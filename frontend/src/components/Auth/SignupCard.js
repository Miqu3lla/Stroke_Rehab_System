import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import useAuthStore from '../../store/useAuthStore';
import AuthBrandHeader from './AuthBrandHeader';
import AuthTextInput from './AuthTextInput';
import AuthPrimaryButton from './AuthPrimaryButton';
import PasswordRules from './PasswordRules';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { validatePassword } from '../../utils/passwordPolicy';

export default function SignupCard({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { handleSignUp, loading } = useAuthStore();

  // Disable Sign Up until policy passes AND confirm matches. Keeps the
  // patient from tapping a button that will only Alert them anyway.
  const policyOk = validatePassword(password).ok;
  const confirmMatches = password.length > 0 && password === confirmPassword;
  const canSubmit = !loading && policyOk && confirmMatches;

  return (
    <View className="w-full max-w-sm">
      <AuthBrandHeader
        eyebrow="Get started"
        title={'Start your\nrecovery journey'}
        subtitle="Create an account to track sessions and see your progress over time."
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
        placeholder="Create a password"
        value={password}
        onChangeText={setPassword}
        isPassword
      />
      <PasswordRules password={password} />
      <AuthTextInput
        label="Confirm password"
        placeholder="Re-enter your password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        isPassword
      />
      {confirmPassword.length > 0 && !confirmMatches && (
        <Text style={{ color: palette.amber, fontFamily: fonts.sans, fontSize: 12, marginTop: -12, marginBottom: 12 }}>
          Passwords do not match
        </Text>
      )}

      <AuthPrimaryButton
        label="Create account"
        onPress={() => handleSignUp(email, password, confirmPassword, navigation)}
        disabled={!canSubmit}
        loading={loading}
      />

      <TouchableOpacity className="mt-6 items-center" onPress={() => navigation.replace('Login')} disabled={loading}>
        <Text style={{ color: palette.inkSoft, fontFamily: fonts.sans, fontSize: 13.5 }}>
          Already have an account?{' '}
          <Text style={{ color: palette.primary, fontFamily: fonts.sansBold }}>Sign in</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}
