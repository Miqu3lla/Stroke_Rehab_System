import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, Pressable, SafeAreaView, ScrollView } from 'react-native';
import { ArrowLeft, LogOut } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import usePatientProfileStore from '../store/usePatientProfileStore';
import useAuthStore from '../store/useAuthStore';
import PatientHeaderProfile from '../components/profile/PatientHeaderProfile';
import ClinicalSummary from '../components/profile/ClinicalSummary';

export default function PatientProfileScreen() {
  const navigation = useNavigation();
  const { profile, loading, error, fetchPatientProfile } = usePatientProfileStore();
  const { logout } = useAuthStore();

  useEffect(() => {
    fetchPatientProfile();
  }, [fetchPatientProfile]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="flex-row items-center px-4 py-4 bg-white border-b border-slate-200">
        <Pressable onPress={() => navigation.goBack()} className="p-2 mr-3 bg-slate-100 rounded-lg">
          <ArrowLeft color="#0f172a" size={24} />
        </Pressable>
        <Text className="text-xl font-bold text-slate-900">Patient Profile</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        {loading ? (
          <ActivityIndicator size="large" color="#0052cc" className="mt-10" />
        ) : error ? (
          <Text className="text-red-500 text-center mt-10">{error}</Text>
        ) : profile ? (
          <View className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6">
            <PatientHeaderProfile profile={profile} />
            <View className="h-px bg-slate-100 my-5" />
            <ClinicalSummary profile={profile} />
          </View>
        ) : null}

        <Pressable 
          onPress={() => logout(navigation)}
          className="bg-red-50 flex-row items-center justify-center p-4 rounded-xl border border-red-100 mt-2"
        >
          <LogOut color="#ef4444" size={20} className="mr-2" />
          <Text className="text-red-500 font-bold text-lg ml-2">Logout</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
