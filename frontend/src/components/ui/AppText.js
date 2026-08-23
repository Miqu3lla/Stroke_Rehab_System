import React from 'react';
import { Text } from 'react-native';
import useSettingsStore, { TEXT_SCALE_MULTIPLIER } from '../../store/useSettingsStore';

// Text component that respects the Profile screen's "Text size" preference.
// `size` is the mockup's base px value; scaled by the persisted textScale.
// Adopt this in place of raw <Text> in newly-built screens going forward -
// existing screens still use plain <Text> and aren't retrofitted yet.
export default function AppText({ size = 14, style, children, ...rest }) {
  const textScale = useSettingsStore((s) => s.textScale);
  const scaledSize = Math.round(size * TEXT_SCALE_MULTIPLIER[textScale]);
  return (
    <Text style={[{ fontSize: scaledSize }, style]} {...rest}>
      {children}
    </Text>
  );
}
