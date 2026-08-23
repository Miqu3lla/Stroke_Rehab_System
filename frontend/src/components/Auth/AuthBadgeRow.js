import React from 'react';
import { View, Text } from 'react-native';
import { Shield, Activity } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// .badge-row from theramotion-auth.html — login screen only.
export default function AuthBadgeRow() {
  return (
    <View className="flex-row gap-2 mt-6">
      <Badge icon={Shield} text="Data kept private" />
      <Badge icon={Activity} text="Progress synced" />
    </View>
  );
}

function Badge({ icon: Icon, text }) {
  return (
    <View className="flex-1 items-center rounded-2xl border py-3 px-2.5" style={{ backgroundColor: palette.card, borderColor: palette.line }}>
      <Icon size={16} color={palette.sage} style={{ marginBottom: 6 }} />
      <Text className="text-center" style={{ color: palette.inkSoft, fontFamily: fonts.sansSemibold, fontSize: 10.5, lineHeight: 13 }}>
        {text}
      </Text>
    </View>
  );
}
