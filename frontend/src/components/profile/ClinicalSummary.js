import React from 'react';
import { View, Text } from 'react-native';
import { Activity, Calendar } from 'lucide-react-native';

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
    <View>
      <Text className="text-lg font-bold text-slate-900 mb-4">Clinical Summary</Text>
      
      <View className="flex-row items-center mb-4">
        <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center mr-4">
          <Activity size={24} color="#0052cc" />
        </View>
        <View>
          <Text className="text-slate-500 text-sm mb-1">Focus Area</Text>
          <Text className="text-slate-900 font-semibold text-base capitalize">{focusArea}</Text>
        </View>
      </View>
      
      <View className="flex-row items-center">
        <View className="w-12 h-12 rounded-full bg-green-50 items-center justify-center mr-4">
          <Calendar size={24} color="#00875a" />
        </View>
        <View>
          <Text className="text-slate-500 text-sm mb-1">Time in Recovery</Text>
          <Text className="text-slate-900 font-semibold text-base">
            {monthsInRecovery} {monthsInRecovery === 1 ? 'month' : 'months'}
          </Text>
        </View>
      </View>
    </View>
  );
}
