import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import useAuthStore from '../../store/useAuthStore';
import AuthBrandHeader from './AuthBrandHeader';
import AuthTextInput from './AuthTextInput';
import AuthPrimaryButton from './AuthPrimaryButton';
import PasswordRules from './PasswordRules';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { validatePassword } from '../../utils/passwordPolicy';

export default function ResetPasswordCard({ email, navigation }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [countdown, setCountdown] = useState(300);

  const { handleResetPassword, handleForgotPassword, loading } = useAuthStore();

  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setInterval(() => setCountdown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const onResendCode = async () => {
    // Only start the cooldown if a code was actually sent - otherwise a
    // failed resend (rate limit, network error) locks the user out for
    // 5 minutes for nothing.
    const sent = await handleForgotPassword(email, navigation);
    if (sent) setCountdown(300);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const policyOk = validatePassword(password).ok;
  const confirmMatches = password.length > 0 && password === confirmPassword;
  const canSubmit = !loading && code.length > 0 && policyOk && confirmMatches;

  return (
    <View className="w-full max-w-sm">
      <AuthBrandHeader
        eyebrow="Account recovery"
        title={'Reset your\npassword'}
        subtitle={`Enter the code sent to ${email}.`}
      />

      <AuthTextInput
        label="Reset code"
        placeholder="6-digit code"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
      />
      <TouchableOpacity className="-mt-3 mb-5" onPress={onResendCode} disabled={loading || countdown > 0}>
        <Text style={{ color: countdown > 0 ? palette.inkSoft : palette.primary, fontFamily: fonts.sansBold, fontSize: 13 }}>
          {countdown > 0 ? `Resend code in ${formatTime(countdown)}` : 'Resend code'}
        </Text>
      </TouchableOpacity>

      <AuthTextInput label="New password" placeholder="Enter your new password" value={password} onChangeText={setPassword} isPassword />
      <PasswordRules password={password} />
      <AuthTextInput
        label="Confirm password"
        placeholder="Confirm your new password"
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
        label="Reset password"
        onPress={() => handleResetPassword(email, code, password, confirmPassword, navigation)}
        disabled={!canSubmit}
        loading={loading}
      />
    </View>
  );
}
