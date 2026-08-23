// On-device reminder scheduling for the Profile "Preferences" toggles.
// Entirely local (OS-owned schedule) - no backend/push server involved.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const SESSION_REMINDER_ID = 'session-reminder';
const PROGRESS_RECAP_ID = 'progress-recap';

// Foreground behavior: still show the banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('reminders', {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch((err) => console.error('Failed to set up notification channel:', err));
}

// Requests permission only if not already granted/denied - avoids
// re-prompting every time the user flips the toggle.
export async function ensureNotificationPermission() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleSessionReminder() {
  await Notifications.scheduleNotificationAsync({
    identifier: SESSION_REMINDER_ID,
    // Deliberately generic wording - lock-screen notifications are visible
    // to anyone near the phone, so avoid naming the app's health context.
    content: {
      title: 'TheraMotion',
      body: 'You have something waiting for you today.',
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
  });
}

export async function cancelSessionReminder() {
  await Notifications.cancelScheduledNotificationAsync(SESSION_REMINDER_ID);
}

export async function scheduleProgressRecap() {
  await Notifications.scheduleNotificationAsync({
    identifier: PROGRESS_RECAP_ID,
    content: {
      title: 'TheraMotion',
      body: 'Your weekly summary is ready to view.',
    },
    // weekday 1 = Sunday per expo-notifications' calendar trigger.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 9, minute: 0 },
  });
}

export async function cancelProgressRecap() {
  await Notifications.cancelScheduledNotificationAsync(PROGRESS_RECAP_ID);
}
