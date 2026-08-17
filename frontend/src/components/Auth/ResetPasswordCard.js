import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Eye, EyeOff, Check, X } from 'lucide-react-native';
import useAuthStore from '../../store/useAuthStore';
import { PASSWORD_RULES, validatePassword } from '../../utils/passwordPolicy';

// Live checklist rendered under the Password field - same pattern as SignupCard.
function PasswordChecklist({ password }) {
  return (
    <View className="mt-3 ml-2">
      {PASSWORD_RULES.map((rule) => {
        const passed = rule.test(password);
        return (
          <View key={rule.id} className="flex-row items-center mb-1">
            {passed ? (
              <Check size={18} color="#16a34a" />
            ) : (
              <X size={18} color="#9ca3af" />
            )}
            <Text
              className={`ml-2 text-base ${passed ? 'text-green-600' : 'text-gray-500'}`}
            >
              {rule.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ResetPasswordCard({ email, navigation }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [countdown, setCountdown] = useState(300);

  const { handleResetPassword, handleForgotPassword, loading } = useAuthStore();

  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const onResendCode = () => {
    handleForgotPassword(email, navigation);
    setCountdown(300);
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
    <View className="w-full max-w-sm p-6 bg-white rounded-[32px] shadow-sm border border-gray-100">
      <View className="mb-6">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Reset Code</Text>
        <TextInput
          className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] px-6 text-xl text-gray-900 tracking-[8px]"
          placeholder="6-digit code"
          placeholderTextColor="#737685"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
        />
        <TouchableOpacity
          className="mt-3 ml-2 self-start"
          onPress={onResendCode}
          disabled={loading || countdown > 0}
        >
          <Text className={`text-lg font-bold ${countdown > 0 ? 'text-gray-400' : 'text-[#0052CC]'}`}>
            {countdown > 0 ? `Resend code in ${formatTime(countdown)}` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </View>

      <View className="mb-6">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">New Password</Text>
        <View className="relative">
          <TextInput
            className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] pl-6 pr-16 text-xl text-gray-900"
            placeholder="Enter your new password"
            placeholderTextColor="#737685"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity
            className="absolute right-5 top-0 bottom-0 justify-center"
            onPress={() => setShowPassword((v) => !v)}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={24} color="#737685" /> : <Eye size={24} color="#737685" />}
          </TouchableOpacity>
        </View>
        <PasswordChecklist password={password} />
      </View>

      <View className="mb-8">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Confirm Password</Text>
        <View className="relative">
          <TextInput
            className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] pl-6 pr-16 text-xl text-gray-900"
            placeholder="Confirm your new password"
            placeholderTextColor="#737685"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirm}
            autoCapitalize="none"
          />
          <TouchableOpacity
            className="absolute right-5 top-0 bottom-0 justify-center"
            onPress={() => setShowConfirm((v) => !v)}
            accessibilityLabel={showConfirm ? 'Hide password' : 'Show password'}
          >
            {showConfirm ? <EyeOff size={24} color="#737685" /> : <Eye size={24} color="#737685" />}
          </TouchableOpacity>
        </View>
        {confirmPassword.length > 0 && !confirmMatches && (
          <Text className="text-red-600 text-base mt-2 ml-2">Passwords do not match</Text>
        )}
      </View>

      <TouchableOpacity
        className={`w-full h-[72px] rounded-full justify-center items-center mb-4 ${canSubmit ? 'bg-[#0052CC]' : 'bg-[#9bb6e0]'}`}
        onPress={() => handleResetPassword(email, code, password, confirmPassword, navigation)}
        disabled={!canSubmit}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Text className="text-white text-[22px] font-bold">Reset Password</Text>
        )}
      </TouchableOpacity>

    </View>
  );
}
