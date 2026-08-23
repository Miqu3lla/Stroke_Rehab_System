import React from 'react';
import { View, Pressable, Alert } from 'react-native';
import { FileText, ShieldCheck, Info, ChevronRight } from 'lucide-react-native';
import AppText from '../ui/AppText';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import appConfig from '../../../app.json';

const comingSoon = (feature) => Alert.alert('Coming soon', `${feature} isn't available yet.`);

function LinkRow({ icon, label, onPress, meta, last }) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
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
      {meta ? (
        <AppText size={12} style={{ fontFamily: fonts.sansBold, color: palette.inkSoft }}>
          {meta}
        </AppText>
      ) : (
        <ChevronRight size={16} color={palette.inkSoft} />
      )}
    </Wrapper>
  );
}

export default function AboutPanel() {
  return (
    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
      <LinkRow
        icon={<ShieldCheck size={17} color={palette.primary} />}
        label="Privacy policy"
        onPress={() => comingSoon('The privacy policy')}
      />
      <LinkRow
        icon={<FileText size={17} color={palette.primary} />}
        label="Terms of service"
        onPress={() => comingSoon('Terms of service')}
      />
      <LinkRow
        icon={<Info size={17} color={palette.primary} />}
        label="App version"
        meta={appConfig.expo.version}
        last
      />
    </View>
  );
}
