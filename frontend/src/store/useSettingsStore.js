import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import {
  ensureNotificationPermission,
  scheduleSessionReminder,
  cancelSessionReminder,
  scheduleProgressRecap,
  cancelProgressRecap,
} from '../lib/notifications';

// Multiplier applied to AppText's base font size for the "Text size" toggle.
export const TEXT_SCALE_MULTIPLIER = { base: 1, large: 1.15 };

// A shared AsyncStorage key would let one patient's toggles/text-scale leak
// into another patient's session on a device used by more than one patient
// (e.g. a clinic tablet). Namespace the key by the signed-in patient's id.
const scopedKey = async (name) => {
  const { data: { session } } = await supabase.auth.getSession();
  return `${name}:${session?.user?.id || 'anonymous'}`;
};

const scopedStorage = {
  getItem: async (name) => AsyncStorage.getItem(await scopedKey(name)),
  setItem: async (name, value) => AsyncStorage.setItem(await scopedKey(name), value),
  removeItem: async (name) => AsyncStorage.removeItem(await scopedKey(name)),
};

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
      storage: createJSONStorage(() => scopedStorage),
    }
  )
);

// Reconcile the OS-level schedule to whichever patient's state just loaded -
// runs after cold-start hydration AND after the manual rehydrate() below, so
// a switched-in patient's reminders actually get (re)scheduled, not just
// shown as "on" in the UI. Silently turns a toggle back off if permission
// isn't granted for this device/patient, rather than lying about it.
useSettingsStore.persist.onFinishHydration(async (state) => {
  const updates = {};

  if (state.sessionReminders) {
    if (await ensureNotificationPermission()) await scheduleSessionReminder();
    else updates.sessionReminders = false;
  } else {
    await cancelSessionReminder().catch(() => {});
  }

  if (state.progressRecap) {
    if (await ensureNotificationPermission()) await scheduleProgressRecap();
    else updates.progressRecap = false;
  } else {
    await cancelProgressRecap().catch(() => {});
  }

  if (Object.keys(updates).length) useSettingsStore.setState(updates);
});

// Only react to an actual user-id change, not every token refresh - reset
// then rehydrate from the new patient's scoped key (triggers the sync above).
let lastUserId;
supabase.auth.onAuthStateChange((_event, session) => {
  const nextUserId = session?.user?.id ?? null;
  if (lastUserId === undefined) {
    lastUserId = nextUserId;
    return;
  }
  if (nextUserId === lastUserId) return;
  lastUserId = nextUserId;

  useSettingsStore.setState({ sessionReminders: false, progressRecap: false, textScale: 'base' });
  useSettingsStore.persist.rehydrate();
});

export default useSettingsStore;
