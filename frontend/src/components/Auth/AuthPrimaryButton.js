import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// .primary-btn / .primary-btn.disabled from theramotion-auth.html.
export default function AuthPrimaryButton({ label, onPress, disabled, loading }) {
  const dimmed = disabled || loading;
  const textColor = disabled ? '#7FA39C' : '#fff';

  return (
    <TouchableOpacity
      className="w-full flex-row items-center justify-center gap-2 rounded-2xl py-4 mt-1.5"
      style={{ backgroundColor: disabled ? palette.primarySoft : palette.primary }}
      onPress={onPress}
      disabled={dimmed}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          <Text style={{ color: textColor, fontFamily: fonts.sansBold, fontSize: 15 }}>{label}</Text>
          <ArrowRight size={15} color={textColor} />
        </>
      )}
    </TouchableOpacity>
  );
}
