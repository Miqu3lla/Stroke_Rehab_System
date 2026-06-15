import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { User, Pencil, Check } from 'lucide-react-native';
import usePatientProfileStore from '../../store/usePatientProfileStore';

// Compose the display name from first + last. Empty last_name (single-
// name patients) renders as just the first name without a trailing space.
const displayName = (profile) => {
  if (!profile) return 'Patient Name';
  const parts = [profile.first_name, profile.last_name].filter((s) => s && s.trim());
  return parts.length > 0 ? parts.join(' ') : 'Patient Name';
};

export default function PatientHeaderProfile({ profile }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editFirst, setEditFirst] = useState(profile?.first_name || '');
  const [editLast, setEditLast] = useState(profile?.last_name || '');
  const { updatePatientName } = usePatientProfileStore();

  const startEditing = () => {
    setEditFirst(profile?.first_name || '');
    setEditLast(profile?.last_name || '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    const nextFirst = editFirst.trim();
    const nextLast = editLast.trim();
    // Skip the network call if nothing actually changed.
    const changed =
      nextFirst !== (profile?.first_name || '') ||
      nextLast !== (profile?.last_name || '');
    if (!nextFirst) {
      // First name is required — keep editor open if cleared.
      return;
    }
    if (!changed) {
      setIsEditing(false);
      return;
    }
    try {
      await updatePatientName({ first_name: nextFirst, last_name: nextLast });
      setIsEditing(false);
    } catch (err) {
      // Error already surfaced via store state.error; keep editor open
      // so the patient can retry without retyping.
    }
  };

  const accountCreated = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'Unknown';

  return (
    <View className="flex-row items-center">
      <View className="w-16 h-16 rounded-full bg-slate-100 items-center justify-center mr-4">
        <User size={32} color="#0065f1ff" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-start justify-between">
          {isEditing ? (
            <View className="flex-1 mr-2">
              <TextInput
                value={editFirst}
                onChangeText={setEditFirst}
                placeholder="First name"
                className="text-xl font-bold text-slate-900 border-b border-blue-600 p-0 mb-1"
                autoFocus
              />
              <TextInput
                value={editLast}
                onChangeText={setEditLast}
                placeholder="Last name"
                className="text-base font-semibold text-slate-700 border-b border-blue-600 p-0"
                onSubmitEditing={handleSave}
              />
            </View>
          ) : (
            <Text className="text-xl font-bold text-slate-900 flex-1">{displayName(profile)}</Text>
          )}

          <Pressable
            onPress={isEditing ? handleSave : startEditing}
            className="p-2 rounded-full bg-slate-100 ml-2"
          >
            {isEditing ? <Check size={18} color="#00875a" /> : <Pencil size={18} color="#64748b" />}
          </Pressable>
        </View>
        <Text className="text-slate-500 text-sm mt-1">Account created: {accountCreated}</Text>
      </View>
    </View>
  );
}
