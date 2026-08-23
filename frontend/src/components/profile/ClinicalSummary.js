import React from 'react';
import { View } from 'react-native';
import { Activity, Calendar } from 'lucide-react-native';
import AppText from '../ui/AppText';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

function StatRow({ icon, iconBg, iconColor, label, value, last }) {
  return (
    <View
      className="flex-row items-center gap-3.5 p-4"
      style={!last ? { borderBottomWidth: 1, borderBottomColor: palette.line } : null}
    >
      <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: iconBg }}>
        {icon}
      </View>
      <View>
        <AppText size={12} style={{ fontFamily: fonts.sans, color: palette.inkSoft, marginBottom: 2 }}>
          {label}
        </AppText>
        <AppText size={14.5} style={{ fontFamily: fonts.sansBold, color: palette.ink }} className="capitalize">
          {value}
        </AppText>
      </View>
    </View>
  );
}

export default function ClinicalSummary({ profile }) {
  // Combine affected side and area
  const side = profile?.affected_side?.toLowerCase() || '';
  const area = profile?.affected_area?.toLowerCase() || '';
  let focusArea = 'Not specified';
  if (side || area) {
    focusArea = `${side} ${area}`.trim();
  }

  // Calculate total months in recovery
  let monthsInRecovery = parseInt(profile?.months_in_recovery || 0, 10);
  if (profile?.created_at) {
    const createdDate = new Date(profile.created_at);
    const currentDate = new Date();

    // Calculate elapsed months by comparing years and months directly
    const elapsedMonths = (currentDate.getFullYear() - createdDate.getFullYear()) * 12
      + (currentDate.getMonth() - createdDate.getMonth());

    // Add elapsed months to the initial value
    monthsInRecovery += elapsedMonths;
  }

  return (
    <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}>
      <StatRow
        icon={<Activity size={18} color={palette.primary} />}
        iconBg={palette.primarySoft}
        label="Focus area"
        value={focusArea}
      />
      <StatRow
        icon={<Calendar size={18} color={palette.sage} />}
        iconBg={palette.sageSoft}
        label="Time in recovery"
        value={`${monthsInRecovery} ${monthsInRecovery === 1 ? 'month' : 'months'}`}
        last
      />
    </View>
  );
}
