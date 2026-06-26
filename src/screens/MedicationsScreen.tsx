import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView, Share,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, updateMedication, deleteMedication,
  getRemindersForMedication, addReminder, deleteReminder, updateAllRemindersSound, updateMedicationStock,
} from '../database/db';
import {
  scheduleReminderWeekly, scheduleReminderMonthly, scheduleReminderEveryNMonths,
} from '../services/notifications';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelAllRemindersForMedication,
} from '../services/notifications';
import { Medication, MedicationReminder, DrugInteraction } from '../types';
import { DrugSuggestion, getSuggestions, getBulaUrl, getPhytoBulaUrl, checkInteractions, checkSubstanceInteractions, isPhytotherapic } from '../utils/drugSearch';
import { useBulaViewer } from '../utils/useBulaViewer';
import { reportMissingDrug } from '../services/reportMissing';
// ──────────────────────────────────────────────────────────────────────────────

function buildDoctorMessage(drugName: string, interactions: DrugInteraction[]): string {
  const pairs = interactions
    .map(i => `• ${i.drug1} + ${i.drug2}: ${i.risk_description}`)
    .join('\n');
  return (
    `Olá, estou iniciando o uso de ${drugName} e identifiquei interações medicamentosas com outros remédios que já tomo:\n\n${pairs}\n\n` +
    `Poderia avaliar se há riscos para o meu tratamento e orientar sobre o uso concomitante?`
  );
}

const EMPTY_MED: Omit<Medication, 'id'> = {
  generic_name: '', commercial_name: '', dose: '', frequency: '', is_critical: false, notes: '',
  stock_quantity: null, end_date: null,
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
const DOSE_UNITS = ['mg', 'g', 'mcg', 'UI', 'mL', '%', 'cáps'];
type ReminderPeriod = 'day' | 'week' | 'month' | 'year';
type WizardStep = 'type' | 'name' | 'dose' | 'period' | 'times_per_day' | 'weekdays' | 'month_days' | 'n_months' | 'time' | 'deadline' | 'sound' | 'repeat' | 'stock';

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
  base.push('deadline', 'sound', 'repeat', 'stock');
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
  const [commercialSuggestions, setCommercialSuggestions] = useState<DrugSuggestion[]>([]);
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [substanceInteractions, setSubstanceInteractions] = useState<DrugInteraction[]>([]);
  const [postSaveInteractions, setPostSaveInteractions] = useState<DrugInteraction[]>([]);
  const [entryType, setEntryType] = useState<'medicamento' | 'fitoterapico'>('medicamento');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardInteractions, setCardInteractions] = useState<Map<number, DrugInteraction[]>>(new Map());
  const [interactionModal, setInteractionModal] = useState<DrugInteraction[] | null>(null);
  const [stockInput, setStockInput] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [showStockHelp, setShowStockHelp] = useState(false);
  const [showInteractionWarning, setShowInteractionWarning] = useState(false);
  const [stockActionMed, setStockActionMed] = useState<Medication | null>(null);
  const [stockEditValue, setStockEditValue] = useState('');
  useEffect(() => {
    if (stockActionMed) setStockEditValue(String(stockActionMed.stock_quantity ?? 0));
  }, [stockActionMed]);

  // Wizard
  const [wizardStep, setWizardStep] = useState<WizardStep>('name');

  // Reminder / picker state
  const [reminderHasSound, setReminderHasSound] = useState<Map<number, boolean>>(new Map());
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

  const route = useRoute<RouteProp<{ Medications: { openMedId?: number } }, 'Medications'>>();

  const load = useCallback(async () => {
    setLoading(true);
    let meds: Medication[] = [];
    try {
      meds = await getMedications();
      setMedications(meds);
      const interactionMap = new Map<number, DrugInteraction[]>();
      const timesMap = new Map<number, string[]>();
      const soundMap = new Map<number, boolean>();
      await Promise.all(meds.map(async (med) => {
        const others = meds.filter(m => m.id !== med.id).map(m => m.generic_name);
        const ints = checkInteractions(med.generic_name, others);
        if (ints.length > 0) interactionMap.set(med.id, ints);
        const rs = await getRemindersForMedication(med.id);
        timesMap.set(med.id, rs.filter(r => r.is_active).map(r => periodLabel(r.period, r.time)));
        soundMap.set(med.id, rs.some(r => r.is_active && r.with_sound));
      }));
      setCardInteractions(interactionMap);
      setReminderTimes(timesMap);
      setReminderHasSound(soundMap);
    } catch {}
    setLoading(false);
    return meds;
  }, []);

  useFocusEffect(useCallback(() => {
    const openId = route.params?.openMedId;
    load().then(meds => {
      if (openId) {
        const med = meds.find(m => m.id === openId);
        if (med) openEdit(med);
      }
    });
  }, [load, route.params?.openMedId]));

  async function syncNotification(meds: Medication[]) {
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

    // Debounce expensive operations (search + interactions) so they don't block every keystroke
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSuggestions(getSuggestions(v, 7, entryType === 'fitoterapico' ? 'Fitoterápico' : undefined));
      setCommercialSuggestions([]);
      const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
      const drugInts = checkInteractions(v, others);
      const seenIds = new Set(drugInts.map(i => i.id));
      setInteractions(drugInts);
      setSubstanceInteractions(checkSubstanceInteractions(v, others).filter(i => !seenIds.has(i.id)));
    }, 300);
  }

  function applySuggestion(s: DrugSuggestion) {
    Keyboard.dismiss();
    const commercial = s.brandName ?? s.firstBrand;
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (commercial ?? ''),
    }));
    setSuggestions([]);
    setCommercialSuggestions([]);
    setKnownDrug(true);
    setInteractions([]);
    setSubstanceInteractions([]);
    // Delay interaction check so keyboard dismiss + UI render settle first
    setTimeout(() => {
      const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
      const drugInts = checkInteractions(s.genericName, others);
      const seenIds = new Set(drugInts.map(i => i.id));
      setInteractions(drugInts);
      setSubstanceInteractions(checkSubstanceInteractions(s.genericName, others).filter(i => !seenIds.has(i.id)));
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
      setInteractions(checkInteractions(s.genericName, medications.map(m => m.generic_name)));
    }
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert('Remover medicamento', `Deseja remover "${name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await cancelAllRemindersForMedication(id).catch(() => {});
          await deleteMedication(id);
          const updated = await getMedications();
          setMedications(updated);
          await syncNotification(updated);
        },
      },
    ]);
  }

  async function refreshReminderTimes(medId: number) {
    const rs = await getRemindersForMedication(medId);
    const times = rs.filter(r => r.is_active).map(r => periodLabel(r.period, r.time));
    const hasSound = rs.some(r => r.is_active && r.with_sound);
    setReminderTimes(prev => new Map(prev).set(medId, times));
    setReminderHasSound(prev => new Map(prev).set(medId, hasSound));
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
      if (dayRs.length > 1) {
        setCustomTimes(dayRs.map(r => r.time.substring(0, 5)).join(' '));
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
        if (p === 'day') await scheduleReminder(item.id, item.generic_name, item.dose, h, m, newSound, ri);
        else if (p.startsWith('week:')) await scheduleReminderWeekly(item.id, item.generic_name, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri);
        else if (p.startsWith('month:')) await scheduleReminderMonthly(item.id, item.generic_name, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri);
        else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(item.id, item.generic_name, item.dose, Number(nStr), Number(dStr), h, m, newSound, ri); }
      } catch {}
    }
    setReminderHasSound(prev => new Map(prev).set(item.id, newSound));
  }

  async function doSaveWizard() {
    try {
      const effectiveTime = startTime || '08:00';
      let newEntries: Omit<MedicationReminder, 'id'>[] = [];

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

      const isCritical = interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high');
      const stockQty = stockInput.trim() ? parseInt(stockInput.trim(), 10) : null;
      const endDate = hasDeadline && durationDays.trim() ? addDays(parseInt(durationDays.trim(), 10)) : null;
      const data = {
        ...form,
        generic_name: form.generic_name.trim(),
        commercial_name: form.commercial_name.trim(),
        is_critical: isCritical,
        stock_quantity: stockQty,
        end_date: endDate,
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

      for (const e of newEntries) {
        const [h, m] = e.time.split(':').map(Number);
        const p = e.period ?? 'day';
        const ri = e.repeat_interval ?? 0;
        try {
          if (p === 'day') await scheduleReminder(savedMedId, data.generic_name, data.dose, h, m, e.with_sound, ri);
          else if (p.startsWith('week:')) await scheduleReminderWeekly(savedMedId, data.generic_name, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri);
          else if (p.startsWith('month:')) await scheduleReminderMonthly(savedMedId, data.generic_name, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri);
          else if (p.startsWith('nmonths:')) {
            const [, nStr, dStr] = p.split(':');
            await scheduleReminderEveryNMonths(savedMedId, data.generic_name, data.dose, Number(nStr), Number(dStr), h, m, e.with_sound, ri);
          }
        } catch {}
        await addReminder({ medication_id: savedMedId, time: e.time, period: e.period, with_sound: e.with_sound, is_active: true, repeat_interval: ri }).catch(() => {});
      }

      const isNew = editingId === null;
      const updated = await getMedications();
      setMedications(updated);
      setShowModal(false);

      const savedInts = [...interactions];
      setSuggestions([]); setCommercialSuggestions([]); setInteractions([]); setSubstanceInteractions([]);
      setEditingId(null); setKnownDrug(false);
      setStockInput(''); setDurationDays(''); setHasDeadline(false);
      setReminders([]); resetPickerState(); setWizardStep('name');
      await syncNotification(updated);
      await refreshReminderTimes(savedMedId).catch(() => {});

      if (isNew && savedInts.length === 0) {
        navigation.navigate('Home' as never);
      } else if (savedInts.length > 0) {
        setPostSaveInteractions(savedInts);
        setShowInteractionWarning(true);
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
    setSuggestions([]); setCommercialSuggestions([]); setInteractions([]); setSubstanceInteractions([]);
    setEntryType('medicamento'); setKnownDrug(false);
    setReminders([]); setStockInput(''); setDurationDays(''); setHasDeadline(false);
    resetPickerState();
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
      end_date: item.end_date,
    });
    const parsed = parseDose(item.dose);
    setDoseValue(parsed.value); setDoseUnit(parsed.unit); setDoseUnitTouched(!!item.dose);
    setStockInput(item.stock_quantity != null ? String(item.stock_quantity) : '');
    setDurationDays(item.end_date ? String(Math.max(0, daysRemaining(item.end_date))) : '');
    setHasDeadline(!!item.end_date);
    setEditingId(item.id);
    setSuggestions([]); setCommercialSuggestions([]); setKnownDrug(true);
    setEntryType(isPhytotherapic(item.generic_name) ? 'fitoterapico' : 'medicamento');
    setInteractions([]); setSubstanceInteractions([]);
    resetPickerState(); setReminders([]);
    setWizardStep('name');
    setShowModal(true);
    getRemindersForMedication(item.id).then(rs => {
      setReminders(rs);
      if (rs.length > 0) populatePickerFromReminders(rs);
    }).catch(() => {});
    setTimeout(() => {
      const others = medications.filter(m => m.id !== item.id).map(m => m.generic_name);
      const drugInts = checkInteractions(item.generic_name, others);
      const seenIds = new Set(drugInts.map(i => i.id));
      setInteractions(drugInts);
      setSubstanceInteractions(checkSubstanceInteractions(item.generic_name, others).filter(i => !seenIds.has(i.id)));
    }, 0);
  }

  function stepNeedsNext(): boolean {
    if (editingId !== null) return true;
    switch (wizardStep) {
      case 'type':
      case 'period':
      case 'sound':
      case 'repeat':
        return false;
      case 'times_per_day':
        return mealMode;
      case 'deadline':
        return hasDeadline;
      default:
        return true;
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
    if (wizardStep === 'time' && pickerH === null) {
      Alert.alert('Obrigatório', 'Defina o horário do primeiro aviso.');
      return;
    }

    if (idx >= seq.length - 1) {
      handleSave();
    } else {
      setWizardStep(seq[idx + 1]);
    }
  }

  function wizGoBack() {
    const isNew = editingId === null;
    const seq = getStepSequence(reminderPeriod, isNew, mealMode);
    const idx = seq.indexOf(wizardStep);
    if (idx <= 0) {
      setShowModal(false);
    } else {
      setWizardStep(seq[idx - 1]);
    }
  }

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
              {form.generic_name.length >= 2 && suggestions.length === 0 && !knownDrug && (
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

            {entryType === 'fitoterapico' && form.generic_name.length > 0 && (
              <View style={styles.phytoGrid}>
                {getSuggestions(form.generic_name, 34, 'Fitoterápico').map(p => {
                  const popular = p.firstBrand ?? p.genericName;
                  const scientific = p.genericName.replace(/\s*\(.*\)/, '').trim();
                  return (
                    <TouchableOpacity key={p.genericName} style={styles.phytoCard} onPress={() => applySuggestion(p)}>
                      <Text style={styles.phytoCardName} numberOfLines={2}>{popular}</Text>
                      <Text style={styles.phytoCardScientific} numberOfLines={1}>{scientific}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}



            {(interactions.length > 0 || substanceInteractions.length > 0) && (
              <Text style={styles.interactionDisclaimer}>
                ⚠️ Possíveis interações detectadas. Será exibido aviso após salvar.
              </Text>
            )}
            {interactions.map(i => {
              const isC = i.risk_level === 'critical';
              const isH = i.risk_level === 'high';
              const color = isC ? '#CC0000' : isH ? '#e65c00' : '#b58900';
              const bg = isC ? '#fff0f0' : isH ? '#fff5f0' : '#fffaf0';
              const label = isC ? 'CRÍTICO' : isH ? 'ALTO' : 'MODERADO';
              return (
                <View key={i.id} style={[styles.interactionCard, { borderLeftColor: color, backgroundColor: bg }]}>
                  <Text style={[styles.interactionBadge, { color }]}>⚡ {label}</Text>
                  <Text style={styles.interactionDrugs}>{i.drug1}  +  {i.drug2}</Text>
                  <Text style={styles.interactionDesc}>{i.risk_description}</Text>
                </View>
              );
            })}
            {interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high') && (
              <View style={styles.doctorAdviceBox}>
                <Text style={styles.doctorAdviceTitle}>Avise seu médico</Text>
                <Text style={styles.doctorAdviceText}>
                  Você já usa medicamentos com interação com{' '}
                  <Text style={{ fontWeight: '700' }}>{form.generic_name || 'este medicamento'}</Text>.
                  Informe seu médico antes de iniciar.
                </Text>
                <TouchableOpacity
                  style={styles.doctorShareBtn}
                  onPress={() => Share.share({ message: buildDoctorMessage(form.generic_name, interactions) })}
                >
                  <Text style={styles.doctorShareBtnText}>Compartilhar aviso com médico</Text>
                </TouchableOpacity>
              </View>
            )}
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

      case 'period':
        return (
          <>
            <Text style={styles.wizLabel}>Com que frequência?</Text>
            <Text style={styles.wizHint}>Toque em uma opção para continuar</Text>
            <View style={styles.periodCardRow}>
              {([
                { p: 'day',   icon: '☀️', label: 'Todo Dia',  hint: 'Repetição diária' },
                { p: 'week',  icon: '📅', label: 'Semanal',   hint: 'Alguns dias da semana' },
                { p: 'month', icon: '🗓', label: 'Mensal',    hint: 'Alguns dias do mês' },
                { p: 'year',  icon: '📆', label: 'Livre',     hint: 'A cada N meses' },
              ] as { p: ReminderPeriod; icon: string; label: string; hint: string }[]).map(({ p, icon, label, hint }) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodCardBtn, editingId !== null && reminderPeriod === p && styles.periodCardBtnActive]}
                  onPress={() => { setReminderPeriod(p); wizGoNext(p); }}
                >
                  <Text style={styles.periodCardIcon}>{icon}</Text>
                  <Text style={[styles.periodCardText, editingId !== null && reminderPeriod === p && styles.periodCardTextActive]}>{label}</Text>
                  <Text style={[styles.periodCardHint, editingId !== null && reminderPeriod === p && { color: 'rgba(255,255,255,0.7)' }]}>{hint}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        );

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
            <View style={[styles.timesRow, { marginTop: 20 }]}>
              {TIMES_PER_DAY_OPTIONS.map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.timesBtn, timesPerDayTouched && timesPerDay === n && styles.timesBtnActive]}
                  onPress={() => { setTimesPerDay(n); setTimesPerDayTouched(true); setCustomTimes(''); setSpecificModeActive(false); wizGoNext(); }}
                >
                  <Text style={[styles.timesBtnText, timesPerDayTouched && timesPerDay === n && styles.timesBtnTextActive]}>{n}x</Text>
                </TouchableOpacity>
              ))}
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
            {showHorarioPicker && (
              <DateTimePicker
                value={(() => { const d = new Date(); d.setHours(pickerH ?? 8, pickerM ?? 0, 0, 0); return d; })()}
                mode="time"
                is24Hour={true}
                onChange={(e, d) => {
                  setShowHorarioPicker(false);
                  if (e.type === 'set' && d) {
                    setPickerH(d.getHours()); setPickerM(d.getMinutes());
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
                style={[styles.yesNoBtn, editingId !== null && hasDeadline && styles.yesNoBtnActive]}
                onPress={() => setHasDeadline(true)}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && hasDeadline && styles.yesNoBtnTextActive]}>Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtn, editingId !== null && !hasDeadline && styles.yesNoBtnActive]}
                onPress={() => { setHasDeadline(false); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && !hasDeadline && styles.yesNoBtnTextActive]}>Não</Text>
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
            <Text style={styles.wizHint}>Deseja que o aviso toque um som?</Text>
            <View style={[styles.yesNoRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtn, editingId !== null && withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(true); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && withSound && styles.yesNoBtnTextActive]}>🔔 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtn, editingId !== null && !withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(false); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && !withSound && styles.yesNoBtnTextActive]}>🔕 Não</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'repeat':
        return (
          <>
            <Text style={styles.wizLabel}>Repetir alarme</Text>
            <Text style={styles.wizHint}>
              Deseja que o alarme toque a cada 5 minutos até você confirmar em{' '}
              <Text style={{ fontWeight: '700' }}>Tomei</Text> ou{' '}
              <Text style={{ fontWeight: '700' }}>Não Tomei</Text>?
            </Text>
            <Text style={[styles.wizHint, { marginTop: 6, color: '#999', fontSize: 12 }]}>
              Necessário caso deseje Controlar o Estoque.
            </Text>
            <View style={[styles.yesNoRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtn, editingId !== null && repeatInterval > 0 && styles.yesNoBtnActive]}
                onPress={() => { setRepeatInterval(5); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && repeatInterval > 0 && styles.yesNoBtnTextActive]}>🔁 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtn, editingId !== null && repeatInterval === 0 && styles.yesNoBtnActive]}
                onPress={() => { setRepeatInterval(0); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, editingId !== null && repeatInterval === 0 && styles.yesNoBtnTextActive]}>Não</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'stock':
        return (
          <>
            <Text style={styles.wizLabel}>Controle de estoque</Text>
            <Text style={styles.wizHint}>Quantos comprimidos/doses você tem em casa?</Text>
            <Text style={[styles.wizHint, { marginTop: 6, color: '#999', fontSize: 12 }]}>
              Com o controle ativo, o aviso fica na tela até você tocar em <Text style={{ fontWeight: '700' }}>Tomei</Text> ou <Text style={{ fontWeight: '700' }}>Não Tomei</Text>. Se repetir alarme estiver ativado, o alarme toca a cada 5 min. A cada <Text style={{ fontWeight: '700' }}>Tomei</Text> o estoque diminui 1. Quando faltar doses para 3 dias, você será avisado.
            </Text>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput, { marginTop: 16 }]}
              value={stockInput}
              onChangeText={setStockInput}
              keyboardType="number-pad"
              placeholder="Ex: 30"
              placeholderTextColor="#bbb"
            />
            <Text style={{ fontSize: 12, color: '#999', marginTop: 6, marginLeft: 2 }}>
              Deixe em branco para não controlar o estoque
            </Text>
            <TouchableOpacity
              style={[styles.stockHelpBtn2, { marginTop: 10 }]}
              onPress={() => setShowStockHelp(true)}
            >
              <Text style={styles.stockHelpBtn2Text}>Como funciona o controle de estoque?</Text>
            </TouchableOpacity>
          </>
        );

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
          const itemInteractions = cardInteractions.get(item.id) ?? [];
          const hasHighRisk = itemInteractions.some(i => i.risk_level === 'critical' || i.risk_level === 'high');
          return (
          <View style={[styles.medCard, hasHighRisk && styles.medCardCritical]}>
            <View style={styles.medHeader}>
              {hasHighRisk && <Text style={styles.criticalIcon}>⚠️</Text>}
              <Text style={styles.medGeneric}>
                {item.commercial_name ? `${item.commercial_name} — ${item.generic_name}` : item.generic_name}
              </Text>
            </View>
            <View style={styles.medCardRow}>
              <TouchableOpacity style={styles.medInfo} activeOpacity={0.6} onPress={() => openEdit(item)}>
                {item.dose ? <Text style={styles.medDetail}>⚖️ {item.dose}</Text> : null}
                {(reminderTimes.get(item.id)?.length ?? 0) > 0 ? (
                  <Text style={styles.medDetail}>🕐 {reminderTimes.get(item.id)!.join('  ·  ')}</Text>
                ) : item.frequency ? (
                  <Text style={styles.medDetail}>🕐 {item.frequency}</Text>
                ) : null}
                {item.notes ? <Text style={styles.medNotes}>{item.notes}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity style={styles.bellBtn} onPress={() => handleToggleSound(item)}>
                <Text style={styles.bellBtnText}>
                  {(reminderTimes.get(item.id)?.length ?? 0) > 0 && (reminderHasSound.get(item.id) ?? false) ? '🔔' : '🔕'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulaCardBtn} onPress={() => {
                const url = isPhytotherapic(item.generic_name)
                  ? getPhytoBulaUrl(item.generic_name, item.commercial_name || undefined)
                  : getBulaUrl(item.generic_name, item.commercial_name || undefined);
                openBula(url);
              }}>
                <Text style={styles.bulaCardBtnText}>📋</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {item.stock_quantity != null && (
              <View style={styles.stockRow}>
                {(() => {
                  const dailyDoses = reminderTimes.get(item.id)?.length ?? 1;
                  const daysLeft = Math.floor(item.stock_quantity / dailyDoses);
                  const isLow = daysLeft <= 3;
                  return (
                    <>
                      <Text style={[styles.stockText, isLow && styles.stockTextLow]}>
                        💊 {item.stock_quantity} restante{item.stock_quantity !== 1 ? 's' : ''} · ~{daysLeft} dia{daysLeft !== 1 ? 's' : ''}
                        {isLow ? '  ⚠ estoque baixo' : ''}
                      </Text>
                      <TouchableOpacity style={styles.takenBtn} onPress={() => setStockActionMed(item)}>
                        <Text style={styles.takenBtnText}>Tomar</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </View>
            )}
            {item.end_date && (
              <Text style={[styles.endDateText, daysRemaining(item.end_date) <= 0 && styles.endDateDone]}>
                {daysRemaining(item.end_date) > 0
                  ? `📅 Termina em ${formatEndDate(item.end_date)} · ${daysRemaining(item.end_date)} dia${daysRemaining(item.end_date) !== 1 ? 's' : ''}`
                  : `📅 Tratamento encerrado em ${formatEndDate(item.end_date)}`}
              </Text>
            )}
            {itemInteractions.length > 0 && (
              <TouchableOpacity style={styles.cardInteractionRow} activeOpacity={0.7} onPress={() => setInteractionModal(itemInteractions)}>
                {itemInteractions.slice(0, 3).map(i => {
                  const color = i.risk_level === 'critical' ? '#CC0000' : i.risk_level === 'high' ? '#e65c00' : '#b58900';
                  const label = i.risk_level === 'critical' ? 'Interação Crítica' : i.risk_level === 'high' ? 'Interação Alta' : 'Interação Moderada';
                  return (
                    <View key={i.id} style={[styles.cardInteractionBadge, { borderColor: color }]}>
                      <Text style={[styles.cardInteractionBadgeText, { color }]}>{label}</Text>
                    </View>
                  );
                })}
                {itemInteractions.length > 3 && (
                  <Text style={styles.cardInteractionMore}>+{itemInteractions.length - 3}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          );
        }}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openWizard}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Wizard modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <View style={styles.wizModalBox}>
              {/* Progress bar */}
              {(() => {
                const seq = getStepSequence(reminderPeriod, editingId === null, mealMode);
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
                style={{ flex: 1 }}
                contentContainerStyle={[styles.wizContent, { paddingBottom: 24 }]}
                keyboardShouldPersistTaps="handled"
              >
                {renderWizardStep()}
              </ScrollView>

              {/* Suggestions fixas acima do footer — visíveis mesmo com teclado aberto */}
              {wizardStep === 'name' && suggestions.length > 0 && entryType !== 'fitoterapico' && (
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
                      <TouchableOpacity style={styles.bulaBtn} onPress={() => openBula(s.bulaUrl)}>
                        <Text style={styles.bulaBtnText}>📋</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              {/* Footer */}
              <View style={[styles.wizFooter, { paddingBottom: insets.bottom + 12 }]}>
                <TouchableOpacity
                  style={[styles.wizBackBtn, !stepNeedsNext() && { flex: 1, borderColor: '#ddd' }]}
                  onPress={wizGoBack}
                >
                  <Text style={styles.wizBackBtnText}>‹ Voltar</Text>
                </TouchableOpacity>
                {stepNeedsNext() && (
                  <TouchableOpacity style={styles.wizNextBtn} onPress={() => wizGoNext()}>
                    <Text style={styles.wizNextBtnText}>
                      {(() => {
                        const seq = getStepSequence(reminderPeriod, editingId === null, mealMode);
                        const idx = seq.indexOf(wizardStep);
                        return idx >= seq.length - 1 ? 'Salvar ✓' : 'Próximo ›';
                      })()}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Post-save interaction warning */}
      <Modal visible={showInteractionWarning} animationType="slide" transparent onRequestClose={() => { setShowInteractionWarning(false); setPostSaveInteractions([]); }}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>⚠️ Interação detectada</Text>
            <Text style={[styles.iwAdviceText, { marginTop: 0, marginBottom: 12 }]}>
              Medicamento salvo. Informe seu médico sobre estas interações.
            </Text>
            <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
              {postSaveInteractions.map(i => {
                const c = i.risk_level === 'critical' ? '#CC0000' : i.risk_level === 'high' ? '#e65c00' : '#b58900';
                const lbl = i.risk_level === 'critical' ? 'Crítico' : i.risk_level === 'high' ? 'Alto' : 'Moderado';
                return (
                  <View key={i.id} style={[styles.iwItem, { borderLeftColor: c }]}>
                    <View style={[styles.intModalBadge, { borderColor: c, marginBottom: 4 }]}>
                      <Text style={[styles.intModalBadgeText, { color: c }]}>{lbl}</Text>
                    </View>
                    <Text style={styles.intModalDrugs}>{i.drug1} + {i.drug2}</Text>
                    <Text style={styles.intModalDesc}>{i.risk_description}</Text>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.intModalClose} onPress={() => { setShowInteractionWarning(false); setPostSaveInteractions([]); }}>
              <Text style={styles.intModalCloseText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Stock action modal */}
      <Modal visible={!!stockActionMed} animationType="slide" transparent onRequestClose={() => setStockActionMed(null)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>💊 {stockActionMed?.generic_name}</Text>
            <TouchableOpacity
              style={styles.stockActionBtn}
              onPress={async () => {
                if (!stockActionMed) return;
                const next = Math.max(0, (stockActionMed.stock_quantity ?? 0) - 1);
                await updateMedicationStock(stockActionMed.id, next);
                setMedications(prev => prev.map(m => m.id === stockActionMed.id ? { ...m, stock_quantity: next } : m));
                setStockActionMed(null);
                if (next === 0) Alert.alert('Estoque zerado', `O estoque de ${stockActionMed.generic_name} acabou. Providencie a reposição.`);
              }}
            >
              <Text style={styles.stockActionBtnText}>✓ Informar Tomei</Text>
              <Text style={styles.stockActionBtnHint}>Desconta 1 do estoque atual ({stockActionMed?.stock_quantity ?? 0} restante{stockActionMed?.stock_quantity !== 1 ? 's' : ''})</Text>
            </TouchableOpacity>
            <View style={styles.stockActionEditRow}>
              <Text style={styles.stockActionEditLabel}>Alterar quantidade de estoque</Text>
              <View style={styles.stockActionEditInputRow}>
                <TextInput
                  style={styles.stockActionEditInput}
                  value={stockEditValue}
                  onChangeText={setStockEditValue}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                />
                <TouchableOpacity
                  style={styles.stockActionSaveBtn}
                  onPress={async () => {
                    if (!stockActionMed) return;
                    const qty = parseInt(stockEditValue, 10);
                    if (isNaN(qty) || qty < 0) { Alert.alert('Valor inválido', 'Informe um número maior ou igual a zero.'); return; }
                    await updateMedicationStock(stockActionMed.id, qty);
                    setMedications(prev => prev.map(m => m.id === stockActionMed.id ? { ...m, stock_quantity: qty } : m));
                    setStockActionMed(null);
                  }}
                >
                  <Text style={styles.stockActionSaveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.stockActionInfo}>
              <Text style={styles.stockActionInfoText}>
                O estoque é descontado automaticamente ao tocar em <Text style={{ fontWeight: '700' }}>Tomei</Text> no alarme ou em <Text style={{ fontWeight: '700' }}>Tomar</Text> aqui.
              </Text>
            </View>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setStockActionMed(null)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {bulaModal}

      {/* Interaction detail modal (from card tap) */}
      <Modal visible={!!interactionModal} animationType="slide" transparent onRequestClose={() => setInteractionModal(null)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Interações detectadas</Text>
            <ScrollView>
              {(interactionModal ?? []).map(i => {
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
                1. Informe a quantidade atual de comprimidos que você tem em casa.{'\n\n'}
                2. A cada vez que tomar o medicamento, toque em <Text style={{ fontWeight: '700' }}>Tomei</Text> no aviso de alarme ou em <Text style={{ fontWeight: '700' }}>Tomar</Text> no card. O estoque diminui automaticamente em 1.{'\n\n'}
                3. Quando o estoque ficar baixo (menos de 3 dias de doses), você verá um aviso.
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
  medInfo: { flex: 1 },
  medHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  criticalIcon: { fontSize: 16 },
  medGeneric: { fontSize: 15, fontWeight: '600', color: '#222', flexShrink: 1 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
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
  takenBtn: { backgroundColor: '#1C3F7A', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 },
  takenBtnText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  endDateText: { fontSize: 12, color: '#888', marginTop: 4 },
  endDateDone: { color: '#CC0000' },
  cardInteractionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  cardInteractionBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  cardInteractionBadgeText: { fontSize: 10, fontWeight: '600' },
  cardInteractionMore: { fontSize: 11, color: '#999' },
  intModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  intModalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  intModalTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  intModalItem: { borderLeftWidth: 3, borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fafafa' },
  intModalBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 4 },
  intModalBadgeText: { fontSize: 10, fontWeight: '600' },
  intModalDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  intModalDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
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
    backgroundColor: '#1a3a6b', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1a3a6b', shadowOpacity: 0.4, shadowRadius: 6,
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
  },
  wizBackBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizBackBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  wizNextBtn: { flex: 2, backgroundColor: '#1a3a6b', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizNextBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
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
  yesNoBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  yesNoBtnText: { fontSize: 16, color: '#555', fontWeight: '700' },
  yesNoBtnTextActive: { color: '#fff' },
  // Period cards
  periodCardRow: { flexDirection: 'row', gap: 8, marginTop: 16, flexWrap: 'wrap' },
  periodCardBtn: {
    width: '47%', borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    padding: 14, alignItems: 'center', marginBottom: 8,
  },
  periodCardBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  periodCardIcon: { fontSize: 26, marginBottom: 6 },
  periodCardText: { fontSize: 14, color: '#333', fontWeight: '700' },
  periodCardTextActive: { color: '#fff' },
  periodCardHint: { fontSize: 11, color: '#888', marginTop: 3 },
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
  suggestionChipText: { fontSize: 14, color: '#1a3a6b', fontWeight: '600' },
  suggestionChipTextBrand: { color: '#6b1a8a' },
  suggestionCategory: { fontSize: 11, color: '#7a92b8', marginTop: 1 },
  suggestionCategoryBrand: { color: '#9a72b8' },
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
  // Interaction inline
  interactionCard: { borderLeftWidth: 3, borderRadius: 8, padding: 10, marginTop: 8 },
  interactionDisclaimer: { fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 12, marginBottom: 4, lineHeight: 16 },
  interactionBadge: { fontSize: 11, fontWeight: '700', marginBottom: 3, letterSpacing: 0.5 },
  interactionDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  interactionDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  doctorAdviceBox: { backgroundColor: '#f0f4ff', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#c0ccdf' },
  doctorAdviceTitle: { fontSize: 13, fontWeight: '700', color: '#1a3a6b', marginBottom: 4 },
  doctorAdviceText: { fontSize: 12, color: '#444', lineHeight: 17, marginBottom: 10 },
  doctorShareBtn: { backgroundColor: '#1a3a6b', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, alignSelf: 'flex-start' },
  doctorShareBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },
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
  doseUnitBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  doseUnitText: { fontSize: 14, color: '#555', fontWeight: '600' },
  doseUnitTextActive: { color: '#fff' },
  timesBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  timesBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  timesBtnText: { fontSize: 14, color: '#555', fontWeight: '600' },
  timesBtnTextActive: { color: '#fff' },
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
  weekdayBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  weekdayBtnText: { fontSize: 12, color: '#555', fontWeight: '600' },
  weekdayBtnTextActive: { color: '#fff' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  monthDayBtn: { width: 40, height: 36, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  monthDayBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  monthDayBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  monthDayBtnTextActive: { color: '#fff' },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  typeBtnActiveGreen: { backgroundColor: '#1a6b3a', borderColor: '#1a6b3a' },
  typeBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },
  phytoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  phytoCard: { width: '47%', backgroundColor: '#f0f7f0', borderRadius: 10, borderWidth: 1, borderColor: '#a8d5a8', padding: 10 },
  phytoCardName: { fontSize: 13, fontWeight: '700', color: '#1a6b3a', marginBottom: 2 },
  phytoCardScientific: { fontSize: 10, color: '#5a9a6a', fontStyle: 'italic' },
  iwItem: { borderLeftWidth: 3, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: '#fafafa' },
  iwAdviceText: { fontSize: 14, color: '#555', marginTop: 12, marginBottom: 4 },
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
  stockHelpBtn2: { alignSelf: 'flex-start' },
  stockHelpBtn2Text: { fontSize: 13, color: '#1C3F7A', textDecorationLine: 'underline' },
});
