import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, ScrollView, KeyboardAvoidingView,
} from 'react-native';
import PickerDataHora from '../components/PickerDataHora';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getActivities, addActivity, updateActivity, deleteActivity, updateCycleStart,
  getRemindersForActivity, addActivityReminder, deleteAllRemindersForActivity,
  getAppointments, addAppointment, updateAppointment, deleteAppointment,
  addActivityLog,
  getKV, setKV,
} from '../database/db';
import {
  scheduleActivityReminder, scheduleActivityReminderWeekly, cancelAllRemindersForActivity,
  scheduleAppointmentReminders, cancelAppointmentReminders,
} from '../services/notifications';
import { Activity, ActivityReminder, ActivityType, ACTIVITY_PRESETS, Appointment } from '../types';
import { getCyclePhase } from '../utils/cyclePhase';

const ACTIVITY_TYPES: ActivityType[] = ['water', 'walk', 'physio', 'weight', 'bp', 'glucose', 'cycle', 'custom'];
const WEEKDAYS_ACT = [
  { label: 'Dom', value: 1 }, { label: 'Seg', value: 2 }, { label: 'Ter', value: 3 },
  { label: 'Qua', value: 4 }, { label: 'Qui', value: 5 }, { label: 'Sex', value: 6 },
  { label: 'Sáb', value: 7 },
];
const MEASURE_TYPES: ActivityType[] = ['bp', 'glucose', 'weight'];

function parseTime(t: string): { hour: number; minute: number } | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function formatDateBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formToDate(dateBR: string, timeHHMM: string): Date {
  const dm = dateBR.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = timeHHMM.match(/^(\d{1,2}):(\d{2})$/);
  const now = new Date();
  const d = dm ? parseInt(dm[1], 10) : now.getDate();
  const mo = dm ? parseInt(dm[2], 10) - 1 : now.getMonth();
  const y = dm ? parseInt(dm[3], 10) : now.getFullYear();
  const h = tm ? parseInt(tm[1], 10) : now.getHours();
  const m = tm ? parseInt(tm[2], 10) : now.getMinutes();
  return new Date(y, mo, d, h, m);
}

function parseDateBR(br: string): string | null {
  const m = br.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

function isDatePast(date: string, time: string): boolean {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (isNaN(y)) return false;
  return new Date(y, mo - 1, d, h, mi) < new Date();
}

// Retorna cor conforme SBC (pressão), SBD (glicose) e OMS (IMC)
function measureColor(type: string, value: string): string {
  if (type === 'bp') {
    const m = value.match(/^(\d+)\/(\d+)/);
    if (!m) return '#1C3F7A';
    const sys = parseInt(m[1], 10);
    const dia = parseInt(m[2], 10);
    // SBC 2020 + hipotensão
    if (sys < 90 || dia < 60)     return '#3B82F6';  // Hipotensão
    if (sys >= 180 || dia >= 120) return '#7F1D1D';  // Crise
    if (sys >= 160 || dia >= 100) return '#DC2626';  // Est. 2
    if (sys >= 140 || dia >= 90)  return '#EA580C';  // Est. 1
    if (sys >= 130 || dia >= 85)  return '#D97706';  // Limítrofe
    return '#16A34A';                                 // Normal
  }
  if (type === 'glucose') {
    const m = value.match(/^(\d+)/);
    if (!m) return '#1C3F7A';
    const g = parseInt(m[1], 10);
    if (g < 70)   return '#7F1D1D';
    if (g <= 99)  return '#16A34A';
    if (g <= 125) return '#D97706';
    return '#DC2626';
  }
  if (type === 'weight') {
    const m = value.match(/IMC\s*([\d.]+)/);
    if (!m) return '#1C3F7A';
    const bmi = parseFloat(m[1]);
    if (bmi < 18.5) return '#3B82F6';
    if (bmi < 25)   return '#16A34A';
    if (bmi < 30)   return '#D97706';
    if (bmi < 35)   return '#EA580C';
    if (bmi < 40)   return '#DC2626';
    return '#7F1D1D';
  }
  return '#1C3F7A';
}

const BP_LEGEND = [
  { color: '#3B82F6', label: 'Hipotens.' },
  { color: '#16A34A', label: 'Normal' },
  { color: '#D97706', label: 'Limítrofe' },
  { color: '#EA580C', label: 'Est. 1' },
  { color: '#DC2626', label: 'Est. 2' },
  { color: '#7F1D1D', label: 'Crise' },
];
const GLUCOSE_LEGEND = [
  { color: '#7F1D1D', label: 'Hipoglicemia' },
  { color: '#16A34A', label: 'Normal' },
  { color: '#D97706', label: 'Pré-diab.' },
  { color: '#DC2626', label: 'Diabetes' },
];
const BMI_LEGEND = [
  { color: '#3B82F6', label: 'Abaixo' },
  { color: '#16A34A', label: 'Normal' },
  { color: '#D97706', label: 'Sobrepeso' },
  { color: '#EA580C', label: 'Ob. I' },
  { color: '#DC2626', label: 'Ob. II' },
  { color: '#7F1D1D', label: 'Ob. III' },
];

function ColorLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <View style={legendStyles.row}>
      {items.map(i => (
        <View key={i.label} style={legendStyles.item}>
          <View style={[legendStyles.dot, { backgroundColor: i.color }]} />
          <Text style={legendStyles.label}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}
const legendStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 11, color: '#555' },
});

// ─── EMPTY FORMS ──────────────────────────────────────────────────────────────

const EMPTY_ACTIVITY = { type: 'water' as ActivityType, name: 'Tomar água', notes: '', times: ['08:00'] };
const EMPTY_APPT = { doctor_name: '', specialty: '', date: '', time: '08:00', location: '', notes: '' };

function fmtHM(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateRepeatTimes(fromH: number, fromM: number, toH: number, toM: number, itvH: number, itvM: number): string[] {
  const step = itvH * 60 + itvM;
  if (step <= 0) return [fmtHM(fromH, fromM)];
  const times: string[] = [];
  let cur = fromH * 60 + fromM;
  const end = toH * 60 + toM;
  while (cur <= end) {
    times.push(fmtHM(Math.floor(cur / 60) % 24, cur % 60));
    cur += step;
  }
  return times.length ? times : [fmtHM(fromH, fromM)];
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────

export default function AgendaScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ Agenda: { tab?: 'activities' | 'appointments'; openActivityId?: number; openAppointmentId?: number } }, 'Agenda'>>();
  const [tab, setTab] = useState<'activities' | 'appointments'>(route.params?.tab ?? 'activities');

  useFocusEffect(useCallback(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]));

  const measureScrollRef = useRef<ScrollView>(null);
  const activityScrollRef = useRef<ScrollView>(null);
  const apptScrollRef = useRef<ScrollView>(null);
  const scrollToEndSoon = (ref: React.RefObject<ScrollView | null>) => {
    setTimeout(() => ref.current?.scrollToEnd({ animated: true }), 250);
  };
  // No iOS o picker é view inline e pode nascer fora da tela. Rola até ELE, não até o fim
  // do formulário: aqui a data e o horário ficam no MEIO (embaixo ainda vêm local,
  // observações e os botões), e rolar ao fim jogava o picker para cima, fora da tela —
  // a pessoa tinha que arrastar de volta. A folga de 100px mantém à vista o campo que ela
  // acabou de tocar, senão o picker aparece colado no topo, sem contexto.
  const revelarPicker = (ref: React.RefObject<ScrollView | null>) => (y: number) => {
    ref.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
  };

  // Activities state
  const [activities, setActivities] = useState<Activity[]>([]);
  const [remindersMap, setRemindersMap] = useState<Record<number, ActivityReminder[]>>({});
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [actForm, setActForm] = useState(EMPTY_ACTIVITY);

  // Cycle (menstrual) activity fields
  const [cycleStartDateBR, setCycleStartDateBR] = useState('');
  const [cycleLengthInput, setCycleLengthInput] = useState('28');
  const [periodLengthInput, setPeriodLengthInput] = useState('5');
  const [showCycleDatePicker, setShowCycleDatePicker] = useState(false);
  const [cyclePickerDate, setCyclePickerDate] = useState(new Date());

  // Measurement modal state
  const [showMeasureModal, setShowMeasureModal] = useState(false);
  const [measureActivity, setMeasureActivity] = useState<Activity | null>(null);
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [bpPulse, setBpPulse] = useState('');
  const [measureValue, setMeasureValue] = useState('');
  const [weightHeight, setWeightHeight] = useState('');
  const [walkTime, setWalkTime] = useState('');
  const [walkDistance, setWalkDistance] = useState('');

  // Appointments state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showApptModal, setShowApptModal] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [apptForm, setApptForm] = useState(EMPTY_APPT);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());

  // Activity weekday filter
  const [actWeekdays, setActWeekdays] = useState<number[]>([]);

  // Activity time state
  const [actTimeStr, setActTimeStr] = useState('08:00');
  const [actRepeat, setActRepeat] = useState(false);
  const [actItvInput, setActItvInput] = useState('1');
  const [actToStr, setActToStr] = useState('20:00');
  const [showActTimePicker, setShowActTimePicker] = useState(false);
  const [showToTimePicker, setShowToTimePicker] = useState(false);

  // Appointment time
  const [apptH, setApptH] = useState(8);
  const [apptM, setApptM] = useState(0);
  const [showApptTimePicker, setShowApptTimePicker] = useState(false);

  const loadActivities = useCallback(async () => {
    const list = await getActivities();
    setActivities(list);
    const map: Record<number, ActivityReminder[]> = {};
    await Promise.all(list.map(async a => {
      map[a.id] = await getRemindersForActivity(a.id);
    }));
    setRemindersMap(map);
    return { list, map };
  }, []);

  const loadAppointments = useCallback(async () => {
    const list = await getAppointments();
    setAppointments(list);
    return list;
  }, []);

  useFocusEffect(useCallback(() => {
    const openActId = route.params?.openActivityId;
    const openApptId = route.params?.openAppointmentId;
    if (route.params?.tab) setTab(route.params.tab);

    // Consome os parâmetros de deep-link uma única vez — sem isso, o React Navigation
    // mantém openActivityId/openAppointmentId na rota e reabre o modal a cada foco
    // na tela (ex: só trocar de aba e voltar), mesmo sem o usuário tocar em nada.
    if (openActId || openApptId) {
      (navigation as any).setParams({ openActivityId: undefined, openAppointmentId: undefined });
    }

    loadActivities().then(({ list }) => {
      if (openActId) {
        const act = list.find(a => a.id === openActId);
        if (act) { act.type === 'cycle' ? handleCycleRestart(act) : openMeasureModal(act); }
      }
    });

    loadAppointments().then(list => {
      if (openApptId) {
        const appt = list.find(a => a.id === openApptId);
        if (appt) openEditAppt(appt);
      }
    });
  }, [loadActivities, loadAppointments, navigation, route.params?.tab, route.params?.openActivityId, route.params?.openAppointmentId]));

  // ─── ACTIVITY HANDLERS ──────────────────────────────────────────────────────

  function initActWheelFromTimes(times: string[]) {
    if (times.length === 0) {
      setActRepeat(false); setActTimeStr('08:00'); return;
    }
    if (times.length === 1) {
      setActRepeat(false); setActTimeStr(times[0]); return;
    }
    const sorted = [...times].sort();
    const mins = sorted.map(t => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); });
    const interval = mins[1] - mins[0];
    setActRepeat(true);
    setActTimeStr(sorted[0]);
    setActToStr(sorted[sorted.length - 1]);
    setActItvInput(String(Math.max(1, Math.round(interval / 60)) || 1));
  }

  function openNewActivity() {
    setEditingActivity(null);
    setActForm(EMPTY_ACTIVITY);
    setActRepeat(false); setActTimeStr('08:00');
    setActItvInput('1'); setActToStr('20:00');
    setActWeekdays([]);
    const now = new Date();
    setCycleStartDateBR(`${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`);
    setCycleLengthInput('28');
    setPeriodLengthInput('5');
    setShowActivityModal(true);
  }

  function openEditActivity(a: Activity) {
    setEditingActivity(a);
    const reminders = remindersMap[a.id] ?? [];
    const times = reminders.map(r => r.time);
    setActForm({ type: a.type, name: a.name, notes: a.notes, times: times.length ? times : [''] });
    initActWheelFromTimes(times);
    const firstR = reminders[0];
    if (firstR?.period?.startsWith('week:')) {
      setActWeekdays(firstR.period.split(':')[1].split(',').map(Number));
    } else {
      setActWeekdays([]);
    }
    setCycleStartDateBR(a.cycle_start_date ? formatDateBR(a.cycle_start_date) : '');
    setCycleLengthInput(String(a.cycle_length_days ?? 28));
    setPeriodLengthInput(String(a.period_length_days ?? 5));
    setShowActivityModal(true);
  }

  async function saveActivity() {
    if (!actForm.name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome da atividade.');
      return;
    }

    if (actForm.type === 'cycle') {
      const cycleStartIso = parseDateBR(cycleStartDateBR);
      if (!cycleStartIso) {
        Alert.alert('Data inválida', 'Informe o 1º dia do ciclo no formato DD/MM/AAAA.');
        return;
      }
      const cycleData = {
        type: actForm.type,
        name: actForm.name.trim(),
        notes: actForm.notes.trim(),
        cycle_start_date: cycleStartIso,
        cycle_length_days: Math.max(1, parseInt(cycleLengthInput, 10) || 28),
        period_length_days: Math.max(1, parseInt(periodLengthInput, 10) || 5),
      };
      if (editingActivity) {
        await updateActivity({ ...editingActivity, ...cycleData });
        await cancelAllRemindersForActivity(editingActivity.id);
        await deleteAllRemindersForActivity(editingActivity.id);
      } else {
        await addActivity(cycleData);
      }
      setShowActivityModal(false);
      loadActivities();
      return;
    }

    const itv = { hour: Math.max(1, parseInt(actItvInput) || 1), minute: 0 };
    const from = parseTime(actTimeStr) ?? { hour: 8, minute: 0 };
    const to = parseTime(actToStr) ?? { hour: 20, minute: 0 };
    const times = actRepeat
      ? generateRepeatTimes(from.hour, from.minute, to.hour, to.minute, itv.hour, itv.minute)
      : [actTimeStr || '08:00'];

    let actId: number;
    if (editingActivity) {
      await updateActivity({ ...editingActivity, type: actForm.type, name: actForm.name.trim(), notes: actForm.notes.trim() });
      actId = editingActivity.id;
      await cancelAllRemindersForActivity(actId);
      await deleteAllRemindersForActivity(actId);
    } else {
      actId = await addActivity({ type: actForm.type, name: actForm.name.trim(), notes: actForm.notes.trim() });
    }

    const hasWeekdays = actWeekdays.length > 0;
    const sortedWd = [...actWeekdays].sort((a, b) => a - b);
    const period = hasWeekdays ? `week:${sortedWd.join(',')}` : 'day';

    for (const t of times) {
      const parsed = parseTime(t);
      if (!parsed) continue;
      await addActivityReminder({ activity_id: actId, time: t, is_active: true, with_sound: true, period });
      if (hasWeekdays) {
        await scheduleActivityReminderWeekly(actId, actForm.name.trim(), sortedWd, parsed.hour, parsed.minute, true, actForm.type).catch(() => {});
      } else {
        await scheduleActivityReminder(actId, actForm.name.trim(), parsed.hour, parsed.minute, true, actForm.type).catch(() => {});
      }
    }

    setShowActivityModal(false);
    loadActivities();
  }

  async function handleDeleteActivity(a: Activity) {
    Alert.alert('Remover atividade', `Remover "${a.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await cancelAllRemindersForActivity(a.id);
          await deleteActivity(a.id);
          loadActivities();
        },
      },
    ]);
  }

  function handleCycleRestart(a: Activity) {
    Alert.alert('Novo ciclo', 'Hoje é o 1º dia do novo ciclo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar', onPress: async () => {
          const now = new Date();
          const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          await updateCycleStart(a.id, iso);
          await addActivityLog({ activity_id: a.id, activity_name: a.name, activity_type: a.type, realized: true, value: 'Novo ciclo iniciado' });
          loadActivities();
        },
      },
    ]);
  }

  function onTypeSelect(type: ActivityType) {
    if (!['water', 'bp', 'glucose'].includes(type)) setActRepeat(false);
    setActForm(f => ({
      ...f,
      type,
      name: f.name === ACTIVITY_PRESETS[f.type].defaultName
        ? ACTIVITY_PRESETS[type].defaultName
        : f.name,
    }));
  }

  // ─── MEASUREMENT HANDLERS ───────────────────────────────────────────────────

  async function openMeasureModal(a: Activity) {
    setMeasureActivity(a);
    setBpSystolic(''); setBpDiastolic(''); setBpPulse('');
    setMeasureValue('');
    setWalkTime(''); setWalkDistance('');
    const savedHeight = a.type === 'weight' ? (await getKV('weight_height') ?? '') : '';
    setWeightHeight(savedHeight);
    setShowMeasureModal(true);
  }

  async function saveMeasurement() {
    if (!measureActivity) return;
    let value = '';

    if (measureActivity.type === 'bp') {
      if (!bpSystolic.trim() || !bpDiastolic.trim()) {
        Alert.alert('Obrigatório', 'Informe a pressão sistólica e diastólica.');
        return;
      }
      value = `${bpSystolic}/${bpDiastolic}`;
      if (bpPulse.trim()) value += ` · ${bpPulse}bpm`;
    } else if (measureActivity.type === 'glucose') {
      if (!measureValue.trim()) { Alert.alert('Obrigatório', 'Informe o valor da glicose.'); return; }
      value = `${measureValue.trim()} mg/dL`;
    } else if (measureActivity.type === 'weight') {
      if (!measureValue.trim()) { Alert.alert('Obrigatório', 'Informe o peso.'); return; }
      value = `${measureValue.trim()} kg`;
      const hCm = parseInt(weightHeight, 10);
      const w = parseFloat(measureValue.replace(',', '.'));
      if (hCm > 0 && w > 0) {
        const hM = hCm / 100;
        const bmi = (w / (hM * hM)).toFixed(1);
        value += ` · ${hCm}cm · IMC ${bmi}`;
        await setKV('weight_height', String(hCm));
      }
    } else if (measureActivity.type === 'walk') {
      if (!walkTime.trim() && !walkDistance.trim()) {
        Alert.alert('Obrigatório', 'Informe pelo menos o tempo ou o percurso.');
        return;
      }
      const parts: string[] = [];
      if (walkTime.trim()) parts.push(`${walkTime.trim()} min`);
      if (walkDistance.trim()) parts.push(`${walkDistance.trim()} km`);
      value = parts.join(' · ');
    } else {
      value = measureValue.trim();
    }

    await addActivityLog({
      activity_id: measureActivity.id,
      activity_name: measureActivity.name,
      activity_type: measureActivity.type,
      realized: true,
      value,
    });

    setShowMeasureModal(false);
  }

  // ─── APPOINTMENT HANDLERS ───────────────────────────────────────────────────

  function openNewAppt() {
    setEditingAppt(null);
    setApptForm(EMPTY_APPT);
    setApptH(8); setApptM(0);
    setShowApptModal(true);
  }

  function openEditAppt(a: Appointment) {
    setEditingAppt(a);
    setApptForm({
      doctor_name: a.doctor_name,
      specialty: a.specialty,
      date: formatDateBR(a.date),
      time: a.time,
      location: a.location,
      notes: a.notes,
    });
    const [h, m] = a.time.split(':').map(Number);
    setApptH(!isNaN(h) ? h : 8);
    setApptM(!isNaN(m) ? m : 0);
    setShowApptModal(true);
  }

  async function saveAppt() {
    if (!apptForm.doctor_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do médico.');
      return;
    }
    if (!apptForm.date.trim()) {
      Alert.alert('Campo obrigatório', 'Informe a data da consulta.');
      return;
    }
    const isoDate = parseDateBR(apptForm.date);
    if (!isoDate) {
      Alert.alert('Data inválida', 'Use o formato DD/MM/AAAA (ex: 25/06/2026)');
      return;
    }
    if (apptH > 23 || apptM > 59) {
      Alert.alert('Horário inválido', 'Informe no formato HH:MM (ex: 14:30)');
      return;
    }
    const apptTime = fmtHM(apptH, apptM);

    const apptData = {
      doctor_name: apptForm.doctor_name.trim(),
      specialty: apptForm.specialty.trim(),
      date: isoDate,
      time: apptTime,
      location: apptForm.location.trim(),
      notes: apptForm.notes.trim(),
    };

    let apptId: number;
    if (editingAppt) {
      await cancelAppointmentReminders(editingAppt.id);
      await updateAppointment({ ...editingAppt, ...apptData });
      apptId = editingAppt.id;
    } else {
      apptId = await addAppointment(apptData);
    }

    await scheduleAppointmentReminders(apptId, apptData.doctor_name, isoDate, apptTime);

    setShowApptModal(false);
    loadAppointments();
  }

  async function handleDeleteAppt(a: Appointment) {
    Alert.alert('Remover consulta', `Remover consulta com Dr(a). ${a.doctor_name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await cancelAppointmentReminders(a.id);
          await deleteAppointment(a.id);
          loadAppointments();
        },
      },
    ]);
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Tab Toggle */}
      <View style={styles.tabToggle}>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'activities' && styles.toggleBtnActive]}
          onPress={() => setTab('activities')}
        >
          <Text style={[styles.toggleBtnText, tab === 'activities' && styles.toggleBtnTextActive]}>
            Atividades
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'appointments' && styles.toggleBtnActive]}
          onPress={() => setTab('appointments')}
        >
          <Text style={[styles.toggleBtnText, tab === 'appointments' && styles.toggleBtnTextActive]}>
            Consultas Médicas
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'activities' ? (
        <FlatList
          data={activities}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🏃</Text>
              <Text style={styles.emptyText}>Nenhuma atividade.</Text>
              <Text style={styles.emptyHint}>Adicione caminhada, água, fisioterapia e outras rotinas de saúde.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const reminders = remindersMap[item.id] ?? [];
            const { icon } = ACTIVITY_PRESETS[item.type] ?? ACTIVITY_PRESETS.custom;
            const isCycle = item.type === 'cycle';
            const cyclePhase = isCycle && item.cycle_start_date
              ? getCyclePhase(item.cycle_start_date, item.cycle_length_days ?? 28, item.period_length_days ?? 5)
              : null;

            return (
              <View style={styles.card}>
                {/* Top row */}
                <View style={styles.cardTopRow}>
                  <Text style={styles.actIcon}>{icon}</Text>
                  <TouchableOpacity
                    style={styles.cardInfo}
                    onPress={() => isCycle ? handleCycleRestart(item) : openMeasureModal(item)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.cardName}>
                      {item.name}<Text style={styles.cardNamePlus}> +</Text>
                    </Text>
                    {isCycle ? (
                      cyclePhase ? (
                        <Text style={[styles.cardSub, cyclePhase.isFertile && styles.cardSubFertile]}>
                          Dia {cyclePhase.dayInCycle} de {item.cycle_length_days ?? 28} · Fase: {cyclePhase.label}
                        </Text>
                      ) : (
                        <Text style={styles.cardSub}>Toque em editar para configurar</Text>
                      )
                    ) : reminders.length > 0 && (() => {
                      const firstR = reminders[0];
                      const wdLabel = firstR?.period?.startsWith('week:')
                        ? '  · ' + firstR.period.split(':')[1].split(',').map(v => WEEKDAYS_ACT.find(w => w.value === Number(v))?.label ?? '').join(', ')
                        : '';
                      return <Text style={styles.cardSub}>🔔 {reminders.map(r => r.time).join('  ·  ')}{wdLabel}</Text>;
                    })()}
                  </TouchableOpacity>
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditActivity(item)} accessibilityLabel={`Editar atividade ${item.name}`} accessibilityRole="button">
                      <Text style={styles.editBtnText}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteActivity(item)} accessibilityLabel={`Remover atividade ${item.name}`} accessibilityRole="button">
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      ) : tab === 'appointments' ? (
        <FlatList
          data={appointments}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🗓️</Text>
              <Text style={styles.emptyText}>Nenhuma consulta.</Text>
              <Text style={styles.emptyHint}>Adicione suas consultas médicas e receba lembrete 1 dia e 1 hora antes.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const past = isDatePast(item.date, item.time);
            return (
              <View style={[styles.card, past && styles.cardPast]}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.apptIcon}>🩺</Text>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.cardName, past && styles.cardNamePast]}>
                      Dr(a). {item.doctor_name}
                    </Text>
                    {!!item.specialty && <Text style={styles.cardSub}>{item.specialty}</Text>}
                    <Text style={styles.cardSub}>
                      {formatDateBR(item.date)} às {item.time}
                      {item.location ? `  ·  ${item.location}` : ''}
                    </Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditAppt(item)} accessibilityLabel={`Editar consulta com ${item.doctor_name}`} accessibilityRole="button">
                      <Text style={styles.editBtnText}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteAppt(item)} accessibilityLabel={`Remover consulta com ${item.doctor_name}`} accessibilityRole="button">
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      ) : null}

      <TouchableOpacity
        style={[styles.fab, { bottom: 24 + insets.bottom }]}
        onPress={tab === 'activities' ? openNewActivity : openNewAppt}
        accessibilityLabel={tab === 'activities' ? 'Adicionar atividade' : 'Adicionar consulta'}
        accessibilityRole="button"
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* ─── MEASUREMENT MODAL ─── */}
      <Modal visible={showMeasureModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <ScrollView
              ref={measureScrollRef}
              style={styles.modalBox}
              contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalTitle}>
                {ACTIVITY_PRESETS[measureActivity?.type ?? 'custom']?.icon}{' '}
                {measureActivity?.name}
              </Text>

              {measureActivity?.type === 'bp' && (
                <>
                  <View style={styles.measureHint}>
                    <Text style={styles.measureHintText}>
                      A pressão arterial é representada por dois números:{'\n'}
                      <Text style={{ fontWeight: '700' }}>sistólica</Text> (coração contraindo) /{' '}
                      <Text style={{ fontWeight: '700' }}>diastólica</Text> (coração relaxando)
                    </Text>
                  </View>

                  <Text style={styles.fieldLabel}>Pressão Sistólica — número de cima</Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={bpSystolic}
                      onChangeText={setBpSystolic}
                      keyboardType="numeric"
                      placeholder="ex: 120"
                      placeholderTextColor="#bbb"
                      maxLength={3}
                      returnKeyType="next"
                    />
                    <Text style={styles.measureUnit}>mmHg</Text>
                  </View>

                  <Text style={styles.fieldLabel}>Pressão Diastólica — número de baixo</Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={bpDiastolic}
                      onChangeText={setBpDiastolic}
                      keyboardType="numeric"
                      placeholder="ex: 80"
                      placeholderTextColor="#bbb"
                      maxLength={3}
                      returnKeyType="next"
                    />
                    <Text style={styles.measureUnit}>mmHg</Text>
                  </View>

                  <Text style={styles.fieldLabel}>Pulsação <Text style={styles.fieldLabelOpt}>(opcional)</Text></Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={bpPulse}
                      onChangeText={setBpPulse}
                      keyboardType="numeric"
                      placeholder="ex: 72"
                      placeholderTextColor="#bbb"
                      maxLength={3}
                      returnKeyType="done"
                      onFocus={() => scrollToEndSoon(measureScrollRef)}
                    />
                    <Text style={styles.measureUnit}>bpm</Text>
                  </View>
                </>
              )}

              {measureActivity?.type === 'glucose' && (
                <>
                  <Text style={styles.fieldLabel}>Glicemia</Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={measureValue}
                      onChangeText={setMeasureValue}
                      keyboardType="numeric"
                      placeholder="ex: 100"
                      placeholderTextColor="#bbb"
                      maxLength={5}
                      returnKeyType="done"
                      onFocus={() => scrollToEndSoon(measureScrollRef)}
                    />
                    <Text style={styles.measureUnit}>mg/dL</Text>
                  </View>
                </>
              )}

              {measureActivity?.type === 'weight' && (() => {
                const hCm = parseInt(weightHeight, 10);
                const w = parseFloat(measureValue.replace(',', '.'));
                const bmi = (hCm > 0 && w > 0) ? (w / Math.pow(hCm / 100, 2)) : null;
                const bmiColor = bmi ? measureColor('weight', `IMC ${bmi.toFixed(1)}`) : '#9CA3AF';
                const bmiLabel = !bmi ? '' : bmi < 18.5 ? 'Abaixo do peso' : bmi < 25 ? 'Peso normal' : bmi < 30 ? 'Sobrepeso' : bmi < 35 ? 'Obesidade I' : bmi < 40 ? 'Obesidade II' : 'Obesidade III';
                return (
                  <>
                    <Text style={styles.fieldLabel}>Peso</Text>
                    <View style={styles.measureInputRow}>
                      <TextInput
                        style={[styles.fieldInput, styles.measureInput]}
                        value={measureValue}
                        onChangeText={setMeasureValue}
                        keyboardType="decimal-pad"
                        placeholder="ex: 70.5"
                        placeholderTextColor="#bbb"
                        maxLength={6}
                        returnKeyType="next"
                      />
                      <Text style={styles.measureUnit}>kg</Text>
                    </View>

                    <Text style={styles.fieldLabel}>Altura <Text style={styles.fieldLabelOpt}>(para calcular IMC)</Text></Text>
                    <View style={styles.measureInputRow}>
                      <TextInput
                        style={[styles.fieldInput, styles.measureInput]}
                        value={weightHeight}
                        onChangeText={v => setWeightHeight(v.replace(/\D/g, ''))}
                        keyboardType="number-pad"
                        placeholder="ex: 170"
                        placeholderTextColor="#bbb"
                        maxLength={3}
                        returnKeyType="done"
                        onFocus={() => scrollToEndSoon(measureScrollRef)}
                      />
                      <Text style={styles.measureUnit}>cm</Text>
                    </View>

                    {bmi !== null && (
                      <View style={styles.bmiPreview}>
                        <Text style={styles.bmiPreviewValue}>IMC: <Text style={{ color: bmiColor, fontWeight: '700' }}>{bmi.toFixed(1)}</Text></Text>
                        <Text style={[styles.bmiPreviewLabel, { color: bmiColor }]}>{bmiLabel}</Text>
                      </View>
                    )}
                    <ColorLegend items={BMI_LEGEND} />
                  </>
                );
              })()}

              {measureActivity?.type === 'walk' && (
                <>
                  <Text style={styles.fieldLabel}>Tempo <Text style={styles.fieldLabelOpt}>(opcional)</Text></Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={walkTime}
                      onChangeText={setWalkTime}
                      keyboardType="numeric"
                      placeholder="ex: 30"
                      placeholderTextColor="#bbb"
                      maxLength={4}
                      returnKeyType="next"
                    />
                    <Text style={styles.measureUnit}>min</Text>
                  </View>
                  <Text style={styles.fieldLabel}>Percurso <Text style={styles.fieldLabelOpt}>(opcional)</Text></Text>
                  <View style={styles.measureInputRow}>
                    <TextInput
                      style={[styles.fieldInput, styles.measureInput]}
                      value={walkDistance}
                      onChangeText={setWalkDistance}
                      keyboardType="decimal-pad"
                      placeholder="ex: 2.5"
                      placeholderTextColor="#bbb"
                      maxLength={6}
                      returnKeyType="done"
                      onFocus={() => scrollToEndSoon(measureScrollRef)}
                    />
                    <Text style={styles.measureUnit}>km</Text>
                  </View>
                </>
              )}

              {!MEASURE_TYPES.includes(measureActivity?.type ?? 'custom' as ActivityType) && measureActivity?.type !== 'walk' && (
                <>
                  <Text style={styles.fieldLabel}>Valor <Text style={styles.fieldLabelOpt}>(opcional)</Text></Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={measureValue}
                    onChangeText={setMeasureValue}
                    placeholder="ex: 2 copos, 40 minutos…"
                    placeholderTextColor="#bbb"
                    autoCapitalize="sentences"
                    returnKeyType="done"
                    onFocus={() => scrollToEndSoon(measureScrollRef)}
                  />
                </>
              )}

              {measureActivity?.type === 'bp' && <ColorLegend items={BP_LEGEND} />}
              {measureActivity?.type === 'glucose' && <ColorLegend items={GLUCOSE_LEGEND} />}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowMeasureModal(false)}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveMeasurement}>
                  <Text style={styles.saveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── ACTIVITY MODAL ─── */}
      <Modal visible={showActivityModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <ScrollView
              ref={activityScrollRef}
              style={styles.modalBox}
              contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalTitle}>
                {editingActivity ? 'Editar Atividade' : 'Nova Atividade'}
              </Text>

              <Text style={styles.fieldLabel}>Tipo</Text>
              <View style={styles.typeGrid}>
                {ACTIVITY_TYPES.map(type => {
                  const { icon, defaultName } = ACTIVITY_PRESETS[type];
                  const active = actForm.type === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeBtn, active && styles.typeBtnActive]}
                      onPress={() => onTypeSelect(type)}
                    >
                      <Text style={styles.typeIcon}>{icon}</Text>
                      <Text style={[styles.typeLabel, active && styles.typeLabelActive]} numberOfLines={1}>
                        {defaultName || 'Outro'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Nome *</Text>
              <TextInput
                style={styles.fieldInput}
                value={actForm.name}
                onChangeText={v => setActForm(f => ({ ...f, name: v }))}
                placeholder="Ex: Tomar água"
                autoCapitalize="sentences"
                autoCorrect={false}
                spellCheck={false}
              />

              {actForm.type === 'cycle' ? (
                <>
                  <Text style={styles.fieldLabel}>1º dia do ciclo atual *</Text>
                  <TouchableOpacity
                    style={[styles.fieldInput, styles.pickerBtn]}
                    onPress={() => {
                      const iso = parseDateBR(cycleStartDateBR);
                      setCyclePickerDate(iso ? new Date(iso + 'T00:00:00') : new Date());
                      setShowCycleDatePicker(v => !v);
                    }}
                  >
                    <Text style={cycleStartDateBR ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                      {cycleStartDateBR || 'DD/MM/AAAA'}
                    </Text>
                    <Text style={styles.pickerBtnIcon}>📅</Text>
                  </TouchableOpacity>

                  <Text style={styles.fieldLabel}>Duração média do ciclo (dias)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={cycleLengthInput}
                    onChangeText={v => setCycleLengthInput(v.replace(/\D/g, '').slice(0, 2))}
                    onEndEditing={() => setCycleLengthInput(String(Math.max(1, parseInt(cycleLengthInput, 10) || 28)))}
                    keyboardType="number-pad"
                    placeholder="28"
                  />

                  <Text style={styles.fieldLabel}>Duração da menstruação (dias)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={periodLengthInput}
                    onChangeText={v => setPeriodLengthInput(v.replace(/\D/g, '').slice(0, 2))}
                    onEndEditing={() => setPeriodLengthInput(String(Math.max(1, parseInt(periodLengthInput, 10) || 5)))}
                    keyboardType="number-pad"
                    placeholder="5"
                  />

                  {showCycleDatePicker && (
                    <PickerDataHora
                      aoAparecer={revelarPicker(activityScrollRef)}
                      valor={cyclePickerDate}
                      modo="date"
                      onMudar={(date) => {
                        const d = String(date.getDate()).padStart(2, '0');
                        const mo = String(date.getMonth() + 1).padStart(2, '0');
                        setCycleStartDateBR(`${d}/${mo}/${date.getFullYear()}`);
                        setCyclePickerDate(date);
                      }}
                      onFechar={() => setShowCycleDatePicker(false)}
                    />
                  )}
                </>
              ) : (
                <>
                  <View style={styles.actTimeRow}>
                    <Text style={styles.actTimeLabel}>Horário da Atividade</Text>
                    <TouchableOpacity onPress={() => setShowActTimePicker(v => !v)}>
                      <Text style={styles.actTimeDisplay}>{actTimeStr || '08:00'}</Text>
                    </TouchableOpacity>
                  </View>
                  {showActTimePicker && (
                    <PickerDataHora
                      aoAparecer={revelarPicker(activityScrollRef)}
                      valor={(() => { const d = new Date(); const p = parseTime(actTimeStr); d.setHours(p?.hour ?? 8, p?.minute ?? 0, 0, 0); return d; })()}
                      onMudar={(d) => setActTimeStr(fmtHM(d.getHours(), d.getMinutes()))}
                      onFechar={() => setShowActTimePicker(false)}
                    />
                  )}

                  {['water', 'bp', 'glucose'].includes(actForm.type) && (
                    <TouchableOpacity
                      style={[styles.repeatToggleBtn, actRepeat && styles.repeatToggleBtnActive]}
                      onPress={() => setActRepeat(v => !v)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.repeatToggleBtnText, actRepeat && styles.repeatToggleBtnTextActive]}>
                        🔁  Repetir lembrete{actRepeat ? ' — Ativado' : ''}
                      </Text>
                      <Text style={[styles.repeatToggleBtnHint, actRepeat && { color: 'rgba(255,255,255,0.65)' }]}>
                        {actRepeat ? 'Toque para desativar' : 'Repete o aviso em intervalos durante o dia'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {actRepeat && ['water', 'bp', 'glucose'].includes(actForm.type) && (
                    <View style={styles.repeatInlineRow}>
                      <Text style={styles.repeatInlineText}>Repete a cada </Text>
                      <TextInput
                        style={styles.repeatItvInput}
                        value={actItvInput}
                        onChangeText={v => setActItvInput(v.replace(/\D/g,''))}
                        onEndEditing={() => { const n = Math.max(1, parseInt(actItvInput) || 1); setActItvInput(String(n)); }}
                        keyboardType="numeric"
                      />
                      <Text style={styles.repeatInlineText}>h  das {actTimeStr}  às </Text>
                      <TouchableOpacity onPress={() => setShowToTimePicker(v => !v)}>
                        <Text style={styles.repeatTimeDisplay}>{actToStr || '20:00'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {showToTimePicker && (
                    <PickerDataHora
                      aoAparecer={revelarPicker(activityScrollRef)}
                      valor={(() => { const d = new Date(); const p = parseTime(actToStr); d.setHours(p?.hour ?? 20, p?.minute ?? 0, 0, 0); return d; })()}
                      onMudar={(d) => setActToStr(fmtHM(d.getHours(), d.getMinutes()))}
                      onFechar={() => setShowToTimePicker(false)}
                    />
                  )}

                  <Text style={styles.fieldLabel}>
                    Dias da semana <Text style={styles.fieldLabelOpt}>(vazio = todos os dias)</Text>
                  </Text>
                  <View style={styles.actWeekdayRow}>
                    {WEEKDAYS_ACT.map(wd => {
                      const sel = actWeekdays.includes(wd.value);
                      return (
                        <TouchableOpacity
                          key={wd.value}
                          style={[styles.actWeekdayBtn, sel && styles.actWeekdayBtnActive]}
                          onPress={() => setActWeekdays(prev => sel ? prev.filter(v => v !== wd.value) : [...prev, wd.value])}
                        >
                          <Text style={[styles.actWeekdayBtnText, sel && styles.actWeekdayBtnTextActive]}>{wd.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Observações</Text>
              <TextInput
                style={[styles.fieldInput, { height: 64 }]}
                value={actForm.notes}
                onChangeText={v => setActForm(f => ({ ...f, notes: v }))}
                placeholder="Opcional"
                multiline
                onFocus={() => scrollToEndSoon(activityScrollRef)}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowActivityModal(false)}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveActivity}>
                  <Text style={styles.saveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── APPOINTMENT MODAL ─── */}
      <Modal visible={showApptModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <ScrollView
              ref={apptScrollRef}
              style={styles.modalBox}
              contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalTitle}>
                {editingAppt ? 'Editar Consulta' : 'Nova Consulta'}
              </Text>

              <Text style={styles.fieldLabel}>Médico *</Text>
              <TextInput
                style={styles.fieldInput}
                value={apptForm.doctor_name}
                onChangeText={v => setApptForm(f => ({ ...f, doctor_name: v }))}
                placeholder="Ex: Dr. Carlos Silva"
                autoCapitalize="words"
                autoCorrect={false}
                spellCheck={false}
              />

              <Text style={styles.fieldLabel}>Especialidade</Text>
              <TextInput
                style={styles.fieldInput}
                value={apptForm.specialty}
                onChangeText={v => setApptForm(f => ({ ...f, specialty: v }))}
                placeholder="Ex: Cardiologista"
                autoCapitalize="sentences"
              />

              <Text style={styles.fieldLabel}>Data *</Text>
              <TouchableOpacity
                style={[styles.fieldInput, styles.pickerBtn]}
                onPress={() => {
                  setPickerDate(formToDate(apptForm.date, fmtHM(apptH, apptM)));
                  setShowDatePicker(v => !v);
                }}
              >
                <Text style={apptForm.date ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                  {apptForm.date || 'DD/MM/AAAA'}
                </Text>
                <Text style={styles.pickerBtnIcon}>📅</Text>
              </TouchableOpacity>
              {/* Tem que ficar DENTRO do Modal: no iOS o picker é uma view inline, e fora
                  daqui ele nascia atrás do modal — o botão Data não abria nada. */}
              {showDatePicker && (
                <PickerDataHora
                  aoAparecer={revelarPicker(apptScrollRef)}
                  valor={pickerDate}
                  modo="date"
                  onMudar={(date) => {
                    const d = String(date.getDate()).padStart(2, '0');
                    const mo = String(date.getMonth() + 1).padStart(2, '0');
                    setApptForm(f => ({ ...f, date: `${d}/${mo}/${date.getFullYear()}` }));
                    setPickerDate(date);
                  }}
                  onFechar={() => setShowDatePicker(false)}
                />
              )}

              <Text style={styles.fieldLabel}>Horário *</Text>
              <TouchableOpacity
                style={[styles.fieldInput, styles.pickerBtn]}
                onPress={() => setShowApptTimePicker(v => !v)}
              >
                <Text style={styles.pickerBtnText}>{fmtHM(apptH, apptM)}</Text>
                <Text style={styles.pickerBtnIcon}>🕐</Text>
              </TouchableOpacity>
              {showApptTimePicker && (
                <PickerDataHora
                  aoAparecer={revelarPicker(apptScrollRef)}
                  valor={(() => { const d = new Date(); d.setHours(apptH, apptM, 0, 0); return d; })()}
                  onMudar={(date) => { setApptH(date.getHours()); setApptM(date.getMinutes()); }}
                  onFechar={() => setShowApptTimePicker(false)}
                />
              )}

              <Text style={styles.fieldLabel}>Local</Text>
              <TextInput
                style={styles.fieldInput}
                value={apptForm.location}
                onChangeText={v => setApptForm(f => ({ ...f, location: v }))}
                placeholder="Ex: Clínica São Lucas, sala 12"
                autoCapitalize="sentences"
              />

              <Text style={styles.fieldLabel}>Observações</Text>
              <TextInput
                style={[styles.fieldInput, { height: 64 }]}
                value={apptForm.notes}
                onChangeText={v => setApptForm(f => ({ ...f, notes: v }))}
                placeholder="Exames a trazer, convênio, etc."
                multiline
                onFocus={() => scrollToEndSoon(apptScrollRef)}
              />

              <View style={styles.reminderInfo}>
                <Text style={styles.reminderInfoText}>
                  🔔 Lembretes automáticos: 1 dia antes e 1 hora antes da consulta.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowApptModal(false)}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveAppt}>
                  <Text style={styles.saveBtnText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>


    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },

  tabToggle: {
    flexDirection: 'row',
    margin: 14,
    marginBottom: 4,
    backgroundColor: '#E8EBF0',
    borderRadius: 10,
    padding: 3,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleBtnText: { fontSize: 13, fontWeight: '500', color: '#888' },
  toggleBtnTextActive: { color: '#1C3F7A', fontWeight: '700' },

  list: { padding: 14, paddingTop: 10, paddingBottom: 32 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#999', marginBottom: 6, fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardTopRow: {
    flexDirection: 'row', alignItems: 'center',
  },
  cardPast: { opacity: 0.55 },
  actIcon: { fontSize: 26, marginRight: 12 },
  apptIcon: { fontSize: 26, marginRight: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1C3F7A', marginBottom: 2 },
  cardNamePlus: { fontSize: 15, fontWeight: '700', color: '#E07B4F' },
  cardNamePast: { color: '#888' },
  cardSub: { fontSize: 12, color: '#777', marginTop: 2 },
  cardSubFertile: { color: '#E07B4F', fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 8, marginLeft: 8 },
  editBtn: { padding: 6 },
  editBtnText: { fontSize: 16 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 11, color: '#DC2626', fontWeight: '700' },

  addCircleBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#EEF2FF',
    alignItems: 'center', justifyContent: 'center',
  },
  addCircleBtnText: { fontSize: 18, color: '#1C3F7A', fontWeight: '600', lineHeight: 22 },

  fab: {
    position: 'absolute', right: 20, width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#1C3F7A', alignItems: 'center', justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 26, lineHeight: 30, fontWeight: '300' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '92%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 4, marginTop: 12 },
  fieldLabelOpt: { fontSize: 12, fontWeight: '400', color: '#9CA3AF' },
  fieldInput: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111',
    backgroundColor: '#FAFAFA', marginBottom: 2,
  },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerBtnText: { fontSize: 14, color: '#111', flex: 1 },
  pickerBtnPlaceholder: { fontSize: 14, color: '#9CA3AF', flex: 1 },
  pickerBtnIcon: { fontSize: 16, marginLeft: 4 },

  // Measurement modal
  measureHint: {
    backgroundColor: '#EEF2FF', borderRadius: 8, padding: 12, marginBottom: 4, marginTop: 4,
  },
  measureHintText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  measureInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2,
  },
  measureInput: { flex: 1, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  measureUnit: { fontSize: 14, fontWeight: '600', color: '#6B7280', minWidth: 44 },
  bmiPreview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginTop: 8,
  },
  bmiPreviewValue: { fontSize: 15, color: '#374151' },
  bmiPreviewLabel: { fontSize: 13, fontWeight: '600' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  typeBtn: {
    width: '22%', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
    alignItems: 'center', backgroundColor: '#F9FAFB',
  },
  typeBtnActive: { borderColor: '#1C3F7A', backgroundColor: '#EEF2FF' },
  typeIcon: { fontSize: 20, marginBottom: 2 },
  typeLabel: { fontSize: 9, color: '#666', textAlign: 'center' },
  typeLabelActive: { color: '#1C3F7A', fontWeight: '700' },

  actTimeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, marginTop: 4,
  },
  actTimeLabel: { fontSize: 14, color: '#555' },
  actTimeDisplay: {
    fontSize: 20, fontWeight: '700', color: '#1C3F7A',
    textAlign: 'center', minWidth: 64, paddingVertical: 2,
  },

  repeatToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  repeatToggleLabel: { fontSize: 13, color: '#555', flex: 1, marginRight: 10 },
  repeatToggleBtn: {
    borderWidth: 1.5, borderColor: '#D1D5DB', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 10,
    backgroundColor: '#F9FAFB',
  },
  repeatToggleBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  repeatToggleBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  repeatToggleBtnTextActive: { color: '#fff' },
  repeatToggleBtnHint: { fontSize: 12, color: '#9CA3AF', marginTop: 3 },
  repeatInlineRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    backgroundColor: '#F2F4F8', borderRadius: 10, padding: 10, marginTop: 4, gap: 2,
  },
  repeatInlineText: { fontSize: 13, color: '#444' },
  repeatItvInput: {
    fontSize: 14, fontWeight: '700', color: '#1C3F7A',
    textAlign: 'center', minWidth: 32, paddingVertical: 2,
  },
  repeatTimeDisplay: {
    fontSize: 14, fontWeight: '700', color: '#1C3F7A',
    textAlign: 'center', minWidth: 48, paddingVertical: 2,
  },

  actWeekdayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 4 },
  actWeekdayBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB', minWidth: 44, alignItems: 'center',
  },
  actWeekdayBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  actWeekdayBtnText: { fontSize: 13, fontWeight: '600', color: '#555' },
  actWeekdayBtnTextActive: { color: '#fff' },

  reminderInfo: {
    backgroundColor: '#EEF2FF', borderRadius: 8, padding: 10, marginTop: 12,
  },
  reminderInfoText: { fontSize: 12, color: '#4B5563' },

  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelBtnText: { color: '#1C3F7A', fontWeight: '600', fontSize: 15 },
  saveBtn: {
    flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
