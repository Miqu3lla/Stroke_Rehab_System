import React, { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { User, Pencil, Check } from 'lucide-react-native';
import usePatientProfileStore from '../../store/usePatientProfileStore';

export default function PatientHeaderProfile({ profile }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(profile?.name || 'Patient Name');
  const { updatePatientName } = usePatientProfileStore();

  const handleSave = async () => {
    if (editName.trim() && editName !== profile?.name) {
      await updatePatientName(editName.trim());
    }
    setIsEditing(false);
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
        <View className="flex-row items-center justify-between">
          {isEditing ? (
            <TextInput
              value={editName}
              onChangeText={setEditName}
              className="flex-1 text-xl font-bold text-slate-900 border-b border-blue-600 mr-2 p-0"
              autoFocus
              onSubmitEditing={handleSave}
            />
          ) : (
            <Text className="text-xl font-bold text-slate-900 flex-1">{profile?.name || 'Patient Name'}</Text>
          )}
          
          <Pressable 
            onPress={isEditing ? handleSave : () => { setEditName(profile?.name || 'Patient Name'); setIsEditing(true); }}
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
