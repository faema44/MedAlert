import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch, Linking, Dimensions, Alert, TextInput, AppState,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import {
  getProfile, getMedications, getKV, setKV, getContacts,
  getRemindersForMedication, updateAllRemindersSound,
  getActivities, getRemindersForActivity, updateAllActivityRemindersSound,
  getAppointments, addMedicationLog, markMedicationLogTaken, updateMedicationStock, getMedicationLog,
} from '../database/db';

type RootTabs = {
  Home: undefined; Profile: undefined; Medications: undefined;
  Contacts: undefined; Agenda: undefined; Interactions: undefined; History: undefined;
};

import {
  updateEmergencyNotification, cancelEmergencyNotification, nextReminderInfo,
  cancelAllRemindersForMedication, cancelAllRemindersForActivity, cancelRepeatAlarm,
  rescheduleRemindersForMedication, rescheduleRemindersForActivity, notifyLowStock,
  dismissPresentedForMedication,
} from '../services/notifications';
import { Profile, Medication, MedicationReminder, DrugInteraction, ActivityReminder, Appointment, ACTIVITY_PRESETS } from '../types';
import { checkInteractions, isPhytotherapic } from '../utils/drugSearch';

const KV_ALERT_ACTIVE = 'alert_active';

type UnifiedItem = {
  id: number;
  type: 'med' | 'activity' | 'appointment';
  icon: string;
  name: string;
  label: string;
  time: string;
  dayDiff: number;
  sortMs: number;
  isMuted: boolean;
  dose?: string;
  stockQty?: number | null;
  dailyDoses?: number;
  medObj?: Medication;
};

function appointmentInfo(appt: Appointment): { label: string; sortMs: number } | null {
  const [y, mo, d] = appt.date.split('-').map(Number);
  const [h, m] = appt.time.split(':').map(Number);
  if (isNaN(y) || isNaN(h)) return null;
  const apptMs = new Date(y, mo - 1, d, h, m).getTime();
  if (apptMs < Date.now()) return null;
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((new Date(y, mo - 1, d).getTime() - today0) / 86400000);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const dayLabel = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã'
    : `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}`;
  return { label: `${dayLabel} às ${hh}:${mm}`, sortMs: apptMs };
}

function extractTimeDayDiff(sortMs: number): { time: string; dayDiff: number } {
  const d = new Date(sortMs);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return {
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    dayDiff: Math.round((itemDay - today0) / 86400000),
  };
}

function dayLabelForDiff(dayDiff: number, sortMs: number): string {
  if (dayDiff === 0) return 'hoje';
  if (dayDiff === 1) return 'amanhã';
  const d = new Date(sortMs);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDailyInfo(reminders: ActivityReminder[]): { label: string; sortMs: number } | null {
  const now = new Date();
  let bestMs = Infinity;
  for (const r of reminders) {
    if (!r.is_active) continue;
    const [h, m] = r.time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const pick = t > now ? t.getTime() : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m).getTime();
    if (pick < bestMs) bestMs = pick;
  }
  if (!isFinite(bestMs)) return null;
  const best = new Date(bestMs);
  const hh = String(best.getHours()).padStart(2, '0');
  const mm = String(best.getMinutes()).padStart(2, '0');
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((new Date(best.getFullYear(), best.getMonth(), best.getDate()).getTime() - today0) / 86400000);
  return { label: `${diffDays === 0 ? 'hoje' : 'amanhã'} às ${hh}:${mm}`, sortMs: bestMs };
}

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootTabs>>();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showPhoneConfigModal, setShowPhoneConfigModal] = useState(false);
  const [allInteractions, setAllInteractions] = useState<DrugInteraction[]>([]);
  const [showInteractionsModal, setShowInteractionsModal] = useState(false);
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([]);
  const [onboardingStep, setOnboardingStep] = useState<'welcome' | 1 | 2 | 3 | 4 | null>(null);
  const [foregroundAlerts, setForegroundAlerts] = useState<UnifiedItem[]>([]);
  const [fgHModalItem, setFgHModalItem] = useState<UnifiedItem | null>(null);
  const [fgHModalTimeText, setFgHModalTimeText] = useState('');
  const dismissedAlertsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [p, m, alertActive, acts, appts, contacts, welcomeSeen, onboardingDone, skipMeds] = await Promise.all([
      getProfile(), getMedications(), getKV(KV_ALERT_ACTIVE), getActivities(), getAppointments(),
      getContacts(), getKV('onboarding_welcome_seen'), getKV('onboarding_done'), getKV('onboarding_skip_meds'),
    ]);
    setProfile(p);
    setMedications(m);

    if (alertActive === '1' && p?.name) {
      await updateEmergencyNotification(p, m).catch(() => {});
      setNotifActive(true);
    } else {
      setNotifActive(false);
    }

    // Drug interactions
    const seen = new Set<string>();
    const ints: DrugInteraction[] = [];
    const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
    m.forEach(med => {
      const others = m.filter(x => x.id !== med.id).map(x => x.generic_name);
      checkInteractions(med.generic_name, others).forEach(i => {
        if (!seen.has(i.id)) { seen.add(i.id); ints.push(i); }
      });
    });
    ints.sort((a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3));
    setAllInteractions(ints);

    // Build unified items
    const items: UnifiedItem[] = [];

    const medReminders = await Promise.all(m.map(med => getRemindersForMedication(med.id).catch(() => [] as MedicationReminder[])));
    m.forEach((med, idx) => {
      const reminders = medReminders[idx] ?? [];
      if (reminders.length === 0) return;
      const activeReminders = reminders.filter(r => r.is_active);
      const isMuted = activeReminders.length > 0 && activeReminders.every(r => !r.with_sound);
      const info = nextReminderInfo(reminders);
      if (!info) return;
      const { time: medTime, dayDiff: medDayDiff } = extractTimeDayDiff(info.sortMs);
      const dailyDoses = activeReminders.length || 1;
      items.push({
        id: med.id, type: 'med', icon: med.is_critical ? '⚠️' : isPhytotherapic(med.generic_name) ? '🌿' : '💊',
        name: med.commercial_name?.trim() || med.generic_name,
        label: info.label,
        time: medTime,
        dayDiff: medDayDiff,
        sortMs: info.sortMs,
        isMuted,
        dose: med.dose || undefined,
        stockQty: med.stock_quantity,
        dailyDoses,
        medObj: med,
      });
    });

    const actReminders = await Promise.all(acts.map(a => getRemindersForActivity(a.id).catch(() => [] as ActivityReminder[])));
    acts.forEach((act, idx) => {
      const reminders = actReminders[idx] ?? [];
      if (reminders.length === 0) return;
      const activeReminders = reminders.filter(r => r.is_active);
      const isMuted = activeReminders.length > 0 && activeReminders.every(r => !r.with_sound);
      const info = nextDailyInfo(reminders);
      if (!info) return;
      const { time: actTime, dayDiff: actDayDiff } = extractTimeDayDiff(info.sortMs);
      items.push({
        id: act.id, type: 'activity', icon: ACTIVITY_PRESETS[act.type]?.icon ?? '📌',
        name: act.name,
        label: info.label,
        time: actTime,
        dayDiff: actDayDiff,
        sortMs: info.sortMs,
        isMuted,
      });
    });

    appts.forEach(appt => {
      const info = appointmentInfo(appt);
      if (!info) return;
      const docLabel = appt.specialty ? `${appt.doctor_name} · ${appt.specialty}` : appt.doctor_name;
      const { time: apptTime, dayDiff: apptDayDiff } = extractTimeDayDiff(info.sortMs);
      items.push({
        id: appt.id, type: 'appointment', icon: '🩺',
        name: docLabel,
        label: info.label,
        time: apptTime,
        dayDiff: apptDayDiff,
        sortMs: info.sortMs,
        isMuted: false,
      });
    });

    items.sort((a, b) => a.sortMs - b.sortMs);
    setUnifiedItems(items);

    // Single source of truth: query all taken logs (1 year) for cross-location dedup
    const nowD = new Date();
    const nowMins = nowD.getHours() * 60 + nowD.getMinutes();
    const todayWd = nowD.getDay() + 1;
    const todayDate = nowD.getDate();
    const since1y = new Date(nowD); since1y.setFullYear(since1y.getFullYear() - 1); since1y.setHours(0, 0, 0, 0);
    const allLogs = await getMedicationLog({ since_iso: since1y.toISOString() });

    const isSlotTaken = (medId: number, dateStr: string, timeStr: string) => {
      const slotMs = new Date(`${dateStr}T${timeStr}:00`).getTime();
      return allLogs.some(l =>
        l.medication_id === medId && l.taken === 1 &&
        Math.abs(new Date(l.scheduled_at).getTime() - slotMs) < 4 * 60 * 60 * 1000
      );
    };

    const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}-${String(nowD.getDate()).padStart(2,'0')}`;

    // Foreground alerts (today only, past times, not taken, not session-dismissed)
    const overdue: UnifiedItem[] = [];
    m.forEach((med, idx) => {
      if (med.home_reminder === 0) return;
      const reminders = medReminders[idx] ?? [];
      const active = reminders.filter(r => r.is_active);
      const overdueTime = active
        .filter(r => {
          const [h, rm] = r.time.split(':').map(Number);
          if (isNaN(h)) return false;
          const rMins = h * 60 + rm;
          if (!r.period || r.period === 'day') return rMins <= nowMins;
          if (r.period.startsWith('week:')) return r.period.split(':')[1].split(',').map(Number).includes(todayWd) && rMins <= nowMins;
          if (r.period.startsWith('month:')) return r.period.split(':')[1].split(',').map(Number).includes(todayDate) && rMins <= nowMins;
          return false;
        })
        .filter(r => !isSlotTaken(med.id, todayStr, r.time))
        .map(r => r.time).sort()[0];
      if (!overdueTime) return;
      if (dismissedAlertsRef.current.has(`${med.id}_${todayStr}_${overdueTime}`)) return;
      const isMuted = active.length > 0 && active.every(r => !r.with_sound);
      overdue.push({
        id: med.id, type: 'med',
        icon: med.is_critical ? '⚠️' : isPhytotherapic(med.generic_name) ? '🌿' : '💊',
        name: med.commercial_name?.trim() || med.generic_name,
        label: `hoje às ${overdueTime}`,
        time: overdueTime, dayDiff: 0, sortMs: 0, isMuted,
        dose: med.dose || undefined, stockQty: med.stock_quantity,
        dailyDoses: active.length || 1, medObj: med,
      });
    });
    setForegroundAlerts(overdue);

    // Onboarding step logic
    if (!p?.name) {
      setOnboardingStep(welcomeSeen === '1' ? 1 : 'welcome');
    } else if (onboardingDone !== '1') {
      if (contacts.length === 0) {
        setOnboardingStep(2);
      } else if (m.length === 0 && skipMeds !== '1') {
        setOnboardingStep(3);
      } else if (alertActive !== '1') {
        setOnboardingStep(4);
      } else {
        await setKV('onboarding_done', '1');
        setOnboardingStep(null);
      }
    } else {
      setOnboardingStep(null);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Re-check when app returns from background (useFocusEffect doesn't fire in this case)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  // Re-check overdue alerts every 60 s while screen is mounted
  useEffect(() => {
    const timer = setInterval(() => { load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleAlertToggle() {
    if (!profile?.name) {
      return;
    }
    if (notifActive) {
      await cancelEmergencyNotification();
      await setKV(KV_ALERT_ACTIVE, '0');
      setNotifActive(false);
    } else {
      if (!profile) return;
      await updateEmergencyNotification(profile, medications);
      await setKV(KV_ALERT_ACTIVE, '1');
      setNotifActive(true);
    }
  }

  async function handleToggleMute(item: UnifiedItem) {
    // Toggle with_sound: muted → reativa com som; ativo → silencia (sem som)
    // is_active permanece intacto — só o canal de áudio muda
    const newWithSound = item.isMuted; // se estava mudo, novo estado = com som, e vice-versa
    if (item.type === 'med') {
      await updateAllRemindersSound(item.id, newWithSound);
      await cancelAllRemindersForMedication(item.id);
      await cancelRepeatAlarm(item.id);
      const med = medications.find(m => m.id === item.id);
      if (med) {
        const reminders = await getRemindersForMedication(item.id);
        await rescheduleRemindersForMedication(med, reminders.map(r => ({ ...r, with_sound: newWithSound })));
      }
    } else {
      await updateAllActivityRemindersSound(item.id, newWithSound);
      await cancelAllRemindersForActivity(item.id);
      const reminders = await getRemindersForActivity(item.id);
      await rescheduleRemindersForActivity(item.id, item.name, reminders.map(r => ({ ...r, with_sound: newWithSound })));
    }
    load();
  }

  async function handleTomeiHome(item: UnifiedItem, takenAt?: Date) {
    if (!item.medObj) return;
    const med = item.medObj;
    const medDisplayName = med.commercial_name?.trim() || med.generic_name;
    const nowD = new Date();
    const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}-${String(nowD.getDate()).padStart(2,'0')}`;
    const scheduledAt = new Date(`${todayStr}T${item.time}:00`).toISOString();
    const takenAtIso = takenAt ? takenAt.toISOString() : scheduledAt;
    const notifId = `fg_${med.id}_${todayStr}_${item.time.replace(':', '')}`;
    await addMedicationLog({
      medication_id: med.id,
      medication_name: medDisplayName,
      dose: med.dose ?? '',
      notification_id: notifId,
      scheduled_at: scheduledAt,
      taken_at: takenAtIso,
    }).then(() => markMedicationLogTaken(notifId, true)).catch(() => {});
    if (med.stock_quantity != null) {
      const next = Math.max(0, med.stock_quantity - 1);
      await updateMedicationStock(med.id, next);
      const dailyDoses = item.dailyDoses || 1;
      const daysLeft = Math.floor(next / dailyDoses);
      if (daysLeft <= 3) {
        const daysUntilEnd = med.end_date
          ? Math.ceil((new Date(med.end_date + 'T23:59:59').getTime() - Date.now()) / 86400000)
          : Infinity;
        if (daysLeft < daysUntilEnd) notifyLowStock(med.id, medDisplayName, daysLeft).catch(() => {});
      }
      if (next === 0) Alert.alert('Estoque zerado', `O estoque de ${medDisplayName} acabou. Providencie a reposição e ajuste em Medicamentos > Editar card > Controle de Estoque.`);
    }
    dismissPresentedForMedication(med.id).catch(() => {});
    load();
  }

  async function handleWelcomeStart() {
    await setKV('onboarding_welcome_seen', '1');
    setOnboardingStep(1);
  }

  async function handleSkipMeds() {
    await setKV('onboarding_skip_meds', '1');
    setOnboardingStep(4);
  }

  async function handleOnboardingActivateAlert() {
    if (!profile) return;
    await updateEmergencyNotification(profile, medications);
    await setKV(KV_ALERT_ACTIVE, '1');
    setNotifActive(true);
    await setKV('onboarding_done', '1');
    setOnboardingStep(null);
  }

  async function handleSkipAlert() {
    await setKV('onboarding_done', '1');
    setOnboardingStep(null);
  }

  function getArrowLeft(step: 1 | 2 | 3): number {
    // Tab centers for 5 visible tabs (Home=0, Profile=1, Medications=2, Contacts=3, Agenda=4)
    const centers: Record<number, number> = {
      1: SCREEN_W * 0.3,  // Profile
      2: SCREEN_W * 0.7,  // Contacts
      3: SCREEN_W * 0.5,  // Medications
    };
    const balloonMargin = 16;
    const arrowHalf = 7;
    return Math.max(10, Math.min(centers[step] - balloonMargin - arrowHalf, SCREEN_W - 32 - 24));
  }

  const criticalMeds = medications.filter(m => m.is_critical);

  const dayGroups = useMemo(() => {
    const groups = new Map<number, UnifiedItem[]>();
    for (const item of unifiedItems) {
      const list = groups.get(item.dayDiff) ?? [];
      list.push(item);
      groups.set(item.dayDiff, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [unifiedItems]);

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Foreground overdue alerts */}
      {foregroundAlerts.map(alert => (
        <View key={alert.id} style={styles.fgAlertCard}>
          {/* Info row: icon + name + time badge */}
          <View style={styles.fgAlertInfo}>
            <Text style={styles.fgAlertIcon}>{alert.icon}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.fgAlertName} numberOfLines={1}>{alert.name}</Text>
                <View style={styles.fgAlertTimeBadge}>
                  <Text style={styles.fgAlertTimeBadgeText}>{alert.time}</Text>
                </View>
              </View>
              {alert.dose ? <Text style={styles.fgAlertDose}>{alert.dose}</Text> : null}
            </View>
          </View>
          {/* Buttons row */}
          <View style={styles.fgAlertBtns}>
            <TouchableOpacity
              style={styles.fgAlertTomei}
              onPress={async () => {
                await handleTomeiHome(alert);
                dismissedAlertsRef.current.add(`${alert.id}_${todayDateStr()}_${alert.time}`);
                setForegroundAlerts(prev => prev.filter(a => a.id !== alert.id));
              }}
            >
              <Text style={styles.fgAlertTomeiText}>✓ No horário</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fgAlertOutro}
              onPress={() => { setFgHModalTimeText(''); setFgHModalItem(alert); }}
            >
              <Text style={styles.fgAlertOutroText}>⏰ Outro</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fgAlertPular}
              onPress={() => {
                dismissedAlertsRef.current.add(`${alert.id}_${todayDateStr()}_${alert.time}`);
                setForegroundAlerts(prev => prev.filter(a => a.id !== alert.id));
              }}
            >
              <Text style={styles.fgAlertPularText}>Dispensar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* Alert status chip + Hist button */}
      <View style={styles.alertRow}>
        <TouchableOpacity style={[styles.alertChip, { flex: 1 }]} activeOpacity={0.7} onPress={() => setShowAlertModal(true)}>
          <View style={[styles.statusDot, notifActive ? styles.dotActive : styles.dotInactive]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alertChipText, { color: notifActive ? '#1a6b3a' : '#C0392B' }]}>
              {notifActive ? 'Alerta ativado' : 'Alerta desativado'}
            </Text>
            {!notifActive && (
              <Text style={styles.alertChipHint}>Toque para ativar a tela de bloqueio</Text>
            )}
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.histBtn}
          onPress={() => (navigation as any).navigate('History')}
        >
          <Text style={styles.histBtnText}>📋 Hist</Text>
        </TouchableOpacity>
      </View>

      {/* Alert modal */}
      <Modal visible={showAlertModal} animationType="slide" transparent onRequestClose={() => setShowAlertModal(false)}>
        <View style={styles.intModalOverlay}>
          <ScrollView style={styles.alertModalBox} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            <Text style={styles.alertModalTitle}>Alerta de Emergência</Text>
            <View style={styles.alertToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertToggleLabel}>{notifActive ? 'Ativado' : 'Desativado'}</Text>
                <Text style={styles.alertToggleHint}>
                  {notifActive ? 'Visível na tela de bloqueio' : 'Toque para ativar'}
                </Text>
              </View>
              <Switch
                value={notifActive}
                onValueChange={handleAlertToggle}
                trackColor={{ true: '#1C3F7A', false: '#ccc' }}
                thumbColor="#fff"
              />
            </View>
            <Text style={styles.alertModalSection}>Para que serve</Text>
            <Text style={styles.alertModalBody}>
              Exibe suas informações médicas — medicamentos, doses e contatos de emergência — na tela de bloqueio do celular, sem precisar desbloquear.
            </Text>
            <Text style={styles.alertModalSection}>Como configurar o celular</Text>
            {[
              'Abra as Configurações do celular',
              'Vá em Notificações → Alerta Médico',
              'Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"',
              'Certifique-se de que as notificações estão ativadas',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 O caminho exato varia por fabricante. Geralmente em Configurações → Notificações → Tela de Bloqueio.
              </Text>
            </View>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowAlertModal(false)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Unified reminders list — grouped by day */}
      {dayGroups.length > 0 && (
        <View style={styles.remindersCard}>
          {dayGroups.map(([diff, items], groupIdx) => (
            <View key={diff}>
              <View style={[styles.dayGroupHeader, groupIdx > 0 && styles.dayGroupDivider]}>
                <Text style={styles.dayLabel}>{dayLabelForDiff(diff, items[0].sortMs)}</Text>
                {groupIdx === 0 && <Text style={styles.remindersTitle}>PRÓXIMOS LEMBRETES</Text>}
              </View>
              {items.map((item) => {
                const daysLeft = item.type === 'med' && item.stockQty != null
                  ? Math.floor(item.stockQty / (item.dailyDoses || 1))
                  : null;
                const daysUntilEnd = item.medObj?.end_date
                  ? Math.ceil((new Date(item.medObj.end_date + 'T23:59:59').getTime() - Date.now()) / 86400000)
                  : null;
                const stockWillRunOutBeforeEnd = daysLeft != null && daysLeft <= 3
                  && daysUntilEnd != null && daysLeft < daysUntilEnd;
                const stockLow = daysLeft != null && daysLeft <= 3;
                const stockAlert = stockWillRunOutBeforeEnd
                  ? '⚠ acaba antes do prazo'
                  : stockLow ? '⚠ baixo' : null;
                const stockInfo = item.type === 'med' && item.stockQty != null && daysLeft != null
                  ? `${item.stockQty} restante${item.stockQty !== 1 ? 's' : ''} · ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''}${stockAlert ? `  ${stockAlert}` : ''}`
                  : null;
                return (
                  <TouchableOpacity
                    key={`${item.type}-${item.id}`}
                    style={styles.reminderRow}
                    activeOpacity={0.6}
                    onPress={() => {
                      if (item.type === 'med') (navigation as any).navigate('Medications');
                      else if (item.type === 'appointment') (navigation as any).navigate('Agenda', { tab: 'appointments', openAppointmentId: item.id });
                      else (navigation as any).navigate('Agenda', { tab: 'activities', openActivityId: item.id });
                    }}
                  >
                    <Text style={styles.reminderTimeLeft}>{item.time}</Text>
                    <Text style={styles.reminderIcon}>{item.icon}</Text>
                    <View style={styles.reminderContent}>
                      <View style={styles.reminderTopRow}>
                        <Text style={styles.reminderName} numberOfLines={1}>{item.name}</Text>
                        {item.type !== 'appointment' ? (
                          <TouchableOpacity
                            style={styles.reminderBellBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                            onPress={() => handleToggleMute(item)}
                          >
                            <Text style={styles.reminderBell}>{item.isMuted ? '🔕' : '🔔'}</Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={styles.reminderBell}>📅</Text>
                        )}
                      </View>
                      {(item.dose || stockInfo) && (
                        <Text style={styles.reminderSubLine}>
                          {item.dose ? item.dose : null}
                          {item.dose && item.stockQty != null && daysLeft != null ? '  ·  ' : null}
                          {item.stockQty != null && daysLeft != null ? (
                            <>
                              {`${item.stockQty} restante${item.stockQty !== 1 ? 's' : ''} · ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`}
                              {stockAlert ? (
                                <Text style={{ color: stockWillRunOutBeforeEnd ? '#CC0000' : '#E07B4F', fontWeight: '600' }}>
                                  {`  ${stockAlert}`}
                                </Text>
                              ) : null}
                            </>
                          ) : null}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {criticalMeds.length > 0 && (
        <TouchableOpacity style={styles.criticalCard} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <View style={styles.cardRow}>
            <Text style={styles.criticalCardTag}>MEDICAMENTOS CRÍTICOS</Text>
            <Text style={styles.cardChevron}>›</Text>
          </View>
          {criticalMeds.map(med => (
            <Text key={med.id} style={styles.criticalMed}>
              • {med.generic_name}{med.commercial_name ? ` (${med.commercial_name})` : ''}{med.dose ? ` — ${med.dose}` : ''}
            </Text>
          ))}
        </TouchableOpacity>
      )}

      {allInteractions.length > 0 && (
        <TouchableOpacity style={styles.interactionChip} activeOpacity={0.7} onPress={() => setShowInteractionsModal(true)}>
          <Text style={styles.interactionChipIcon}>⚠</Text>
          <Text style={styles.interactionChipText}>
            {allInteractions.length} interaç{allInteractions.length > 1 ? 'ões' : 'ão'} detectada{allInteractions.length > 1 ? 's' : ''}
          </Text>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      )}

      {fgHModalItem && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFgHModalItem(null)}>
          <View style={styles.overdueOverlay}>
            <View style={styles.overdueBox}>
              <Text style={[styles.overdueName, { fontSize: 16, marginBottom: 4 }]}>Informe o horário em que tomou o medicamento</Text>
              <Text style={styles.overdueTime}>{fgHModalItem.name}</Text>
              <TextInput
                style={styles.hTimeInput}
                value={fgHModalTimeText}
                onChangeText={t => {
                  const digits = t.replace(/\D/g, '').slice(0, 4);
                  setFgHModalTimeText(digits.length > 2 ? `${digits.slice(0,2)}:${digits.slice(2)}` : digits);
                }}
                placeholder="HH:MM"
                keyboardType="numeric"
                maxLength={5}
                autoFocus
                textAlign="center"
              />
              <TouchableOpacity
                style={styles.overdueTomei}
                onPress={async () => {
                  const [h, mn] = fgHModalTimeText.split(':').map(Number);
                  if (isNaN(h) || isNaN(mn) || h > 23 || mn > 59) {
                    Alert.alert('Horário inválido', 'Informe no formato HH:MM (ex: 14:30)');
                    return;
                  }
                  const item = fgHModalItem;
                  const customTime = new Date(); customTime.setHours(h, mn, 0, 0);
                  setFgHModalItem(null); setFgHModalTimeText('');
                  await handleTomeiHome(item, customTime);
                  dismissedAlertsRef.current.add(`${item.id}_${todayDateStr()}_${item.time}`);
                  setForegroundAlerts(prev => prev.filter(a => a.id !== item.id));
                }}
              >
                <Text style={styles.overdueTomeiText}>Confirmar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.overdueDispensar} onPress={() => { setFgHModalItem(null); setFgHModalTimeText(''); }}>
                <Text style={styles.overdueDispensarText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={showInteractionsModal} animationType="slide" transparent onRequestClose={() => setShowInteractionsModal(false)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Interações detectadas</Text>
            <ScrollView>
              {allInteractions.map(i => {
                const color = i.risk_level === 'critical' ? '#CC0000' : i.risk_level === 'high' ? '#e65c00' : '#b58900';
                const label = i.risk_level === 'critical' ? 'Crítico' : i.risk_level === 'high' ? 'Alto' : 'Moderado';
                return (
                  <View key={i.id} style={[styles.intModalItem, { borderLeftColor: color }]}>
                    <View style={[styles.intModalBadge, { borderColor: color }]}>
                      <Text style={[styles.intModalBadgeText, { color }]}>{label}</Text>
                    </View>
                    <Text style={styles.intModalDrugs}>{i.drug1} + {i.drug2}</Text>
                    <Text style={styles.intModalDesc}>{i.risk_description}</Text>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowInteractionsModal(false)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Phone configuration modal */}
      <Modal visible={showPhoneConfigModal} animationType="slide" transparent onRequestClose={() => setShowPhoneConfigModal(false)}>
        <View style={styles.intModalOverlay}>
          <ScrollView style={styles.phoneModalBox} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            <Text style={styles.phoneModalTitle}>📱 Configure seu telefone</Text>
            <Text style={styles.phoneModalSub}>Siga os passos abaixo para garantir que os alertas funcionem corretamente</Text>

            {/* Passo 1 — Notificações */}
            <View style={styles.phoneStep}>
              <View style={styles.phoneStepHeader}>
                <View style={styles.phoneStepNum}><Text style={styles.phoneStepNumText}>1</Text></View>
                <Text style={styles.phoneStepTitle}>Ative as notificações do app</Text>
              </View>
              <Text style={styles.phoneStepPath}>Configurações → Aplicativos → Alerta Médico → Notificações</Text>
              <View style={styles.settingsMock}>
                <View style={styles.settingsMockRow}>
                  <Text style={styles.settingsMockLabel}>Mostrar notificações</Text>
                  <View style={styles.settingsMockToggleOn}><Text style={styles.settingsMockToggleText}>✓</Text></View>
                </View>
                <View style={[styles.settingsMockRow, { borderTopWidth: 0.5, borderTopColor: '#eee' }]}>
                  <Text style={styles.settingsMockLabel}>Lembrete de Medicamento</Text>
                  <View style={styles.settingsMockToggleOn}><Text style={styles.settingsMockToggleText}>✓</Text></View>
                </View>
                <View style={[styles.settingsMockRow, { borderTopWidth: 0.5, borderTopColor: '#eee' }]}>
                  <Text style={styles.settingsMockLabel}>Lembrete de Atividade</Text>
                  <View style={styles.settingsMockToggleOn}><Text style={styles.settingsMockToggleText}>✓</Text></View>
                </View>
                <View style={[styles.settingsMockRow, { borderTopWidth: 0.5, borderTopColor: '#eee' }]}>
                  <Text style={styles.settingsMockLabel}>Lembrete de Consulta</Text>
                  <View style={styles.settingsMockToggleOn}><Text style={styles.settingsMockToggleText}>✓</Text></View>
                </View>
              </View>
              <TouchableOpacity style={styles.phoneSettingsBtn} onPress={() => Linking.openSettings()}>
                <Text style={styles.phoneSettingsBtnText}>⚙️  Abrir configurações do app</Text>
              </TouchableOpacity>
            </View>

            {/* Passo 2 — Tela de bloqueio */}
            <View style={styles.phoneStep}>
              <View style={styles.phoneStepHeader}>
                <View style={styles.phoneStepNum}><Text style={styles.phoneStepNumText}>2</Text></View>
                <Text style={styles.phoneStepTitle}>Mostre o conteúdo na Tela de Bloqueio</Text>
              </View>
              <Text style={styles.phoneStepPath}>Configurações → Notificações → Privacidade (ou Tela de Bloqueio)</Text>
              <View style={styles.settingsMock}>
                <View style={styles.settingsMockRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsMockLabel}>Notificações na tela de bloqueio</Text>
                    <Text style={styles.settingsMockSub}>Selecione: Mostrar todo o conteúdo</Text>
                  </View>
                  <Text style={styles.settingsMockChevron}>›</Text>
                </View>
              </View>
              <View style={styles.phoneTipBox}>
                <Text style={styles.phoneTipText}>
                  <Text style={styles.phoneTipBrand}>Samsung: </Text>Configurações → Tela de bloqueio → Notificações → Detalhes{'\n'}
                  <Text style={styles.phoneTipBrand}>Motorola: </Text>Configurações → Notificações → Privacidade de notificações{'\n'}
                  <Text style={styles.phoneTipBrand}>Xiaomi: </Text>Configurações → Notificações e barra de status → Notificações na tela de bloqueio
                </Text>
              </View>
            </View>

            {/* Passo 3 — Bateria */}
            <View style={styles.phoneStep}>
              <View style={styles.phoneStepHeader}>
                <View style={styles.phoneStepNum}><Text style={styles.phoneStepNumText}>3</Text></View>
                <Text style={styles.phoneStepTitle}>Libere o app na bateria (mais importante)</Text>
              </View>
              <Text style={styles.phoneStepPath}>Configurações → Aplicativos → Alerta Médico → Bateria</Text>
              <View style={styles.settingsMock}>
                <View style={styles.settingsMockRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingsMockLabel, { color: '#ccc' }]}>Otimizada (padrão)</Text>
                    <Text style={styles.settingsMockSub}>Pode bloquear alarmes em segundo plano</Text>
                  </View>
                  <View style={styles.settingsMockToggleOff} />
                </View>
                <View style={[styles.settingsMockRow, { borderTopWidth: 0.5, borderTopColor: '#eee', backgroundColor: '#f0fff4' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.settingsMockLabel, { color: '#1a6b3a' }]}>Sem restrições ← selecione este</Text>
                    <Text style={styles.settingsMockSub}>Garante que os alarmes sempre disparem</Text>
                  </View>
                  <View style={styles.settingsMockToggleOn}><Text style={styles.settingsMockToggleText}>✓</Text></View>
                </View>
              </View>
              <View style={styles.phoneTipBox}>
                <Text style={styles.phoneTipText}>
                  <Text style={styles.phoneTipBrand}>Samsung: </Text>Configurações → Bateria → Limites de uso em segundo plano → Nunca adormecer{'\n'}
                  <Text style={styles.phoneTipBrand}>Xiaomi/MIUI: </Text>Configurações → Apps → Gerenciar apps → Alerta Médico → Economia de bateria → Sem restrições
                </Text>
              </View>
            </View>

            {/* Passo 4 — Não perturbe */}
            <View style={styles.phoneStep}>
              <View style={styles.phoneStepHeader}>
                <View style={styles.phoneStepNum}><Text style={styles.phoneStepNumText}>4</Text></View>
                <Text style={styles.phoneStepTitle}>Modo "Não perturbe" (se usar)</Text>
              </View>
              <Text style={styles.phoneStepBody}>
                Se o celular estiver no modo "Não perturbe" (lua ou sino cortado), os alarmes do Alerta Médico podem ser silenciados.
                Para excepcionar o app:
              </Text>
              <Text style={styles.phoneStepPath}>Configurações → Som → Não perturbe → Exceções de apps → adicione Alerta Médico</Text>
            </View>

            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowPhoneConfigModal(false)}>
              <Text style={styles.intModalCloseText}>Entendi</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

    </ScrollView>

      {/* Welcome modal — first launch */}
      <Modal visible={onboardingStep === 'welcome'} transparent animationType="fade">
        <View style={styles.welcomeOverlay}>
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>Bem-vindo ao{'\n'}Alerta Médico</Text>
            <Text style={styles.welcomeSub}>
              Para funcionar, o app precisa de três informações:
            </Text>
            <View style={styles.welcomeItem}>
              <Text style={styles.welcomeItemIcon}>👤</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.welcomeItemTitle}>Perfil Médico</Text>
                <Text style={styles.welcomeItemSub}>Seu nome, tipo sanguíneo e alergias</Text>
              </View>
            </View>
            <View style={styles.welcomeItem}>
              <Text style={styles.welcomeItemIcon}>📞</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.welcomeItemTitle}>Contato de Emergência</Text>
                <Text style={styles.welcomeItemSub}>Quem ligar em caso de emergência</Text>
              </View>
            </View>
            <View style={styles.welcomeItem}>
              <Text style={styles.welcomeItemIcon}>💊</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.welcomeItemTitle}>Medicamentos</Text>
                <Text style={styles.welcomeItemSub}>O que você usa no dia a dia</Text>
              </View>
            </View>
            <Text style={styles.welcomeNote}>
              Vou guiar você pelo preenchimento. Tudo pode ser alterado facilmente depois.
            </Text>
            <TouchableOpacity style={styles.welcomeBtn} onPress={handleWelcomeStart}>
              <Text style={styles.welcomeBtnText}>Vamos começar →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Guide balloon overlay — steps 1, 2, 3 (bottom) */}
      {(onboardingStep === 1 || onboardingStep === 2 || onboardingStep === 3) && (
        <Modal visible transparent animationType="fade">
          <View style={styles.guideOverlay}>
            <View style={[styles.guideBalloon, { bottom: 64 + insets.bottom + 14 }]}>
              {onboardingStep === 1 && (
                <>
                  <Text style={styles.guideTitle}>👤  Perfil Médico</Text>
                  <Text style={styles.guideBody}>
                    Informe seu nome, tipo sanguíneo e alergias.{'\n'}
                    Pode alterar facilmente depois!
                  </Text>
                  <TouchableOpacity
                    style={styles.guideBtn}
                    onPress={() => { setOnboardingStep(null); navigation.navigate('Profile'); }}
                  >
                    <Text style={styles.guideBtnText}>Ir para o Perfil →</Text>
                  </TouchableOpacity>
                </>
              )}
              {onboardingStep === 2 && (
                <>
                  <Text style={styles.guideTitle}>📞  Contato de Emergência</Text>
                  <Text style={styles.guideBody}>
                    Adicione quem deve ser contatado em uma emergência.{'\n'}
                    Pode alterar facilmente depois!
                  </Text>
                  <TouchableOpacity
                    style={styles.guideBtn}
                    onPress={() => { setOnboardingStep(null); navigation.navigate('Contacts'); }}
                  >
                    <Text style={styles.guideBtnText}>Ir para Contatos →</Text>
                  </TouchableOpacity>
                </>
              )}
              {onboardingStep === 3 && (
                <>
                  <Text style={styles.guideTitle}>💊  Medicamentos</Text>
                  <Text style={styles.guideBody}>
                    Cadastre os medicamentos que você usa.{'\n'}
                    Pode alterar facilmente depois!
                  </Text>
                  <TouchableOpacity
                    style={styles.guideBtn}
                    onPress={() => { setOnboardingStep(null); navigation.navigate('Medications'); }}
                  >
                    <Text style={styles.guideBtnText}>Ir para Medicamentos →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.guideSkipBtn} onPress={handleSkipMeds}>
                    <Text style={styles.guideSkipText}>Pular por agora</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={[styles.guideArrow, { left: getArrowLeft(onboardingStep as 1 | 2 | 3) }]} />
            </View>
          </View>
        </Modal>
      )}

      {/* Guide balloon — step 4: alert chip (top of screen, arrow points up) */}
      {onboardingStep === 4 && (
        <Modal visible transparent animationType="fade">
          <View style={styles.guideOverlay}>
            <View style={[styles.guideBalloon, { top: insets.top + 56 + 14 + 50 + 8 }]}>
              <View style={styles.guideArrowUp} />
              <Text style={styles.guideTitle}>🔔  Ativar o Alerta</Text>
              <Text style={styles.guideBody}>
                Ative o alerta acima para exibir seus dados médicos na tela de bloqueio — sem precisar desbloquear o celular.
              </Text>
              <TouchableOpacity style={styles.guideBtn} onPress={handleOnboardingActivateAlert}>
                <Text style={styles.guideBtnText}>Ativar o Alerta →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.guideSkipBtn} onPress={handleSkipAlert}>
                <Text style={styles.guideSkipText}>Pular por agora</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32 },

  fgAlertCard: {
    backgroundColor: '#1C3F7A', borderRadius: 14, padding: 14, marginBottom: 10,
  },
  fgAlertInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  fgAlertIcon: { fontSize: 30 },
  fgAlertName: { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  fgAlertTimeBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  fgAlertTimeBadgeText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  fgAlertDose: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  fgAlertBtns: { flexDirection: 'row', gap: 6 },
  fgAlertTomei: {
    flex: 1, backgroundColor: '#fff', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  fgAlertTomeiText: { fontSize: 12, fontWeight: '700', color: '#1C3F7A' },
  fgAlertOutro: {
    flex: 1, backgroundColor: '#E07B4F', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  fgAlertOutroText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  fgAlertPular: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  fgAlertPularText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },

  alertRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 10,
  },
  alertChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  histBtn: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  histBtnText: { fontSize: 13, color: '#1C3F7A', fontWeight: '600' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#5DC994' },
  dotInactive: { backgroundColor: '#E07B4F' },
  alertChipText: { fontSize: 13, fontWeight: '600' },
  alertChipHint: { fontSize: 11, color: '#E07B4F', marginTop: 1 },

  alertModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '85%',
  },
  alertModalTitle: { fontSize: 17, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  alertToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 20,
  },
  alertToggleLabel: { fontSize: 15, fontWeight: '700', color: '#1A1F2E' },
  alertToggleHint: { fontSize: 12, color: '#888', marginTop: 2 },
  alertModalSection: { fontSize: 11, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  alertModalBody: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 16 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  tipBox: { backgroundColor: '#f0faf4', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 14 },
  tipText: { fontSize: 12, color: '#1a6b3a', lineHeight: 18 },

  remindersCard: {
    backgroundColor: '#fff', borderRadius: 12, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  dayGroupHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
  },
  dayGroupDivider: {
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)', paddingTop: 10, marginTop: 4,
  },
  remindersTitle: {
    fontSize: 10, color: '#8A8F9D', fontWeight: '700', letterSpacing: 0.8, flex: 1, textAlign: 'right',
  },
  dayLabel: {
    fontSize: 13, color: '#1C3F7A', fontWeight: '700', flexShrink: 0, marginRight: 6,
  },
  reminderRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 9, paddingHorizontal: 14,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)',
  },
  reminderTimeLeft: { fontSize: 14, color: '#1C3F7A', fontWeight: '800', width: 56, paddingTop: 1, marginRight: 6 },
  reminderIcon: { fontSize: 17, marginRight: 8, width: 22, textAlign: 'center', paddingTop: 1 },
  reminderContent: { flex: 1 },
  reminderTopRow: { flexDirection: 'row', alignItems: 'center' },
  reminderName: { fontSize: 13, color: '#1A1F2E', fontWeight: '500', flex: 1, marginRight: 4 },
  reminderTime: { fontSize: 13, color: '#1C3F7A', fontWeight: '700', marginRight: 6 },
  reminderSubLine: { fontSize: 11, color: '#8A8F9D', marginTop: 3 },
  reminderBellBtn: { padding: 2 },
  reminderBell: { fontSize: 15 },
  hTimeInput: {
    borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 10,
    fontSize: 28, fontWeight: '700', color: '#1C3F7A',
    paddingVertical: 12, paddingHorizontal: 20,
    marginVertical: 16, width: 140, textAlign: 'center',
  },

  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },

  criticalCard: {
    backgroundColor: '#fff8f8', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(204,0,0,0.12)', borderLeftWidth: 3, borderLeftColor: '#CC0000',
  },
  criticalCardTag: { fontSize: 10, color: '#CC0000', fontWeight: '600', letterSpacing: 0.5 },
  criticalMed: { fontSize: 13, color: '#444', marginTop: 4 },

  interactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  interactionChipIcon: { fontSize: 13, color: '#e65c00' },
  interactionChipText: { fontSize: 13, color: '#555', flex: 1 },

  intModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  intModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '70%',
  },
  intModalTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  intModalItem: {
    borderLeftWidth: 3, borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fafafa',
  },
  intModalBadge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  intModalBadgeText: { fontSize: 10, fontWeight: '600' },
  intModalDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  intModalDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  intModalClose: {
    marginTop: 12, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  intModalCloseText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  // Phone config modal
  phoneModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '92%',
  },
  phoneModalTitle: { fontSize: 17, fontWeight: '700', color: '#1C3F7A', marginBottom: 4 },
  phoneModalSub: { fontSize: 13, color: '#666', marginBottom: 18, lineHeight: 18 },
  phoneStep: {
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 14,
  },
  phoneStepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  phoneStepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0,
  },
  phoneStepNumText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  phoneStepTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E', flex: 1 },
  phoneStepPath: { fontSize: 11, color: '#888', fontStyle: 'italic', marginBottom: 10, lineHeight: 16 },
  phoneStepBody: { fontSize: 13, color: '#444', lineHeight: 19, marginBottom: 8 },
  settingsMock: {
    backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden',
    borderWidth: 0.5, borderColor: '#dde3f0', marginBottom: 10,
  },
  settingsMockRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11,
  },
  settingsMockLabel: { fontSize: 13, color: '#222', flex: 1 },
  settingsMockSub: { fontSize: 11, color: '#888', marginTop: 2 },
  settingsMockChevron: { fontSize: 18, color: '#C0C5D0' },
  settingsMockToggleOn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center',
  },
  settingsMockToggleText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  settingsMockToggleOff: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#ccc',
  },
  phoneTipBox: {
    backgroundColor: '#fff8f0', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: '#E07B4F',
  },
  phoneTipText: { fontSize: 12, color: '#555', lineHeight: 19 },
  phoneTipBrand: { fontWeight: '700', color: '#E07B4F' },
  phoneSettingsBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 8, paddingVertical: 10,
    alignItems: 'center',
  },
  phoneSettingsBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Onboarding — welcome modal
  welcomeOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  welcomeCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%',
  },
  welcomeTitle: {
    fontSize: 22, fontWeight: '800', color: '#1C3F7A',
    textAlign: 'center', marginBottom: 16, lineHeight: 30,
  },
  welcomeSub: {
    fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 19,
  },
  welcomeItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 12, marginBottom: 10,
  },
  welcomeItemIcon: { fontSize: 22 },
  welcomeItemTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  welcomeItemSub: { fontSize: 12, color: '#777', marginTop: 1 },
  welcomeNote: {
    fontSize: 12, color: '#888', textAlign: 'center',
    marginTop: 16, marginBottom: 20, lineHeight: 18,
  },
  welcomeBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  welcomeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Onboarding — guide balloon
  guideOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  guideBalloon: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 8,
  },
  guideTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 8 },
  guideBody: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 14 },
  guideBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  guideBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  guideSkipBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 6 },
  guideSkipText: { fontSize: 13, color: '#999' },
  guideArrow: {
    position: 'absolute', bottom: -10,
    width: 0, height: 0,
    borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: '#fff',
  },
  guideArrowUp: {
    position: 'absolute', top: -10, left: 20,
    width: 0, height: 0,
    borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: '#fff',
  },
  overdueOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  overdueBox: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28,
    alignItems: 'center', width: '100%',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, elevation: 12,
  },
  overdueIcon: { fontSize: 48, marginBottom: 10 },
  overdueName: { fontSize: 20, fontWeight: '800', color: '#1C3F7A', textAlign: 'center', marginBottom: 6 },
  overdueTime: { fontSize: 14, color: '#666', marginBottom: 4 },
  overdueSubtitle: { fontSize: 15, color: '#444', marginTop: 10, marginBottom: 20, textAlign: 'center' },
  overdueTomei: {
    backgroundColor: '#1C3F7A', borderRadius: 12, paddingVertical: 14,
    paddingHorizontal: 40, marginBottom: 10, width: '100%', alignItems: 'center',
  },
  overdueTomeiText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  overdueDispensar: {
    borderWidth: 1.5, borderColor: '#C8CDD8', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 40, width: '100%', alignItems: 'center',
  },
  overdueDispensarText: { color: '#666', fontSize: 15, fontWeight: '600' },
});
