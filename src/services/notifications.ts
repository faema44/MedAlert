import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Profile, Medication } from '../types';
import { postMedNotification, cancelMedNotification } from './medNotification';

const CHANNEL_ID = 'medalert_emergency_v3';
const NOTIF_ID = 'emergency';
const REMINDER_SOUND_CHANNEL = 'medalert_reminder_sound';
const REMINDER_SILENT_CHANNEL = 'medalert_reminder_silent';

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Clean up channels from previous installs
  for (const old of ['medalert_emergency', 'medalert_emergency_v2', 'medalert_lockscreen', 'medalert_detail']) {
    await Notifications.deleteNotificationChannelAsync(old).catch(() => {});
  }

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Alerta de Emergência Médica',
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    sound: null,
    vibrationPattern: null,
    enableLights: false,
    showBadge: false,
  });

  await Notifications.setNotificationChannelAsync(REMINDER_SOUND_CHANNEL, {
    name: 'Lembrete com Som',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });

  await Notifications.setNotificationChannelAsync(REMINDER_SILENT_CHANNEL, {
    name: 'Lembrete Silencioso',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: null,
  });
}

export async function requestPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function clearEmergency(): Promise<void> {
  try { cancelMedNotification(); } catch {}
  for (const id of [NOTIF_ID, 'emergency_lockscreen', 'emergency_detail', 'emergency_persistent']) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
    try { await Notifications.dismissNotificationAsync(id); } catch {}
  }
}

export async function updateEmergencyNotification(
  profile: Profile | null,
  medications: Medication[]
): Promise<void> {
  await clearEmergency();

  if (!profile?.name) return;

  // bigText: ficha completa, exibida ao expandir (▼)
  const lines: string[] = [`👤 ${profile.name}`];
  if (profile.blood_type && profile.blood_type !== 'Desconhecido') lines.push(`🩸 ${profile.blood_type}`);
  if (medications.length) {
    lines.push('');
    medications.slice(0, 8).forEach(m => {
      const label = m.commercial_name ? `${m.generic_name} (${m.commercial_name})` : m.generic_name;
      lines.push(`${m.is_critical ? '⚠️' : '💊'} ${label}${m.dose ? '  ' + m.dose : ''}`);
    });
    if (medications.length > 8) lines.push(`  +${medications.length - 8} outros`);
  }
  if (profile.allergies) { lines.push(''); lines.push(`🚫 ${profile.allergies}`); }
  if (profile.notes)     { lines.push(''); lines.push(`📋 ${profile.notes}`); }

  // contentText vazio → collapsed mostra só o título "Informações Médicas"
  // bigText completo → expanded (▼) mostra ficha médica
  try {
    postMedNotification('✚  Informações Médicas', '', lines.join('\n'), CHANNEL_ID);
  } catch {}
}

export async function cancelEmergencyNotification(): Promise<void> {
  await clearEmergency();
}

function reminderContent(medicationName: string, dose: string, medicationId: number) {
  return {
    title: '💊 Hora do medicamento',
    body: `${medicationName}${dose ? ' — ' + dose : ''}`,
    data: { type: 'reminder', medicationId },
  };
}

function timePart(hour: number, minute: number) {
  return `${String(hour).padStart(2,'0')}${String(minute).padStart(2,'0')}`;
}

export async function scheduleReminder(
  medicationId: number,
  medicationName: string,
  dose: string,
  hour: number,
  minute: number,
  withSound: boolean,
): Promise<void> {
  const id = `reminder_${medicationId}_${timePart(hour, minute)}`;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: reminderContent(medicationName, dose, medicationId),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: withSound ? REMINDER_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
    },
  });
}

export async function scheduleReminderWeekly(
  medicationId: number,
  medicationName: string,
  dose: string,
  weekdays: number[],  // array: 1=Dom, 2=Seg … 7=Sáb
  hour: number,
  minute: number,
  withSound: boolean,
): Promise<void> {
  for (const wd of weekdays) {
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_w${wd}_${timePart(hour, minute)}`,
      content: reminderContent(medicationName, dose, medicationId),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: wd,
        hour,
        minute,
        channelId: withSound ? REMINDER_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
      },
    });
  }
}

export async function scheduleReminderMonthly(
  medicationId: number,
  medicationName: string,
  dose: string,
  days: number[],  // array of days-of-month (1-28)
  hour: number,
  minute: number,
  withSound: boolean,
): Promise<void> {
  for (const day of days) {
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_m${day}_${timePart(hour, minute)}`,
      content: reminderContent(medicationName, dose, medicationId),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: true,
        day,
        hour,
        minute,
        channelId: withSound ? REMINDER_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
      } as any,
    });
  }
}

export async function scheduleReminderEveryNMonths(
  medicationId: number,
  medicationName: string,
  dose: string,
  intervalMonths: number,
  dayOfMonth: number,
  hour: number,
  minute: number,
  withSound: boolean,
): Promise<void> {
  const tp = timePart(hour, minute);
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
  if (next <= now) next.setMonth(next.getMonth() + intervalMonths);
  for (let i = 0; i < 12; i++) {
    const dateStr = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_nm_${dateStr}_${tp}`,
      content: reminderContent(medicationName, dose, medicationId),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: false,
        year: next.getFullYear(),
        month: next.getMonth() + 1,
        day: next.getDate(),
        hour,
        minute,
        channelId: withSound ? REMINDER_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
      } as any,
    });
    next.setMonth(next.getMonth() + intervalMonths);
  }
}

export async function cancelReminderByTime(
  medicationId: number,
  time: string,
  period: string = 'day',
): Promise<void> {
  const [hh, mm] = time.split(':');
  const tp = `${hh.padStart(2, '0')}${mm.padStart(2, '0')}`;

  if (period === 'day') {
    await Notifications.cancelScheduledNotificationAsync(`reminder_${medicationId}_${tp}`).catch(() => {});
  } else if (period.startsWith('week:')) {
    for (const wd of period.split(':')[1].split(',').map(Number)) {
      await Notifications.cancelScheduledNotificationAsync(`reminder_${medicationId}_w${wd}_${tp}`).catch(() => {});
    }
  } else if (period.startsWith('month:')) {
    for (const d of period.split(':')[1].split(',').map(Number)) {
      await Notifications.cancelScheduledNotificationAsync(`reminder_${medicationId}_m${d}_${tp}`).catch(() => {});
    }
  } else if (period.startsWith('nmonths:')) {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter(n => n.identifier.startsWith(`reminder_${medicationId}_nm_`) && n.identifier.endsWith(`_${tp}`))
        .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    );
  }
}

export async function cancelAllRemindersForMedication(medicationId: number): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(n => n.identifier.startsWith(`reminder_${medicationId}_`))
      .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
  );
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isReminder = notification.request.content.data?.type === 'reminder';
    return {
      shouldShowBanner: true,
      shouldPlaySound: isReminder,
      shouldSetBadge: false,
      shouldShowList: true,
    };
  },
});
