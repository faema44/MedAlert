import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Profile, Medication, MedicationReminder, ActivityReminder } from '../types';
import { postMedNotification, cancelMedNotification, postSimpleNotification, cancelSimpleNotification } from './medNotification';
import { getRemindersForMedication, getMedications, getActivities, getRemindersForActivity, getContacts, getKV, setKV, addMedicationLowStockLog } from '../database/db';

const CHANNEL_ID = 'medalert_emergency_v5';
const NOTIF_ID = 'emergency';
const EMERGENCY_SIGNATURE_KV = 'emergency_notif_signature';
const NEXT_MED_CHANNEL = 'medalert_next_med_v1';
// Notificação nativa (NotificationManager.notify), não Expo — precisa de id numérico
const NEXT_MED_NATIVE_ID = 1002;
const NEXT_MED_SIGNATURE_KV = 'next_med_notif_signature';
const REMINDER_SOUND_CHANNEL = 'medalert_reminder_sound';
const REMINDER_SILENT_CHANNEL = 'medalert_reminder_silent';
const REMINDER_CATEGORY = 'reminder_action';
// v2: PUBLIC lock-screen visibility + action buttons
const MED_SOUND_CHANNEL = 'medalert_med_sound_v2';
// HIGH importance sem som — usado quando home_reminder=1 e with_sound=false para exibir heads-up
const MED_SILENT_HEADSUP_CHANNEL = 'medalert_med_silent_headsup_v1';
const ACTIVITY_SOUND_CHANNEL = 'medalert_activity_sound_v2';
const APPT_SOUND_CHANNEL = 'medalert_appt_sound_v1';

const MED_ACTION_CATEGORY = 'med_action';
const ACTIVITY_MEASURE_CATEGORY = 'activity_measure_action';
const ACTIVITY_BASIC_CATEGORY = 'activity_basic_action';
const MEASURE_ACTIVITY_TYPES = ['bp', 'glucose', 'weight'];
const TREATMENT_ENDED_CHANNEL = 'medalert_treatment_ended_v1';
const TREATMENT_ENDED_CATEGORY = 'treatment_ended_action';
const LOW_STOCK_CATEGORY = 'low_stock_action';

export async function setupReminderCategory(): Promise<void> {
  // Categories don't work in Expo Go (SDK 53+); work normally in production APK/AAB.
  try {
    await Notifications.setNotificationCategoryAsync(MED_ACTION_CATEGORY, [
      { identifier: 'TOOK', buttonTitle: 'Tomei',       options: { opensAppToForeground: false } },
      { identifier: 'SKIP', buttonTitle: 'Não tomei',  options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(ACTIVITY_MEASURE_CATEGORY, [
      { identifier: 'MEASURE',  buttonTitle: '📋 Medir',      options: { opensAppToForeground: true  } },
      { identifier: 'SNOOZE',   buttonTitle: '⏱ Adiar 5 min', options: { opensAppToForeground: false } },
      { identifier: 'SKIP_ACT', buttonTitle: 'Pular',          options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(ACTIVITY_BASIC_CATEGORY, [
      { identifier: 'DONE',     buttonTitle: '✓ Realizei',    options: { opensAppToForeground: false } },
      { identifier: 'SNOOZE',   buttonTitle: '⏱ Adiar 5 min', options: { opensAppToForeground: false } },
      { identifier: 'SKIP_ACT', buttonTitle: 'Pular',          options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(TREATMENT_ENDED_CATEGORY, [
      { identifier: 'END_OK', buttonTitle: 'OK', options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(LOW_STOCK_CATEGORY, [
      { identifier: 'STOCK_OK', buttonTitle: 'OK', options: { opensAppToForeground: false } },
    ]);
  } catch {
    // Silently ignore in Expo Go
  }
}

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Clean up channels from previous installs (v1 med/activity channels get PUBLIC replacements)
  for (const old of [
    'medalert_emergency', 'medalert_emergency_v2', 'medalert_emergency_v3', 'medalert_emergency_v4', 'medalert_lockscreen', 'medalert_detail',
    'medalert_med_sound_v1', 'medalert_activity_sound_v1',
  ]) {
    await Notifications.deleteNotificationChannelAsync(old).catch(() => {});
  }

  // MAX: com DEFAULT (v4) o Samsung rebaixava o card ongoing para a fileira de
  // ícones da tela de bloqueio quando havia outras notificações. O banner heads-up
  // repetido é evitado por setOnlyAlertOnce(true) no módulo nativo + atualização
  // in-place (mesmo NOTIF_ID, sem cancelar antes) — só alerta quando a notificação
  // não está na tela (primeira ativação, pós-boot).
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

  await Notifications.setNotificationChannelAsync(MED_SOUND_CHANNEL, {
    name: 'Lembrete de Medicamento',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'med_reminder',
    vibrationPattern: [0, 250, 150, 250],
  });

  await Notifications.setNotificationChannelAsync(ACTIVITY_SOUND_CHANNEL, {
    name: 'Lembrete de Atividade',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'activity_reminder',
  });

  await Notifications.setNotificationChannelAsync(APPT_SOUND_CHANNEL, {
    name: 'Lembrete de Consulta',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'appt_reminder',
    vibrationPattern: [0, 300, 100, 300],
  });

  await Notifications.setNotificationChannelAsync(TREATMENT_ENDED_CHANNEL, {
    name: 'Tratamento Encerrado',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: null,
  });

  // Banner separado do "próximo medicamento" — DEFAULT (sem heads-up/som),
  // PUBLIC para aparecer completo na tela de bloqueio.
  await Notifications.setNotificationChannelAsync(NEXT_MED_CHANNEL, {
    name: 'Próximo Medicamento',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: null,
    showBadge: false,
  });

  await Notifications.setNotificationChannelAsync(MED_SILENT_HEADSUP_CHANNEL, {
    name: 'Lembrete de Medicamento (silencioso)',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: null,
    vibrationPattern: [0, 250, 150, 250],
  });

}

export async function requestPermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export interface ReminderInfo {
  label: string;   // "hoje às 14:00" | "amanhã às 08:00" | "20/06 às 10:00"
  sortMs: number;  // epoch ms — used for sorting
}

export function nextReminderInfo(reminders: MedicationReminder[]): ReminderInfo | null {
  const now = new Date();
  let bestMs = Infinity;

  for (const r of reminders) {
    if (!r.is_active) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    let candidate: Date | null = null;

    if (!r.period || r.period === 'day') {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      candidate = t > now ? t : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m);

    } else if (r.period.startsWith('week:')) {
      const wds = r.period.split(':')[1].split(',').map(Number);
      const todayWd = now.getDay() + 1; // 1=Dom…7=Sáb
      let min: Date | null = null;
      for (const wd of wds) {
        const diff = (wd - todayWd + 7) % 7;
        if (diff === 0) {
          const c = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
          const pick = c > now ? c : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, h, m);
          if (!min || pick < min) min = pick;
        } else {
          const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, h, m);
          if (!min || c < min) min = c;
        }
      }
      candidate = min;

    } else if (r.period.startsWith('month:')) {
      const days = r.period.split(':')[1].split(',').map(Number);
      let min: Date | null = null;
      for (const d of days) {
        const c = new Date(now.getFullYear(), now.getMonth(), d, h, m);
        const pick = c > now ? c : new Date(now.getFullYear(), now.getMonth() + 1, d, h, m);
        if (!min || pick < min) min = pick;
      }
      candidate = min;

    } else if (r.period.startsWith('nmonths:')) {
      const [, nStr, dStr] = r.period.split(':');
      const n = parseInt(nStr, 10);
      const d = parseInt(dStr, 10);
      let c = new Date(now.getFullYear(), now.getMonth(), d, h, m);
      if (c <= now) c = new Date(now.getFullYear(), now.getMonth() + n, d, h, m);
      candidate = c;
    }

    if (candidate && candidate.getTime() < bestMs) bestMs = candidate.getTime();
  }

  if (!isFinite(bestMs)) return null;

  const best = new Date(bestMs);
  const hh = String(best.getHours()).padStart(2, '0');
  const mm = String(best.getMinutes()).padStart(2, '0');
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(best.getFullYear(), best.getMonth(), best.getDate()).getTime();
  const diffDays = Math.round((targetDay - today0) / 86400000);
  const dayLabel = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã'
    : `${String(best.getDate()).padStart(2, '0')}/${String(best.getMonth() + 1).padStart(2, '0')}`;

  return { label: `${dayLabel} às ${hh}:${mm}`, sortMs: bestMs };
}

async function clearEmergency(): Promise<void> {
  try { cancelMedNotification(); } catch {}
  try { cancelSimpleNotification(NEXT_MED_NATIVE_ID); } catch {}
  for (const id of [NOTIF_ID, 'emergency_lockscreen', 'emergency_detail', 'emergency_persistent']) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
    try { await Notifications.dismissNotificationAsync(id); } catch {}
  }
}

// Banner separado com o próximo medicamento de hoje. Notificação nativa (não Expo) para
// poder usar setShowWhen(false) — sem isso o Android sempre mostra o carimbo de quando
// a notificação foi postada, que confunde com o horário do remédio escrito no corpo.
// Ongoing (não dá para dispensar por engano); atualizada in-place pelo mesmo id; some
// quando não há mais dose hoje. Assinatura própria em KV evita repost igual.
async function updateNextMedNotification(
  nextMed: { name: string; label: string; critical: boolean } | null
): Promise<void> {
  const signature = nextMed ? `${nextMed.name}|${nextMed.label}|${nextMed.critical}` : '';
  const lastSignature = await getKV(NEXT_MED_SIGNATURE_KV).catch(() => null);
  if (lastSignature === signature) return;

  if (nextMed) {
    postSimpleNotification(
      'Próximo medicamento',
      `${nextMed.critical ? '⚠️' : '💊'} ${nextMed.name} · ${nextMed.label}`,
      NEXT_MED_CHANNEL,
      NEXT_MED_NATIVE_ID,
    );
  } else {
    cancelSimpleNotification(NEXT_MED_NATIVE_ID);
  }
  await setKV(NEXT_MED_SIGNATURE_KV, signature).catch(() => {});
}

export function calculateAge(birthDate: string): number | null {
  const match = birthDate?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, mo, y] = match;
  const birth = new Date(Number(y), Number(mo) - 1, Number(d));
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear = now.getMonth() > birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age--;
  return age >= 0 ? age : null;
}

// Linhas do card de emergência (medicamentos, perfil, contatos) — mesmo conteúdo
// usado no bigText da notificação da tela de bloqueio, exportado para a Agenda/tela
// de Emergência conseguir mostrar uma prévia idêntica.
export async function buildEmergencyCardLines(profile: Profile, medications: Medication[]): Promise<string[]> {
  const sortedMeds = [...medications].sort((a, b) => {
    if (a.is_critical !== b.is_critical) return a.is_critical ? -1 : 1;
    const nameA = a.commercial_name || a.generic_name;
    const nameB = b.commercial_name || b.generic_name;
    return nameA.localeCompare(nameB, 'pt');
  });
  const meds8 = sortedMeds.slice(0, 8);

  const lines: string[] = [];
  if (meds8.length) {
    meds8.forEach(m => {
      const name = m.commercial_name ? m.commercial_name : m.generic_name;
      lines.push(`${m.is_critical ? '⚠️' : '💊'} ${name}${m.dose ? '  ' + m.dose : ''}`);
    });
    if (medications.length > 8) lines.push(`+${medications.length - 8} medicamentos no app`);
  }

  if (lines.length) lines.push('');
  const bloodSuffix = (profile.blood_type && profile.blood_type !== 'Desconhecido') ? `  🩸 ${profile.blood_type}` : '';
  const age = calculateAge(profile.birth_date);
  const ageSuffix = age != null ? `  ${age}A` : '';
  lines.push(`👤 ${profile.name}${bloodSuffix}${ageSuffix}`);
  if (profile.allergies) lines.push(`Alergia: ${profile.allergies}`);
  if (profile.notes)     lines.push(`📋 ${profile.notes}`);

  const lockContacts = (await getContacts().catch(() => [])).filter(c => c.show_on_lock);
  if (lockContacts.length) {
    lines.push('');
    lockContacts.forEach(c => {
      const firstName = c.name.split(' ')[0];
      lines.push(`📞 ${firstName}: ${c.phone}`);
    });
  }

  return lines;
}

export async function updateEmergencyNotification(
  profile: Profile | null,
  medications: Medication[]
): Promise<void> {
  if (!profile?.name) {
    await clearEmergency();
    await setKV(EMERGENCY_SIGNATURE_KV, '').catch(() => {});
    await setKV(NEXT_MED_SIGNATURE_KV, '').catch(() => {});
    return;
  }

  // Ordena: críticos primeiro, depois alfabético pelo nome principal
  const sortedMeds = [...medications].sort((a, b) => {
    if (a.is_critical !== b.is_critical) return a.is_critical ? -1 : 1;
    const nameA = a.commercial_name || a.generic_name;
    const nameB = b.commercial_name || b.generic_name;
    return nameA.localeCompare(nameB, 'pt');
  });
  const meds8 = sortedMeds.slice(0, 8);

  // Carrega lembretes de cada medicamento para mostrar próximo horário
  const medReminders = meds8.length
    ? await Promise.all(meds8.map(m => getRemindersForMedication(m.id).catch(() => [] as MedicationReminder[])))
    : [];

  // Título fixo — não expõe nome/tipo sanguíneo/idade na notificação recolhida.
  // Esses dados só aparecem quando o usuário expande manualmente (privacidade).
  const title = 'Informações Médicas';

  // Próximo lembrete do dia — vai para um banner separado (updateNextMedNotification),
  // fora da ficha fixa de emergência.
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const upcoming: { sortMs: number; name: string; label: string; critical: boolean }[] = [];
  meds8.forEach((m, idx) => {
    const info = nextReminderInfo(medReminders[idx] ?? []);
    if (info && info.sortMs <= todayEnd.getTime()) {
      upcoming.push({ name: m.commercial_name?.trim() || m.generic_name, label: info.label, sortMs: info.sortMs, critical: m.is_critical });
    }
  });
  upcoming.sort((a, b) => a.sortMs - b.sortMs);
  const nextMed = upcoming[0] ?? null;
  await updateNextMedNotification(nextMed);

  // Colapsado mostra só o título (privacidade) — dados apenas ao expandir.
  const contentText = '';

  // bigText: ficha expandida, em grupos — medicamentos (lista completa),
  // informações médicas (identificação, alergias, observações) e dados de
  // emergência (contatos) — nessa ordem, sem misturar os grupos.
  const lines = await buildEmergencyCardLines(profile, medications);

  // Só reenvia se o conteúdo realmente mudou. A atualização é in-place (nm.notify
  // com o mesmo id substitui) — NÃO cancelar antes: cancelar zera o estado de
  // "já alertou" e faria o banner heads-up reaparecer a cada repost.
  const bigText = lines.join('\n');
  const signature = `${title}|${contentText}|${bigText}`;
  const lastSignature = await getKV(EMERGENCY_SIGNATURE_KV).catch(() => null);
  if (lastSignature === signature) return;

  try {
    postMedNotification(title, contentText, bigText, CHANNEL_ID);
  } catch {}
  await setKV(EMERGENCY_SIGNATURE_KV, signature).catch(() => {});
}

export async function cancelEmergencyNotification(): Promise<void> {
  await clearEmergency();
  await setKV(EMERGENCY_SIGNATURE_KV, '').catch(() => {});
  await setKV(NEXT_MED_SIGNATURE_KV, '').catch(() => {});
}

// Zera a assinatura no cold start: num aparelho restaurado por backup (Google/manual)
// o banco chega com a assinatura antiga, mas a notificação não está na tela — sem o
// reset, updateEmergencyNotification a consideraria "já postada" e nunca reexibiria.
// Também cobre o Android 14+, onde o usuário pode dispensar notificações ongoing.
// Custo: um repost silencioso por abertura do app (canal DEFAULT, sem som/heads-up).
export async function resetEmergencySignature(): Promise<void> {
  await setKV(EMERGENCY_SIGNATURE_KV, '').catch(() => {});
  await setKV(NEXT_MED_SIGNATURE_KV, '').catch(() => {});
}

export async function dismissNotification(id: string): Promise<void> {
  await Notifications.dismissNotificationAsync(id).catch(() => {});
}

export interface ReminderAlertPayload {
  notificationId: string;
  medicationId: number;
  name: string;
  dose: string;
  repeatInterval: number;
}

export function initReminderListeners(
  onReceived: (data: ReminderAlertPayload) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data;
    if (data?.type !== 'reminder') return;
    const payload: ReminderAlertPayload = {
      notificationId: notification.request.identifier,
      medicationId: data.medicationId as number,
      name: (data.name as string) || (notification.request.content.title ?? ''),
      dose: (data.dose as string) || '',
      repeatInterval: (data.repeatInterval as number) || 0,
    };
    onReceived(payload);
  });
  return () => sub.remove();
}

function reminderContent(medicationName: string, dose: string, medicationId: number, repeatInterval = 0, stockWarning?: string) {
  const bodyBase = dose || 'Hora de tomar o medicamento';
  return {
    title: medicationName,
    body: stockWarning ? `${bodyBase} · ${stockWarning}` : bodyBase,
    data: { type: 'reminder', medicationId, name: medicationName, dose, repeatInterval },
    sticky: true,
    categoryIdentifier: MED_ACTION_CATEGORY,
  };
}

function timePart(hour: number, minute: number) {
  return `${String(hour).padStart(2,'0')}${String(minute).padStart(2,'0')}`;
}

function medChannel(withSound: boolean, homeReminder: boolean): string {
  if (withSound) return MED_SOUND_CHANNEL;
  return homeReminder ? MED_SILENT_HEADSUP_CHANNEL : REMINDER_SILENT_CHANNEL;
}

export async function scheduleReminder(
  medicationId: number,
  medicationName: string,
  dose: string,
  hour: number,
  minute: number,
  withSound: boolean,
  repeatInterval = 0,
  stockWarning?: string,
  homeReminder = false,
): Promise<void> {
  const id = `reminder_${medicationId}_${timePart(hour, minute)}`;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: reminderContent(medicationName, dose, medicationId, repeatInterval, stockWarning),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: medChannel(withSound, homeReminder),
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
  repeatInterval = 0,
  stockWarning?: string,
  homeReminder = false,
): Promise<void> {
  for (const wd of weekdays) {
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_w${wd}_${timePart(hour, minute)}`,
      content: reminderContent(medicationName, dose, medicationId, repeatInterval, stockWarning),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: wd,
        hour,
        minute,
        channelId: medChannel(withSound, homeReminder),
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
  repeatInterval = 0,
  stockWarning?: string,
  homeReminder = false,
): Promise<void> {
  for (const day of days) {
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_m${day}_${timePart(hour, minute)}`,
      content: reminderContent(medicationName, dose, medicationId, repeatInterval, stockWarning),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: true,
        day,
        hour,
        minute,
        channelId: medChannel(withSound, homeReminder),
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
  repeatInterval = 0,
  stockWarning?: string,
  homeReminder = false,
): Promise<void> {
  const tp = timePart(hour, minute);
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
  if (next <= now) next.setMonth(next.getMonth() + intervalMonths);
  for (let i = 0; i < 12; i++) {
    const dateStr = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder_${medicationId}_nm_${dateStr}_${tp}`,
      content: reminderContent(medicationName, dose, medicationId, repeatInterval, stockWarning),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: false,
        year: next.getFullYear(),
        month: next.getMonth() + 1,
        day: next.getDate(),
        hour,
        minute,
        channelId: medChannel(withSound, homeReminder),
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

export async function scheduleRepeatAlarm(
  medicationId: number,
  medicationName: string,
  dose: string,
  intervalMinutes: number,
  withSound: boolean,
): Promise<void> {
  const id = `reminder_repeat_${medicationId}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: reminderContent(medicationName, dose, medicationId, intervalMinutes),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: intervalMinutes * 60,
      channelId: withSound ? MED_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
    },
  });
}

export async function cancelRepeatAlarm(medicationId: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`reminder_repeat_${medicationId}`).catch(() => {});
}

export interface ActivityAlertPayload {
  notificationId: string;
  activityId: number;
  name: string;
  activityType: string;
}

export function initActivityListeners(
  onReceived: (data: ActivityAlertPayload) => void,
): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data;
    if (data?.type !== 'activity') return;
    onReceived({
      notificationId: notification.request.identifier,
      activityId: data.activityId as number,
      name: (data.activityName as string) || notification.request.content.title || '',
      activityType: (data.activityType as string) || 'custom',
    });
  });
  return () => sub.remove();
}

export async function scheduleActivityReminder(
  activityId: number,
  activityName: string,
  hour: number,
  minute: number,
  withSound = true,
  activityType = 'custom',
): Promise<void> {
  const tp = timePart(hour, minute);
  const isMeasure = MEASURE_ACTIVITY_TYPES.includes(activityType);
  await Notifications.scheduleNotificationAsync({
    identifier: `activity_${activityId}_${tp}`,
    content: {
      title: activityName,
      body: isMeasure ? 'Hora de medir' : 'Hora da sua atividade',
      data: { type: 'activity', activityId, activityName, activityType },
      categoryIdentifier: isMeasure ? ACTIVITY_MEASURE_CATEGORY : ACTIVITY_BASIC_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: withSound ? ACTIVITY_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
    },
  });
}

export async function scheduleActivityReminderWeekly(
  activityId: number,
  activityName: string,
  weekdays: number[],
  hour: number,
  minute: number,
  withSound = true,
  activityType = 'custom',
): Promise<void> {
  const tp = timePart(hour, minute);
  const isMeasure = MEASURE_ACTIVITY_TYPES.includes(activityType);
  for (const wd of weekdays) {
    await Notifications.scheduleNotificationAsync({
      identifier: `activity_${activityId}_w${wd}_${tp}`,
      content: {
        title: activityName,
        body: isMeasure ? 'Hora de medir' : 'Hora da sua atividade',
        data: { type: 'activity', activityId, activityName, activityType },
        categoryIdentifier: isMeasure ? ACTIVITY_MEASURE_CATEGORY : ACTIVITY_BASIC_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: wd,
        hour,
        minute,
        channelId: withSound ? ACTIVITY_SOUND_CHANNEL : REMINDER_SILENT_CHANNEL,
      },
    });
  }
}

export async function snoozeActivityReminder(
  activityId: number,
  activityName: string,
  activityType: string,
  snoozeMinutes = 5,
): Promise<void> {
  const isMeasureSnooze = MEASURE_ACTIVITY_TYPES.includes(activityType);
  await Notifications.scheduleNotificationAsync({
    identifier: `snooze_activity_${activityId}_${Date.now()}`,
    content: {
      title: activityName,
      body: 'Lembrete adiado',
      data: { type: 'activity', activityId, activityName, activityType },
      categoryIdentifier: isMeasureSnooze ? ACTIVITY_MEASURE_CATEGORY : ACTIVITY_BASIC_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: snoozeMinutes * 60,
      channelId: ACTIVITY_SOUND_CHANNEL,
    },
  });
}

export async function cancelAllRemindersForActivity(activityId: number): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(n => n.identifier.startsWith(`activity_${activityId}_`))
      .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
  );
}

export async function scheduleAppointmentReminders(
  appointmentId: number,
  doctorName: string,
  date: string,  // "YYYY-MM-DD"
  time: string,  // "HH:MM"
): Promise<void> {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (isNaN(year) || isNaN(hour)) return;

  const apptMs = new Date(year, month - 1, day, hour, minute).getTime();
  const now = Date.now();

  const d1 = new Date(apptMs - 24 * 60 * 60 * 1000);
  if (d1.getTime() > now) {
    await Notifications.scheduleNotificationAsync({
      identifier: `appt_${appointmentId}_d1`,
      content: {
        title: `Consulta amanhã às ${time}`,
        body: `Dr(a). ${doctorName}`,
        data: { type: 'appointment', appointmentId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: false,
        year: d1.getFullYear(),
        month: d1.getMonth() + 1,
        day: d1.getDate(),
        hour: d1.getHours(),
        minute: d1.getMinutes(),
        channelId: APPT_SOUND_CHANNEL,
      } as any,
    }).catch(() => {});
  }

  const h1 = new Date(apptMs - 60 * 60 * 1000);
  if (h1.getTime() > now) {
    await Notifications.scheduleNotificationAsync({
      identifier: `appt_${appointmentId}_h1`,
      content: {
        title: `Consulta em 1 hora`,
        body: `Dr(a). ${doctorName} às ${time}`,
        data: { type: 'appointment', appointmentId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: false,
        year: h1.getFullYear(),
        month: h1.getMonth() + 1,
        day: h1.getDate(),
        hour: h1.getHours(),
        minute: h1.getMinutes(),
        channelId: APPT_SOUND_CHANNEL,
      } as any,
    }).catch(() => {});
  }
}

export async function cancelAppointmentReminders(appointmentId: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`appt_${appointmentId}_d1`).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`appt_${appointmentId}_h1`).catch(() => {});
}

export async function rescheduleRemindersForMedication(
  med: Medication,
  reminders: MedicationReminder[],
  stockWarning?: string,
): Promise<void> {
  const notifName = med.commercial_name?.trim() || med.generic_name;
  const homeReminder = med.home_reminder !== 0;
  for (const r of reminders) {
    if (!r.is_active) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (isNaN(h)) continue;
    if (!r.period || r.period === 'day') {
      await scheduleReminder(med.id, notifName, med.dose, h, m, r.with_sound, r.repeat_interval, stockWarning, homeReminder).catch(() => {});
    } else if (r.period.startsWith('week:')) {
      const wds = r.period.split(':')[1].split(',').map(Number);
      await scheduleReminderWeekly(med.id, notifName, med.dose, wds, h, m, r.with_sound, r.repeat_interval, stockWarning, homeReminder).catch(() => {});
    } else if (r.period.startsWith('month:')) {
      const days = r.period.split(':')[1].split(',').map(Number);
      await scheduleReminderMonthly(med.id, notifName, med.dose, days, h, m, r.with_sound, r.repeat_interval, stockWarning, homeReminder).catch(() => {});
    } else if (r.period.startsWith('nmonths:')) {
      const [, nStr, dStr] = r.period.split(':');
      await scheduleReminderEveryNMonths(med.id, notifName, med.dose, parseInt(nStr), parseInt(dStr), h, m, r.with_sound, r.repeat_interval, stockWarning, homeReminder).catch(() => {});
    }
  }
}

export async function rescheduleAllActiveNotifications(): Promise<void> {
  try {
    const [meds, acts] = await Promise.all([getMedications(), getActivities()]);
    await Promise.all(meds.map(async med => {
      const reminders = await getRemindersForMedication(med.id).catch(() => [] as MedicationReminder[]);
      let stockWarning: string | undefined;
      if (med.stock_quantity != null) {
        const activeDoses = reminders.filter(r => r.is_active).length || 1;
        const daysLeft = Math.floor(med.stock_quantity / (activeDoses * (med.units_per_dose || 1)));
        if (daysLeft <= 3) {
          stockWarning = `⚠️ Estoque: ~${daysLeft}d`;
        }
      }
      await rescheduleRemindersForMedication(med, reminders, stockWarning);
    }));
    await Promise.all(acts.map(async act => {
      const reminders = await getRemindersForActivity(act.id).catch(() => []);
      await rescheduleRemindersForActivity(act.id, act.name, reminders);
    }));
  } catch {}
}

export async function rescheduleRemindersForActivity(
  activityId: number,
  activityName: string,
  reminders: ActivityReminder[],
): Promise<void> {
  for (const r of reminders) {
    if (!r.is_active) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (isNaN(h)) continue;
    const p = r.period ?? 'day';
    if (p.startsWith('week:')) {
      const wds = p.split(':')[1].split(',').map(Number);
      await scheduleActivityReminderWeekly(activityId, activityName, wds, h, m, r.with_sound ?? true).catch(() => {});
    } else {
      await scheduleActivityReminder(activityId, activityName, h, m, r.with_sound ?? true).catch(() => {});
    }
  }
}

export interface NotificationResponseHandlers {
  onMedTook:           (medicationId: number, notifId: string, name: string, dose: string, firedAtMs: number) => void;
  onMedSkip:           (medicationId: number, notifId: string, name: string, dose: string, firedAtMs: number) => void;
  onMedDefault:        (payload: ReminderAlertPayload) => void;
  onActivityDone:      (activityId: number, activityName: string, activityType: string, notifId: string) => void;
  onActivitySnooze:    (activityId: number, activityName: string, activityType: string, notifId: string) => void;
  onActivitySkip:      (activityId: number, activityName: string, activityType: string, notifId: string) => void;
  onActivityMeasure:   (activityId: number, notifId: string) => void;
  onActivityDefault:   (payload: ActivityAlertPayload) => void;
  onTreatmentEndedOk:  (medicationId: number) => void;
}

export function initResponseListeners(handlers: NotificationResponseHandlers): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const { actionIdentifier, notification } = response;
    const data = notification.request.content.data as any;
    const notifId = notification.request.identifier;

    if (data?.type === 'reminder') {
      if (actionIdentifier === 'TOOK') {
        handlers.onMedTook(data.medicationId, notifId, data.name ?? '', data.dose ?? '', notification.date);
      } else if (actionIdentifier === 'SKIP') {
        handlers.onMedSkip(data.medicationId, notifId, data.name ?? '', data.dose ?? '', notification.date);
      } else {
        // Default action: user tapped the notification body (app opens)
        handlers.onMedDefault({
          notificationId: notifId,
          medicationId: data.medicationId,
          name: data.name || notification.request.content.title || '',
          dose: data.dose || '',
          repeatInterval: data.repeatInterval || 0,
        });
      }
    }

    if (data?.type === 'activity') {
      if (actionIdentifier === 'DONE') {
        handlers.onActivityDone(data.activityId, data.activityName, data.activityType, notifId);
      } else if (actionIdentifier === 'SNOOZE') {
        handlers.onActivitySnooze(data.activityId, data.activityName, data.activityType, notifId);
      } else if (actionIdentifier === 'SKIP_ACT') {
        handlers.onActivitySkip(data.activityId, data.activityName, data.activityType, notifId);
      } else if (actionIdentifier === 'MEASURE') {
        handlers.onActivityMeasure(data.activityId, notifId);
      } else {
        // Default action: user tapped the notification body (app opens)
        handlers.onActivityDefault({
          notificationId: notifId,
          activityId: data.activityId,
          name: data.activityName || notification.request.content.title || '',
          activityType: data.activityType || 'custom',
        });
      }
    }

    if (data?.type === 'treatment_ended') {
      if (actionIdentifier === 'END_OK' || actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        handlers.onTreatmentEndedOk(data.medicationId as number);
      }
    }

    // Aviso de estoque baixo é sticky — só o OK (ou toque) remove
    if (data?.type === 'low_stock') {
      dismissNotification(notifId).catch(() => {});
    }
  });
  return () => sub.remove();
}

export async function notifyTreatmentEnded(medicationId: number, medicationName: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: `treatment_ended_${medicationId}`,
    content: {
      title: 'Tratamento encerrado',
      body: `${medicationName} — tratamento concluído. Verifique com seu médico.`,
      data: { type: 'treatment_ended', medicationId, medicationName },
      categoryIdentifier: TREATMENT_ENDED_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: TREATMENT_ENDED_CHANNEL,
    } as any,
  });
}

export async function notifyLowStock(medicationId: number, medicationName: string, daysLeft: number): Promise<void> {
  await addMedicationLowStockLog(medicationId, medicationName, daysLeft).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: `low_stock_${medicationId}`,
    content: {
      title: '💊 Estoque baixo',
      body: `${medicationName} — restam ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''} de doses. Providencie a reposição.`,
      data: { type: 'low_stock', medicationId },
      // Só sai da tela quando o usuário der OK (sticky impede descartar por engano)
      sticky: true,
      categoryIdentifier: LOW_STOCK_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: REMINDER_SOUND_CHANNEL,
    } as any,
  });
}

export async function getLastResponse(): Promise<Notifications.NotificationResponse | null> {
  return Notifications.getLastNotificationResponseAsync().catch(() => null);
}

export async function dismissPresentedForMedication(medicationId: number): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  const toRemove = presented.filter(n => (n.request.content.data as any)?.medicationId === medicationId);
  await Promise.all(toRemove.map(n => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})));
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const t = notification.request.content.data?.type;
    return {
      shouldShowBanner: true,
      shouldPlaySound: t === 'reminder' || t === 'activity',
      shouldSetBadge: false,
      shouldShowList: true,
    };
  },
});
