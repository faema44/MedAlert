import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Linking, Alert, AppState,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import {
  getProfile, getMedications, getKV, setKV, getContacts,
  getRemindersForMedication, updateAllRemindersSound,
  getActivities, getRemindersForActivity, updateAllActivityRemindersSound,
  getAppointments, resolveMedicationLogSlot, updateMedicationStock, getMedicationLog,
} from '../database/db';
import EmergencyChecklist from '../components/EmergencyChecklist';
import { getCyclePhase, CyclePhaseInfo } from '../utils/cyclePhase';

type RootTabs = {
  Home: undefined; Profile: undefined; Medications: undefined;
  Contacts: undefined; Agenda: undefined; Interactions: undefined; History: undefined;
  Settings: undefined; LockScreen: { openAlert?: boolean } | undefined;
};

import {
  updateEmergencyNotification, nextReminderInfo,
  cancelAllRemindersForMedication, cancelAllRemindersForActivity, cancelRepeatAlarm,
  rescheduleRemindersForMedication, rescheduleRemindersForActivity, notifyLowStock,
  dismissPresentedForMedication, clearBadge,
} from '../services/notifications';
import { Profile, Medication, MedicationReminder, ActivityReminder, Appointment, ACTIVITY_PRESETS, EmergencyContact } from '../types';
import { isPhytotherapic } from '../utils/drugSearch';

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
  slotMs?: number; // instante exato da dose cobrada (alertas da Home podem ser de ontem)
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

// Um lembrete criado depois do horário já ter passado não conta como dose perdida
// (não existia ainda pra ser tomada) — só passa a valer no próximo horário.
function reminderExistedBeforeSlot(r: MedicationReminder, slot: Date): boolean {
  if (!r.created_at) return true;
  const createdAt = new Date(r.created_at.replace(' ', 'T') + 'Z');
  if (isNaN(createdAt.getTime())) return true;
  return createdAt.getTime() <= slot.getTime();
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function occursOnDay(period: string | undefined, d: Date): boolean {
  const p = period || 'day';
  if (p === 'day') return true;
  if (p.startsWith('week:')) return p.split(':')[1].split(',').map(Number).includes(d.getDay() + 1);
  if (p.startsWith('month:')) return p.split(':')[1].split(',').map(Number).includes(d.getDate());
  return false; // 'year:' não tem lembrete diário
}

type MedSlot = { at: Date; r: MedicationReminder };

// Horários agendados do medicamento nos dias [from, to] relativos a hoje, em ordem.
function buildSlots(active: MedicationReminder[], today: Date, from: number, to: number): MedSlot[] {
  const out: MedSlot[] = [];
  for (let off = from; off <= to; off++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
    for (const r of active) {
      if (!occursOnDay(r.period, day)) continue;
      const [h, m] = r.time.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      out.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0), r });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// Por quanto tempo um alerta vencido continua na tela: METADE do caminho até a próxima
// dose do mesmo medicamento. 4x/dia (6h de intervalo) → 3h de cartão; 1x/dia → 12h.
// A regra anterior era "até a meia-noite", que dava 16h para uma dose das 08:00 e
// 10 minutos para uma das 23:50 — quanto mais tarde a dose, menos chance de responder.
// Assim o cartão nunca sobrevive até encostar na dose seguinte, e a hora do relógio
// deixa de decidir. Teto de 12h: sem ele um lembrete semanal ficaria 3 dias e meio na tela.
const MAX_ALERT_WINDOW_MS = 12 * 60 * 60 * 1000;

function alertExpiryMs(slot: MedSlot, allSlots: MedSlot[]): number {
  const slotMs = slot.at.getTime();
  const next = allSlots.find(s => s.at.getTime() > slotMs);
  const gap = next ? next.at.getTime() - slotMs : 24 * 60 * 60 * 1000;
  return slotMs + Math.min(gap / 2, MAX_ALERT_WINDOW_MS);
}

// Chave da dose, não do medicamento: o cartão pode ser de ontem, e responder a dose de
// ontem não pode dispensar a de hoje.
function alertKey(item: UnifiedItem): string {
  return `${item.id}_${ymd(new Date(item.slotMs!))}_${item.time}`;
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
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showPhoneConfigModal, setShowPhoneConfigModal] = useState(false);
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([]);
  const [emergencyReady, setEmergencyReady] = useState(false);
  const [medsHintDismissedAt, setMedsHintDismissedAt] = useState<string | null>(null);
  const [emergencyHintDismissedAt, setEmergencyHintDismissedAt] = useState<string | null>(null);
  const [foregroundAlerts, setForegroundAlerts] = useState<UnifiedItem[]>([]);
  const [staleStockDoses, setStaleStockDoses] = useState(0);
  const [cycleStatus, setCycleStatus] = useState<{ activityId: number; name: string; phase: CyclePhaseInfo; cycleLength: number } | null>(null);
  const [fgHModalItem, setFgHModalItem] = useState<UnifiedItem | null>(null);
  const [fgHModalHour, setFgHModalHour] = useState(0);
  const [fgHModalMinute, setFgHModalMinute] = useState(0);
  const [showFgHTimePicker, setShowFgHTimePicker] = useState(false);
  const dismissedAlertsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [p, m, alertActive, acts, appts, contacts, medsHintAt, emergencyHintAt] = await Promise.all([
      getProfile(), getMedications(), getKV(KV_ALERT_ACTIVE), getActivities(), getAppointments(),
      getContacts(), getKV('home_hint_meds_dismissed_at'), getKV('home_hint_emergency_dismissed_at'),
    ]);
    setProfile(p);
    setMedications(m);
    setEmergencyContacts(contacts);
    setNotifActive(alertActive === '1' && !!p?.name);

    const ready = !!p?.name && contacts.length > 0 && alertActive === '1';
    setEmergencyReady(ready);
    // Uma vez que o usuário complete os 3 itens (ou adicione um medicamento), o
    // lembrete correspondente é dispensado para sempre — não volta a incomodar
    // mesmo se o usuário desfizer a configuração depois.
    let emergencyDismissedAt = emergencyHintAt;
    if (ready && !emergencyDismissedAt) {
      emergencyDismissedAt = new Date().toISOString();
      await setKV('home_hint_emergency_dismissed_at', emergencyDismissedAt);
    }
    setEmergencyHintDismissedAt(emergencyDismissedAt);

    let medsDismissedAt = medsHintAt;
    if (m.length > 0 && !medsDismissedAt) {
      medsDismissedAt = new Date().toISOString();
      await setKV('home_hint_meds_dismissed_at', medsDismissedAt);
    }
    setMedsHintDismissedAt(medsDismissedAt);

    if (alertActive === '1' && p?.name) {
      await updateEmergencyNotification(p, m).catch(() => {});
    }

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

    // Ciclo menstrual não tem lembrete (não entra na lista de horários) — mostra a
    // fase de hoje num card próprio, à parte da lista "Próximos lembretes".
    const cycleAct = acts.find(a => a.type === 'cycle' && a.cycle_start_date);
    setCycleStatus(cycleAct ? {
      activityId: cycleAct.id,
      name: cycleAct.name,
      phase: getCyclePhase(cycleAct.cycle_start_date!, cycleAct.cycle_length_days ?? 28, cycleAct.period_length_days ?? 5),
      cycleLength: cycleAct.cycle_length_days ?? 28,
    } : null);

    const actReminders = await Promise.all(acts.map(a => getRemindersForActivity(a.id).catch(() => [] as ActivityReminder[])));
    acts.forEach((act, idx) => {
      if (act.type === 'cycle') return;
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
    const since1y = new Date(nowD); since1y.setFullYear(since1y.getFullYear() - 1); since1y.setHours(0, 0, 0, 0);
    const allLogs = await getMedicationLog({ since_iso: since1y.toISOString() });

    // Slot "respondido" = Tomei OU Não tomei — ambos resolvem a cobrança do dia.
    // Janela de ±50min: cobre resposta atrasada via repetição (6×5min = 30min) sem
    // engolir doses vizinhas — com ±4h, responder uma dose suprimia o popup de
    // qualquer outra dose do mesmo medicamento nas 4h seguintes (ex.: testes seguidos)
    const isSlotTaken = (medId: number, slot: Date) => allLogs.some(l =>
      l.medication_id === medId && l.taken != null &&
      Math.abs(new Date(l.scheduled_at).getTime() - slot.getTime()) < 50 * 60 * 1000
    );

    const nowMs = nowD.getTime();
    const today0 = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();

    const overdue: UnifiedItem[] = [];
    // Doses sem resposta cujo cartão já expirou, em medicamentos COM controle de estoque:
    // o app descontou nada e nunca mais vai perguntar, então o estoque só volta a bater se
    // o usuário ajustar o registro no Histórico. Janela de 7 dias, a mesma de
    // reconcileMissedDoses() — o que é mais velho que isso não tem log criado nem conserto.
    let staleStockDoses = 0;

    m.forEach((med, idx) => {
      const active = (medReminders[idx] ?? []).filter(r => r.is_active);
      if (!active.length) return;

      // +1 dia: a "próxima dose" de um horário das 23h cai amanhã, e é ela que define a janela.
      const allSlots = buildSlots(active, nowD, -7, 1);
      const pending = allSlots.filter(s =>
        s.at.getTime() <= nowMs &&
        reminderExistedBeforeSlot(s.r, s.at) &&
        !isSlotTaken(med.id, s.at)
      );

      const live: MedSlot[] = [];
      for (const s of pending) {
        if (nowMs < alertExpiryMs(s, allSlots)) live.push(s);
        else if (med.stock_quantity != null && med.save_history !== 0) staleStockDoses++;
      }

      // Um cartão por medicamento: a dose vencida mais antiga ainda dentro da janela.
      if (med.home_reminder === 0) return;
      const slot = live[0];
      if (!slot) return;
      const time = hhmm(slot.at);
      if (dismissedAlertsRef.current.has(`${med.id}_${ymd(slot.at)}_${time}`)) return;

      const slotDay = new Date(slot.at.getFullYear(), slot.at.getMonth(), slot.at.getDate()).getTime();
      const dayDiff = Math.round((slotDay - today0) / 86400000);
      const isMuted = active.every(r => !r.with_sound);
      overdue.push({
        id: med.id, type: 'med',
        icon: med.is_critical ? '⚠️' : isPhytotherapic(med.generic_name) ? '🌿' : '💊',
        name: med.commercial_name?.trim() || med.generic_name,
        label: `${dayDiff === 0 ? 'hoje' : 'ontem'} às ${time}`,
        time, dayDiff, sortMs: slot.at.getTime(), isMuted,
        dose: med.dose || undefined, stockQty: med.stock_quantity,
        dailyDoses: active.length || 1, medObj: med,
        slotMs: slot.at.getTime(),
      });
    });
    setForegroundAlerts(overdue);
    setStaleStockDoses(staleStockDoses);
  }, []);

  useFocusEffect(useCallback(() => { load(); clearBadge(); }, [load]));

  // Re-check when app returns from background (useFocusEffect doesn't fire in this case)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { load(); clearBadge(); }
    });
    return () => sub.remove();
  }, [load]);

  // Re-check overdue alerts every 60 s while screen is mounted
  useEffect(() => {
    const timer = setInterval(() => { load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

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

  // "Não tomei" na Home: grava taken=0 igual ao botão da notificação —
  // antes o "Dispensar" só escondia o cartão e a dose ficava sem resposta no histórico
  async function handlePuleiHome(item: UnifiedItem) {
    if (!item.medObj) return;
    const med = item.medObj;
    const medDisplayName = med.commercial_name?.trim() || med.generic_name;
    const slot = new Date(item.slotMs!);
    const scheduledAt = slot.toISOString();
    const notifId = `fg_${med.id}_${ymd(slot)}_${item.time.replace(':', '')}`;
    await resolveMedicationLogSlot({
      medication_id: med.id,
      medication_name: medDisplayName,
      dose: med.dose ?? '',
      notification_id: notifId,
      scheduled_at: scheduledAt,
      taken: false,
    }).catch(() => {});
    cancelRepeatAlarm(med.id).catch(() => {});
    dismissPresentedForMedication(med.id).catch(() => {});
    load();
  }

  async function handleTomeiHome(item: UnifiedItem, takenAt?: Date) {
    if (!item.medObj) return;
    const med = item.medObj;
    const medDisplayName = med.commercial_name?.trim() || med.generic_name;
    const slot = new Date(item.slotMs!);
    const scheduledAt = slot.toISOString();
    const takenAtIso = takenAt ? takenAt.toISOString() : scheduledAt;
    const notifId = `fg_${med.id}_${ymd(slot)}_${item.time.replace(':', '')}`;
    await resolveMedicationLogSlot({
      medication_id: med.id,
      medication_name: medDisplayName,
      dose: med.dose ?? '',
      notification_id: notifId,
      scheduled_at: scheduledAt,
      taken: true,
      taken_at: takenAtIso,
    }).catch(() => {});
    if (med.stock_quantity != null) {
      const unitsPerDose = med.units_per_dose || 1;
      const next = Math.max(0, med.stock_quantity - unitsPerDose);
      await updateMedicationStock(med.id, next);
      const dailyDoses = item.dailyDoses || 1;
      const daysLeft = Math.floor(next / (dailyDoses * unitsPerDose));
      if (daysLeft <= 3) {
        const daysUntilEnd = med.end_date
          ? Math.ceil((new Date(med.end_date + 'T23:59:59').getTime() - Date.now()) / 86400000)
          : Infinity;
        if (daysLeft < daysUntilEnd) notifyLowStock(med.id, medDisplayName, daysLeft).catch(() => {});
      }
      if (next === 0) Alert.alert('Estoque zerado', `O estoque de ${medDisplayName} acabou. Providencie a reposição e ajuste em Medicamentos > Editar card > Controle de Estoque.`);
    }
    cancelRepeatAlarm(med.id).catch(() => {});
    dismissPresentedForMedication(med.id).catch(() => {});
    load();
  }

  async function dismissMedsHint() {
    const now = new Date().toISOString();
    await setKV('home_hint_meds_dismissed_at', now);
    setMedsHintDismissedAt(now);
  }

  async function dismissEmergencyHint() {
    const now = new Date().toISOString();
    await setKV('home_hint_emergency_dismissed_at', now);
    setEmergencyHintDismissedAt(now);
  }

  const showMedsHint = medications.length === 0 && !medsHintDismissedAt;
  const showEmergencyHint = !emergencyReady && !emergencyHintDismissedAt;

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Dismissable setup hints — no forced onboarding */}
      {showMedsHint && (
        <TouchableOpacity style={styles.hintCard} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <Text style={styles.hintIcon}>💊</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.hintTitle}>Adicionar medicamentos</Text>
            <Text style={styles.hintSub}>Cadastre para receber lembretes de horário</Text>
          </View>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={dismissMedsHint} accessibilityLabel="Dispensar aviso de medicamentos" accessibilityRole="button">
            <Text style={styles.hintClose}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
      {showEmergencyHint && (
        <View style={styles.hintExpandedCard}>
          <View style={styles.hintExpandedHeader}>
            <View style={styles.hintEmergencyIconBox}>
              <Text style={styles.hintEmergencyIconText}>+</Text>
            </View>
            <Text style={styles.hintExpandedTitle}>Configurar emergência</Text>
            <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={dismissEmergencyHint} accessibilityLabel="Dispensar aviso de configuração" accessibilityRole="button">
              <Text style={styles.hintClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.hintExpandedList}>
            <EmergencyChecklist
              profile={profile}
              contacts={emergencyContacts}
              notifActive={notifActive}
              onPressProfile={() => navigation.navigate('Profile')}
              onPressContacts={() => navigation.navigate('Contacts')}
              onPressAlert={() => navigation.navigate('LockScreen', { openAlert: true })}
            />
          </View>
        </View>
      )}

      {cycleStatus && (
        <TouchableOpacity
          style={styles.cycleCard}
          activeOpacity={0.8}
          onPress={() => (navigation as any).navigate('Agenda', { tab: 'activities', openActivityId: cycleStatus.activityId })}
        >
          <Text style={styles.hintIcon}>🌸</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.hintTitle}>{cycleStatus.name}</Text>
            <Text style={styles.hintSub}>
              Dia {cycleStatus.phase.dayInCycle} de {cycleStatus.cycleLength} · Fase: {cycleStatus.phase.label}
            </Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      )}

      {staleStockDoses > 0 && (
        <TouchableOpacity style={styles.stockWarnCard} activeOpacity={0.8} onPress={() => navigation.navigate('History')}>
          <Text style={styles.hintIcon}>📦</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.stockWarnTitle}>Estoque pode estar desatualizado</Text>
            <Text style={styles.stockWarnSub}>
              {staleStockDoses === 1
                ? '1 dose ficou sem resposta e saiu da tela. Ajuste no Histórico para o estoque ficar correto.'
                : `${staleStockDoses} doses ficaram sem resposta e saíram da tela. Ajuste no Histórico para o estoque ficar correto.`}
            </Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      )}

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
                  <Text style={styles.fgAlertTimeBadgeText}>
                    {alert.dayDiff === 0 ? alert.time : `ontem ${alert.time}`}
                  </Text>
                </View>
              </View>
              {alert.dose ? <Text style={styles.fgAlertDose}>{alert.dose}</Text> : null}
            </View>
          </View>
          {/* Buttons row */}
          <View style={styles.fgAlertBtns}>
            <TouchableOpacity
              style={styles.fgAlertNaoTomei}
              onPress={async () => {
                await handlePuleiHome(alert);
                dismissedAlertsRef.current.add(alertKey(alert));
                setForegroundAlerts(prev => prev.filter(a => a.id !== alert.id));
              }}
            >
              <Text style={styles.fgAlertNaoTomeiText}>Não tomei</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fgAlertOutro}
              onPress={() => {
                const now = new Date();
                setFgHModalHour(now.getHours()); setFgHModalMinute(now.getMinutes());
                setFgHModalItem(alert);
              }}
            >
              <Text style={styles.fgAlertOutroText}>⏰ Outro</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fgAlertTomei}
              onPress={async () => {
                await handleTomeiHome(alert);
                dismissedAlertsRef.current.add(alertKey(alert));
                setForegroundAlerts(prev => prev.filter(a => a.id !== alert.id));
              }}
            >
              <Text style={styles.fgAlertTomeiText}>✓ No horário</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

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
                  ? Math.floor(item.stockQty / ((item.dailyDoses || 1) * (item.medObj?.units_per_dose || 1)))
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
                            accessibilityLabel={item.isMuted ? `Reativar som do lembrete de ${item.name}` : `Silenciar lembrete de ${item.name}`}
                            accessibilityRole="button"
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

      {fgHModalItem && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFgHModalItem(null)}>
          <View style={styles.overdueOverlay}>
            <View style={styles.overdueBox}>
              <Text style={[styles.overdueName, { fontSize: 16, marginBottom: 4 }]}>Informe o horário em que tomou o medicamento</Text>
              <Text style={styles.overdueTime}>{fgHModalItem.name}</Text>
              <TouchableOpacity style={styles.hTimeInput} onPress={() => setShowFgHTimePicker(true)}>
                <Text style={styles.hTimeInputText}>
                  {String(fgHModalHour).padStart(2, '0')}:{String(fgHModalMinute).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
              {showFgHTimePicker && (
                <DateTimePicker
                  value={(() => { const d = new Date(); d.setHours(fgHModalHour, fgHModalMinute, 0, 0); return d; })()}
                  mode="time"
                  is24Hour={true}
                  display="clock"
                  onChange={(e, date) => {
                    setShowFgHTimePicker(false);
                    if (e.type === 'set' && date) { setFgHModalHour(date.getHours()); setFgHModalMinute(date.getMinutes()); }
                  }}
                />
              )}
              <TouchableOpacity
                style={styles.overdueTomei}
                onPress={async () => {
                  const item = fgHModalItem;
                  const customTime = new Date(); customTime.setHours(fgHModalHour, fgHModalMinute, 0, 0);
                  // O picker só dá hora e minuto, e monta em cima de hoje. Num cartão de
                  // ontem (dose tardia respondida de manhã), "tomei às 23:55" cairia hoje
                  // às 23:55 — no futuro. Ninguém toma remédio no futuro: é ontem.
                  if (customTime.getTime() > Date.now()) customTime.setDate(customTime.getDate() - 1);
                  setFgHModalItem(null);
                  await handleTomeiHome(item, customTime);
                  dismissedAlertsRef.current.add(alertKey(item));
                  setForegroundAlerts(prev => prev.filter(a => a.id !== item.id));
                }}
              >
                <Text style={styles.overdueTomeiText}>Confirmar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.overdueDispensar} onPress={() => setFgHModalItem(null)}>
                <Text style={styles.overdueDispensarText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

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
    flex: 1, backgroundColor: '#2E9E5B', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  fgAlertTomeiText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  fgAlertOutro: {
    flex: 1, backgroundColor: '#E07B4F', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  fgAlertOutroText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  fgAlertNaoTomei: {
    flex: 1, backgroundColor: '#CC0000', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  fgAlertNaoTomeiText: { fontSize: 12, fontWeight: '700', color: '#fff' },

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
    borderTopWidth: 2, borderTopColor: 'rgba(224,123,79,0.4)', paddingTop: 10, marginTop: 4,
  },
  remindersTitle: {
    fontSize: 10, color: '#8A8F9D', fontWeight: '700', letterSpacing: 0.8, flex: 1, textAlign: 'right',
  },
  dayLabel: {
    fontSize: 13, color: '#E07B4F', fontWeight: '700', flexShrink: 0, marginRight: 6,
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
    paddingVertical: 12, paddingHorizontal: 20,
    marginVertical: 16, width: 140, alignItems: 'center',
  },
  hTimeInputText: { fontSize: 28, fontWeight: '700', color: '#1C3F7A' },

  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },

  hintCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#4A6FA5',
  },
  cycleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  stockWarnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#E07B4F',
  },
  stockWarnTitle: { fontSize: 14, fontWeight: '700', color: '#E07B4F' },
  stockWarnSub: { fontSize: 12, color: '#8A8F9D', marginTop: 1 },
  hintIcon: { fontSize: 22 },
  hintTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  hintSub: { fontSize: 12, color: '#8A8F9D', marginTop: 1 },
  hintClose: { fontSize: 15, color: '#C0C5D0', padding: 4 },

  hintExpandedCard: {
    backgroundColor: '#F2F4F8', borderRadius: 14, padding: 10, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#4A6FA5',
  },
  hintExpandedHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 4, paddingBottom: 8,
  },
  hintEmergencyIconBox: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#CC0000',
    alignItems: 'center', justifyContent: 'center',
  },
  hintEmergencyIconText: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 17 },
  hintExpandedTitle: { fontSize: 15, fontWeight: '700', color: '#1A1F2E', flex: 1 },
  hintExpandedList: { gap: 8 },

  // Herdados do modal de interações (suspenso — ver docs/interacoes-suspensas.md); o modal de
  // configuração do telefone reaproveita estes três.
  intModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
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
