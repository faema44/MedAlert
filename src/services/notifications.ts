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

export async function scheduleReminder(
  medicationId: number,
  medicationName: string,
  dose: string,
  hour: number,
  minute: number,
  withSound: boolean,
): Promise<void> {
  const id = `reminder_${medicationId}_${String(hour).padStart(2,'0')}${String(minute).padStart(2,'0')}`;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: '💊 Hora do medicamento',
      body: `${medicationName}${dose ? ' — ' + dose : ''}`,
      data: { type: 'reminder', medicationId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: withSound ? REMINDER_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
    },
  });
}

export async function cancelReminderByTime(medicationId: number, time: string): Promise<void> {
  const [h, m] = time.split(':');
  const id = `reminder_${medicationId}_${h.padStart(2,'0')}${m.padStart(2,'0')}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
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
