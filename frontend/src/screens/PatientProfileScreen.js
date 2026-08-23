import React, { useEffect } from 'react';
import { View, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, LogOut } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import usePatientProfileStore from '../store/usePatientProfileStore';
import useAuthStore from '../store/useAuthStore';
import PatientHeaderProfile from '../components/profile/PatientHeaderProfile';
import ClinicalSummary from '../components/profile/ClinicalSummary';
import PreferencesPanel from '../components/profile/PreferencesPanel';
import SupportPanel from '../components/profile/SupportPanel';
import AboutPanel from '../components/profile/AboutPanel';
import AppText from '../components/ui/AppText';
import { palette } from '../constants/palette';
import { fonts } from '../constants/fonts';

function SectionTitle({ children }) {
  return (
    <AppText size={15.5} style={{ fontFamily: fonts.serif, color: palette.ink, marginBottom: 12 }}>
      {children}
    </AppText>
  );
}

export default function PatientProfileScreen() {
  const navigation = useNavigation();
  const { profile, loading, error, fetchPatientProfile } = usePatientProfileStore();
  const { logout } = useAuthStore();

  useEffect(() => {
    fetchPatientProfile();
  }, [fetchPatientProfile]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.canvas }} edges={['top']}>
      <View className="flex-row items-center gap-3 px-5 pt-2 pb-4">
        <Pressable
          onPress={() => navigation.goBack()}
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: palette.primarySoft }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={18} color={palette.primary} />
        </Pressable>
        <AppText size={19} style={{ fontFamily: fonts.serif, color: palette.ink }}>
          Patient Profile
        </AppText>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {loading ? (
          <ActivityIndicator size="large" color={palette.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <AppText size={14} style={{ fontFamily: fonts.sans, color: palette.danger, textAlign: 'center', marginTop: 40 }}>
            {error}
          </AppText>
        ) : profile ? (
          <>
            <PatientHeaderProfile profile={profile} />

            <View className="px-5 mb-3">
              <SectionTitle>Clinical summary</SectionTitle>
            </View>
            <View className="px-5 mb-6">
              <ClinicalSummary profile={profile} />
            </View>

            <View className="px-5 mb-3">
              <SectionTitle>Preferences</SectionTitle>
            </View>
            <View className="px-5 mb-6">
              <PreferencesPanel />
            </View>

            <View className="px-5 mb-3">
              <SectionTitle>Support</SectionTitle>
            </View>
            <View className="px-5 mb-6">
              <SupportPanel />
            </View>

            <View className="px-5 mb-3">
              <SectionTitle>About</SectionTitle>
            </View>
            <View className="px-5 mb-6">
              <AboutPanel />
            </View>
          </>
        ) : null}

        <Pressable
          onPress={() => logout(navigation)}
          className="flex-row items-center justify-center gap-2 mx-5 p-4 rounded-2xl"
          style={{ backgroundColor: palette.dangerSoft, borderWidth: 1, borderColor: palette.dangerSoft }}
        >
          <LogOut size={18} color={palette.danger} />
          <AppText size={14} style={{ fontFamily: fonts.sansBold, color: palette.danger }}>
            Log out
          </AppText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
