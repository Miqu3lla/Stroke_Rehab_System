import React from 'react';
import { View, Pressable } from 'react-native';
import { Bell, History, Type } from 'lucide-react-native';
import AppText from '../ui/AppText';
import useSettingsStore from '../../store/useSettingsStore';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

function Switch({ on }) {
  return (
    <View
      className="w-[42px] h-[25px] rounded-full justify-center"
      style={{ backgroundColor: on ? palette.sage : palette.line, padding: 3 }}
    >
      <View
        className="w-[19px] h-[19px] rounded-full bg-white"
        style={{ marginLeft: on ? 17 : 0 }}
      />
    </View>
  );
}

function ToggleRow({ icon, title, subtitle, on, onToggle, last }) {
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center gap-3.5 py-3.5 px-4"
      style={!last ? { borderBottomWidth: 1, borderBottomColor: palette.line } : null}
    >
      <View className="w-[38px] h-[38px] rounded-xl items-center justify-center" style={{ backgroundColor: palette.primarySoft }}>
        {icon}
      </View>
      <View className="flex-1">
        <AppText size={13.5} style={{ fontFamily: fonts.sansBold, color: palette.ink, marginBottom: 2 }}>
          {title}
        </AppText>
        <AppText size={11.5} style={{ fontFamily: fonts.sans, color: palette.inkSoft }}>
          {subtitle}
        </AppText>
      </View>
      <Switch on={on} />
    </Pressable>
  );
}

export default function PreferencesPanel() {
  const { sessionReminders, progressRecap, textScale, toggleSessionReminders, toggleProgressRecap, setTextScale } =
    useSettingsStore();

  return (
    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
      <ToggleRow
        icon={<Bell size={17} color={palette.primary} />}
        title="Session reminders"
        subtitle="Daily nudge to complete today's exercises"
        on={sessionReminders}
        onToggle={toggleSessionReminders}
      />
      <ToggleRow
        icon={<History size={17} color={palette.primary} />}
        title="Progress recap"
        subtitle="Weekly summary on Sundays"
        on={progressRecap}
        onToggle={toggleProgressRecap}
      />
      <View className="flex-row items-center gap-3.5 py-3.5 px-4">
        <View className="w-[38px] h-[38px] rounded-xl items-center justify-center" style={{ backgroundColor: palette.primarySoft }}>
          <Type size={17} color={palette.primary} />
        </View>
        <View className="flex-1">
          <AppText size={13.5} style={{ fontFamily: fonts.sansBold, color: palette.ink, marginBottom: 2 }}>
            Text size
          </AppText>
          <AppText size={11.5} style={{ fontFamily: fonts.sans, color: palette.inkSoft }}>
            Scales text on redesigned screens
          </AppText>
        </View>
        <View className="flex-row gap-1.5">
          {[
            { key: 'base', label: 'A', fontSize: 12 },
            { key: 'large', label: 'A', fontSize: 15 },
          ].map((opt) => {
            const on = textScale === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setTextScale(opt.key)}
                className="px-2.5 py-1.5 rounded-lg"
                style={{ backgroundColor: on ? palette.primary : palette.canvas }}
              >
                <AppText
                  size={opt.fontSize}
                  style={{ fontFamily: fonts.sansBold, color: on ? '#fff' : palette.inkSoft }}
                >
                  {opt.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
