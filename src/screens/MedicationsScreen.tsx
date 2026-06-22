import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView, Share,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, updateMedication, deleteMedication,
  getRemindersForMedication, addReminder, deleteReminder, toggleReminderActive, updateAllRemindersSound, updateReminderSound, updateMedicationStock, updateAllRemindersInterval,
} from '../database/db';
import {
  scheduleReminderWeekly, scheduleReminderMonthly, scheduleReminderEveryNMonths,
} from '../services/notifications';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelReminderByTime, cancelAllRemindersForMedication,
} from '../services/notifications';
import { Medication, MedicationReminder, DrugInteraction } from '../types';
import { DrugSuggestion, getSuggestions, getBulaUrl, getPhytoBulaUrl, checkInteractions, checkSubstanceInteractions, isPhytotherapic, getPhytotherapics } from '../utils/drugSearch';
import { useBulaViewer } from '../utils/useBulaViewer';
import { reportMissingDrug } from '../services/reportMissing';

// ─── Time Picker ──────────────────────────────────────────────────────────────
const ITEM_H = 44;
const PICKER_VISIBLE = 5;
const PICKER_PAD = ITEM_H * 2; // centers first/last items

function PickerCol({ items, value, onChange }: {
  items: string[]; value: number; onChange: (v: number) => void;
}) {
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      ref.current?.scrollTo({ y: value * ITEM_H, animated: false });
    }, 80);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ height: ITEM_H * PICKER_VISIBLE, width: 72, overflow: 'hidden' }}>
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          onChange(Math.max(0, Math.min(items.length - 1, idx)));
        }}
        onScrollEndDrag={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
          onChange(Math.max(0, Math.min(items.length - 1, idx)));
        }}
        contentContainerStyle={{ paddingVertical: PICKER_PAD }}
      >
        {items.map((item, i) => (
          <View key={i} style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{
              fontSize: i === value ? 26 : 18,
              color: i === value ? '#1C3F7A' : '#C0C5D0',
              fontWeight: i === value ? '700' : '400',
            }}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function TimePicker({ hour, minute, onChange }: {
  hour: number; minute: number; onChange: (h: number, m: number) => void;
}) {
  return (
    <View style={tpStyles.wrap}>
      <View pointerEvents="none" style={tpStyles.selBar} />
      <PickerCol items={HOURS} value={hour} onChange={(h) => onChange(h, minute)} />
      <Text style={tpStyles.colon}>:</Text>
      <PickerCol items={MINUTES} value={minute} onChange={(m) => onChange(hour, m)} />
    </View>
  );
}

const tpStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F2F4F8', borderRadius: 12,
    height: ITEM_H * PICKER_VISIBLE, overflow: 'hidden', marginTop: 4,
  },
  selBar: {
    position: 'absolute',
    top: ITEM_H * 2, left: 0, right: 0,
    height: ITEM_H,
    backgroundColor: 'rgba(28,63,122,0.09)',
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(28,63,122,0.14)',
  },
  colon: { fontSize: 26, fontWeight: '700', color: '#1C3F7A', paddingHorizontal: 6, marginBottom: 2 },
});
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
type ReminderPeriod = 'day' | 'week' | 'month' | 'year';
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

function computeTimes(startTime: string, timesPerDay: number): string[] {
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

export default function MedicationsScreen() {
  const { openBula, modal: bulaModal } = useBulaViewer();
  const insets = useSafeAreaInsets();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_MED);
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([]);
  const [reportedDrug, setReportedDrug] = useState<string>('');
  const [reportingName, setReportingName] = useState<string | null>(null);
  const [knownDrug, setKnownDrug] = useState<boolean>(false);
  const [commercialSuggestions, setCommercialSuggestions] = useState<DrugSuggestion[]>([]);
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [substanceInteractions, setSubstanceInteractions] = useState<DrugInteraction[]>([]);
  const [entryType, setEntryType] = useState<'medicamento' | 'fitoterapico'>('medicamento');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardInteractions, setCardInteractions] = useState<Map<number, DrugInteraction[]>>(new Map());
  const [interactionModal, setInteractionModal] = useState<DrugInteraction[] | null>(null);
  const [stockInput, setStockInput] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [showStockHelp, setShowStockHelp] = useState(false);

  // Reminder state
  const [reminderHasSound, setReminderHasSound] = useState<Map<number, boolean>>(new Map());
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderMed, setReminderMed] = useState<Medication | null>(null);
  const [reminderIsDraft, setReminderIsDraft] = useState(false);
  const [reminderFromEditFlow, setReminderFromEditFlow] = useState(false);
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [reminderTimes, setReminderTimes] = useState<Map<number, string[]>>(new Map());
  const [customTimes, setCustomTimes] = useState('');
  const [withSound, setWithSound] = useState(true);
  const [repeatInterval, setRepeatInterval] = useState(0);
  const [reminderPeriod, setReminderPeriod] = useState<ReminderPeriod>('day');
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([2]);
  const [selectedMonthDays, setSelectedMonthDays] = useState<number[]>([1]);
  const [nMonths, setNMonths] = useState('1');
  const [monthDay, setMonthDay] = useState('1');

  const startTime = `${String(pickerHour).padStart(2, '0')}:${String(pickerMinute).padStart(2, '0')}`;
  const computedTimes = useMemo(
    () => computeTimes(startTime, timesPerDay),
    [pickerHour, pickerMinute, timesPerDay]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meds = await getMedications();
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
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
    setForm(f => ({ ...f, generic_name: v }));
    setSuggestions(getSuggestions(v, 7, entryType === 'fitoterapico' ? 'Fitoterápico' : undefined));
    setCommercialSuggestions([]);
    setKnownDrug(false);
    if (reportedDrug && v !== reportedDrug) setReportedDrug('');
    setReportingName(null);
    const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
    const drugInts = checkInteractions(v, others);
    const seenIds = new Set(drugInts.map(i => i.id));
    setInteractions(drugInts);
    setSubstanceInteractions(checkSubstanceInteractions(v, others).filter(i => !seenIds.has(i.id)));
  }

  function applySuggestion(s: DrugSuggestion) {
    const commercial = s.brandName ?? s.firstBrand;
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (commercial ?? ''),
    }));
    setSuggestions([]);
    setKnownDrug(true);
    setInteractions([]);
    setSubstanceInteractions([]);
    setTimeout(() => {
      const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
      const drugInts = checkInteractions(s.genericName, others);
      const seenIds = new Set(drugInts.map(i => i.id));
      setInteractions(drugInts);
      setSubstanceInteractions(checkSubstanceInteractions(s.genericName, others).filter(i => !seenIds.has(i.id)));
    }, 0);
  }

  function handleCommercialNameChange(v: string) {
    setForm(f => ({ ...f, commercial_name: v }));
    setSuggestions([]);
    const all = getSuggestions(v);
    setCommercialSuggestions(all.filter(s => s.isBrand));
  }

  function applyCommercialSuggestion(s: DrugSuggestion) {
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

  async function doSave() {
    try {
      const isCritical = interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high');
      const stockQty = stockInput.trim() ? parseInt(stockInput.trim(), 10) : null;
      const endDate = durationDays.trim() ? addDays(parseInt(durationDays.trim(), 10)) : null;
      const data = { ...form, generic_name: form.generic_name.trim(), commercial_name: form.commercial_name.trim(), is_critical: isCritical, stock_quantity: stockQty, end_date: endDate };
      let newMedId: number | null = null;
      if (editingId !== null) {
        await updateMedication({ ...data, id: editingId });
      } else {
        newMedId = await addMedication(data);
      }
      const updated = await getMedications();
      setMedications(updated);
      setShowModal(false);
      setSuggestions([]);
      setCommercialSuggestions([]);
      setInteractions([]);
      setSubstanceInteractions([]);
      setEditingId(null);
      setKnownDrug(false);
      setReportedDrug('');
      setReportingName(null);
      setStockInput('');
      setDurationDays('');
      await syncNotification(updated);
      if (newMedId !== null && reminders.length > 0) {
        const newMed = updated.find(m => m.id === newMedId);
        if (newMed) {
          for (const r of reminders) {
            const [h, m] = r.time.split(':').map(Number);
            const p = r.period ?? 'day';
            try {
              const ri = r.repeat_interval ?? 0;
              if (p === 'day') {
                await scheduleReminder(newMedId, newMed.generic_name, newMed.dose, h, m, r.with_sound, ri);
              } else if (p.startsWith('week:')) {
                const wds = p.split(':')[1].split(',').map(Number);
                await scheduleReminderWeekly(newMedId, newMed.generic_name, newMed.dose, wds, h, m, r.with_sound, ri);
              } else if (p.startsWith('month:')) {
                const days = p.split(':')[1].split(',').map(Number);
                await scheduleReminderMonthly(newMedId, newMed.generic_name, newMed.dose, days, h, m, r.with_sound, ri);
              } else if (p.startsWith('nmonths:')) {
                const [, nStr, dStr] = p.split(':');
                await scheduleReminderEveryNMonths(newMedId, newMed.generic_name, newMed.dose, Number(nStr), Number(dStr), h, m, r.with_sound, ri);
              }
            } catch {}
            await addReminder({ medication_id: newMedId, time: r.time, period: r.period, with_sound: r.with_sound, is_active: true, repeat_interval: r.repeat_interval ?? 0 }).catch(() => {});
          }
        }
      }
      if (newMedId !== null) await refreshReminderTimes(newMedId).catch(() => {});
      setReminders([]);
      setReminderIsDraft(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Erro ao salvar', msg);
    }
  }

  async function handleSave() {
    if (!form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome genérico do medicamento.');
      return;
    }
    if (interactions.length > 0) {
      const lines = interactions
        .map(i => `• ${i.drug1} + ${i.drug2}\n  ${i.risk_description}`)
        .join('\n\n');
      Alert.alert(
        'Interação medicamentosa detectada',
        `Este medicamento pode interagir com outros da sua lista:\n\n${lines}`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Salvar mesmo assim', onPress: doSave },
        ]
      );
      return;
    }
    await doSave();
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
    setStockInput(item.stock_quantity != null ? String(item.stock_quantity) : '');
    setDurationDays(item.end_date ? String(Math.max(0, daysRemaining(item.end_date))) : '');
    setEditingId(item.id);
    setSuggestions([]);
    setCommercialSuggestions([]);
    setKnownDrug(true);
    setReportedDrug('');
    setEntryType(isPhytotherapic(item.generic_name) ? 'fitoterapico' : 'medicamento');
    setInteractions([]);
    setSubstanceInteractions([]);
    setShowModal(true); // abre imediatamente
    setTimeout(() => {  // interações calculadas após render
      const others = medications.filter(m => m.id !== item.id).map(m => m.generic_name);
      const drugInts = checkInteractions(item.generic_name, others);
      const seenIds = new Set(drugInts.map(i => i.id));
      setInteractions(drugInts);
      setSubstanceInteractions(checkSubstanceInteractions(item.generic_name, others).filter(i => !seenIds.has(i.id)));
    }, 0);
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
    setPickerHour(8); setPickerMinute(0); setTimesPerDay(1);
    setCustomTimes(''); setWithSound(true); setRepeatInterval(0); setReminderPeriod('day');
    setSelectedWeekdays([2]); setSelectedMonthDays([1]); setNMonths('1'); setMonthDay('1');
  }

  function populatePickerFromReminders(rs: MedicationReminder[]) {
    const active = rs.filter(r => r.is_active);
    const first = active[0] ?? rs[0];
    if (!first) { resetPickerState(); return; }
    const [h, m] = first.time.split(':').map(Number);
    setPickerHour(h);
    setPickerMinute(m);
    setCustomTimes('');
    const p = first.period ?? 'day';
    if (p === 'day') {
      setReminderPeriod('day');
      setTimesPerDay(rs.filter(r => (r.period ?? 'day') === 'day').length || 1);
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
  }

  async function openReminders(med: Medication, fromEditFlow = false) {
    setReminderMed(med);
    setReminderIsDraft(false);
    setReminderFromEditFlow(fromEditFlow);
    setReminders([]);
    resetPickerState();
    setShowReminderModal(true); // abre imediatamente
    const rs = await getRemindersForMedication(med.id); // carrega após render
    setReminders(rs);
    setWithSound(rs.some(r => r.with_sound));
    setRepeatInterval(rs[0]?.repeat_interval ?? 0);
    if (rs.length > 0) populatePickerFromReminders(rs);
  }

  function openRemindersForNewMed() {
    setReminderMed(null);
    setReminderIsDraft(true);
    setReminderFromEditFlow(false);
    resetPickerState();
    setShowReminderModal(true);
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
        else if (p.startsWith('nmonths:')) { const [,nStr,dStr] = p.split(':'); await scheduleReminderEveryNMonths(item.id, item.generic_name, item.dose, Number(nStr), Number(dStr), h, m, newSound, ri); }
      } catch {}
    }
    setReminderHasSound(prev => new Map(prev).set(item.id, newSound));
  }

  async function handleSaveReminder() {
    try {
      let newEntries: MedicationReminder[] = [];

      if (reminderPeriod === 'day') {
        let times: string[] = [];
        if (customTimes.trim()) {
          const raw = customTimes.trim();
          const num = parseInt(raw, 10);
          if (!isNaN(num) && /^\d+$/.test(raw)) {
            times = computeTimes(startTime, num);
          } else {
            times = raw.split(/[,\s]+/).map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t));
          }
        } else {
          times = computedTimes;
        }
        if (times.length === 0) { Alert.alert('Erro', 'Nenhum horário válido informado.'); return; }
        newEntries = times.map((time, i) => ({
          id: reminderIsDraft ? -(Date.now() + i) : 0,
          medication_id: reminderMed?.id ?? 0,
          time, period: 'day', with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
        }));
      } else if (reminderPeriod === 'week') {
        if (selectedWeekdays.length === 0) { Alert.alert('Erro', 'Selecione ao menos um dia da semana.'); return; }
        const [h, m] = startTime.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        newEntries = [{ id: reminderIsDraft ? -Date.now() : 0, medication_id: reminderMed?.id ?? 0, time: startTime, period: `week:${selectedWeekdays.sort((a,b)=>a-b).join(',')}`, with_sound: withSound, is_active: true, repeat_interval: repeatInterval }];
      } else if (reminderPeriod === 'month') {
        if (selectedMonthDays.length === 0) { Alert.alert('Erro', 'Selecione ao menos um dia do mês.'); return; }
        const [h, m] = startTime.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        newEntries = [{ id: reminderIsDraft ? -Date.now() : 0, medication_id: reminderMed?.id ?? 0, time: startTime, period: `month:${selectedMonthDays.sort((a,b)=>a-b).join(',')}`, with_sound: withSound, is_active: true, repeat_interval: repeatInterval }];
      } else if (reminderPeriod === 'year') {
        const n = parseInt(nMonths, 10);
        const d = parseInt(monthDay, 10);
        const [h, mi] = startTime.split(':').map(Number);
        if (isNaN(n) || n < 1) { Alert.alert('Erro', 'Informe o intervalo em meses (mínimo 1).'); return; }
        if (isNaN(d) || d < 1 || d > 28) { Alert.alert('Erro', 'Dia do mês deve ser entre 1 e 28.'); return; }
        if (isNaN(h) || isNaN(mi)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        newEntries = [{ id: reminderIsDraft ? -Date.now() : 0, medication_id: reminderMed?.id ?? 0, time: startTime, period: `nmonths:${n}:${d}`, with_sound: withSound, is_active: true, repeat_interval: repeatInterval }];
      }

      if (reminderIsDraft) {
        setReminders(prev => [...prev, ...newEntries]);
        setShowReminderModal(false);
        setTimeout(() => setShowModal(true), 100);
        return;
      } else if (reminderMed) {
        // Determina o tipo de período sendo salvo
        const p0 = newEntries[0]?.period ?? 'day';
        const periodType = (p: string) => p.startsWith('week:') ? 'week' : p.startsWith('month:') ? 'month' : p.startsWith('nmonths:') ? 'nmonths' : 'day';
        // Apaga todos os reminders do mesmo tipo (substitui em vez de acumular)
        for (const r of reminders) {
          if (periodType(r.period ?? 'day') === periodType(p0)) {
            await deleteReminder(r.id).catch(() => {});
          }
        }
        // Adiciona os novos
        for (const e of newEntries) {
          await addReminder({ medication_id: reminderMed.id, time: e.time, period: e.period, with_sound: withSound, is_active: true, repeat_interval: repeatInterval });
        }
        // Cancela tudo e reagenda todos os reminders restantes + novos
        await cancelAllRemindersForMedication(reminderMed.id).catch(() => {});
        const allRem = await getRemindersForMedication(reminderMed.id);
        for (const rem of allRem.filter(rem => rem.is_active)) {
          const [h, m] = rem.time.split(':').map(Number);
          const p = rem.period ?? 'day';
          try {
            const ri = rem.repeat_interval ?? 0;
            if (p === 'day') await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, rem.with_sound, ri);
            else if (p.startsWith('week:')) await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, ri);
            else if (p.startsWith('month:')) await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, ri);
            else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(reminderMed.id, reminderMed.generic_name, reminderMed.dose, Number(nStr), Number(dStr), h, m, rem.with_sound, ri); }
          } catch {}
        }
        setReminders(allRem);
        await refreshReminderTimes(reminderMed.id);
      }

      if (reminderFromEditFlow) {
        setReminderFromEditFlow(false);
        setShowReminderModal(false);
        setTimeout(() => setShowModal(true), 100);
      } else {
        resetPickerState();
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o lembrete.');
    }
  }

  async function handleDeleteReminder(r: MedicationReminder) {
    if (reminderIsDraft) {
      setReminders(prev => prev.filter(x => x.id !== r.id));
      return;
    }
    await cancelReminderByTime(r.medication_id, r.time, r.period).catch(() => {});
    await deleteReminder(r.id);
    setReminders(await getRemindersForMedication(r.medication_id));
    await refreshReminderTimes(r.medication_id);
  }

  async function handleToggleActive(r: MedicationReminder) {
    if (reminderIsDraft) {
      setReminders(prev => prev.map(x => x.id === r.id ? { ...x, is_active: !x.is_active } : x));
      return;
    }
    const newActive = !r.is_active;
    await toggleReminderActive(r.id, newActive);
    if (newActive && reminderMed) {
      const [h, m] = r.time.split(':').map(Number);
      const p = r.period ?? 'day';
      const ri = r.repeat_interval ?? 0;
      if (p === 'day') {
        await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, r.with_sound, ri).catch(() => {});
      } else if (p.startsWith('week:')) {
        const wds = p.split(':')[1].split(',').map(Number);
        await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, wds, h, m, r.with_sound, ri).catch(() => {});
      } else if (p.startsWith('month:')) {
        const days = p.split(':')[1].split(',').map(Number);
        await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, days, h, m, r.with_sound, ri).catch(() => {});
      } else if (p.startsWith('nmonths:')) {
        const [, n, d] = p.split(':');
        await scheduleReminderEveryNMonths(reminderMed.id, reminderMed.generic_name, reminderMed.dose, Number(n), Number(d), h, m, r.with_sound, ri).catch(() => {});
      }
    } else {
      await cancelReminderByTime(r.medication_id, r.time, r.period).catch(() => {});
    }
    setReminders(await getRemindersForMedication(r.medication_id));
    await refreshReminderTimes(r.medication_id);
  }

  async function handleToggleReminderSound(r: MedicationReminder) {
    if (!reminderMed) return;
    await updateReminderSound(r.id, !r.with_sound);
    await cancelAllRemindersForMedication(reminderMed.id).catch(() => {});
    const rs = await getRemindersForMedication(reminderMed.id);
    for (const rem of rs.filter(rem => rem.is_active)) {
      const [h, m] = rem.time.split(':').map(Number);
      const p = rem.period ?? 'day';
      try {
        const ri = rem.repeat_interval ?? 0;
        if (p === 'day') await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, rem.with_sound, ri);
        else if (p.startsWith('week:')) await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, ri);
        else if (p.startsWith('month:')) await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, ri);
        else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(reminderMed.id, reminderMed.generic_name, reminderMed.dose, Number(nStr), Number(dStr), h, m, rem.with_sound, ri); }
      } catch {}
    }
    setReminders(rs);
    setWithSound(rs.some(rem => rem.with_sound));
    await refreshReminderTimes(reminderMed.id);
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
            <View style={styles.medCardRow}>
              <TouchableOpacity style={styles.medInfo} activeOpacity={0.6} onPress={() => openEdit(item)}>
                <View style={styles.medHeader}>
                  {hasHighRisk && <Text style={styles.criticalIcon}>⚠️</Text>}
                  <Text style={styles.medGeneric}>{item.generic_name}</Text>
                </View>
                {item.commercial_name ? <Text style={styles.medCommercial}>{item.commercial_name}</Text> : null}
                {item.dose ? <Text style={styles.medDetail}>💊 {item.dose}</Text> : null}
                {(reminderTimes.get(item.id)?.length ?? 0) > 0 ? (
                  <Text style={styles.medDetail}>🕐 {reminderTimes.get(item.id)!.join('  ·  ')}</Text>
                ) : item.frequency ? (
                  <Text style={styles.medDetail}>🕐 {item.frequency}</Text>
                ) : null}
                {item.notes ? <Text style={styles.medNotes}>{item.notes}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.bellBtn,
                  !((reminderTimes.get(item.id)?.length ?? 0) > 0 && (reminderHasSound.get(item.id) ?? false)) && styles.bellBtnDim,
                  (reminderTimes.get(item.id)?.length ?? 0) > 0 && (reminderHasSound.get(item.id) ?? false) && styles.bellBtnActive,
                ]}
                onPress={() => handleToggleSound(item)}
              >
                <Text style={styles.bellBtnText}>🔔</Text>
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
            {/* Stock row */}
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
                      <TouchableOpacity
                        style={styles.takenBtn}
                        onPress={async () => {
                          const next = Math.max(0, item.stock_quantity! - 1);
                          await updateMedicationStock(item.id, next);
                          setMedications(prev => prev.map(m => m.id === item.id ? { ...m, stock_quantity: next } : m));
                          if (next === 0) Alert.alert('Estoque zerado', `O estoque de ${item.generic_name} acabou. Providencie a reposição.`);
                        }}
                      >
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

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={() => { setForm(EMPTY_MED); setEditingId(null); setSuggestions([]); setCommercialSuggestions([]); setInteractions([]); setSubstanceInteractions([]); setEntryType('medicamento'); setKnownDrug(false); setReportedDrug(''); setReportingName(null); setReminders([]); setReminderIsDraft(false); setStockInput(''); setDurationDays(''); setShowModal(true); }}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add medication modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>
              {editingId !== null
                ? (entryType === 'fitoterapico' ? 'Editar Fitoterápico' : 'Editar Medicamento')
                : (entryType === 'fitoterapico' ? 'Novo Fitoterápico' : 'Novo Medicamento')}
            </Text>

            {editingId === null && (
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeBtn, entryType === 'medicamento' && styles.typeBtnActive]}
                  onPress={() => { setEntryType('medicamento'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); }}
                >
                  <Text style={[styles.typeBtnText, entryType === 'medicamento' && styles.typeBtnTextActive]}>💊 Medicamento</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeBtn, entryType === 'fitoterapico' && styles.typeBtnActiveGreen]}
                  onPress={() => { setEntryType('fitoterapico'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); }}
                >
                  <Text style={[styles.typeBtnText, entryType === 'fitoterapico' && styles.typeBtnTextActive]}>🌿 Fitoterápico</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>{entryType === 'fitoterapico' ? 'Nome do fitoterápico / planta *' : 'Nome genérico *'}</Text>
              {form.generic_name.length >= 2 && suggestions.length === 0 && !knownDrug && (
                <ActivityIndicator size="small" color="#1C3F7A" style={{ marginLeft: 6 }} />
              )}
            </View>
            <TextInput
              style={styles.fieldInput}
              value={form.generic_name}
              onChangeText={handleGenericNameChange}
              autoCapitalize="words"
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

            {suggestions.length > 0 && entryType !== 'fitoterapico' && (
              <View style={styles.suggestionsBox}>
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
                    <TouchableOpacity
                      style={styles.bulaBtn}
                      onPress={() => openBula(s.bulaUrl)}
                    >
                      <Text style={styles.bulaBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {suggestions.length === 0 && !knownDrug && form.generic_name.trim().length >= 3 && (
              reportedDrug === form.generic_name.trim() ? (
                <Text style={styles.reportedText}>✓ Reportado — obrigado!</Text>
              ) : reportingName !== null ? (
                <View style={styles.reportConfirmBox}>
                  <Text style={styles.reportConfirmLabel}>Nome completo do medicamento:</Text>
                  <TextInput
                    style={styles.reportConfirmInput}
                    value={reportingName}
                    onChangeText={setReportingName}
                    autoFocus
                    autoCapitalize="words"
                    placeholder="Ex: Amoxicilina Tri-hidratada"
                  />
                  <View style={styles.reportConfirmBtns}>
                    <TouchableOpacity
                      style={styles.reportCancelBtn}
                      onPress={() => setReportingName(null)}
                    >
                      <Text style={styles.reportCancelText}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reportSendBtn, !reportingName.trim() && { opacity: 0.4 }]}
                      disabled={!reportingName.trim()}
                      onPress={async () => {
                        const name = reportingName.trim();
                        setReportingName(null);
                        setReportedDrug(form.generic_name.trim());
                        await reportMissingDrug(name);
                      }}
                    >
                      <Text style={styles.reportSendText}>Enviar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.reportMissingBtn}
                  onPress={() => setReportingName(form.generic_name.trim())}
                >
                  <Text style={styles.reportMissingText}>
                    Não encontrado no banco — Reportar faltante
                  </Text>
                </TouchableOpacity>
              )
            )}
            <Text style={styles.fieldLabel}>Nome comercial</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.commercial_name}
              onChangeText={handleCommercialNameChange}
              onFocus={() => setSuggestions([])}
              autoCapitalize="words"
            />
            {commercialSuggestions.length > 0 && (
              <View style={styles.suggestionsBox}>
                {commercialSuggestions.map(s => (
                  <View key={s.label} style={styles.suggestionRow}>
                    <TouchableOpacity
                      style={[styles.suggestionChip, styles.suggestionChipBrand]}
                      onPress={() => applyCommercialSuggestion(s)}
                    >
                      <Text style={[styles.suggestionChipText, styles.suggestionChipTextBrand]} numberOfLines={1}>
                        {s.brandName}
                      </Text>
                      {s.category ? (
                        <Text style={[styles.suggestionCategory, styles.suggestionCategoryBrand]}>
                          {s.genericName} · {s.category}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.bulaBtn}
                      onPress={() => openBula(s.bulaUrl)}
                    >
                      <Text style={styles.bulaBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.fieldLabel}>Dose</Text>
            <TextInput style={styles.fieldInput} value={form.dose} onChangeText={v => setForm(f => ({ ...f, dose: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} />

            <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Frequência</Text>
            <TouchableOpacity
              style={styles.freqField}
              onPress={() => {
                if (editingId !== null) {
                  const med = medications.find(m => m.id === editingId);
                  if (med) { setShowModal(false); setTimeout(() => openReminders(med, true), 100); }
                } else {
                  setShowModal(false);
                  setTimeout(() => openRemindersForNewMed(), 100);
                }
              }}
            >
              {(() => {
                const times = editingId !== null
                  ? (reminderTimes.get(editingId) ?? [])
                  : reminders.filter(r => r.is_active).map(r => periodLabel(r.period, r.time));
                return times.length > 0
                  ? <Text style={styles.freqTimesText}>🕐 {times.join('  ·  ')}</Text>
                  : <Text style={styles.freqPlaceholderText}>Toque para configurar →</Text>;
              })()}
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Observações</Text>
            <TextInput style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} multiline />

            {(interactions.length > 0 || substanceInteractions.length > 0) && (
              <Text style={styles.interactionDisclaimer}>
                ⚠️ Possíveis interações com outros medicamentos ou substâncias que você já usa. Em caso de dúvidas, consulte seu médico.
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
            {substanceInteractions.map(i => {
              const isC = i.risk_level === 'critical';
              const isH = i.risk_level === 'high';
              const color = isC ? '#CC0000' : isH ? '#e65c00' : '#b58900';
              const bg = isC ? '#fff0f0' : isH ? '#fff5f0' : '#fffaf0';
              const label = isC ? 'CRÍTICO' : isH ? 'ALTO' : 'MODERADO';
              const substance = i.drug1.toLowerCase().includes(form.generic_name.toLowerCase().slice(0, 4)) ? i.drug2 : i.drug1;
              return (
                <View key={i.id} style={[styles.interactionCard, { borderLeftColor: color, backgroundColor: bg }]}>
                  <Text style={[styles.interactionBadge, { color }]}>⚠️ {label} · Substância</Text>
                  <Text style={styles.interactionDrugs}>{i.drug1}  +  {i.drug2}</Text>
                  <Text style={styles.interactionDesc}>{i.risk_description}</Text>
                  <Text style={[styles.substanceWarning, { color }]}>Evite {substance} durante o tratamento</Text>
                </View>
              );
            })}
            {/* Stock & duration */}
            {(() => {
              const hasAlarm = editingId !== null
                ? (reminderTimes.get(editingId)?.length ?? 0) > 0
                : reminders.filter(r => r.is_active).length > 0;
              return (
                <>
                  <View style={styles.stockSection}>
                    <View style={styles.stockSectionHeader}>
                      <Text style={styles.stockSectionTitle}>Controle de estoque</Text>
                      <TouchableOpacity onPress={() => setShowStockHelp(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.stockHelpBtn}>?</Text>
                      </TouchableOpacity>
                    </View>
                    {!hasAlarm && (
                      <Text style={styles.stockNoAlarm}>Configure um alarme para ativar o controle de estoque</Text>
                    )}
                    <Text style={styles.fieldLabel}>Quantidade atual (comprimidos/doses)</Text>
                    <TextInput
                      style={[styles.fieldInput, !hasAlarm && { opacity: 0.4 }]}
                      value={stockInput}
                      onChangeText={setStockInput}
                      keyboardType="number-pad"
                      editable={hasAlarm}
                      placeholder={hasAlarm ? 'Ex: 30' : 'Requer alarme ativo'}
                      placeholderTextColor="#bbb"
                    />
                    <Text style={styles.fieldLabel}>Duração do tratamento (dias)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={durationDays}
                      onChangeText={setDurationDays}
                      keyboardType="number-pad"
                      placeholder="Deixe vazio para uso contínuo"
                      placeholderTextColor="#bbb"
                    />
                    {durationDays.trim() !== '' && !isNaN(parseInt(durationDays)) && (
                      <Text style={styles.stockEndDatePreview}>
                        Termina em: {formatEndDate(addDays(parseInt(durationDays)))}
                      </Text>
                    )}
                  </View>
                </>
              );
            })()}

            {interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high') && (
              <View style={styles.doctorAdviceBox}>
                <Text style={styles.doctorAdviceTitle}>Avise seu médico</Text>
                <Text style={styles.doctorAdviceText}>
                  Você já usa medicamentos com interação conhecida com{' '}
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

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowModal(false); setReminders([]); setReminderIsDraft(false); setEditingId(null); }}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>{editingId !== null ? 'Atualizar' : 'Salvar'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reminders modal */}
      <Modal visible={showReminderModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>⏰ Frequência</Text>
            {(reminderMed?.generic_name || (reminderIsDraft && form.generic_name)) && (
              <Text style={styles.reminderMedName}>{reminderMed?.generic_name || form.generic_name}</Text>
            )}

            <View style={styles.soundRow}>
              <View>
                <Text style={styles.soundLabel}>🔔 Som</Text>
                <Text style={styles.soundHint}>{withSound ? 'Toca som ao notificar' : 'Notificações silenciosas'}</Text>
              </View>
              <Switch
                value={withSound}
                onValueChange={async (val) => {
                  setWithSound(val);
                  if (!reminderMed) return;
                  await updateAllRemindersSound(reminderMed.id, val);
                  await cancelAllRemindersForMedication(reminderMed.id).catch(() => {});
                  const rs = await getRemindersForMedication(reminderMed.id);
                  for (const rem of rs.filter(rem => rem.is_active)) {
                    const [h, m] = rem.time.split(':').map(Number);
                    const p = rem.period ?? 'day';
                    try {
                      const ri = rem.repeat_interval ?? 0;
                      if (p === 'day') await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, val, ri);
                      else if (p.startsWith('week:')) await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, val, ri);
                      else if (p.startsWith('month:')) await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, val, ri);
                      else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(reminderMed.id, reminderMed.generic_name, reminderMed.dose, Number(nStr), Number(dStr), h, m, val, ri); }
                    } catch {}
                  }
                  setReminders(rs);
                  await refreshReminderTimes(reminderMed.id);
                }}
                trackColor={{ true: '#1a3a6b', false: '#ccc' }}
                thumbColor="#fff"
              />
            </View>

            <View style={styles.repeatRow}>
              <Text style={styles.repeatLabel}>🔁 Repetir alarme</Text>
              <View style={styles.repeatChips}>
                {([0, 5, 10, 15, 30] as const).map(min => (
                  <TouchableOpacity
                    key={min}
                    style={[styles.repeatChip, repeatInterval === min && styles.repeatChipActive]}
                    onPress={async () => {
                      setRepeatInterval(min);
                      if (reminderMed) {
                        await updateAllRemindersInterval(reminderMed.id, min);
                        await cancelAllRemindersForMedication(reminderMed.id).catch(() => {});
                        const rs = await getRemindersForMedication(reminderMed.id);
                        for (const rem of rs.filter(rem => rem.is_active)) {
                          const [h, m] = rem.time.split(':').map(Number);
                          const p = rem.period ?? 'day';
                          try {
                            if (p === 'day') await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, rem.with_sound, min);
                            else if (p.startsWith('week:')) await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, min);
                            else if (p.startsWith('month:')) await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, p.split(':')[1].split(',').map(Number), h, m, rem.with_sound, min);
                            else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(reminderMed.id, reminderMed.generic_name, reminderMed.dose, Number(nStr), Number(dStr), h, m, rem.with_sound, min); }
                          } catch {}
                        }
                      }
                    }}
                  >
                    <Text style={[styles.repeatChipText, repeatInterval === min && styles.repeatChipTextActive]}>
                      {min === 0 ? 'Não repetir' : `${min}min`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {reminders.map(r => (
              <View key={r.id} style={styles.reminderRow}>
                <Text style={styles.reminderTime}>{periodLabel(r.period, r.time)}</Text>
                <TouchableOpacity onPress={() => withSound && handleToggleReminderSound(r)} disabled={!withSound}>
                  <Text style={[styles.reminderSound, !withSound && { opacity: 0.35 }]}>
                    {r.with_sound && withSound ? '🔊' : '🔇'}
                  </Text>
                </TouchableOpacity>
                <Switch
                  value={r.is_active}
                  onValueChange={() => handleToggleActive(r)}
                  trackColor={{ true: '#1a3a6b', false: '#ccc' }}
                  thumbColor="#fff"
                  style={styles.reminderSwitch}
                />
                <TouchableOpacity onPress={() => handleDeleteReminder(r)} style={styles.reminderDeleteBtn}>
                  <Text style={styles.reminderDeleteText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={[styles.addForm, reminders.length === 0 && { marginTop: 0, borderTopWidth: 0, paddingTop: 0 }]}>
              {reminders.length > 0 && <Text style={styles.addFormTitle}>Novo lembrete</Text>}

              <Text style={styles.fieldLabel}>Período</Text>
              <View style={styles.periodRow}>
                {(['day', 'week', 'month', 'year'] as ReminderPeriod[]).map(p => {
                  const labels: Record<ReminderPeriod, string> = { day: 'Dia', week: 'Sem.', month: 'Mês', year: 'Livre' };
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.periodBtn, reminderPeriod === p && styles.periodBtnActive]}
                      onPress={() => setReminderPeriod(p)}
                    >
                      <Text style={[styles.periodBtnText, reminderPeriod === p && styles.periodBtnTextActive]}>
                        {labels[p]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {reminderPeriod === 'week' && (
                <>
                  <Text style={styles.fieldLabel}>Dias da semana (selecione um ou mais)</Text>
                  <View style={styles.weekdayRow}>
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
                          <Text style={[styles.weekdayBtnText, sel && styles.weekdayBtnTextActive]}>
                            {wd.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {reminderPeriod === 'month' && (
                <>
                  <Text style={styles.fieldLabel}>Dias do mês (selecione um ou mais)</Text>
                  <View style={styles.monthGrid}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => {
                      const sel = selectedMonthDays.includes(d);
                      return (
                        <TouchableOpacity
                          key={d}
                          style={[styles.monthDayBtn, sel && styles.monthDayBtnActive]}
                          onPress={() => setSelectedMonthDays(prev =>
                            sel ? prev.filter(v => v !== d) : [...prev, d]
                          )}
                        >
                          <Text style={[styles.monthDayBtnText, sel && styles.monthDayBtnTextActive]}>
                            {d}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {reminderPeriod === 'year' && (
                <>
                  <Text style={styles.fieldLabel}>Repetir a cada quantos meses</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={nMonths}
                    onChangeText={setNMonths}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                  <Text style={styles.fieldLabel}>No dia do mês (1–28)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={monthDay}
                    onChangeText={setMonthDay}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>Horário</Text>
              <TimePicker
                hour={pickerHour}
                minute={pickerMinute}
                onChange={(h, m) => { setPickerHour(h); setPickerMinute(m); }}
              />

              {reminderPeriod === 'day' && (
                <>
                  <Text style={styles.fieldLabel}>Vezes por dia</Text>
                  <View style={styles.timesRow}>
                    {TIMES_PER_DAY_OPTIONS.map(n => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.timesBtn, timesPerDay === n && !customTimes.trim() && styles.timesBtnActive]}
                        onPress={() => { setTimesPerDay(n); setCustomTimes(''); }}
                      >
                        <Text style={[styles.timesBtnText, timesPerDay === n && !customTimes.trim() && styles.timesBtnTextActive]}>{n}x</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Outro valor ou horários específicos</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={customTimes}
                    onChangeText={setCustomTimes}
                  />

                  {!customTimes.trim() && computedTimes.length > 0 && (
                    <View style={styles.timesPreview}>
                      <Text style={styles.timesPreviewLabel}>Horários dos avisos:</Text>
                      <Text style={styles.timesPreviewValue}>{computedTimes.join('  •  ')}</Text>
                    </View>
                  )}
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => {
                  const goBack = reminderIsDraft || reminderFromEditFlow;
                  setShowReminderModal(false);
                  setReminderFromEditFlow(false);
                  if (goBack) setTimeout(() => setShowModal(true), 100);
                }}>
                  <Text style={styles.cancelBtnText}>Fechar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSaveReminder}>
                  <Text style={styles.saveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      {bulaModal}

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
                1. Informe a quantidade atual de comprimidos ou doses que você tem em casa.{'\n\n'}
                2. Cada vez que tomar o medicamento, toque em <Text style={{ fontWeight: '700' }}>Tomei</Text> no aviso que aparece na tela quando o alarme disparar, ou em <Text style={{ fontWeight: '700' }}>Tomar</Text> no card do medicamento na aba Medicamentos. O estoque diminui automaticamente em 1.{'\n\n'}
                O aviso de alarme permanece na tela até você tocar em <Text style={{ fontWeight: '700' }}>Tomei</Text> ou <Text style={{ fontWeight: '700' }}>Não tomei</Text>.{'\n\n'}
                3. Quando o estoque ficar baixo (menos de 3 dias de doses), você verá um aviso de estoque baixo para providenciar a reposição.
              </Text>
              <Text style={styles.stockHelpSubtitle}>Duração do tratamento</Text>
              <Text style={styles.stockHelpText}>
                Se o médico prescreveu por um número definido de dias (ex: antibiótico por 7 dias), preencha o campo de duração. O app exibirá a data de término e avisará quando o tratamento encerrar.
              </Text>
              <View style={styles.stockHelpTip}>
                <Text style={styles.stockHelpTipText}>
                  💡 O controle de estoque só funciona se houver um alarme ativo configurado para o medicamento.
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb' },
  medCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  medCardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  medCardCritical: { borderLeftWidth: 4, borderLeftColor: '#CC0000' },
  medInfo: { flex: 1 },
  medHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  criticalIcon: { fontSize: 16 },
  medGeneric: { fontSize: 16, fontWeight: '600', color: '#222' },
  medCommercial: { fontSize: 13, color: '#888', marginBottom: 4 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  medReminders: { fontSize: 12, color: '#1C3F7A', marginTop: 4, opacity: 0.75 },
  // Stock
  stockSection: {
    marginTop: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 14,
  },
  stockSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stockSectionTitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A' },
  stockHelpBtn: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#1C3F7A',
    textAlign: 'center', lineHeight: 16, fontSize: 11, fontWeight: '700', color: '#1C3F7A',
  },
  stockHelpText: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 8 },
  stockHelpSubtitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A', marginTop: 8, marginBottom: 4 },
  stockHelpTip: {
    backgroundColor: '#FFF8E7', borderRadius: 8, padding: 10, marginTop: 8,
    borderLeftWidth: 3, borderLeftColor: '#E07B4F',
  },
  stockHelpTipText: { fontSize: 12, color: '#7a5200', lineHeight: 18 },
  stockNoAlarm: { fontSize: 12, color: '#E07B4F', marginBottom: 8, fontStyle: 'italic' },
  stockEndDatePreview: { fontSize: 12, color: '#1a6b3a', marginTop: 4, fontStyle: 'italic' },
  stockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  stockText: { fontSize: 12, color: '#555', flex: 1 },
  stockTextLow: { color: '#E07B4F', fontWeight: '600' },
  takenBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5,
  },
  takenBtnText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  endDateText: { fontSize: 12, color: '#888', marginTop: 4 },
  endDateDone: { color: '#CC0000' },

  cardInteractionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap',
  },
  cardInteractionBadge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  cardInteractionBadgeText: { fontSize: 10, fontWeight: '600' },
  cardInteractionMore: { fontSize: 11, color: '#999' },

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
  bellBtn: { padding: 8, marginLeft: 4, borderRadius: 8 },
  bellBtnDim: { opacity: 0.28 },
  bellBtnActive: { backgroundColor: 'rgba(28,63,122,0.12)' },
  bellBtnText: { fontSize: 18 },
  freqField: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fafafa', minHeight: 44,
    justifyContent: 'center',
  },
  freqTimesText: { fontSize: 14, color: '#1C3F7A', fontWeight: '600' },
  freqPlaceholderText: { fontSize: 14, color: '#bbb', fontStyle: 'italic' },
  bulaCardBtn: { padding: 8, marginLeft: 4 },
  bulaCardBtnText: { fontSize: 18 },
  deleteBtn: { padding: 8, marginLeft: 4 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a3a6b', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1a3a6b', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalContent: { padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 4 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4 },
  fieldLabel: { fontSize: 13, color: '#555' },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#1a3a6b', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#a0aec0' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  // Autocomplete
  suggestionsBox: { marginTop: 6, gap: 4 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggestionChip: {
    flex: 1, backgroundColor: '#e8edf7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#c0ccdf',
  },
  suggestionChipBrand: { backgroundColor: '#f0e8f7', borderColor: '#c8b0dd' },
  suggestionChipText: { fontSize: 14, color: '#1a3a6b', fontWeight: '600' },
  suggestionChipTextBrand: { color: '#6b1a8a' },
  suggestionCategory: { fontSize: 11, color: '#7a92b8', marginTop: 1 },
  suggestionCategoryBrand: { color: '#9a72b8' },
  bulaBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#f0f4ff',
    borderWidth: 1, borderColor: '#c0ccdf', justifyContent: 'center', alignItems: 'center',
  },
  bulaBtnText: { fontSize: 16 },
  reportMissingBtn: {
    marginTop: 6, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#b0b8c8',
    alignSelf: 'flex-start',
  },
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
  // Interaction warning
  interactionCard: {
    borderLeftWidth: 3, borderRadius: 8, padding: 10, marginTop: 8,
  },
  interactionDisclaimer: {
    fontSize: 12, color: '#888', fontStyle: 'italic',
    marginTop: 12, marginBottom: 4, lineHeight: 16,
  },
  interactionBadge: { fontSize: 11, fontWeight: '700', marginBottom: 3, letterSpacing: 0.5 },
  interactionDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  interactionDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  substanceWarning: { fontSize: 12, fontWeight: '600', marginTop: 5 },
  doctorAdviceBox: {
    backgroundColor: '#f0f4ff', borderRadius: 10, padding: 12, marginTop: 10,
    borderWidth: 1, borderColor: '#c0ccdf',
  },
  doctorAdviceTitle: { fontSize: 13, fontWeight: '700', color: '#1a3a6b', marginBottom: 4 },
  doctorAdviceText: { fontSize: 12, color: '#444', lineHeight: 17, marginBottom: 10 },
  doctorShareBtn: {
    backgroundColor: '#1a3a6b', borderRadius: 8, paddingVertical: 9,
    paddingHorizontal: 14, alignSelf: 'flex-start',
  },
  doctorShareBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },
  // Reminder modal
  reminderMedName: { fontSize: 14, color: '#888', marginBottom: 16 },
  reminderEmpty: { fontSize: 14, color: '#bbb', textAlign: 'center', marginVertical: 16 },
  reminderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  reminderTime: { fontSize: 15, fontWeight: '700', color: '#1a3a6b', flex: 1 },
  reminderSound: { fontSize: 18, marginHorizontal: 8 },
  reminderSwitch: { flex: 1 },
  reminderDeleteBtn: { padding: 8 },
  reminderDeleteText: { fontSize: 16, color: '#ccc' },
  addReminderBtn: {
    marginTop: 16, borderWidth: 1.5, borderColor: '#1a3a6b', borderRadius: 10,
    padding: 14, alignItems: 'center',
  },
  addReminderBtnText: { fontSize: 15, color: '#1a3a6b', fontWeight: '600' },
  // Add form
  addForm: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 16 },
  addFormTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 4 },
  periodRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  periodBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  periodBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  periodBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  periodBtnTextActive: { color: '#fff' },
  weekdayRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  weekdayBtn: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', minWidth: 44,
  },
  weekdayBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  weekdayBtnText: { fontSize: 12, color: '#555', fontWeight: '600' },
  weekdayBtnTextActive: { color: '#fff' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  monthDayBtn: {
    width: 40, height: 36, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  monthDayBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  monthDayBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  monthDayBtnTextActive: { color: '#fff' },
  timesRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  timesBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  timesBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  timesBtnText: { fontSize: 14, color: '#555', fontWeight: '600' },
  timesBtnTextActive: { color: '#fff' },
  timesPreview: {
    backgroundColor: '#f0f4ff', borderRadius: 8, padding: 12, marginTop: 12,
  },
  timesPreviewLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  timesPreviewValue: { fontSize: 16, color: '#1a3a6b', fontWeight: '700', letterSpacing: 1 },
  soundRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  soundLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  soundHint: { fontSize: 12, color: '#999', marginTop: 2 },
  repeatRow: { marginTop: 16 },
  repeatLabel: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8 },
  repeatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  repeatChip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#ccc', backgroundColor: '#fff',
  },
  repeatChipActive: { borderColor: '#1C3F7A', backgroundColor: '#EEF2FB' },
  repeatChipText: { fontSize: 13, color: '#666', fontWeight: '500' },
  repeatChipTextActive: { color: '#1C3F7A', fontWeight: '700' },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  typeBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: '#1a3a6b', borderColor: '#1a3a6b' },
  typeBtnActiveGreen: { backgroundColor: '#1a6b3a', borderColor: '#1a6b3a' },
  typeBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },
  phytoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4,
  },
  phytoCard: {
    width: '47%', backgroundColor: '#f0f7f0', borderRadius: 10,
    borderWidth: 1, borderColor: '#a8d5a8', padding: 10,
  },
  phytoCardName: { fontSize: 13, fontWeight: '700', color: '#1a6b3a', marginBottom: 2 },
  phytoCardScientific: { fontSize: 10, color: '#5a9a6a', fontStyle: 'italic' },
});
