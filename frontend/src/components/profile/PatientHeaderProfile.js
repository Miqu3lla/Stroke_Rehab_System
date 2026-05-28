import React from 'react';
import { View, Text } from 'react-native';
import { User } from 'lucide-react-native';

export default function PatientHeaderProfile({ profile }) {
  const accountCreated = profile?.created_at 
    ? new Date(profile.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) 
    : 'Unknown';
  
  return (
    <View className="flex-row items-center">
      <View className="w-16 h-16 rounded-full bg-blue-50 items-center justify-center mr-4">
        <User size={32} color="#2563eb" />
      </View>
      <View className="flex-1">
        <Text className="text-xl font-bold text-slate-900">{profile?.name || 'Patient Name'}</Text>
        <Text className="text-slate-500 text-sm mt-1">Account created: {accountCreated}</Text>
      </View>
    </View>
  );
}
