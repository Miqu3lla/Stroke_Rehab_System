import React, { useState } from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { User, Pencil, Check } from 'lucide-react-native';
import usePatientProfileStore from '../../store/usePatientProfileStore';
import AppText from '../ui/AppText';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

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
        day: 'numeric',
      })
    : 'Unknown';

  return (
    <View className="flex-row items-center px-5 pb-5 pt-1">
      <View
        className="w-16 h-16 rounded-full items-center justify-center mr-3.5"
        style={{ backgroundColor: palette.primarySoft }}
      >
        <User size={28} color={palette.primary} />
      </View>
      <View className="flex-1">
        {isEditing ? (
          <View className="mr-2">
            <TextInput
              value={editFirst}
              onChangeText={setEditFirst}
              placeholder="First name"
              autoFocus
              style={{
                fontFamily: fonts.serif,
                fontSize: 20,
                color: palette.ink,
                borderBottomWidth: 1,
                borderBottomColor: palette.primary,
                paddingVertical: 2,
                marginBottom: 3,
              }}
            />
            <TextInput
              value={editLast}
              onChangeText={setEditLast}
              placeholder="Last name"
              onSubmitEditing={handleSave}
              style={{
                fontFamily: fonts.sansSemibold,
                fontSize: 13,
                color: palette.inkSoft,
                borderBottomWidth: 1,
                borderBottomColor: palette.primary,
                paddingVertical: 2,
              }}
            />
          </View>
        ) : (
          <AppText size={20} style={{ fontFamily: fonts.serif, color: palette.ink, marginBottom: 3 }}>
            {displayName(profile)}
          </AppText>
        )}
        {!isEditing && (
          <AppText size={12.5} style={{ fontFamily: fonts.sans, color: palette.inkSoft }}>
            Account created {accountCreated}
          </AppText>
        )}
      </View>
      <Pressable
        onPress={isEditing ? handleSave : startEditing}
        className="w-9 h-9 rounded-xl items-center justify-center ml-2"
        style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.line }}
        accessibilityRole="button"
        accessibilityLabel={isEditing ? 'Save profile' : 'Edit profile'}
      >
        {isEditing ? <Check size={16} color={palette.sage} /> : <Pencil size={15} color={palette.inkSoft} />}
      </Pressable>
    </View>
  );
}
