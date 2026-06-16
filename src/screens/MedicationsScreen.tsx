import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView, Linking, Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, updateMedication, deleteMedication,
  getRemindersForMedication, addReminder, deleteReminder, toggleReminderActive,
} from '../database/db';
import {
  scheduleReminderWeekly, scheduleReminderMonthly, scheduleReminderYearly,
} from '../services/notifications';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelReminderByTime, cancelAllRemindersForMedication,
} from '../services/notifications';
import { Medication, MedicationReminder, DrugInteraction } from '../types';
import { DrugSuggestion, getSuggestions, getBulaUrl, checkInteractions } from '../utils/drugSearch';

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
};

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
    const wd = WEEKDAYS.find(w => w.value === Number(period.split(':')[1]));
    return `${time} · toda ${wd?.label ?? ''}`;
  }
  if (period.startsWith('month:')) return `${time} · dia ${period.split(':')[1]}/mês`;
  if (period.startsWith('year:')) return `${time} · ${period.split(':')[1]} anual`;
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
  const insets = useSafeAreaInsets();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_MED);
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([]);
  const [commercialSuggestions, setCommercialSuggestions] = useState<DrugSuggestion[]>([]);
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [cardInteractions, setCardInteractions] = useState<Map<number, DrugInteraction[]>>(new Map());

  // Reminder state
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderMed, setReminderMed] = useState<Medication | null>(null);
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [startTime, setStartTime] = useState('08:00');
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [customTimes, setCustomTimes] = useState('');
  const [withSound, setWithSound] = useState(true);
  const [reminderPeriod, setReminderPeriod] = useState<ReminderPeriod>('day');
  const [weekday, setWeekday] = useState(2);        // 2 = Segunda-feira
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [yearDate, setYearDate] = useState('01/01'); // DD/MM

  const computedTimes = useMemo(
    () => computeTimes(startTime, timesPerDay),
    [startTime, timesPerDay]
  );

  const load = useCallback(async () => {
    try {
      const meds = await getMedications();
      setMedications(meds);
      const map = new Map<number, DrugInteraction[]>();
      meds.forEach(med => {
        const others = meds.filter(m => m.id !== med.id).map(m => m.generic_name);
        const ints = checkInteractions(med.generic_name, others);
        if (ints.length > 0) map.set(med.id, ints);
      });
      setCardInteractions(map);
    } catch {}
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
    setSuggestions(getSuggestions(v));
    setCommercialSuggestions([]);
    // Exclude the medication being edited from the interaction check
    const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
    setInteractions(checkInteractions(v, others));
  }

  function applySuggestion(s: DrugSuggestion) {
    const commercial = s.brandName ?? s.firstBrand;
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (commercial ?? ''),
    }));
    setSuggestions([]);
    const others = medications.filter(m => m.id !== editingId).map(m => m.generic_name);
    setInteractions(checkInteractions(s.genericName, others));
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
      const data = { ...form, generic_name: form.generic_name.trim(), commercial_name: form.commercial_name.trim() };
      if (editingId !== null) {
        await updateMedication({ ...data, id: editingId });
      } else {
        await addMedication(data);
      }
      const updated = await getMedications();
      setMedications(updated);
      setShowModal(false);
      setSuggestions([]);
      setCommercialSuggestions([]);
      setInteractions([]);
      setEditingId(null);
      await syncNotification(updated);
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
    });
    setEditingId(item.id);
    setSuggestions([]);
    setCommercialSuggestions([]);
    const others = medications.filter(m => m.id !== item.id).map(m => m.generic_name);
    setInteractions(checkInteractions(item.generic_name, others));
    setShowModal(true);
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

  async function openReminders(med: Medication) {
    setReminderMed(med);
    setReminders(await getRemindersForMedication(med.id));
    setShowAddForm(false);
    setStartTime('08:00');
    setTimesPerDay(1);
    setCustomTimes('');
    setWithSound(true);
    setReminderPeriod('day');
    setWeekday(2);
    setDayOfMonth('1');
    setYearDate('01/01');
    setShowReminderModal(true);
  }

  async function handleSaveReminder() {
    if (!reminderMed) return;
    try {
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
        for (const time of times) {
          const [h, m] = time.split(':').map(Number);
          await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, withSound);
          await addReminder({ medication_id: reminderMed.id, time, period: 'day', with_sound: withSound, is_active: true });
        }
      } else if (reminderPeriod === 'week') {
        const [h, m] = startTime.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, weekday, h, m, withSound);
        await addReminder({ medication_id: reminderMed.id, time: startTime, period: `week:${weekday}`, with_sound: withSound, is_active: true });
      } else if (reminderPeriod === 'month') {
        const dom = parseInt(dayOfMonth, 10);
        const [h, m] = startTime.split(':').map(Number);
        if (isNaN(dom) || dom < 1 || dom > 28) { Alert.alert('Erro', 'Dia do mês deve ser entre 1 e 28.'); return; }
        if (isNaN(h) || isNaN(m)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, dom, h, m, withSound);
        await addReminder({ medication_id: reminderMed.id, time: startTime, period: `month:${dom}`, with_sound: withSound, is_active: true });
      } else if (reminderPeriod === 'year') {
        const parts = yearDate.split('/');
        const dd = parseInt(parts[0] ?? '1', 10);
        const mm = parseInt(parts[1] ?? '1', 10);
        const [h, mi] = startTime.split(':').map(Number);
        if (isNaN(dd) || isNaN(mm) || dd < 1 || dd > 31 || mm < 1 || mm > 12) { Alert.alert('Erro', 'Data inválida. Use formato DD/MM.'); return; }
        if (isNaN(h) || isNaN(mi)) { Alert.alert('Erro', 'Horário inválido.'); return; }
        await scheduleReminderYearly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, mm, dd, h, mi, withSound);
        await addReminder({ medication_id: reminderMed.id, time: startTime, period: `year:${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}`, with_sound: withSound, is_active: true });
      }
      setReminders(await getRemindersForMedication(reminderMed.id));
      setShowAddForm(false);
      setCustomTimes('');
      setReminderPeriod('day');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o lembrete.');
    }
  }

  async function handleDeleteReminder(r: MedicationReminder) {
    await cancelReminderByTime(r.medication_id, r.time, r.period).catch(() => {});
    await deleteReminder(r.id);
    setReminders(await getRemindersForMedication(r.medication_id));
  }

  async function handleToggleActive(r: MedicationReminder) {
    const newActive = !r.is_active;
    await toggleReminderActive(r.id, newActive);
    if (newActive && reminderMed) {
      const [h, m] = r.time.split(':').map(Number);
      const p = r.period ?? 'day';
      if (p === 'day') {
        await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, r.with_sound).catch(() => {});
      } else if (p.startsWith('week:')) {
        const wd = Number(p.split(':')[1]);
        await scheduleReminderWeekly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, wd, h, m, r.with_sound).catch(() => {});
      } else if (p.startsWith('month:')) {
        const dom = Number(p.split(':')[1]);
        await scheduleReminderMonthly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, dom, h, m, r.with_sound).catch(() => {});
      } else if (p.startsWith('year:')) {
        const [dd, mm2] = p.split(':')[1].split('/').map(Number);
        await scheduleReminderYearly(reminderMed.id, reminderMed.generic_name, reminderMed.dose, mm2, dd, h, m, r.with_sound).catch(() => {});
      }
    } else {
      await cancelReminderByTime(r.medication_id, r.time, r.period).catch(() => {});
    }
    setReminders(await getRemindersForMedication(r.medication_id));
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={medications}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhum medicamento cadastrado.</Text>
            <Text style={styles.emptyHint}>Toque em + para adicionar.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.medCard, item.is_critical && styles.medCardCritical]}>
            <View style={styles.medInfo}>
              <View style={styles.medHeader}>
                {item.is_critical && <Text style={styles.criticalTag}>⚠️ CRÍTICO</Text>}
                <Text style={styles.medGeneric}>{item.generic_name}</Text>
              </View>
              {item.commercial_name ? <Text style={styles.medCommercial}>{item.commercial_name}</Text> : null}
              {item.dose ? <Text style={styles.medDetail}>💊 {item.dose}</Text> : null}
              {item.frequency ? <Text style={styles.medDetail}>🕐 {item.frequency}</Text> : null}
              {item.notes ? <Text style={styles.medNotes}>{item.notes}</Text> : null}
              {(cardInteractions.get(item.id) ?? []).map(i => {
                const isC = i.risk_level === 'critical';
                const isH = i.risk_level === 'high';
                const color = isC ? '#CC0000' : isH ? '#e65c00' : '#b58900';
                const label = isC ? '⚡ CRÍTICO' : isH ? '⚡ ALTO' : '⚡ MODERADO';
                return (
                  <View key={i.id} style={[styles.cardInteractionBox, { borderLeftColor: color }]}>
                    <Text style={[styles.cardInteractionBadge, { color }]}>{label} · {i.drug1} + {i.drug2}</Text>
                    <Text style={styles.cardInteractionDesc}>{i.risk_description}</Text>
                  </View>
                );
              })}
            </View>
            <TouchableOpacity style={styles.bellBtn} onPress={() => openReminders(item)}>
              <Text style={styles.bellBtnText}>🔔</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
              <Text style={styles.editBtnText}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={() => { setForm(EMPTY_MED); setEditingId(null); setSuggestions([]); setCommercialSuggestions([]); setInteractions([]); setShowModal(true); }}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add medication modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>{editingId !== null ? 'Editar Medicamento' : 'Novo Medicamento'}</Text>

            <Text style={styles.fieldLabel}>Nome genérico *</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.generic_name}
              onChangeText={handleGenericNameChange}
              autoCapitalize="words"
            />
            {suggestions.length > 0 && (
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
                      onPress={() => Linking.openURL(s.bulaUrl)}
                    >
                      <Text style={styles.bulaBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {form.generic_name.trim().length >= 3 && suggestions.length === 0 && (
              <TouchableOpacity
                style={styles.bulaLinkInline}
                onPress={() => Linking.openURL(getBulaUrl(form.generic_name))}
              >
                <Text style={styles.bulaLinkText}>📋 Ver bula no ANVISA</Text>
              </TouchableOpacity>
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
                  {(isC || isH) && !form.is_critical && (
                    <TouchableOpacity
                      style={[styles.markCriticalBtn, { borderColor: color }]}
                      onPress={() => setForm(f => ({ ...f, is_critical: true }))}
                    >
                      <Text style={[styles.markCriticalBtnText, { color }]}>
                        ⚠️ Marcar como Crítico
                      </Text>
                    </TouchableOpacity>
                  )}
                  {(isC || isH) && form.is_critical && (
                    <Text style={[styles.criticalConfirmed, { color }]}>✓ Marcado como crítico</Text>
                  )}
                </View>
              );
            })}
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
                      onPress={() => Linking.openURL(s.bulaUrl)}
                    >
                      <Text style={styles.bulaBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.fieldLabel}>Dose</Text>
            <TextInput style={styles.fieldInput} value={form.dose} onChangeText={v => setForm(f => ({ ...f, dose: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} />

            <Text style={styles.fieldLabel}>Frequência</Text>
            <TextInput style={styles.fieldInput} value={form.frequency} onChangeText={v => setForm(f => ({ ...f, frequency: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} />

            <Text style={styles.fieldLabel}>Observações</Text>
            <TextInput style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} multiline />

            <View style={styles.criticalRow}>
              <View>
                <Text style={styles.criticalLabel}>Medicamento crítico ⚠️</Text>
                <Text style={styles.criticalHint}>Aparecerá em destaque no alerta</Text>
              </View>
              <Switch value={form.is_critical} onValueChange={v => setForm(f => ({ ...f, is_critical: v }))} trackColor={{ true: '#1a3a6b', false: '#ccc' }} thumbColor="#fff" />
            </View>

            {form.is_critical && (
              <View style={styles.criticalInfo}>
                <Text style={styles.criticalInfoText}>
                  {interactions.some(i => i.risk_level === 'critical' || i.risk_level === 'high')
                    ? '✓ Marcado como crítico pela interação detectada. Lembre-se de informar seu médico sobre o uso concomitante.'
                    : '⚠️ Marque como crítico medicamentos que interagem com procedimentos de emergência (ex: Metformina com contraste, Varfarina com cirurgias).'}
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>{editingId !== null ? 'Atualizar' : 'Salvar'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Reminders modal */}
      <Modal visible={showReminderModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>🔔 Lembretes</Text>
            {reminderMed && <Text style={styles.reminderMedName}>{reminderMed.generic_name}</Text>}

            {reminders.length === 0 && !showAddForm && (
              <Text style={styles.reminderEmpty}>Nenhum lembrete configurado.</Text>
            )}

            {reminders.map(r => (
              <View key={r.id} style={styles.reminderRow}>
                <Text style={styles.reminderTime}>{periodLabel(r.period, r.time)}</Text>
                <Text style={styles.reminderSound}>{r.with_sound ? '🔊' : '🔇'}</Text>
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

            {showAddForm ? (
              <View style={styles.addForm}>
                <Text style={styles.addFormTitle}>Novo lembrete</Text>

                <Text style={styles.fieldLabel}>Período</Text>
                <View style={styles.periodRow}>
                  {(['day', 'week', 'month', 'year'] as ReminderPeriod[]).map(p => {
                    const labels: Record<ReminderPeriod, string> = { day: 'Dia', week: 'Semana', month: 'Mês', year: 'Ano' };
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
                    <Text style={styles.fieldLabel}>Dia da semana</Text>
                    <View style={styles.weekdayRow}>
                      {WEEKDAYS.map(wd => (
                        <TouchableOpacity
                          key={wd.value}
                          style={[styles.weekdayBtn, weekday === wd.value && styles.weekdayBtnActive]}
                          onPress={() => setWeekday(wd.value)}
                        >
                          <Text style={[styles.weekdayBtnText, weekday === wd.value && styles.weekdayBtnTextActive]}>
                            {wd.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {reminderPeriod === 'month' && (
                  <>
                    <Text style={styles.fieldLabel}>Dia do mês (1–28)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={dayOfMonth}
                      onChangeText={setDayOfMonth}
                      placeholder="1"
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                  </>
                )}

                {reminderPeriod === 'year' && (
                  <>
                    <Text style={styles.fieldLabel}>Data (DD/MM)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={yearDate}
                      onChangeText={setYearDate}
                      placeholder="01/01"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                    />
                  </>
                )}

                <Text style={styles.fieldLabel}>Horário</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="08:00"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
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

                <View style={styles.soundRow}>
                  <View>
                    <Text style={styles.soundLabel}>Som</Text>
                    <Text style={styles.soundHint}>{withSound ? 'Toca som ao notificar' : 'Apenas mensagem'}</Text>
                  </View>
                  <Switch
                    value={withSound}
                    onValueChange={setWithSound}
                    trackColor={{ true: '#1a3a6b', false: '#ccc' }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddForm(false)}>
                    <Text style={styles.cancelBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSaveReminder}>
                    <Text style={styles.saveBtnText}>Salvar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.addReminderBtn} onPress={() => setShowAddForm(true)}>
                <Text style={styles.addReminderBtnText}>+ Adicionar lembrete</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 12 }]} onPress={() => setShowReminderModal(false)}>
              <Text style={styles.cancelBtnText}>Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
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
    flexDirection: 'row', alignItems: 'flex-start',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  medCardCritical: { borderLeftWidth: 4, borderLeftColor: '#CC0000' },
  medInfo: { flex: 1 },
  medHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  criticalTag: { fontSize: 11, color: '#CC0000', fontWeight: '700', backgroundColor: '#fff0f0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  medGeneric: { fontSize: 16, fontWeight: '600', color: '#222' },
  medCommercial: { fontSize: 13, color: '#888', marginBottom: 4 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  cardInteractionBox: {
    borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5,
    marginTop: 6, backgroundColor: '#fff8f8',
  },
  cardInteractionBadge: { fontSize: 11, fontWeight: '700', marginBottom: 1 },
  cardInteractionDesc: { fontSize: 11, color: '#555', fontStyle: 'italic' },
  bellBtn: { padding: 8, marginLeft: 4 },
  bellBtnText: { fontSize: 18 },
  editBtn: { padding: 8, marginLeft: 4 },
  editBtnText: { fontSize: 16 },
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
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 4, marginTop: 10 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  criticalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  criticalLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  criticalHint: { fontSize: 12, color: '#999', marginTop: 2 },
  criticalInfo: { backgroundColor: '#fff8f0', borderRadius: 8, padding: 10, marginTop: 10 },
  criticalInfoText: { fontSize: 12, color: '#cc6600', lineHeight: 17 },
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
  bulaLinkInline: { marginTop: 6, paddingVertical: 4 },
  bulaLinkText: { fontSize: 13, color: '#1a6b50', textDecorationLine: 'underline' },
  // Interaction warning
  interactionCard: {
    borderLeftWidth: 3, borderRadius: 8, padding: 10, marginTop: 8,
  },
  interactionBadge: { fontSize: 11, fontWeight: '700', marginBottom: 3, letterSpacing: 0.5 },
  interactionDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  interactionDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  markCriticalBtn: {
    marginTop: 8, borderWidth: 1.5, borderRadius: 8,
    paddingVertical: 7, paddingHorizontal: 12, alignSelf: 'flex-start',
  },
  markCriticalBtnText: { fontSize: 12, fontWeight: '700' },
  criticalConfirmed: { fontSize: 12, fontWeight: '700', marginTop: 8 },
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
});
