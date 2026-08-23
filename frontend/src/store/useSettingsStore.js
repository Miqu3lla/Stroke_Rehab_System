import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import {
  ensureNotificationPermission,
  scheduleSessionReminder,
  cancelSessionReminder,
  scheduleProgressRecap,
  cancelProgressRecap,
} from '../lib/notifications';

// Multiplier applied to AppText's base font size for the "Text size" toggle.
export const TEXT_SCALE_MULTIPLIER = { base: 1, large: 1.15 };

// Patient-local preferences (device only - nothing here is synced to the
// backend). Persisted so toggles survive app restarts.
const useSettingsStore = create(
  persist(
    (set, get) => ({
      sessionReminders: false,
      progressRecap: false,
      textScale: 'base',

      toggleSessionReminders: async () => {
        const next = !get().sessionReminders;
        try {
          if (next) {
            const granted = await ensureNotificationPermission();
            if (!granted) {
              Alert.alert(
                'Notifications disabled',
                'Enable notifications for TheraMotion in your device settings to turn on reminders.'
              );
              return;
            }
            await scheduleSessionReminder();
          } else {
            await cancelSessionReminder();
          }
          set({ sessionReminders: next });
        } catch (err) {
          // Leave the toggle at its prior value - it reflects the last
          // OS state we actually confirmed, not what the user tapped.
          console.error('Failed to update session reminder:', err);
          Alert.alert('Something went wrong', "Couldn't update session reminders. Please try again.");
        }
      },

      toggleProgressRecap: async () => {
        const next = !get().progressRecap;
        try {
          if (next) {
            const granted = await ensureNotificationPermission();
            if (!granted) {
              Alert.alert(
                'Notifications disabled',
                'Enable notifications for TheraMotion in your device settings to turn on the weekly recap.'
              );
              return;
            }
            await scheduleProgressRecap();
          } else {
            await cancelProgressRecap();
          }
          set({ progressRecap: next });
        } catch (err) {
          console.error('Failed to update progress recap:', err);
          Alert.alert('Something went wrong', "Couldn't update the weekly recap. Please try again.");
        }
      },

      setTextScale: (scale) => set({ textScale: scale }),
    }),
    {
      name: 'theramotion-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export default useSettingsStore;
