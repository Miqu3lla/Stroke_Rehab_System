import React from 'react';
import { View, Text } from 'react-native';
import { Check } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { PASSWORD_RULES } from '../../utils/passwordPolicy';

// Live checklist under Signup's password field — sage dot+check when a
// rule passes, amber dot when it doesn't (mockup's .rule/.rule.met).
export default function PasswordRules({ password }) {
  return (
    <View className="mt-1 mb-4" style={{ gap: 8 }}>
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <View key={rule.id} className="flex-row items-center gap-2.5">
            <View
              className="w-[17px] h-[17px] rounded-full items-center justify-center"
              style={{ backgroundColor: met ? palette.sageSoft : palette.amberSoft }}
            >
              {met ? (
                <Check size={10} color={palette.sage} strokeWidth={3} />
              ) : (
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.amber }} />
              )}
            </View>
            <Text style={{ color: met ? palette.ink : palette.inkSoft, fontFamily: fonts.sans, fontSize: 12.5 }}>
              {rule.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
