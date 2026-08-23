import React from 'react';
import { View, Pressable, Alert } from 'react-native';
import { HelpCircle, Mail, Star, ChevronRight } from 'lucide-react-native';
import AppText from '../ui/AppText';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Real destinations (help center URL, care-team contact, store listing)
// aren't wired up yet — stub with an honest "coming soon" instead of a
// dead or fake link.
const comingSoon = (feature) => Alert.alert('Coming soon', `${feature} isn't available yet.`);

function LinkRow({ icon, label, onPress, last }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3.5 py-3.5 px-4"
      style={!last ? { borderBottomWidth: 1, borderBottomColor: palette.line } : null}
    >
      <View className="w-[38px] h-[38px] rounded-xl items-center justify-center" style={{ backgroundColor: palette.primarySoft }}>
        {icon}
      </View>
      <AppText size={13.5} style={{ fontFamily: fonts.sansBold, color: palette.ink, flex: 1 }}>
        {label}
      </AppText>
      <ChevronRight size={16} color={palette.inkSoft} />
    </Pressable>
  );
}

export default function SupportPanel() {
  return (
    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
      <LinkRow
        icon={<HelpCircle size={17} color={palette.primary} />}
        label="Help center"
        onPress={() => comingSoon('The help center')}
      />
      <LinkRow
        icon={<Mail size={17} color={palette.primary} />}
        label="Contact your care team"
        onPress={() => comingSoon('Contacting your care team')}
      />
      <LinkRow
        icon={<Star size={17} color={palette.primary} />}
        label="Rate TheraMotion"
        onPress={() => comingSoon('Rating TheraMotion')}
        last
      />
    </View>
  );
}
