import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Activity, Dumbbell } from 'lucide-react-native';
import usePatientStore from '../../store/usePatientStore';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Sets-and-modes Phase B (2026-06-04). Sits above the recommendation
// list on the Sessions tab; toggles the active session mode between
// Functionality (rep-only) and Strength (rep baseline + 5-min hold
// finisher once unlocked). Backed by `usePatientStore.activeMode` which
// is synced with `patients.preferred_mode` on the server — so the next
// session reload remembers the patient's choice.
//
// Both variants are pre-cached by fetchRecommendation, so tapping the
// toggle swaps the displayed card list instantly (no network call, no
// loading state).

export default function SessionModeToggle() {
  const { activeMode, setActiveMode } = usePatientStore();

  return (
    <View className="flex-row gap-3 mb-4">
      <ModeButton
        label="Functionality"
        icon={Activity}
        active={activeMode === 'functionality'}
        onPress={() => setActiveMode('functionality')}
      />
      <ModeButton
        label="Strength"
        icon={Dumbbell}
        active={activeMode === 'strength'}
        onPress={() => setActiveMode('strength')}
      />
    </View>
  );
}

// Internal button — pill-style with icon + label. Active state inverts
// to the brand primary background so the chosen mode is obvious at a glance.
function ModeButton({ label, icon: Icon, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="flex-1 flex-row items-center justify-center gap-2 py-3.5 rounded-2xl border"
      style={{
        backgroundColor: active ? palette.primary : palette.card,
        borderColor: active ? palette.primary : palette.line,
      }}
    >
      <Icon size={18} color={active ? '#ffffff' : palette.inkSoft} />
      <Text
        className="text-[15px]"
        style={{ color: active ? '#ffffff' : palette.ink, fontFamily: fonts.sansBold }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
