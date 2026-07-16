import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, AppState, Platform,
} from 'react-native';
import PickerDataHora from '../components/PickerDataHora';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import {
  getProfile, getMedications, getKV, setKV, getContacts,
  getRemindersForMedication, updateAllRemindersSound,
  getActivities, getRemindersForActivity, updateAllActivityRemindersSound,
  getAppointments, resolveMedicationLogSlot, updateMedicationStock, getMedicationLog,
} from '../database/db';
import EmergencyChecklist from '../components/EmergencyChecklist';
import { getMedIdOptIn, isMedicalIdPending } from '../services/medicalId';
import { getCyclePhase, CyclePhaseInfo } from '../utils/cyclePhase';

const IS_IOS = Platform.OS === 'ios';

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

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootTabs>>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([]);
  const [emergencyReady, setEmergencyReady] = useState(false);
  const [medsHintDismissedAt, setMedsHintDismissedAt] = useState<string | null>(null);
  const [emergencyHintDismissedAt, setEmergencyHintDismissedAt] = useState<string | null>(null);
  const [foregroundAlerts, setForegroundAlerts] = useState<UnifiedItem[]>([]);
  const [staleStockMeds, setStaleStockMeds] = useState(0);
  const [medIdPending, setMedIdPending] = useState(false);
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

    // iOS: a emergência é a Ficha Médica da Apple — "pronto" = usuário marcou que a usa.
    // Android: perfil + contato + alerta na tela de bloqueio.
    const ready = IS_IOS
      ? await getMedIdOptIn()
      : (!!p?.name && contacts.length > 0 && alertActive === '1');
    setEmergencyReady(ready);
    // A notificação do Medical ID é o empurrão de FORA e some sozinha (ou é empurrada
    // por outra que chegue depois). O sinal durável vivia só dentro de Configurações →
    // Ficha Médica, a dois toques daqui — e o card de setup some assim que a pessoa liga
    // o opt-in. Ou seja, quem já usa o recurso não tinha NADA na Home avisando que a
    // ficha ficou velha. Uma ficha desatualizada é mais perigosa que uma vazia.
    setMedIdPending(ready && IS_IOS ? await isMedicalIdPending(m).catch(() => false) : false);
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
      const info = nextReminderInfo(reminders);
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
    // Medicamentos COM controle de estoque que têm dose sem resposta cujo cartão já expirou:
    // o app não descontou nada e nunca mais vai perguntar, então o estoque só volta a bater
    // se o usuário ajustar o registro no Histórico. Janela de 7 dias, a mesma de
    // reconcileMissedDoses() — o que é mais velho que isso não tem log criado nem conserto.
    //
    // Conta MEDICAMENTO, não dose, e o motivo não é só texto: estoque é por medicamento, e
    // um remédio 3x/dia esquecido um dia rende 3 doses de UM estoque errado. Contar dose
    // ainda convidava a uma comparação que não existe — o Histórico lista as pendentes de
    // TODOS os remédios, e aqui só entram os que têm estoque cadastrado (sem estoque não há
    // estoque para errar). Os números nunca batiam, e o usuário concluía, com razão, que um
    // dos dois estava mentindo.
    const staleStockMeds = new Set<number>();

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
        else if (med.stock_quantity != null && med.save_history !== 0) staleStockMeds.add(med.id);
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
    setStaleStockMeds(staleStockMeds.size);
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
            <Text style={styles.hintExpandedTitle}>{IS_IOS ? 'Configurar Ficha Médica' : 'Configurar emergência'}</Text>
            <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={dismissEmergencyHint} accessibilityLabel="Dispensar aviso de configuração" accessibilityRole="button">
              <Text style={styles.hintClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.hintExpandedList}>
            {IS_IOS ? (
              <TouchableOpacity
                style={styles.medIdNudge}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('LockScreen')}
              >
                <Text style={styles.medIdNudgeText}>
                  No iPhone, suas informações de emergência ficam na Ficha Médica (Medical ID) da
                  Apple, na tela de bloqueio. Toque para ver como preencher e manter atualizada.
                </Text>
                <Text style={styles.medIdNudgeChevron}>›</Text>
              </TouchableOpacity>
            ) : (
              <EmergencyChecklist
                profile={profile}
                contacts={emergencyContacts}
                notifActive={notifActive}
                onPressProfile={() => navigation.navigate('Profile')}
                onPressContacts={() => navigation.navigate('Contacts')}
                onPressAlert={() => navigation.navigate('LockScreen', { openAlert: true })}
              />
            )}
          </View>
        </View>
      )}

      {/* Fica até ser RESOLVIDO (o "Já atualizei" da tela da Ficha Médica), não até ser
          dispensado: dispensar não atualiza a ficha que o socorrista vai ler. Primeiro da
          tela porque é o único item aqui que é segurança, não organização. */}
      {medIdPending && (
        <TouchableOpacity
          style={styles.medIdPendingCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('LockScreen')}
        >
          <Text style={styles.hintIcon}>🍎</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.medIdPendingTitle}>Ficha Médica desatualizada</Text>
            <Text style={styles.medIdPendingSub}>
              Seus remédios mudaram. Toque para copiar a lista e atualizar no app Saúde.
            </Text>
          </View>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
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

      {staleStockMeds > 0 && (
        <TouchableOpacity style={styles.stockWarnCard} activeOpacity={0.8} onPress={() => navigation.navigate('History')}>
          <Text style={styles.hintIcon}>📦</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.stockWarnTitle}>Estoque pode estar desatualizado</Text>
            <Text style={styles.stockWarnSub}>
              {staleStockMeds === 1
                ? '1 medicamento teve dose sem resposta. Ajuste no Histórico para o estoque ficar correto.'
                : `${staleStockMeds} medicamentos tiveram doses sem resposta. Ajuste no Histórico para o estoque ficar correto.`}
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
                <PickerDataHora
                  valor={(() => { const d = new Date(); d.setHours(fgHModalHour, fgHModalMinute, 0, 0); return d; })()}
                  onConfirmar={(date) => {
                    setShowFgHTimePicker(false);
                    setFgHModalHour(date.getHours()); setFgHModalMinute(date.getMinutes());
                  }}
                  onCancelar={() => setShowFgHTimePicker(false)}
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
  medIdPendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1.5, borderColor: '#E07B4F',
  },
  medIdPendingTitle: { fontSize: 14, fontWeight: '700', color: '#E07B4F' },
  medIdPendingSub: { fontSize: 12, color: '#8A8F9D', marginTop: 1 },
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
  medIdNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F2F4F8', borderRadius: 10, padding: 12,
  },
  medIdNudgeText: { flex: 1, fontSize: 13, color: '#1A1F2E', lineHeight: 19 },
  medIdNudgeChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },

  // Herdados do modal de interações (suspenso — ver docs/interacoes-suspensas.md); o modal de
  // configuração do telefone reaproveita estes três.

  // Phone config modal

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
