import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Alert, ScrollView, KeyboardAvoidingView, Switch, Share, Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { TimePicker } from '../components/TimePicker';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getActivities, addActivity, updateActivity, deleteActivity,
  getRemindersForActivity, addActivityReminder, deleteAllRemindersForActivity,
  getAppointments, addAppointment, updateAppointment, deleteAppointment,
  getActivityLogs, deleteActivityLog, ActivityLog,
  addActivityLog, getActivityLogsForActivity,
  getKV, setKV,
} from '../database/db';
import {
  scheduleActivityReminder, cancelAllRemindersForActivity,
  scheduleAppointmentReminders, cancelAppointmentReminders,
} from '../services/notifications';
import { Activity, ActivityReminder, ActivityType, ACTIVITY_PRESETS, Appointment } from '../types';

const ACTIVITY_TYPES: ActivityType[] = ['water', 'walk', 'physio', 'bp', 'glucose', 'weight', 'custom'];
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
    if (sys > 180 || dia > 120) return '#7F1D1D';
    if (sys >= 140 || dia >= 90)  return '#DC2626';
    if (sys >= 130 || dia >= 80)  return '#EA580C';
    if (sys >= 120)               return '#D97706';
    return '#16A34A';
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
  { color: '#16A34A', label: 'Ótima' },
  { color: '#D97706', label: 'Elevada' },
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

function fmtLogDate(logged_at: string): string {
  const d = new Date(logged_at);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `hoje ${time}`;
  if (isYesterday) return `ontem ${time}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + time;
}

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
  const route = useRoute<RouteProp<{ Agenda: { tab?: 'activities' | 'appointments'; openActivityId?: number; openAppointmentId?: number } }, 'Agenda'>>();
  const [tab, setTab] = useState<'activities' | 'appointments' | 'history'>(route.params?.tab ?? 'activities');
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  useFocusEffect(useCallback(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]));

  // Activities state
  const [activities, setActivities] = useState<Activity[]>([]);
  const [remindersMap, setRemindersMap] = useState<Record<number, ActivityReminder[]>>({});
  const [logsMap, setLogsMap] = useState<Record<number, ActivityLog[]>>({});
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [actForm, setActForm] = useState(EMPTY_ACTIVITY);

  // Measurement modal state
  const [showMeasureModal, setShowMeasureModal] = useState(false);
  const [measureActivity, setMeasureActivity] = useState<Activity | null>(null);
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [bpPulse, setBpPulse] = useState('');
  const [measureValue, setMeasureValue] = useState('');
  const [weightHeight, setWeightHeight] = useState('');

  // Appointments state
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showApptModal, setShowApptModal] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [apptForm, setApptForm] = useState(EMPTY_APPT);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());

  // Activity time state
  const [actTimeStr, setActTimeStr] = useState('08:00');
  const [actRepeat, setActRepeat] = useState(false);
  const [actItvInput, setActItvInput] = useState('1');
  const [actToStr, setActToStr] = useState('20:00');
  const [showActTimePicker, setShowActTimePicker] = useState(false);
  const [showToTimePicker, setShowToTimePicker] = useState(false);

  // Appointment time wheel state
  const [apptH, setApptH] = useState(8);
  const [apptM, setApptM] = useState(0);

  const loadActivities = useCallback(async () => {
    const list = await getActivities();
    setActivities(list);
    const map: Record<number, ActivityReminder[]> = {};
    const lmap: Record<number, ActivityLog[]> = {};
    await Promise.all(list.map(async a => {
      map[a.id] = await getRemindersForActivity(a.id);
      lmap[a.id] = await getActivityLogsForActivity(a.id, 5);
    }));
    setRemindersMap(map);
    setLogsMap(lmap);
    return { list, map };
  }, []);

  const loadAppointments = useCallback(async () => {
    const list = await getAppointments();
    setAppointments(list);
    return list;
  }, []);

  const loadLogs = useCallback(async () => {
    setLogs(await getActivityLogs());
  }, []);

  useFocusEffect(useCallback(() => {
    const openActId = route.params?.openActivityId;
    const openApptId = route.params?.openAppointmentId;
    if (route.params?.tab) setTab(route.params.tab);

    loadActivities().then(({ list }) => {
      if (openActId) {
        const act = list.find(a => a.id === openActId);
        if (act) openMeasureModal(act);
      }
    });

    loadAppointments().then(list => {
      if (openApptId) {
        const appt = list.find(a => a.id === openApptId);
        if (appt) openEditAppt(appt);
      }
    });

    loadLogs();
  }, [loadActivities, loadAppointments, loadLogs, route.params?.tab, route.params?.openActivityId, route.params?.openAppointmentId]));

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
    setShowActivityModal(true);
  }

  function openEditActivity(a: Activity) {
    setEditingActivity(a);
    const times = (remindersMap[a.id] ?? []).map(r => r.time);
    setActForm({ type: a.type, name: a.name, notes: a.notes, times: times.length ? times : [''] });
    initActWheelFromTimes(times);
    setShowActivityModal(true);
  }

  async function saveActivity() {
    if (!actForm.name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome da atividade.');
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

    for (const t of times) {
      const parsed = parseTime(t);
      if (!parsed) continue;
      await addActivityReminder({ activity_id: actId, time: t, is_active: true, with_sound: true });
      await scheduleActivityReminder(actId, actForm.name.trim(), parsed.hour, parsed.minute, true, actForm.type).catch(() => {});
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

  function onTypeSelect(type: ActivityType) {
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

    const newLogs = await getActivityLogsForActivity(measureActivity.id, 5);
    setLogsMap(prev => ({ ...prev, [measureActivity.id]: newLogs }));
    setLogs(await getActivityLogs());
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
            Consultas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'history' && styles.toggleBtnActive]}
          onPress={() => { setTab('history'); loadLogs(); }}
        >
          <Text style={[styles.toggleBtnText, tab === 'history' && styles.toggleBtnTextActive]}>
            Histórico
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
            const itemLogs = logsMap[item.id] ?? [];
            const { icon } = ACTIVITY_PRESETS[item.type] ?? ACTIVITY_PRESETS.custom;
            const isMeasure = MEASURE_TYPES.includes(item.type);
            const btnLabel = isMeasure ? '+ Nova medição' : '+ Registrar';

            return (
              <View style={styles.card}>
                {/* Top row */}
                <View style={styles.cardTopRow}>
                  <Text style={styles.actIcon}>{icon}</Text>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName}>{item.name}</Text>
                    {reminders.length > 0 && (
                      <Text style={styles.cardSub}>🔔 {reminders.map(r => r.time).join('  ·  ')}</Text>
                    )}
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditActivity(item)}>
                      <Text style={styles.editBtnText}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.addCircleBtn} onPress={() => openMeasureModal(item)}>
                      <Text style={styles.addCircleBtnText}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteActivity(item)}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Last 5 measurements */}
                {itemLogs.length > 0 && (
                  <View style={styles.logsSection}>
                    {itemLogs.map(log => (
                      <View key={log.id} style={styles.logRow}>
                        <Text style={[styles.logRowValue, { color: measureColor(item.type, log.value) }]} numberOfLines={1}>
                          {log.value || (log.realized ? '✓ Realizado' : '✗ Não realizado')}
                        </Text>
                        <Text style={styles.logRowDate}>{fmtLogDate(log.logged_at)}</Text>
                      </View>
                    ))}
                  </View>
                )}
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
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditAppt(item)}>
                      <Text style={styles.editBtnText}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteAppt(item)}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      ) : null}

      {tab === 'history' && (() => {
        async function shareReport() {
          if (logs.length === 0) { Alert.alert('Histórico vazio', 'Nenhuma atividade registrada ainda.'); return; }
          const lines = logs.map(l => {
            const date = new Date(l.logged_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const status = l.realized ? '✓' : '✗';
            const val = l.value ? ` — ${l.value}` : '';
            return `${status} ${date}  ${l.activity_name}${val}`;
          }).join('\n');
          await Share.share({ message: `📋 Relatório de Atividades\n\n${lines}` });
        }

        function logIcon(type: string) {
          const icons: Record<string, string> = { water: '💧', walk: '🚶', physio: '🏋️', bp: '❤️', glucose: '🩸', weight: '⚖️', custom: '📌' };
          return icons[type] ?? '📌';
        }

        return (
          <View style={{ flex: 1 }}>
            <TouchableOpacity style={styles.reportBtn} onPress={shareReport}>
              <Text style={styles.reportBtnText}>📤 Compartilhar relatório</Text>
            </TouchableOpacity>
            <FlatList
              data={logs}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>📋</Text>
                  <Text style={styles.emptyText}>Nenhum registro ainda.</Text>
                  <Text style={styles.emptyHint}>Os registros aparecem quando você responde aos avisos de atividade ou registra manualmente.</Text>
                </View>
              }
              renderItem={({ item }) => {
                const date = new Date(item.logged_at);
                const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <View style={[styles.logCard, !item.realized && styles.logCardMissed]}>
                    <Text style={styles.logIcon}>{logIcon(item.activity_type)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logName}>{item.activity_name}</Text>
                      {!!item.value && <Text style={styles.logValue}>{item.value}</Text>}
                      <Text style={styles.logDate}>{dateStr} às {timeStr}</Text>
                    </View>
                    <View style={[styles.logBadge, item.realized ? styles.logBadgeOk : styles.logBadgeMissed]}>
                      <Text style={styles.logBadgeText}>{item.realized ? 'Realizado' : 'Não realiz.'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => Alert.alert('Remover', 'Remover este registro?', [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Remover', style: 'destructive', onPress: async () => { await deleteActivityLog(item.id); loadLogs(); } },
                    ])} style={{ padding: 8 }}>
                      <Text style={{ color: '#ccc', fontSize: 14 }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          </View>
        );
      })()}

      {tab !== 'history' && (
        <TouchableOpacity
          style={[styles.fab, { bottom: 24 + insets.bottom }]}
          onPress={tab === 'activities' ? openNewActivity : openNewAppt}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* ─── MEASUREMENT MODAL ─── */}
      <Modal visible={showMeasureModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <ScrollView
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

              {!MEASURE_TYPES.includes(measureActivity?.type ?? 'custom' as ActivityType) && (
                <>
                  <Text style={styles.fieldLabel}>Observação <Text style={styles.fieldLabelOpt}>(opcional)</Text></Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={measureValue}
                    onChangeText={setMeasureValue}
                    placeholder="ex: 30 minutos"
                    placeholderTextColor="#bbb"
                    autoCapitalize="sentences"
                    returnKeyType="done"
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
              />

              <View style={styles.actTimeRow}>
                <Text style={styles.actTimeLabel}>Horário da Atividade</Text>
                <TouchableOpacity onPress={() => setShowActTimePicker(true)}>
                  <Text style={styles.actTimeDisplay}>{actTimeStr || '08:00'}</Text>
                </TouchableOpacity>
              </View>
              {showActTimePicker && (
                <DateTimePicker
                  value={(() => { const d = new Date(); const p = parseTime(actTimeStr); d.setHours(p?.hour ?? 8, p?.minute ?? 0, 0, 0); return d; })()}
                  mode="time"
                  is24Hour={true}
                  onChange={(e, d) => {
                    setShowActTimePicker(false);
                    if (e.type === 'set' && d) setActTimeStr(fmtHM(d.getHours(), d.getMinutes()));
                  }}
                />
              )}

              <View style={styles.repeatToggleRow}>
                <Text style={styles.repeatToggleLabel}>Repetir Lembrete</Text>
                <Switch
                  value={actRepeat}
                  onValueChange={v => setActRepeat(v)}
                  trackColor={{ true: '#1C3F7A' }}
                />
              </View>

              {actRepeat && (
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
                  <TouchableOpacity onPress={() => setShowToTimePicker(true)}>
                    <Text style={styles.repeatTimeDisplay}>{actToStr || '20:00'}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {showToTimePicker && (
                <DateTimePicker
                  value={(() => { const d = new Date(); const p = parseTime(actToStr); d.setHours(p?.hour ?? 20, p?.minute ?? 0, 0, 0); return d; })()}
                  mode="time"
                  is24Hour={true}
                  onChange={(e, d) => {
                    setShowToTimePicker(false);
                    if (e.type === 'set' && d) setActToStr(fmtHM(d.getHours(), d.getMinutes()));
                  }}
                />
              )}

              <Text style={styles.fieldLabel}>Observações</Text>
              <TextInput
                style={[styles.fieldInput, { height: 64 }]}
                value={actForm.notes}
                onChangeText={v => setActForm(f => ({ ...f, notes: v }))}
                placeholder="Opcional"
                multiline
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
                  setShowDatePicker(true);
                }}
              >
                <Text style={apptForm.date ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                  {apptForm.date || 'DD/MM/AAAA'}
                </Text>
                <Text style={styles.pickerBtnIcon}>📅</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Horário *</Text>
              <TimePicker
                hour={apptH}
                minute={apptM}
                onChange={(h, m) => { setApptH(h); setApptM(m); }}
              />

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

      {showDatePicker && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display="calendar"
          onChange={(e: DateTimePickerEvent, date?: Date) => {
            setShowDatePicker(false);
            if (e.type === 'set' && date) {
              const d = String(date.getDate()).padStart(2, '0');
              const mo = String(date.getMonth() + 1).padStart(2, '0');
              const y = date.getFullYear();
              setApptForm(f => ({ ...f, date: `${d}/${mo}/${y}` }));
              setPickerDate(date);
            }
          }}
        />
      )}

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

  list: { padding: 14, paddingTop: 10, paddingBottom: 80 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#999', marginBottom: 6, fontWeight: '500' },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center' },

  reportBtn: {
    margin: 14, marginBottom: 4, backgroundColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  reportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  logCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  logCardMissed: { opacity: 0.6 },
  logIcon: { fontSize: 22 },
  logName: { fontSize: 14, fontWeight: '600', color: '#1A1F2E' },
  logValue: { fontSize: 13, color: '#1C3F7A', fontWeight: '700', marginTop: 1 },
  logDate: { fontSize: 11, color: '#8A8F9D', marginTop: 2 },
  logBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  logBadgeOk: { backgroundColor: '#F0FFF4' },
  logBadgeMissed: { backgroundColor: '#FFF0F0' },
  logBadgeText: { fontSize: 10, fontWeight: '700', color: '#444' },

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
  cardNamePast: { color: '#888' },
  cardSub: { fontSize: 12, color: '#777', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 8, marginLeft: 8 },
  editBtn: { padding: 6 },
  editBtnText: { fontSize: 16 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 11, color: '#DC2626', fontWeight: '700' },

  // Logs section in card
  logsSection: {
    marginTop: 10, borderTopWidth: 1, borderTopColor: '#F0F2F6', paddingTop: 8,
  },
  logRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 3,
  },
  logRowValue: { fontSize: 13, fontWeight: '600', color: '#1C3F7A', flex: 1 },
  logRowDate: { fontSize: 11, color: '#9CA3AF', marginLeft: 8 },
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
    width: '13%', minWidth: 48, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
    alignItems: 'center', backgroundColor: '#F9FAFB',
    flexGrow: 1,
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
