import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
  InteractionManager,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, updateMedication, archiveMedication,
  getRemindersForMedication, addReminder, deleteReminder, updateAllRemindersSound, updateMedicationStock,
  setMedicationSuspended,
} from '../database/db';
import {
  scheduleReminderWeekly, scheduleReminderMonthly, scheduleReminderEveryNMonths,
} from '../services/notifications';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelAllRemindersForMedication, notifyLowStock,
  rescheduleRemindersForMedication,
} from '../services/notifications';
import { Medication, MedicationReminder, DrugInteraction } from '../types';
import MedDisclaimer from '../components/MedDisclaimer';
import CartaoInteracao from '../components/CartaoInteracao';
import InteractionConsentModal, { hasAcceptedInteractionTerms, acceptInteractionTerms } from '../components/InteractionConsentModal';
import { DrugSuggestion, getSuggestions, getBulaUrl, getPhytoBulaUrl, checkInteractions, isPhytotherapic, getAllMedGenericNames } from '../utils/drugSearch';
import { useBulaViewer } from '../utils/useBulaViewer';
import { reportMissingDrug } from '../services/reportMissing';
// ──────────────────────────────────────────────────────────────────────────────

const EMPTY_MED: Omit<Medication, 'id'> = {
  generic_name: '', commercial_name: '', dose: '', frequency: '', is_critical: false, notes: '',
  stock_quantity: null, units_per_dose: 1, end_date: null, home_reminder: 1, save_history: 1,
};

function formatEndDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function daysRemaining(iso: string): number {
  const end = new Date(iso + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TIMES_PER_DAY_OPTIONS = [1, 2, 3, 4, 6];
const DOSE_UNITS = ['mg', 'g', 'mcg', 'UI', 'mL', 'gotas', '%', 'cáps'];
type ReminderPeriod = 'day' | 'week' | 'month' | 'year';
type WizardStep = 'type' | 'name' | 'dose' | 'period' | 'times_per_day' | 'weekdays' | 'month_days' | 'n_months' | 'time' | 'deadline' | 'sound' | 'stock' | 'summary';

const WEEKDAYS = [
  { label: 'Dom', value: 1 }, { label: 'Seg', value: 2 }, { label: 'Ter', value: 3 },
  { label: 'Qua', value: 4 }, { label: 'Qui', value: 5 }, { label: 'Sex', value: 6 },
  { label: 'Sáb', value: 7 },
];

function periodLabel(period: string, time: string): string {
  if (!period || period === 'day') return time;
  if (period.startsWith('week:')) {
    const labels = period.split(':')[1].split(',').map(v => WEEKDAYS.find(w => w.value === Number(v))?.label ?? '').join(', ');
    return `${time} · ${labels}`;
  }
  if (period.startsWith('month:')) return `${time} · dias ${period.split(':')[1]}/mês`;
  if (period.startsWith('nmonths:')) {
    const [, n, d] = period.split(':');
    return `${time} · dia ${d}, a cada ${n} mês${Number(n) > 1 ? 'es' : ''}`;
  }
  return time;
}

function fmtHM(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeTimes(startTime: string, timesPerDay: number): string[] {
  if (!startTime) return [];
  const parts = startTime.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return [];
  const intervalMin = Math.round((24 * 60) / timesPerDay);
  return Array.from({ length: timesPerDay }, (_, i) => {
    const total = ((h * 60 + m) + i * intervalMin) % (24 * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  });
}

function getStepSequence(period: ReminderPeriod, isNew: boolean, skipTime = false): WizardStep[] {
  const base: WizardStep[] = isNew
    ? ['type', 'name', 'dose', 'period']
    : ['name', 'dose', 'period'];
  if (period === 'day') base.push('times_per_day');
  else if (period === 'week') base.push('weekdays');
  else if (period === 'month') base.push('month_days');
  else base.push('n_months');
  if (!skipTime) base.push('time');
  base.push('deadline', 'sound', 'stock');
  return base;
}

export default function MedicationsScreen() {
  const { openBula, modal: bulaModal } = useBulaViewer();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_MED);
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([]);
  const [knownDrug, setKnownDrug] = useState<boolean>(false);
  const [customNameConfirmed, setCustomNameConfirmed] = useState<boolean>(false);
  const [commercialSuggestions, setCommercialSuggestions] = useState<DrugSuggestion[]>([]);
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [entryType, setEntryType] = useState<'medicamento' | 'fitoterapico'>('medicamento');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardInteractions, setCardInteractions] = useState<Map<number, DrugInteraction[]>>(new Map());
  const [interactionModal, setInteractionModal] = useState<DrugInteraction[] | null>(null);
  // Interações aguardando o aceite do termo. O detalhe só abre depois do consentimento.
  const [pendingInteractions, setPendingInteractions] = useState<DrugInteraction[] | null>(null);
  const [stockInput, setStockInput] = useState('');
  const [unitsPerDoseInput, setUnitsPerDoseInput] = useState('1');
  const [durationDays, setDurationDays] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  // No cadastro novo os botões Sim/Não só acendem depois que o usuário toca
  // (na edição vêm acesos refletindo o que está salvo)
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [soundTouched, setSoundTouched] = useState(false);
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [showStockHelp, setShowStockHelp] = useState(false);
  // Snapshot do resumo tirado quando os lembretes terminam de carregar na edição —
  // usado só pra marcar visualmente o que mudou e ainda não foi salvo.
  const [editSnapshot, setEditSnapshot] = useState<Record<string, string> | null>(null);
  const [homeReminderEnabled, setHomeReminderEnabled] = useState(true);
  const homeReminderRef = useRef(true);
  const lockOnlyRef = useRef(false);
  const wizStepScrollRef = useRef<ScrollView>(null);

  // Wizard
  const [wizardStep, setWizardStep] = useState<WizardStep>('name');

  // Reminder / picker state
  const [reminderHasSound, setReminderHasSound] = useState<Map<number, boolean>>(new Map());
  const [reminderMeta, setReminderMeta] = useState<Map<number, { repeat: number; periodType: string }>>(new Map());
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [pickerH, setPickerH] = useState<number | null>(null);
  const [pickerM, setPickerM] = useState<number | null>(null);
  const [customH, setCustomH] = useState<number | null>(null);
  const [customM, setCustomM] = useState<number | null>(null);
  const [showHorarioPicker, setShowHorarioPicker] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [doseValue, setDoseValue] = useState('');
  const [doseUnit, setDoseUnit] = useState('mg');
  const [doseUnitTouched, setDoseUnitTouched] = useState(false);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [timesPerDayTouched, setTimesPerDayTouched] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<Map<number, string[]>>(new Map());
  const [customTimes, setCustomTimes] = useState('');
  const [specificModeActive, setSpecificModeActive] = useState(false);
  const [withSound, setWithSound] = useState(true);
  const [repeatInterval, setRepeatInterval] = useState(0);
  const [reminderPeriod, setReminderPeriod] = useState<ReminderPeriod>('day');
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [selectedMonthDays, setSelectedMonthDays] = useState<number[]>([]);
  const [nMonths, setNMonths] = useState('1');
  const [monthDay, setMonthDay] = useState('1');

  // Meal time mode for notifications
  const [mealMode, setMealMode] = useState(false);
  const [mealCafe, setMealCafe] = useState('');
  const [mealAlmoco, setMealAlmoco] = useState('');
  const [mealJanta, setMealJanta] = useState('');
  const [mealPickerTarget, setMealPickerTarget] = useState<number | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickerDisplay = pickerH !== null ? fmtHM(pickerH, pickerM ?? 0) : '';
  const customInputDisplay = customH !== null ? fmtHM(customH, customM ?? 0) : '';
  const startTime = pickerDisplay;
  const computedTimes = useMemo(
    () => computeTimes(startTime, timesPerDay),
    [startTime, timesPerDay]
  );

  const knownMedsSet = useMemo(() => {
    const s = new Set<string>();
    for (const name of getAllMedGenericNames()) s.add(name.toLowerCase());
    return s;
  }, []);

  const route = useRoute<RouteProp<{ Medications: { openMedId?: number } }, 'Medications'>>();

  const loadExtras = useCallback((allMeds: Medication[]) => {
    InteractionManager.runAfterInteractions(async () => {
      try {
        // Suspensos ficam fora das interações e do card detalhado (card compacto)
        const meds = allMeds.filter(m => !m.suspended);
        const interactionMap = new Map<number, DrugInteraction[]>();
        const timesMap = new Map<number, string[]>();
        const soundMap = new Map<number, boolean>();
        const metaMap = new Map<number, { repeat: number; periodType: string }>();
        await Promise.all(meds.map(async (med) => {
          const others = meds.filter(m => m.id !== med.id).map(m => m.generic_name);
          const ints = checkInteractions(med.generic_name, others);
          if (ints.length > 0) interactionMap.set(med.id, ints);
          const rs = await getRemindersForMedication(med.id);
          const active = rs.filter(r => r.is_active);
          timesMap.set(med.id, active.map(r => periodLabel(r.period, r.time)));
          soundMap.set(med.id, active.some(r => r.with_sound));
          const first = active[0];
          const pt = !first ? 'day'
            : first.period === 'day' ? 'day'
            : first.period.startsWith('week:') ? 'week'
            : first.period.startsWith('month:') ? 'month'
            : first.period.startsWith('nmonths:') ? 'nmonths'
            : 'day';
          metaMap.set(med.id, { repeat: first?.repeat_interval ?? 0, periodType: pt });
        }));
        setCardInteractions(interactionMap);
        setReminderTimes(timesMap);
        setReminderHasSound(soundMap);
        setReminderMeta(metaMap);
      } catch {}
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let meds: Medication[] = [];
    try {
      meds = await getMedications(true);
      setMedications(meds);
    } catch {}
    setLoading(false);
    loadExtras(meds);
    return meds;
  }, [loadExtras]);

  useFocusEffect(useCallback(() => {
    const openId = route.params?.openMedId;
    load().then(meds => {
      if (openId) {
        const med = meds.find(m => m.id === openId);
        if (med) openEdit(med);
      }
    });
  }, [load, route.params?.openMedId]));

  async function syncNotification(allMeds: Medication[]) {
    // Suspensos não entram na ficha de emergência nem nas interações
    const meds = allMeds.filter(m => !m.suspended);
    try {
      const profile = await getProfile();
      if (profile?.name) await updateEmergencyNotification(profile, meds);
    } catch {}
    const map = new Map<number, DrugInteraction[]>();
    meds.forEach(med => {
      const others = meds.filter(m => m.id !== med.id).map(m => m.generic_name);
      const ints = checkInteractions(med.generic_name, others);
      if (ints.length > 0) map.set(med.id, ints);
    });
    setCardInteractions(map);
  }

  function handleGenericNameChange(v: string) {
    // Update form immediately so the input feels responsive
    setForm(f => ({ ...f, generic_name: v }));
    setKnownDrug(false);
    setCustomNameConfirmed(false);

    // Debounce expensive operations (search + interactions) so they don't block every keystroke
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSuggestions(getSuggestions(v, 7, entryType === 'fitoterapico' ? 'Fitoterápico' : undefined));
      setCommercialSuggestions([]);
      const others = medications.filter(m => m.id !== editingId && !m.suspended).map(m => m.generic_name);
      setInteractions(checkInteractions(v, others));
    }, 300);
  }

  function applySuggestion(s: DrugSuggestion) {
    Keyboard.dismiss();
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (s.brandName ?? ''),
    }));
    setSuggestions([]);
    setCommercialSuggestions([]);
    setKnownDrug(true);
    setCustomNameConfirmed(false);
    setInteractions([]);
    // Delay interaction check so keyboard dismiss + UI render settle first
    setTimeout(() => {
      const others = medications.filter(m => m.id !== editingId && !m.suspended).map(m => m.generic_name);
      setInteractions(checkInteractions(s.genericName, others));
    }, 250);
  }

  function handleCommercialNameChange(v: string) {
    setForm(f => ({ ...f, commercial_name: v }));
    setSuggestions([]);
    const all = getSuggestions(v);
    setCommercialSuggestions(all.filter(s => s.isBrand));
  }

  function applyCommercialSuggestion(s: DrugSuggestion) {
    Keyboard.dismiss();
    setForm(f => ({
      ...f,
      commercial_name: s.brandName ?? s.genericName,
      generic_name: f.generic_name.trim() ? f.generic_name : s.genericName,
    }));
    setCommercialSuggestions([]);
    if (!form.generic_name.trim()) {
      setInteractions(checkInteractions(s.genericName, medications.filter(m => !m.suspended).map(m => m.generic_name)));
    }
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert('Remover medicamento', `Deseja remover "${name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await cancelAllRemindersForMedication(id).catch(() => {});
          await archiveMedication(id);
          const updated = await getMedications(true);
          setMedications(updated);
          await syncNotification(updated);
        },
      },
    ]);
  }

  async function handleSuspend() {
    if (editingId === null) return;
    const name = form.commercial_name.trim() || form.generic_name.trim();
    Alert.alert(
      'Colocar em stand-by',
      `"${name}" ficará pausado: sem alarmes, fora da tela de bloqueio e da ficha de emergência. O setup fica guardado para quando você retomar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Suspender', onPress: async () => {
            const id = editingId;
            await setMedicationSuspended(id, true).catch(() => {});
            await cancelAllRemindersForMedication(id).catch(() => {});
            setShowModal(false);
            setEditingId(null);
            const updated = await getMedications(true);
            setMedications(updated);
            loadExtras(updated);
            await syncNotification(updated);
          },
        },
      ]
    );
  }

  async function handleResume(item: Medication) {
    await setMedicationSuspended(item.id, false).catch(() => {});
    const rs = await getRemindersForMedication(item.id).catch(() => [] as MedicationReminder[]);
    await rescheduleRemindersForMedication({ ...item, suspended: 0 }, rs).catch(() => {});
    const updated = await getMedications(true);
    setMedications(updated);
    loadExtras(updated);
    await syncNotification(updated);
  }

  async function refreshReminderTimes(medId: number) {
    const rs = await getRemindersForMedication(medId);
    const active = rs.filter(r => r.is_active);
    const times = active.map(r => periodLabel(r.period, r.time));
    const hasSound = active.some(r => r.with_sound);
    const first = active[0];
    const pt = !first ? 'day'
      : first.period === 'day' ? 'day'
      : first.period.startsWith('week:') ? 'week'
      : first.period.startsWith('month:') ? 'month'
      : first.period.startsWith('nmonths:') ? 'nmonths'
      : 'day';
    setReminderTimes(prev => new Map(prev).set(medId, times));
    setReminderHasSound(prev => new Map(prev).set(medId, hasSound));
    setReminderMeta(prev => new Map(prev).set(medId, { repeat: first?.repeat_interval ?? 0, periodType: pt }));
  }

  function resetPickerState() {
    setPickerH(null); setPickerM(null); setCustomH(null); setCustomM(null);
    setShowHorarioPicker(false); setShowCustomPicker(false);
    setTimesPerDay(1); setTimesPerDayTouched(false); setSpecificModeActive(false);
    setCustomTimes(''); setWithSound(true); setRepeatInterval(0); setReminderPeriod('day');
    setSelectedWeekdays([]); setSelectedMonthDays([]); setNMonths('1'); setMonthDay('1');
    setMealMode(false); setMealCafe(''); setMealAlmoco(''); setMealJanta(''); setMealPickerTarget(null);
  }

  function populatePickerFromReminders(rs: MedicationReminder[]) {
    const active = rs.filter(r => r.is_active);
    const first = active[0] ?? rs[0];
    if (!first) { resetPickerState(); return; }
    const [h, m] = first.time.split(':').map(Number);
    setPickerH(h); setPickerM(m);
    setCustomTimes(''); setCustomH(null); setCustomM(null);
    const p = first.period ?? 'day';
    if (p === 'day') {
      setReminderPeriod('day');
      const dayRs = rs.filter(r => (r.period ?? 'day') === 'day');
      setTimesPerDay(dayRs.length || 1);
      setTimesPerDayTouched(true);
      const dayTimes = dayRs.map(r => r.time.substring(0, 5));
      // Pre-populate meal fields by time-of-day so "Usar horários das refeições" shows saved times
      setMealCafe(''); setMealAlmoco(''); setMealJanta('');
      for (const t of dayTimes) {
        const hh = parseInt(t.split(':')[0], 10);
        if (hh < 10) setMealCafe(t);
        else if (hh < 15) setMealAlmoco(t);
        else setMealJanta(t);
      }
      if (dayRs.length > 1) {
        setCustomTimes(dayTimes.join(' '));
        setPickerH(null); setPickerM(null);
      }
    } else if (p.startsWith('week:')) {
      setReminderPeriod('week');
      setSelectedWeekdays(p.split(':')[1].split(',').map(Number));
    } else if (p.startsWith('month:')) {
      setReminderPeriod('month');
      setSelectedMonthDays(p.split(':')[1].split(',').map(Number));
    } else if (p.startsWith('nmonths:')) {
      setReminderPeriod('year');
      const [, nStr, dStr] = p.split(':');
      setNMonths(nStr); setMonthDay(dStr);
    }
    setWithSound(rs.some(r => r.with_sound));
    setRepeatInterval(rs[0]?.repeat_interval ?? 0);
  }

  async function handleToggleSound(item: Medication) {
    const rs = await getRemindersForMedication(item.id);
    if (rs.length === 0) return;
    const currentHasSound = rs.some(r => r.is_active && r.with_sound);
    const newSound = !currentHasSound;
    await updateAllRemindersSound(item.id, newSound);
    await cancelAllRemindersForMedication(item.id).catch(() => {});
    for (const r of rs.filter(r => r.is_active)) {
      const [h, m] = r.time.split(':').map(Number);
      const p = r.period ?? 'day';
      try {
        const ri = r.repeat_interval ?? 0;
        const notifName = item.commercial_name.trim() || item.generic_name;
        const isHerbal = isPhytotherapic(item.generic_name);
        if (p === 'day') await scheduleReminder(item.id, notifName, item.dose, h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('week:')) await scheduleReminderWeekly(item.id, notifName, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('month:')) await scheduleReminderMonthly(item.id, notifName, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(item.id, notifName, item.dose, Number(nStr), Number(dStr), h, m, newSound, ri, undefined, undefined, isHerbal); }
      } catch {}
    }
    setReminderHasSound(prev => new Map(prev).set(item.id, newSound));
  }

  async function doSaveWizard() {
    try {
      const effectiveTime = startTime || '08:00';
      let newEntries: Omit<MedicationReminder, 'id'>[] = [];

      if (!lockOnlyRef.current) {
        if (reminderPeriod === 'day') {
          let times: string[] = [];
          if (customTimes.trim()) {
            const raw = customTimes.trim();
            const num = parseInt(raw, 10);
            if (!isNaN(num) && /^\d+$/.test(raw)) {
              times = computeTimes(effectiveTime, num);
            } else {
              times = raw.split(/[,\s]+/).map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t));
            }
          } else {
            const ct = computeTimes(effectiveTime, timesPerDay);
            times = ct.length > 0 ? ct : [effectiveTime];
          }
          newEntries = times.map(time => ({
            medication_id: 0, time, period: 'day',
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }));
        } else if (reminderPeriod === 'week') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `week:${selectedWeekdays.sort((a, b) => a - b).join(',')}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        } else if (reminderPeriod === 'month') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `month:${selectedMonthDays.sort((a, b) => a - b).join(',')}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        } else if (reminderPeriod === 'year') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `nmonths:${nMonths}:${monthDay}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        }
      }

      const isCritical = interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high');
      const stockQty = stockInput.trim() ? parseInt(stockInput.trim(), 10) : null;
      const unitsPerDose = unitsPerDoseInput.trim() ? Math.max(1, parseInt(unitsPerDoseInput.trim(), 10)) : 1;
      const endDate = hasDeadline && durationDays.trim() ? addDays(parseInt(durationDays.trim(), 10)) : null;
      const data = {
        ...form,
        generic_name: form.generic_name.trim(),
        commercial_name: form.commercial_name.trim(),
        is_critical: isCritical,
        stock_quantity: stockQty,
        units_per_dose: unitsPerDose,
        end_date: endDate,
        home_reminder: homeReminderRef.current ? 1 : 0,
        save_history: 1,
      };

      let savedMedId: number;
      if (editingId !== null) {
        await updateMedication({ ...data, id: editingId });
        savedMedId = editingId;
        await cancelAllRemindersForMedication(savedMedId).catch(() => {});
        const existing = await getRemindersForMedication(savedMedId);
        for (const r of existing) await deleteReminder(r.id).catch(() => {});
      } else {
        savedMedId = await addMedication(data);
      }

      // Editando um medicamento em stand-by: grava os lembretes no banco mas não
      // agenda alarmes no sistema — o Retomar reagenda tudo
      const isSuspendedMed = editingId !== null &&
        !!medications.find(m => m.id === editingId)?.suspended;

      for (const e of newEntries) {
        const [h, m] = e.time.split(':').map(Number);
        const p = e.period ?? 'day';
        const ri = e.repeat_interval ?? 0;
        if (!isSuspendedMed) try {
          const notifName = data.commercial_name.trim() || data.generic_name;
          const isHerbal = isPhytotherapic(data.generic_name);
          if (p === 'day') await scheduleReminder(savedMedId, notifName, data.dose, h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('week:')) await scheduleReminderWeekly(savedMedId, notifName, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('month:')) await scheduleReminderMonthly(savedMedId, notifName, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('nmonths:')) {
            const [, nStr, dStr] = p.split(':');
            await scheduleReminderEveryNMonths(savedMedId, notifName, data.dose, Number(nStr), Number(dStr), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          }
        } catch {}
        await addReminder({ medication_id: savedMedId, time: e.time, period: e.period, with_sound: e.with_sound, is_active: true, repeat_interval: ri }).catch(() => {});
      }

      const isNew = editingId === null;
      const updated = await getMedications(true);
      setMedications(updated);
      setShowModal(false);

      setSuggestions([]); setCommercialSuggestions([]); setInteractions([]);
      setEditingId(null); setKnownDrug(false);
      setStockInput(''); setUnitsPerDoseInput('1'); setDurationDays(''); setHasDeadline(false);
      setReminders([]); resetPickerState(); setWizardStep('name'); lockOnlyRef.current = false;
      await syncNotification(updated);
      await refreshReminderTimes(savedMedId).catch(() => {});

      if (isNew) {
        navigation.navigate('Medications' as never);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Erro ao salvar', msg);
    }
  }

  async function handleSave() {
    if (!form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do medicamento.');
      return;
    }
    await doSaveWizard();
  }

  function parseDose(dose: string): { value: string; unit: string } {
    const parts = dose.trim().split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && DOSE_UNITS.includes(last)) {
      return { value: parts.slice(0, -1).join(' '), unit: last };
    }
    return { value: dose, unit: 'mg' };
  }

  function openWizard() {
    setForm(EMPTY_MED);
    setDoseValue(''); setDoseUnit('mg'); setDoseUnitTouched(false);
    setEditingId(null);
    setSuggestions([]); setCommercialSuggestions([]); setInteractions([]);
    setEntryType('medicamento'); setKnownDrug(false); setCustomNameConfirmed(false);
    setReminders([]); setStockInput(''); setUnitsPerDoseInput('1'); setDurationDays(''); setHasDeadline(false);
    setDeadlineTouched(false); setSoundTouched(false); setRepeatTouched(false);
    homeReminderRef.current = true; setHomeReminderEnabled(true);
    lockOnlyRef.current = false;
    resetPickerState();
    setEditSnapshot(null);
    setWizardStep('type');
    setShowModal(true);
  }

  function openEdit(item: Medication) {
    setForm({
      generic_name: item.generic_name,
      commercial_name: item.commercial_name,
      dose: item.dose,
      frequency: item.frequency,
      is_critical: item.is_critical,
      notes: item.notes,
      stock_quantity: item.stock_quantity,
      units_per_dose: item.units_per_dose ?? 1,
      end_date: item.end_date,
    });
    const parsed = parseDose(item.dose);
    setDoseValue(parsed.value); setDoseUnit(parsed.unit); setDoseUnitTouched(!!item.dose);
    setStockInput(item.stock_quantity != null ? String(item.stock_quantity) : '');
    setUnitsPerDoseInput(String(item.units_per_dose ?? 1));
    setDurationDays(item.end_date ? String(Math.max(0, daysRemaining(item.end_date))) : '');
    setHasDeadline(!!item.end_date);
    // Edição: botões refletem o que está salvo, então já entram acesos
    setDeadlineTouched(true); setSoundTouched(true); setRepeatTouched(true);
    homeReminderRef.current = item.home_reminder !== 0; setHomeReminderEnabled(item.home_reminder !== 0);
    lockOnlyRef.current = false;
    setEditingId(item.id);
    setSuggestions([]); setCommercialSuggestions([]); setKnownDrug(true); setCustomNameConfirmed(false);
    setEntryType(isPhytotherapic(item.generic_name) ? 'fitoterapico' : 'medicamento');
    setInteractions([]);
    resetPickerState(); setReminders([]);
    setEditSnapshot(null);
    setWizardStep('summary');
    setShowModal(true);
    getRemindersForMedication(item.id).then(rs => {
      setReminders(rs);
      if (rs.length > 0) populatePickerFromReminders(rs);
    }).catch(() => {});
    setTimeout(() => {
      const others = medications.filter(m => m.id !== item.id && !m.suspended).map(m => m.generic_name);
      setInteractions(checkInteractions(item.generic_name, others));
    }, 0);
  }

  // Abre as interações — mas só depois do aceite do termo. Uma vez aceito na sessão,
  // vai direto (pedir a cada toque geraria habituação e o aviso perderia o efeito).
  function requestInteractions(list: DrugInteraction[]) {
    if (hasAcceptedInteractionTerms()) setInteractionModal(list);
    else setPendingInteractions(list);
  }

  function stepNeedsNext(): boolean {
    if (editingId !== null) {
      // Edição: resumo tem "Salvar"; passos de toque voltam sozinhos ao resumo
      switch (wizardStep) {
        case 'period':
          return false;
        case 'deadline':
          return hasDeadline;
        default:
          return true;
      }
    }
    switch (wizardStep) {
      case 'type':
      case 'period':
        return false;
      case 'times_per_day':
        return mealMode;
      case 'deadline':
        return hasDeadline;
      default:
        return true;
    }
  }

  // Edição via resumo: cada passo confirma e volta ao resumo, exceto o sub-fluxo
  // de frequência (period → dias/vezes → horário), que precisa encadear.
  function editNextStep(cur: WizardStep, p: ReminderPeriod): WizardStep {
    switch (cur) {
      case 'period':
        return p === 'day' ? 'times_per_day' : p === 'week' ? 'weekdays' : p === 'month' ? 'month_days' : 'n_months';
      case 'times_per_day':
        return mealMode ? 'summary' : 'time';
      case 'weekdays':
      case 'month_days':
      case 'n_months':
        return 'time';
      default:
        return 'summary';
    }
  }

  // overridePeriod: pass the new period when calling from the period tap handler,
  // because React state won't have updated yet at call time.
  function wizGoNext(overridePeriod?: ReminderPeriod) {
    const p = overridePeriod ?? reminderPeriod;
    const isNew = editingId === null;
    const seq = getStepSequence(p, isNew, mealMode);
    const idx = seq.indexOf(wizardStep);

    if (wizardStep === 'name' && !form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do medicamento.');
      return;
    }
    // Silently report drug names not found in the local database
    if (wizardStep === 'name' && !knownDrug && form.generic_name.trim().length >= 3) {
      reportMissingDrug(form.generic_name.trim()).catch(() => {});
    }
    if (wizardStep === 'times_per_day' && mealMode) {
      const times = [mealCafe, mealAlmoco, mealJanta].filter(t => /^\d{1,2}:\d{2}$/.test(t));
      if (times.length === 0) {
        Alert.alert('Obrigatório', 'Informe ao menos um horário.');
        return;
      }
      setCustomTimes(times.join(' '));
      setTimesPerDay(times.length);
      setTimesPerDayTouched(true);
    }
    if (wizardStep === 'weekdays' && selectedWeekdays.length === 0) {
      Alert.alert('Selecione', 'Selecione ao menos um dia da semana.');
      return;
    }
    if (wizardStep === 'month_days' && selectedMonthDays.length === 0) {
      Alert.alert('Selecione', 'Selecione ao menos um dia do mês.');
      return;
    }
    // Na edição com vários horários/dia o picker pode estar vazio (customTimes cobre)
    if (wizardStep === 'time' && pickerH === null && !customTimes.trim()) {
      Alert.alert('Obrigatório', 'Defina o horário do primeiro aviso.');
      return;
    }

    if (!isNew) {
      setWizardStep(editNextStep(wizardStep, p));
      return;
    }

    if (idx >= seq.length - 1) {
      handleSave();
    } else {
      setWizardStep(seq[idx + 1]);
    }
  }

  function wizGoBack() {
    if (editingId !== null) {
      if (wizardStep === 'summary') setShowModal(false);
      else setWizardStep('summary');
      return;
    }
    const isNew = editingId === null;
    const seq = getStepSequence(reminderPeriod, isNew, mealMode);
    const idx = seq.indexOf(wizardStep);
    if (idx <= 0) {
      setShowModal(false);
    } else {
      setWizardStep(seq[idx - 1]);
    }
  }

  function computeSummaryRows(): { icon: string; label: string; value: string; step: WizardStep }[] {
    const schedText = (() => {
      if (reminderPeriod === 'week' && selectedWeekdays.length > 0) {
        const days = selectedWeekdays.slice().sort((a, b) => a - b).map(v => WEEKDAYS.find(w => w.value === v)?.label).filter(Boolean).join(', ');
        return `Semanal · ${days}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      if (reminderPeriod === 'month' && selectedMonthDays.length > 0) {
        return `Mensal · dias ${selectedMonthDays.slice().sort((a, b) => a - b).join(', ')}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      if (reminderPeriod === 'year') {
        return `A cada ${nMonths} ${Number(nMonths) > 1 ? 'meses' : 'mês'} · dia ${monthDay}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      const times = customTimes.trim()
        ? customTimes.trim().split(/\s+/).filter(t => /^\d{1,2}:\d{2}$/.test(t))
        : (pickerDisplay ? computeTimes(startTime, timesPerDay) : []);
      return times.length > 0 ? `Diário · ${times.join(' · ')}` : 'Sem lembrete — só tela de bloqueio';
    })();
    const deadlineDays = parseInt(durationDays, 10);
    return [
      { icon: '💊', label: 'Nome', value: form.commercial_name.trim() ? `${form.commercial_name.trim()} — ${form.generic_name}` : form.generic_name, step: 'name' },
      { icon: '⚖️', label: 'Dose e observações', value: [form.dose, form.notes].filter(Boolean).join('  ·  ') || 'Não informada', step: 'dose' },
      { icon: '🗓', label: 'Frequência e horários', value: schedText, step: 'period' },
      { icon: '📅', label: 'Prazo do tratamento', value: hasDeadline && !isNaN(deadlineDays) ? `${deadlineDays} dia${deadlineDays !== 1 ? 's' : ''} · termina ${formatEndDate(addDays(deadlineDays))}` : 'Sem prazo', step: 'deadline' },
      { icon: withSound ? '🔔' : '🔕', label: 'Alarme', value: `${withSound ? 'Sim' : 'Não'}  ·  Repete: ${repeatInterval > 0 ? 'Sim' : 'Não'}`, step: 'sound' },
      { icon: '📦', label: 'Estoque', value: stockInput.trim() ? `${stockInput.trim()} restantes  ·  1 dose = ${unitsPerDoseInput.trim() || '1'}` : 'Sem controle de estoque', step: 'stock' },
    ];
  }

  // Tira o snapshot do resumo assim que os lembretes carregam numa edição —
  // é o que dá pra comparar depois pra marcar o que o usuário alterou e ainda não salvou.
  useEffect(() => {
    if (editingId === null || !showModal) return;
    const snap: Record<string, string> = {};
    computeSummaryRows().forEach(r => { snap[r.step] = r.value; });
    setEditSnapshot(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders]);

  function renderWizardStep() {
    switch (wizardStep) {
      case 'type':
        return (
          <>
            <Text style={styles.wizLabel}>O que deseja adicionar?</Text>
            <View style={[styles.yesNoRow, { marginTop: 24, flexDirection: 'column', gap: 16 }]}>
              <TouchableOpacity
                style={styles.typeCardBtn}
                onPress={() => { setEntryType('medicamento'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); wizGoNext(); }}
              >
                <Text style={styles.typeCardIcon}>💊</Text>
                <Text style={styles.typeCardText}>Medicamento</Text>
                <Text style={styles.typeCardHint}>Prescritos ou de uso contínuo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.typeCardBtn}
                onPress={() => { setEntryType('fitoterapico'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); wizGoNext(); }}
              >
                <Text style={styles.typeCardIcon}>🌿</Text>
                <Text style={styles.typeCardText}>Fitoterápico</Text>
                <Text style={styles.typeCardHint}>Plantas medicinais e suplementos</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'name':
        return (
          <>
            <Text style={styles.wizLabel}>{entryType === 'fitoterapico' ? 'Nome do fitoterápico' : 'Nome do medicamento'}</Text>
            <Text style={styles.wizHint}>Digite o nome genérico ou comercial</Text>

            <View style={[styles.fieldLabelRow, { marginTop: 14 }]}>
              {form.generic_name.length >= 2 && suggestions.length === 0 && !knownDrug && !customNameConfirmed && (
                <ActivityIndicator size="small" color="#1C3F7A" style={{ marginLeft: 2, marginRight: 6 }} />
              )}
            </View>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={form.generic_name}
              onChangeText={handleGenericNameChange}
              autoCapitalize="words"
              placeholder={entryType === 'fitoterapico' ? 'Ex: Ginkgo Biloba...' : 'Ex: Losartana...'}
              placeholderTextColor="#bbb"
            />

            {entryType === 'fitoterapico' && form.generic_name.length > 0 && (() => {
              const phytoList = getSuggestions(form.generic_name, 34, 'Fitoterápico');
              const typed = form.generic_name.trim().toLowerCase();
              const exactMatch = phytoList.find(
                p => p.genericName.toLowerCase() === typed || (p.firstBrand ?? '').toLowerCase() === typed
              );
              return (
                <View style={styles.phytoGrid}>
                  {phytoList.map(p => {
                    const popular = p.firstBrand ?? p.genericName;
                    const scientific = p.genericName.replace(/\s*\(.*\)/, '').trim();
                    return (
                      <TouchableOpacity key={p.genericName} style={styles.phytoCard} onPress={() => applySuggestion(p)}>
                        <Text style={styles.phytoCardName} numberOfLines={2}>{popular}</Text>
                        <Text style={styles.phytoCardScientific} numberOfLines={1}>{scientific}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* Card com o nome exatamente como digitado — mesma lógica do fluxo de medicamento:
                      fica sempre disponível, mesmo com nome igual a alguma sugestão, pois o usuário pode
                      estar completando o nome. Continua sendo reportado ao Google Drive ao avançar.
                      Se o nome digitado bate exatamente com um item do BD, tocar aqui aplica o item do BD
                      (não o texto digitado), pra não reportar como "não encontrado" por engano. */}
                  {!knownDrug && !customNameConfirmed && (
                    <TouchableOpacity
                      style={[styles.phytoCard, styles.phytoCardTyped]}
                      onPress={() => {
                        if (exactMatch) { applySuggestion(exactMatch); return; }
                        Keyboard.dismiss(); setCustomNameConfirmed(true);
                      }}
                    >
                      <Text style={[styles.phytoCardName, styles.phytoCardNameTyped]} numberOfLines={2}>{form.generic_name.trim()}</Text>
                      <Text style={[styles.phytoCardScientific, styles.phytoCardScientificTyped]}>Digitado</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </>
        );

      case 'dose':
        return (
          <>
            <Text style={styles.wizLabel}>Dose</Text>
            <Text style={styles.wizHint}>Quantidade e unidade (opcional)</Text>
            <View style={styles.doseRow}>
              <TextInput
                style={[styles.fieldInput, styles.doseValueInput]}
                value={doseValue}
                onChangeText={v => {
                  setDoseValue(v);
                  setForm(f => ({ ...f, dose: v ? `${v} ${doseUnit}` : '' }));
                }}
                keyboardType="numeric"
                autoCapitalize="none"
              />
              <View style={styles.doseUnitRow}>
                {DOSE_UNITS.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.doseUnitBtn, doseUnitTouched && doseUnit === u && styles.doseUnitBtnActive]}
                    onPress={() => {
                      setDoseUnit(u); setDoseUnitTouched(true);
                      setForm(f => ({ ...f, dose: doseValue ? `${doseValue} ${u}` : '' }));
                    }}
                  >
                    <Text style={[styles.doseUnitText, doseUnitTouched && doseUnit === u && styles.doseUnitTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Observações (opcional)</Text>
            <TextInput
              style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top', marginTop: 4 }]}
              value={form.notes}
              onChangeText={v => setForm(f => ({ ...f, notes: v }))}
              multiline
            />
          </>
        );

      case 'period': {
        const periodOptions = [
          { p: 'day'   as ReminderPeriod, icon: '☀️', label: 'Todo Dia',  hint: 'Repetição diária' },
          { p: 'week'  as ReminderPeriod, icon: '📅', label: 'Semanal',   hint: 'Alguns dias da semana' },
          { p: 'month' as ReminderPeriod, icon: '🗓',  label: 'Mensal',    hint: 'Alguns dias do mês' },
          { p: 'year'  as ReminderPeriod, icon: '📆', label: 'Livre',     hint: 'A cada N meses' },
        ];
        return (
          <>
            <Text style={styles.wizLabel}>Com que frequência?</Text>
            <View style={[styles.periodCardRow, { marginTop: 16 }]}>
              {periodOptions.map(({ p, icon, label }) => {
                const isActive = editingId !== null && homeReminderEnabled && reminderPeriod === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.periodCardBtn, isActive && styles.periodCardBtnActive]}
                    onPress={() => { lockOnlyRef.current = false; homeReminderRef.current = true; setHomeReminderEnabled(true); setReminderPeriod(p); wizGoNext(p); }}
                  >
                    <Text style={styles.periodCardIcon}>{icon}</Text>
                    <Text style={[styles.periodCardText, isActive && styles.periodCardTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.lockOnlyBtn, editingId !== null && !homeReminderEnabled && styles.lockOnlyBtnActive]}
              onPress={() => { lockOnlyRef.current = true; homeReminderRef.current = false; handleSave(); }}
            >
              <Text style={[styles.lockOnlyBtnText, editingId !== null && !homeReminderEnabled && styles.lockOnlyBtnTextActive]}>🔒 Apenas Tela de Bloqueio</Text>
            </TouchableOpacity>
            <Text style={styles.lockOnlyHint}>
              Apenas Tela de Bloqueio: o medicamento só aparece na ficha médica para socorristas —
              sem alarme e sem registro no Histórico.
            </Text>
          </>
        );
      }

      case 'times_per_day': {
        if (mealMode) {
          const mealItems = [
            { label: '☕ Café da manhã', value: mealCafe, setter: setMealCafe, defaultH: 7 },
            { label: '🍽 Almoço', value: mealAlmoco, setter: setMealAlmoco, defaultH: 12 },
            { label: '🌙 Jantar', value: mealJanta, setter: setMealJanta, defaultH: 19 },
          ];
          return (
            <>
              <Text style={styles.wizLabel}>Horários das refeições</Text>
              <Text style={styles.wizHint}>Informe 1, 2 ou 3 horários</Text>
              {mealItems.map((item, idx) => (
                <View key={idx} style={{ marginTop: 14 }}>
                  <Text style={styles.fieldLabel}>
                    {item.label}
                    {idx > 0 ? <Text style={{ color: '#bbb', fontWeight: '400' }}> (opcional)</Text> : null}
                  </Text>
                  <TouchableOpacity
                    style={[styles.wizTimePicker, { padding: 16, marginTop: 6 }]}
                    onPress={() => setMealPickerTarget(idx)}
                  >
                    <Text style={[styles.wizTimePickerText, { fontSize: 36 }]}>{item.value || '——:——'}</Text>
                    <Text style={styles.wizTimePickerHint}>{item.value ? 'Toque para alterar' : 'Toque para definir'}</Text>
                  </TouchableOpacity>
                  {mealPickerTarget === idx && (
                    <DateTimePicker
                      value={(() => {
                        const d = new Date();
                        if (item.value) { const [h, m] = item.value.split(':').map(Number); d.setHours(h, m, 0, 0); }
                        else d.setHours(item.defaultH, 0, 0, 0);
                        return d;
                      })()}
                      mode="time"
                      is24Hour={true}
                      onChange={(e, d) => {
                        setMealPickerTarget(null);
                        if (e.type === 'set' && d) item.setter(fmtHM(d.getHours(), d.getMinutes()));
                      }}
                    />
                  )}
                </View>
              ))}
              <TouchableOpacity style={{ marginTop: 20 }} onPress={() => setMealMode(false)}>
                <Text style={[styles.wizBackBtnText, { color: '#888' }]}>‹ Outras opções</Text>
              </TouchableOpacity>
            </>
          );
        }
        return (
          <>
            <Text style={styles.wizLabel}>Vezes por dia</Text>
            <Text style={styles.wizHint}>Toque em uma opção para continuar</Text>
            {(() => {
              const registered = customTimes.trim()
                ? customTimes.trim().split(/\s+/).filter(t => /^\d{1,2}:\d{2}$/.test(t))
                : pickerH !== null ? [fmtHM(pickerH, pickerM ?? 0)] : [];
              if (registered.length === 0) return null;
              return (
                <Text style={{ marginTop: 10, color: '#555', fontSize: 13, textAlign: 'center' }}>
                  Registrado: {registered.join('  ·  ')}
                </Text>
              );
            })()}
            <View style={[styles.timesRow, { marginTop: 20 }]}>
              {TIMES_PER_DAY_OPTIONS.map(n => {
                const interval = 24 / n;
                const active = timesPerDayTouched && timesPerDay === n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.timesBtn, active && styles.timesBtnActive]}
                    onPress={() => { setTimesPerDay(n); setTimesPerDayTouched(true); setCustomTimes(''); setSpecificModeActive(false); wizGoNext(); }}
                  >
                    <Text style={[styles.timesBtnText, active && styles.timesBtnTextActive]}>{n}x</Text>
                    {n > 1 && (
                      <Text style={[styles.timesBtnSub, active && styles.timesBtnSubActive]}>de {interval} em {interval}h</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.yesNoBtn, { marginTop: 20, borderColor: '#E07B4F', width: '100%' }]}
              onPress={() => { setMealMode(true); setTimesPerDayTouched(false); }}
            >
              <Text style={[styles.yesNoBtnText, { color: '#E07B4F', fontSize: 14 }]}>🍽 Usar horários das refeições</Text>
            </TouchableOpacity>
          </>
        );
      }

      case 'weekdays':
        return (
          <>
            <Text style={styles.wizLabel}>Dias da semana</Text>
            <Text style={styles.wizHint}>Selecione um ou mais dias</Text>
            <View style={[styles.weekdayRow, { marginTop: 16 }]}>
              {WEEKDAYS.map(wd => {
                const sel = selectedWeekdays.includes(wd.value);
                return (
                  <TouchableOpacity
                    key={wd.value}
                    style={[styles.weekdayBtn, sel && styles.weekdayBtnActive]}
                    onPress={() => setSelectedWeekdays(prev =>
                      sel ? prev.filter(v => v !== wd.value) : [...prev, wd.value]
                    )}
                  >
                    <Text style={[styles.weekdayBtnText, sel && styles.weekdayBtnTextActive]}>{wd.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      case 'month_days':
        return (
          <>
            <Text style={styles.wizLabel}>Dias do mês</Text>
            <Text style={styles.wizHint}>Selecione um ou mais dias</Text>
            <View style={[styles.monthGrid, { marginTop: 16 }]}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
                const sel = selectedMonthDays.includes(d);
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.monthDayBtn, sel && styles.monthDayBtnActive]}
                    onPress={() => setSelectedMonthDays(prev =>
                      sel ? prev.filter(v => v !== d) : [...prev, d]
                    )}
                  >
                    <Text style={[styles.monthDayBtnText, sel && styles.monthDayBtnTextActive]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      case 'n_months':
        return (
          <>
            <Text style={styles.wizLabel}>Intervalo livre</Text>
            <Text style={styles.wizHint}>Para uso esporádico (ex: vitamina trimestral)</Text>
            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Repetir a cada quantos meses</Text>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={nMonths}
              onChangeText={setNMonths}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>No dia do mês (1–28)</Text>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={monthDay}
              onChangeText={setMonthDay}
              keyboardType="number-pad"
              maxLength={2}
            />
          </>
        );

      case 'time':
        return (
          <>
            <Text style={styles.wizLabel}>Horário do primeiro aviso</Text>
            <Text style={styles.wizHint}>Obrigatório — toque no relógio para definir</Text>
            <TouchableOpacity style={styles.wizTimePicker} onPress={() => setShowHorarioPicker(true)}>
              <Text style={styles.wizTimePickerText}>{pickerDisplay || '——:——'}</Text>
              <Text style={styles.wizTimePickerHint}>{pickerDisplay ? 'Toque para alterar' : 'Toque para definir o horário'}</Text>
            </TouchableOpacity>
            {customTimes.trim() !== '' && (
              <Text style={{ marginTop: 12, color: '#555', fontSize: 13, textAlign: 'center' }}>
                Horários do dia: {customTimes.trim().split(/\s+/).join('  ·  ')}
              </Text>
            )}
            {showHorarioPicker && (
              <DateTimePicker
                value={(() => { const d = new Date(); d.setHours(pickerH ?? 8, pickerM ?? 0, 0, 0); return d; })()}
                mode="time"
                is24Hour={true}
                onChange={(e, d) => {
                  setShowHorarioPicker(false);
                  if (e.type === 'set' && d) {
                    setPickerH(d.getHours()); setPickerM(d.getMinutes());
                    // Edição com vários horários/dia: customTimes guarda os horários antigos
                    // e vence no doSaveWizard — sem isto, o horário novo era ignorado.
                    // Desloca todos mantendo os intervalos (08:00/20:00 → 09:00/21:00).
                    if (customTimes.trim()) {
                      const times = customTimes.trim().split(/[\s,]+/).filter(t => /^\d{1,2}:\d{2}$/.test(t)).sort();
                      if (times.length > 0) {
                        const [oh, om] = times[0].split(':').map(Number);
                        const delta = (d.getHours() * 60 + d.getMinutes()) - (oh * 60 + om);
                        const shifted = times.map(t => {
                          const [h, m] = t.split(':').map(Number);
                          const total = ((h * 60 + m + delta) % 1440 + 1440) % 1440;
                          return fmtHM(Math.floor(total / 60), total % 60);
                        });
                        setCustomTimes(shifted.join(' '));
                      }
                    }
                  }
                }}
              />
            )}
          </>
        );

      case 'deadline':
        return (
          <>
            <Text style={styles.wizLabel}>Prazo do tratamento</Text>
            <Text style={styles.wizHint}>O tratamento tem uma data para terminar?</Text>
            <View style={[styles.yesNoRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtn, deadlineTouched && hasDeadline && styles.yesNoBtnActive]}
                onPress={() => { setHasDeadline(true); setDeadlineTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, deadlineTouched && hasDeadline && styles.yesNoBtnTextActive]}>Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtn, deadlineTouched && !hasDeadline && styles.yesNoBtnActive]}
                onPress={() => { setHasDeadline(false); setDeadlineTouched(true); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, deadlineTouched && !hasDeadline && styles.yesNoBtnTextActive]}>Não</Text>
              </TouchableOpacity>
            </View>
            {hasDeadline && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Duração em dias</Text>
                <TextInput
                  style={[styles.fieldInput, styles.wizBigInput]}
                  value={durationDays}
                  onChangeText={setDurationDays}
                  keyboardType="number-pad"
                  placeholder="Ex: 7"
                  placeholderTextColor="#bbb"
                />
                {durationDays.trim() !== '' && !isNaN(parseInt(durationDays)) && (
                  <Text style={styles.stockEndDatePreview}>
                    Termina em: {formatEndDate(addDays(parseInt(durationDays)))}
                  </Text>
                )}
              </>
            )}
          </>
        );

      case 'sound':
        return (
          <>
            <Text style={styles.wizLabel}>Alarme sonoro</Text>
            <View style={[styles.yesNoRow, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, soundTouched && withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(true); setSoundTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, soundTouched && withSound && styles.yesNoBtnTextActive]}>🔔 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, soundTouched && !withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(false); setRepeatInterval(0); setSoundTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, soundTouched && !withSound && styles.yesNoBtnTextActive]}>🔕 Não</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.wizLabel, { marginTop: 22, fontSize: 16 }]}>Repetir alarme — de 5 em 5 min por 30 min</Text>
            <View style={[styles.yesNoRow, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, repeatTouched && repeatInterval > 0 && styles.yesNoBtnActive, !withSound && styles.yesNoBtnDisabled]}
                disabled={!withSound}
                onPress={() => { setRepeatInterval(5); setRepeatTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, repeatTouched && repeatInterval > 0 && styles.yesNoBtnTextActive]}>🔁 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, repeatTouched && repeatInterval === 0 && styles.yesNoBtnActive]}
                onPress={() => { setRepeatInterval(0); setRepeatTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, repeatTouched && repeatInterval === 0 && styles.yesNoBtnTextActive]}>Não</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'stock':
        return (
          <>
            <View style={[styles.fieldLabelRow, { marginTop: 0 }]}>
              <Text style={styles.wizLabel}>Controle de estoque</Text>
              <TouchableOpacity onPress={() => setShowStockHelp(true)} style={{ marginLeft: 8 }}>
                <Text style={styles.stockHelpBtn}>?</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput, { marginTop: 16 }]}
              value={stockInput}
              onChangeText={setStockInput}
              keyboardType="number-pad"
              placeholder="Ex: 30    (Opcional)"
              placeholderTextColor="#bbb"
            />
            <Text style={{ fontSize: 12, color: '#999', marginTop: 6, marginLeft: 2 }}>
              Deixe em branco para não controlar o estoque
            </Text>
            {!!stockInput.trim() && (
              <View style={styles.unitsPerDoseRow}>
                <Text style={styles.unitsPerDoseText}>1 dose =</Text>
                <TextInput
                  style={styles.unitsPerDoseInput}
                  value={unitsPerDoseInput}
                  onChangeText={v => setUnitsPerDoseInput(v.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
                <Text style={styles.unitsPerDoseText}>
                  {(parseInt(unitsPerDoseInput, 10) || 1) === 1 ? 'cápsula/comprimido' : 'cápsulas/comprimidos'}
                </Text>
              </View>
            )}
          </>
        );

      case 'summary': {
        const rows = computeSummaryRows();
        return (
          <>
            <Text style={styles.wizLabel}>O que deseja alterar?</Text>
            <Text style={styles.wizHint}>Toque em um item para editar. Salvar aplica todas as alterações.</Text>
            <View style={{ marginTop: 14 }}>
              {rows.map(r => {
                const changed = editingId !== null && !!editSnapshot && editSnapshot[r.step] !== r.value;
                return (
                  <TouchableOpacity key={r.label} style={[styles.sumRow, changed && styles.sumRowChanged]} activeOpacity={0.7} onPress={() => setWizardStep(r.step)}>
                    <Text style={styles.sumIcon}>{r.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sumLabel}>{r.label}</Text>
                      <Text style={styles.sumValue} numberOfLines={3}>{r.value}</Text>
                    </View>
                    <Text style={styles.sumChevron}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {editingId !== null && !medications.find(m => m.id === editingId)?.suspended && (
              <TouchableOpacity style={styles.suspendBtn} onPress={handleSuspend}>
                <Text style={styles.suspendBtnText}>⏸ Colocar em stand-by</Text>
                <Text style={styles.suspendBtnHint}>Pausa alarmes e tela de bloqueio sem perder o setup</Text>
              </TouchableOpacity>
            )}
          </>
        );
      }

      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={medications}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading
              ? <ActivityIndicator size="large" color="#1C3F7A" />
              : <>
                  <Text style={styles.emptyText}>Nenhum medicamento cadastrado.</Text>
                  <Text style={styles.emptyHint}>Toque em + para adicionar.</Text>
                </>
            }
          </View>
        }
        renderItem={({ item }) => {
          // Stand-by: card compacto de uma linha — só nome + Retomar
          if (item.suspended) {
            return (
              <TouchableOpacity
                style={styles.suspendedCard}
                activeOpacity={0.85}
                onPress={() => openEdit(item)}
                accessibilityLabel={`${item.generic_name} em stand-by. Toque para editar.`}
              >
                <Text style={styles.suspendedIcon}>⏸</Text>
                <Text style={styles.suspendedName} numberOfLines={1}>
                  {item.commercial_name ? `${item.commercial_name} — ${item.generic_name}` : item.generic_name}
                </Text>
                <TouchableOpacity
                  style={styles.resumeBtn}
                  onPress={() => handleResume(item)}
                  accessibilityLabel={`Retomar ${item.generic_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.resumeBtnText}>Retomar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)} accessibilityLabel={`Remover ${item.generic_name}`} accessibilityRole="button">
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }
          const itemInteractions = cardInteractions.get(item.id) ?? [];
          const hasHighRisk = itemInteractions.some(i => i.risk_level === 'critical' || i.risk_level === 'high');
          const times = reminderTimes.get(item.id) ?? [];
          const hasSound = reminderHasSound.get(item.id) ?? false;
          const meta = reminderMeta.get(item.id);
          const periodType = meta?.periodType ?? 'day';
          const repeatInt = meta?.repeat ?? 0;
          const dailyDoses = periodType === 'day' ? (times.length || 1) : 1;
          const unitsPerDose = item.units_per_dose || 1;
          const daysLeft = item.stock_quantity != null ? Math.floor(item.stock_quantity / (dailyDoses * unitsPerDose)) : null;
          const stockLow = daysLeft != null && daysLeft <= 3;

          let scheduleStr = '';
          if (times.length > 0) {
            if (periodType === 'day') {
              scheduleStr = times.join('  ·  ') + (times.length > 1 ? `  (${times.length}×/dia)` : '  · diário');
            } else if (periodType === 'week') {
              const t = times[0]?.split(' · ')[0] ?? '';
              const days = times.map(s => s.split(' · ')[1] ?? '').filter(Boolean);
              scheduleStr = `${t} · ${days.join(', ')}  (semanal)`;
            } else {
              scheduleStr = times[0] ?? '';
              if (times.length > 1) scheduleStr += `  +${times.length - 1}`;
            }
          }

          const hasAnyInfo = item.dose || times.length > 0 || item.notes || item.stock_quantity != null || item.end_date;

          return (
          <TouchableOpacity style={[styles.medCard, hasHighRisk && styles.medCardCritical]} activeOpacity={0.85} onPress={() => openEdit(item)}>
            {/* Header: name + delete */}
            <View style={styles.medHeader}>
              <Text style={styles.criticalIcon}>{isPhytotherapic(item.generic_name) ? '🌿' : '💊'}</Text>
              <Text style={styles.medGeneric} numberOfLines={2}>
                {item.commercial_name ? `${item.commercial_name} — ${item.generic_name}` : item.generic_name}
              </Text>
              {(knownMedsSet.has(item.generic_name.toLowerCase()) || isPhytotherapic(item.generic_name)) && (
                <TouchableOpacity
                  style={styles.bulaCardBtn}
                  accessibilityLabel={`Ver bula de ${item.generic_name}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const url = isPhytotherapic(item.generic_name)
                      ? getPhytoBulaUrl(item.generic_name, item.commercial_name || undefined)
                      : getBulaUrl(item.generic_name, item.commercial_name || undefined);
                    openBula(url, item.generic_name);
                  }}
                >
                  <Text style={styles.bulaCardBtnText}>📋</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)} accessibilityLabel={`Remover ${item.generic_name}`} accessibilityRole="button">
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* Setup info */}
            <View style={styles.medInfo}>
              {scheduleStr ? <Text style={styles.medDetail}>🕐 {scheduleStr}</Text> : null}
              {item.dose ? <Text style={styles.medDetail}>⚖️ {item.dose}</Text> : null}
              {item.stock_quantity != null && (
                <Text style={[styles.medDetail, stockLow && styles.stockTextLow]}>
                  {'💊 '}{item.stock_quantity} restante{item.stock_quantity !== 1 ? 's' : ''}
                  {unitsPerDose > 1 ? ` (1 dose = ${unitsPerDose})` : ''}
                  {daysLeft != null ? ` · ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''}` : ''}
                  {stockLow ? '  ⚠ baixo' : ''}
                </Text>
              )}
              {item.end_date && (
                <Text style={[styles.medDetail, daysRemaining(item.end_date) <= 0 && styles.endDateDone]}>
                  {daysRemaining(item.end_date) > 0
                    ? `📅 ${formatEndDate(item.end_date)} · ${daysRemaining(item.end_date)} dia${daysRemaining(item.end_date) !== 1 ? 's' : ''} restantes`
                    : `📅 ${formatEndDate(item.end_date)} · encerrado`}
                </Text>
              )}
              {times.length > 0 && (
                <Text style={styles.medDetail}>
                  {hasSound ? '🔔' : '🔕'} Alarme: {hasSound ? 'Sim' : 'Não'}  ·  Repete: {repeatInt > 0 ? 'Sim' : 'Não'}
                </Text>
              )}
              {item.notes ? <Text style={styles.medNotes}>📝 {item.notes}</Text> : null}
              {times.length === 0 && hasAnyInfo && (
                <Text style={styles.medNoReminderHint}>🔒 Sem lembrete nem histórico — aparece só na ficha da tela de bloqueio</Text>
              )}
              {!hasAnyInfo && <Text style={styles.medEditHint}>Toque para configurar →</Text>}
            </View>
            {itemInteractions.length > 0 && (() => {
              // Só a contagem, com a cor do risco mais alto. Listar cada interação no cartão
              // polui a lista e, pior, banaliza o alerta — o detalhe fica no modal.
              const worst = itemInteractions.some(i => i.risk_level === 'critical') ? 'critical'
                : itemInteractions.some(i => i.risk_level === 'high') ? 'high' : 'moderate';
              const color = worst === 'critical' ? '#CC0000' : worst === 'high' ? '#e65c00' : '#b58900';
              const n = itemInteractions.length;
              return (
                <TouchableOpacity
                  style={[styles.cardInteractionRow, { borderColor: color }]}
                  activeOpacity={0.7}
                  onPress={() => requestInteractions(itemInteractions)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ${n} ${n > 1 ? 'interações' : 'interação'}`}
                >
                  <Text style={[styles.cardInteractionText, { color }]}>
                    ⚠ {n} {n > 1 ? 'interações' : 'interação'}
                  </Text>
                  <Text style={[styles.cardInteractionChevron, { color }]}>›</Text>
                </TouchableOpacity>
              );
            })()}
          </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openWizard} accessibilityLabel="Adicionar medicamento" accessibilityRole="button">
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Wizard modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <View style={styles.wizModalBox}>
              {/* Progress bar — só no cadastro novo; a edição navega pelo resumo */}
              {editingId === null && (() => {
                const seq = getStepSequence(reminderPeriod, true, mealMode);
                const idx = Math.max(0, seq.indexOf(wizardStep));
                const pct = `${Math.round((idx + 1) / seq.length * 100)}%`;
                return (
                  <View style={styles.wizProgress}>
                    <View style={[styles.wizProgressBar, { width: pct as any }]} />
                  </View>
                );
              })()}

              {/* Header */}
              <View style={styles.wizHeader}>
                <Text style={styles.wizHeaderLabel}>
                  {editingId !== null
                    ? (entryType === 'fitoterapico' ? '✏️ Editando Fitoterápico' : '✏️ Editando Medicamento')
                    : (entryType === 'fitoterapico' ? '🌿 Novo Fitoterápico' : '💊 Novo Medicamento')}
                </Text>
                {form.generic_name.trim() ? (
                  <Text style={styles.wizHeaderName} numberOfLines={1}>
                    {form.commercial_name.trim()
                      ? `${form.commercial_name.trim()} — ${form.generic_name.trim()}`
                      : form.generic_name.trim()}
                  </Text>
                ) : null}
              </View>

              {/* Step content */}
              <ScrollView
                ref={wizStepScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={[styles.wizContent, { paddingBottom: insets.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
              >
                {renderWizardStep()}

                {/* Footer — dentro do scroll para não ocupar espaço fixo com o teclado aberto */}
                <View style={styles.wizFooter}>
                  <TouchableOpacity
                    style={[styles.wizBackBtn, !stepNeedsNext() && { flex: 0, paddingHorizontal: 24, borderColor: '#ddd' }]}
                    onPress={wizGoBack}
                  >
                    <Text style={styles.wizBackBtnText}>
                      {editingId !== null
                        ? (wizardStep === 'summary' ? 'Cancelar' : '‹ Resumo')
                        : '‹ Voltar'}
                    </Text>
                  </TouchableOpacity>
                  {stepNeedsNext() && (() => {
                    // Editando: "OK"/"Próximo" só volta pro resumo, não salva nada ainda —
                    // fica com a mesma cor neutra do "Resumo" pra não parecer que já confirmou.
                    const isEditIntermediate = editingId !== null && wizardStep !== 'summary';
                    return (
                      <TouchableOpacity
                        style={[styles.wizNextBtn, isEditIntermediate && styles.wizNextBtnPlain]}
                        onPress={() => (wizardStep === 'summary' ? handleSave() : wizGoNext())}
                      >
                        <Text style={[styles.wizNextBtnText, isEditIntermediate && styles.wizNextBtnTextPlain]}>
                          {(() => {
                            if (editingId !== null) {
                              if (wizardStep === 'summary') return 'Salvar ✓';
                              return editNextStep(wizardStep, reminderPeriod) === 'summary' ? 'OK ✓' : 'Próximo ›';
                            }
                            const seq = getStepSequence(reminderPeriod, true, mealMode);
                            const idx = seq.indexOf(wizardStep);
                            return idx >= seq.length - 1 ? 'Salvar ✓' : 'Próximo ›';
                          })()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              </ScrollView>

              {/* Suggestions fixas acima do teclado — visíveis mesmo com teclado aberto */}
              {wizardStep === 'name' && entryType !== 'fitoterapico' && !knownDrug && !customNameConfirmed
                && form.generic_name.trim().length >= 2 && (
                <ScrollView
                  style={styles.suggestionsFloating}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {suggestions.map(s => (
                    <View key={s.label} style={styles.suggestionRow}>
                      <TouchableOpacity
                        style={[styles.suggestionChip, s.isBrand && styles.suggestionChipBrand]}
                        onPress={() => applySuggestion(s)}
                      >
                        <Text style={[styles.suggestionChipText, s.isBrand && styles.suggestionChipTextBrand]} numberOfLines={1}>
                          {s.label}
                        </Text>
                        {s.category ? (
                          <Text style={[styles.suggestionCategory, s.isBrand && styles.suggestionCategoryBrand]}>
                            {s.category}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.bulaBtn} onPress={() => openBula(s.bulaUrl, s.genericName)} accessibilityLabel={`Ver bula de ${s.genericName}`} accessibilityRole="button">
                        <Text style={styles.bulaBtnText}>📋</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {/* Card com o nome exatamente como digitado — dá segurança a quem não acha o remédio na lista.
                      Fica sempre disponível (mesmo com nome igual a alguma sugestão) porque o usuário pode
                      ainda estar completando o nome com um complemento/tipo diferente.
                      O nome continua sendo reportado ao Google Drive (via wizGoNext) para entrarmos com ele no BD.
                      Se o nome digitado bate exatamente com uma sugestão, tocar aqui aplica a sugestão do BD
                      (não o texto digitado), pra não reportar como "não encontrado" por engano. */}
                  <View style={styles.suggestionRow}>
                    <TouchableOpacity
                      style={[styles.suggestionChip, styles.suggestionChipTyped]}
                      onPress={() => {
                        const typed = form.generic_name.trim().toLowerCase();
                        const exactMatch = suggestions.find(
                          s => s.label.toLowerCase() === typed || s.genericName.toLowerCase() === typed
                        );
                        if (exactMatch) { applySuggestion(exactMatch); return; }
                        Keyboard.dismiss(); setCustomNameConfirmed(true);
                      }}
                    >
                      <Text style={[styles.suggestionChipText, styles.suggestionChipTextTyped]} numberOfLines={1}>
                        {form.generic_name.trim()}
                      </Text>
                      <Text style={[styles.suggestionCategory, styles.suggestionCategoryTyped]}>
                        Digitado
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {bulaModal}

      {/* Interaction detail modal (from card tap) */}
      {/* Termo de ciência — precede a exibição das interações */}
      <InteractionConsentModal
        visible={!!pendingInteractions}
        onCancel={() => setPendingInteractions(null)}
        onAccept={() => {
          acceptInteractionTerms();
          setInteractionModal(pendingInteractions);
          setPendingInteractions(null);
        }}
      />

      <Modal visible={!!interactionModal} animationType="slide" transparent onRequestClose={() => setInteractionModal(null)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Interações detectadas</Text>
            <MedDisclaimer />
            <ScrollView>
              {/* Cartão ÚNICO (components/CartaoInteracao) — traz fonte, aviso de IA e
                  botão de informar erro, que esta cópia não tinha. */}
              {(interactionModal ?? []).map(i => (
                <CartaoInteracao key={i.id} item={i} aberto />
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setInteractionModal(null)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Stock help modal */}
      <Modal visible={showStockHelp} animationType="slide" transparent onRequestClose={() => setShowStockHelp(false)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Controle de estoque</Text>
            <ScrollView>
              <Text style={styles.stockHelpText}>
                O controle de estoque ajuda você a saber quantos comprimidos ou doses restam e quando precisa comprar mais.
              </Text>
              <Text style={styles.stockHelpSubtitle}>Como funciona</Text>
              <Text style={styles.stockHelpText}>
                1. Informe a quantidade atual de comprimidos ou cápsulas que você tem em casa.{'\n\n'}
                2. Se cada dose for mais de 1 cápsula/comprimido, informe quantas em "1 dose = ".{'\n\n'}
                3. A cada vez que tomar o medicamento, toque em <Text style={{ fontWeight: '700' }}>Tomei</Text> no aviso de alarme ou em <Text style={{ fontWeight: '700' }}>Tomar</Text> no card. O estoque diminui automaticamente de acordo com a dose.{'\n\n'}
                4. Quando o estoque ficar baixo (menos de 3 dias de doses), você verá um aviso.
              </Text>
              <View style={styles.stockHelpTip}>
                <Text style={styles.stockHelpTipText}>
                  💡 O controle de estoque requer que a repetição de alarme esteja ativa.
                </Text>
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowStockHelp(false)}>
              <Text style={styles.intModalCloseText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  list: { padding: 16, paddingBottom: 160 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb' },
  medCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  medCardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  medCardCritical: { borderLeftWidth: 4, borderLeftColor: '#CC0000' },
  medInfo: { flex: 1, paddingTop: 2, paddingBottom: 4 },
  medHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 2 },
  criticalIcon: { fontSize: 16 },
  medGeneric: { fontSize: 15, fontWeight: '600', color: '#222', flex: 1 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  medEditHint: { fontSize: 12, color: '#1C3F7A', marginTop: 4, fontStyle: 'italic' },
  medNoReminderHint: { fontSize: 12, color: '#8A8F9D', marginTop: 4, fontStyle: 'italic' },
  medActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Stock
  stockSection: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 14 },
  stockSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stockSectionTitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A' },
  stockHelpText: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 8 },
  stockHelpSubtitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A', marginTop: 8, marginBottom: 4 },
  stockHelpTip: { backgroundColor: '#FFF8E7', borderRadius: 8, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: '#E07B4F' },
  stockHelpTipText: { fontSize: 12, color: '#7a5200', lineHeight: 18 },
  stockEndDatePreview: { fontSize: 12, color: '#1a6b3a', marginTop: 4, fontStyle: 'italic' },
  stockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  stockText: { fontSize: 12, color: '#555', flex: 1 },
  stockTextLow: { color: '#E07B4F', fontWeight: '600' },
  unitsPerDoseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  unitsPerDoseText: { fontSize: 14, color: '#444' },
  unitsPerDoseInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    fontSize: 15, fontWeight: '600', color: '#222', backgroundColor: '#fafafa', textAlign: 'center', width: 48,
  },
  takenBtn: { backgroundColor: '#1C3F7A', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 },
  takenBtnText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  endDateText: { fontSize: 12, color: '#888', marginTop: 4 },
  endDateDone: { color: '#CC0000' },
  cardInteractionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5,
  },
  cardInteractionText: { fontSize: 11.5, fontWeight: '700' },
  cardInteractionChevron: { fontSize: 15, fontWeight: '700' },
  intModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  intModalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  intModalTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  intModalItem: { borderLeftWidth: 3, borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fafafa' },
  intModalBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 4 },
  intModalBadgeText: { fontSize: 10, fontWeight: '600' },
  intModalDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  intModalDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  intModalMechanismBox: { borderRadius: 8, padding: 10, marginTop: 8, backgroundColor: '#F2F4F8' },
  intModalMechanismTitle: { fontSize: 11, fontWeight: '700', color: '#444', marginBottom: 4 },
  intModalMechanismText: { fontSize: 12, color: '#333', lineHeight: 18 },
  intModalClose: { marginTop: 12, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  intModalCloseText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  bellBtn: { padding: 8, marginLeft: 4, borderRadius: 8 },
  bellBtnText: { fontSize: 18 },
  bulaCardBtn: { padding: 8, marginLeft: 4 },
  bulaCardBtnText: { fontSize: 18 },
  deleteBtn: { padding: 8, marginLeft: 4 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },
  fab: {
    position: 'absolute', bottom: 80, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1C3F7A', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1C3F7A', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Wizard modal
  wizModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: '90%',
  },
  wizProgress: { height: 4, backgroundColor: '#f0f0f0', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  wizProgressBar: { height: 4, backgroundColor: '#1C3F7A' },
  wizHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  wizHeaderLabel: { fontSize: 12, color: '#999', fontWeight: '500', letterSpacing: 0.3 },
  wizHeaderName: { fontSize: 15, fontWeight: '700', color: '#1C3F7A', marginTop: 2 },
  wizContent: { padding: 20 },
  wizLabel: { fontSize: 20, fontWeight: '700', color: '#1C3F7A', marginBottom: 6 },
  wizHint: { fontSize: 14, color: '#666', lineHeight: 20 },
  wizBigInput: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  wizTimePicker: {
    marginTop: 24, backgroundColor: '#F2F4F8', borderRadius: 16,
    padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  wizTimePickerText: { fontSize: 48, fontWeight: '700', color: '#1C3F7A', letterSpacing: 2 },
  wizTimePickerHint: { fontSize: 13, color: '#999', marginTop: 8 },
  wizFooter: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#f0f0f0', backgroundColor: '#fff',
    marginHorizontal: -20,
  },
  wizBackBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizBackBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  wizNextBtn: { flex: 2, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizNextBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  wizNextBtnPlain: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ccc' },
  wizNextBtnTextPlain: { color: '#666' },
  // Type selection cards
  typeCardBtn: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 16, padding: 24,
    alignItems: 'center', backgroundColor: '#fff',
  },
  typeCardIcon: { fontSize: 36, marginBottom: 8 },
  typeCardText: { fontSize: 18, fontWeight: '700', color: '#1C3F7A' },
  typeCardHint: { fontSize: 13, color: '#888', marginTop: 4 },
  // Yes/No
  yesNoRow: { flexDirection: 'row', gap: 12 },
  yesNoBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, paddingVertical: 22, alignItems: 'center' },
  yesNoBtnSm: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  yesNoBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  yesNoBtnDisabled: { opacity: 0.4 },
  yesNoBtnText: { fontSize: 16, color: '#555', fontWeight: '700' },
  yesNoBtnTextActive: { color: '#fff' },
  // Period cards
  periodCardRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  periodCardBtn: {
    width: '47%', borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center',
  },
  periodCardBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  periodCardIcon: { fontSize: 28, marginBottom: 6 },
  periodCardText: { fontSize: 14, color: '#333', fontWeight: '700' },
  periodCardTextActive: { color: '#fff' },
  periodCardHint: { fontSize: 11, color: '#888', textAlign: 'center' },
  lockOnlyBtn: {
    marginTop: 12, borderWidth: 1.5, borderColor: '#C8CDD8', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  lockOnlyBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  lockOnlyBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  lockOnlyBtnTextActive: { color: '#fff' },
  lockOnlyHint: { fontSize: 12, color: '#8A8F9D', marginTop: 8, lineHeight: 17, paddingHorizontal: 2 },
  // Autocomplete
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4 },
  fieldLabel: { fontSize: 13, color: '#555' },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  suggestionsBox: { marginTop: 6, gap: 4 },
  suggestionsFloating: {
    maxHeight: 220, borderTopWidth: 1, borderTopColor: '#f0f0f0',
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', gap: 4,
  },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggestionChip: { flex: 1, backgroundColor: '#e8edf7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#c0ccdf' },
  suggestionChipBrand: { backgroundColor: '#f0e8f7', borderColor: '#c8b0dd' },
  suggestionChipText: { fontSize: 14, color: '#1C3F7A', fontWeight: '600' },
  suggestionChipTextBrand: { color: '#6b1a8a' },
  suggestionCategory: { fontSize: 11, color: '#7a92b8', marginTop: 1 },
  suggestionCategoryBrand: { color: '#9a72b8' },
  suggestionChipTyped: { backgroundColor: '#fbe8dd', borderColor: '#E07B4F' },
  suggestionChipTextTyped: { color: '#b45526' },
  suggestionCategoryTyped: { color: '#c46a3a' },
  bulaBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#f0f4ff', borderWidth: 1, borderColor: '#c0ccdf', justifyContent: 'center', alignItems: 'center' },
  bulaBtnText: { fontSize: 16 },
  reportMissingBtn: { marginTop: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#b0b8c8', alignSelf: 'flex-start' },
  reportMissingText: { fontSize: 12, color: '#7a8099' },
  reportedText: { fontSize: 12, color: '#5a9a6a', marginTop: 6 },
  reportConfirmBox: { marginTop: 8, padding: 10, backgroundColor: '#f5f6fa', borderRadius: 8, borderWidth: 1, borderColor: '#dde' },
  reportConfirmLabel: { fontSize: 12, color: '#555', marginBottom: 6 },
  reportConfirmInput: { borderWidth: 1, borderColor: '#ccd', borderRadius: 6, padding: 8, fontSize: 14, backgroundColor: '#fff' },
  reportConfirmBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, gap: 8 },
  reportCancelBtn: { paddingVertical: 6, paddingHorizontal: 14 },
  reportCancelText: { fontSize: 13, color: '#888' },
  reportSendBtn: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#4a6fa5', borderRadius: 6 },
  reportSendText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  // Reminder day config
  horarioInlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4, gap: 12 },
  horarioLabel: { fontSize: 15, fontWeight: '700', color: '#1C3F7A' },
  timeFieldInputInline: { fontSize: 20, fontWeight: '700', color: '#1C3F7A', paddingVertical: 2, minWidth: 72, letterSpacing: 2, textAlign: 'center' },
  timeFieldPlaceholder: { color: '#BEC8E0' },
  timesRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  doseRow: { gap: 12 },
  doseValueInput: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  doseUnitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  doseUnitBtn: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
  doseUnitBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  doseUnitText: { fontSize: 14, color: '#555', fontWeight: '600' },
  doseUnitTextActive: { color: '#fff' },
  timesBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  timesBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  timesBtnText: { fontSize: 14, color: '#555', fontWeight: '600' },
  timesBtnTextActive: { color: '#fff' },
  timesBtnSub: { fontSize: 10, color: '#888', marginTop: 3, textAlign: 'center' },
  timesBtnSubActive: { color: 'rgba(255,255,255,0.8)' },
  specificTimesRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 12, marginBottom: 4 },
  specificTimesLabel: { fontSize: 13, color: '#555', fontWeight: '600' },
  specificTimesInput: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', textAlign: 'center', minWidth: 56, paddingVertical: 1 },
  addTimeBtn: { marginLeft: 8, backgroundColor: '#1C3F7A', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  addTimeBtnText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 26 },
  customTimesBox: { backgroundColor: '#F2F4F8', borderRadius: 8, padding: 10, marginTop: 4, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.1)' },
  customTimesText: { fontSize: 15, color: '#1C3F7A', fontWeight: '600', letterSpacing: 1 },
  timesChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  timesChip: { backgroundColor: '#1C3F7A', color: '#fff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, fontSize: 14, fontWeight: '700' },
  timesPreview: { backgroundColor: '#f0f4ff', borderRadius: 8, padding: 12, marginTop: 12 },
  timesPreviewLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  weekdayRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  weekdayBtn: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', minWidth: 44 },
  weekdayBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  weekdayBtnText: { fontSize: 12, color: '#555', fontWeight: '600' },
  weekdayBtnTextActive: { color: '#fff' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  monthDayBtn: { width: 40, height: 36, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  monthDayBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  monthDayBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  monthDayBtnTextActive: { color: '#fff' },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  typeBtnActiveGreen: { backgroundColor: '#1a6b3a', borderColor: '#1a6b3a' },
  typeBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },
  phytoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  phytoCard: { width: '47%', backgroundColor: '#f0f7f0', borderRadius: 10, borderWidth: 1, borderColor: '#a8d5a8', padding: 10 },
  phytoCardName: { fontSize: 13, fontWeight: '700', color: '#1a6b3a', marginBottom: 2 },
  phytoCardScientific: { fontSize: 10, color: '#5a9a6a', fontStyle: 'italic' },
  phytoCardTyped: { backgroundColor: '#fbe8dd', borderColor: '#E07B4F' },
  phytoCardNameTyped: { color: '#b45526' },
  phytoCardScientificTyped: { color: '#c46a3a', fontStyle: 'normal' },
  stockActionBtn: { backgroundColor: '#1C3F7A', borderRadius: 10, padding: 16, marginBottom: 12 },
  stockActionBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  stockActionBtnHint: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
  stockActionEditRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12 },
  stockActionEditLabel: { fontSize: 13, fontWeight: '600', color: '#1C3F7A', marginBottom: 8 },
  stockActionEditInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockActionEditInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, color: '#222', backgroundColor: '#fafafa', textAlign: 'center' },
  stockActionSaveBtn: { backgroundColor: '#E07B4F', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  stockActionSaveBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  stockActionInfo: { backgroundColor: '#FFF8E7', borderRadius: 8, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#E07B4F' },
  stockActionInfoText: { fontSize: 12, color: '#7a5200', lineHeight: 18 },
  stockHelpBtn: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#1C3F7A', textAlign: 'center', lineHeight: 16, fontSize: 11, fontWeight: '700', color: '#1C3F7A' },
  // Resumo de edição
  sumRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  sumRowChanged: { borderLeftWidth: 3, borderLeftColor: '#1C3F7A' },
  sumIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  sumLabel: { fontSize: 11, color: '#8A8F9D', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  sumValue: { fontSize: 14, color: '#1A1F2E', fontWeight: '600', marginTop: 2 },
  sumChevron: { fontSize: 22, color: '#C0C5D0' },
  // Stand-by
  suspendBtn: {
    marginTop: 6, borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#C0C5D0', borderStyle: 'dashed',
  },
  suspendBtnText: { fontSize: 14, fontWeight: '600', color: '#8A8F9D' },
  suspendBtnHint: { fontSize: 11, color: '#B0B5C0', marginTop: 2 },
  suspendedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)', opacity: 0.75,
  },
  suspendedIcon: { fontSize: 14, color: '#8A8F9D' },
  suspendedName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#8A8F9D' },
  resumeBtn: {
    borderWidth: 1, borderColor: '#1C3F7A', borderRadius: 14,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  resumeBtnText: { fontSize: 12, fontWeight: '700', color: '#1C3F7A' },
});
