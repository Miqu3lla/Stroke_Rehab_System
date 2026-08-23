import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Activity } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Wordmark + eyebrow + title + subtitle block from theramotion-auth.html,
// shared by LoginCard and SignupCard. `title` takes a literal "\n" for the
// two-line headline (mockup: "Continue your\nrecovery").
export default function AuthBrandHeader({ eyebrow, title, subtitle }) {
  return (
    <View className="pt-1 pb-1 mb-6">
      {/* Decorative motion arc, same motif as the Home hero card. */}
      <Svg width={90} height={90} viewBox="0 0 90 90" style={{ position: 'absolute', top: 40, right: -10, opacity: 0.5 }}>
        <Path d="M14 76 A 56 56 0 0 1 76 14" stroke={palette.primary} strokeWidth={2} strokeDasharray="4 7" opacity={0.35} />
      </Svg>

      <View className="flex-row items-center gap-2.5 mb-6">
        <View className="w-[34px] h-[34px] rounded-[10px] items-center justify-center" style={{ backgroundColor: palette.primary }}>
          <Activity size={17} color="#fff" />
        </View>
        <Text style={{ color: palette.ink, fontFamily: fonts.serif, fontSize: 16 }}>TheraMotion</Text>
      </View>

      <Text
        className="text-[11px] uppercase mb-1.5"
        style={{ color: palette.primary, fontFamily: fonts.monoSemibold, letterSpacing: 1.5 }}
      >
        {eyebrow}
      </Text>
      <Text style={{ color: palette.ink, fontFamily: fonts.serif, fontSize: 30, lineHeight: 34, marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ color: palette.inkSoft, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 }}>
        {subtitle}
      </Text>
    </View>
  );
}
