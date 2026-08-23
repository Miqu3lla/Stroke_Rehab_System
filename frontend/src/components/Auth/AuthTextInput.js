import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Labeled input from theramotion-auth.html's .field/.input-wrap, with an
// optional eye toggle for password fields (isPassword) — every password
// field in the mockup ships one, login previously didn't have it.
export default function AuthTextInput({
  label, value, onChangeText, placeholder, isPassword = false,
  keyboardType, autoCapitalize = 'none', maxLength,
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View className="mb-[18px]">
      <Text style={{ color: palette.ink, fontFamily: fonts.sansBold, fontSize: 13, marginBottom: 8 }}>
        {label}
      </Text>
      <View className="relative justify-center">
        <TextInput
          className="w-full rounded-2xl px-4 py-4"
          style={{
            borderWidth: 1.5,
            borderColor: focused ? palette.primary : palette.line,
            backgroundColor: '#fff',
            color: palette.ink,
            fontFamily: fonts.sans,
            fontSize: 14.5,
            paddingRight: isPassword ? 44 : 16,
          }}
          placeholder={placeholder}
          placeholderTextColor="#9BA6B5"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={isPassword && !visible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {isPassword && (
          <TouchableOpacity
            className="absolute right-4"
            onPress={() => setVisible((v) => !v)}
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff size={18} color={palette.inkSoft} /> : <Eye size={18} color={palette.inkSoft} />}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
