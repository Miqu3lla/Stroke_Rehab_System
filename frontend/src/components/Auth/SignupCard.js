import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Eye, EyeOff, Check, X } from 'lucide-react-native';
import useAuthStore from '../../store/useAuthStore';
import { PASSWORD_RULES, validatePassword } from '../../utils/passwordPolicy';

// Live checklist rendered under the Password field — patient sees which
// of the 3 rules they're failing as they type, instead of finding out
// only after tapping Sign Up.
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

export default function SignupCard({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { handleSignUp, loading } = useAuthStore();

  // Disable Sign Up until policy passes AND confirm matches. Keeps the
  // patient from tapping a button that will only Alert them anyway.
  const policyOk = validatePassword(password).ok;
  const confirmMatches = password.length > 0 && password === confirmPassword;
  const canSubmit = !loading && policyOk && confirmMatches;

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

      <View className="mb-6">
        <Text className="text-gray-900 font-bold mb-2 text-xl ml-2">Password</Text>
        <View className="relative">
          <TextInput
            className="w-full h-[72px] bg-[#FAFAFA] border border-[#c3c6d6] rounded-[24px] pl-6 pr-16 text-xl text-gray-900"
            placeholder="Enter your password"
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
            placeholder="Confirm your password"
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
        onPress={() => handleSignUp(email, password, confirmPassword, navigation)}
        disabled={!canSubmit}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="large" />
        ) : (
          <Text className="text-white text-[22px] font-bold">Sign Up ➔</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        className="w-full py-4 justify-center items-center"
        onPress={() => navigation.replace('Login')}
        disabled={loading}
      >
        <Text className="text-[#0052CC] text-[20px] font-bold">Already have an account? Login</Text>
      </TouchableOpacity>
    </View>
  );
}
