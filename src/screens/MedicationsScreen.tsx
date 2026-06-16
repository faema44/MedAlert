import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, deleteMedication,
  getRemindersForMedication, addReminder, deleteReminder, toggleReminderActive,
} from '../database/db';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelReminderByTime, cancelAllRemindersForMedication,
} from '../services/notifications';
import { Medication, MedicationReminder, DrugInteraction } from '../types';
import { DrugSuggestion, getSuggestions, getBulaUrl, checkInteractions } from '../utils/drugSearch';

const EMPTY_MED: Omit<Medication, 'id'> = {
  generic_name: '', commercial_name: '', dose: '', frequency: '', is_critical: false, notes: '',
};

const TIMES_PER_DAY_OPTIONS = [1, 2, 3, 4, 6];

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

  // Reminder state
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderMed, setReminderMed] = useState<Medication | null>(null);
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [startTime, setStartTime] = useState('08:00');
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [withSound, setWithSound] = useState(true);

  const computedTimes = useMemo(
    () => computeTimes(startTime, timesPerDay),
    [startTime, timesPerDay]
  );

  const load = useCallback(async () => {
    try {
      setMedications(await getMedications());
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function syncNotification(meds: Medication[]) {
    try {
      const profile = await getProfile();
      if (profile?.name) await updateEmergencyNotification(profile, meds);
    } catch {}
  }

  function handleGenericNameChange(v: string) {
    setForm(f => ({ ...f, generic_name: v }));
    setSuggestions(getSuggestions(v));
    setCommercialSuggestions([]);
    setInteractions(checkInteractions(v, medications.map(m => m.generic_name)));
  }

  function applySuggestion(s: DrugSuggestion) {
    const commercial = s.brandName ?? s.firstBrand;
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (commercial ?? ''),
    }));
    setSuggestions([]);
    setInteractions(checkInteractions(s.genericName, medications.map(m => m.generic_name)));
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
      await addMedication({ ...form, generic_name: form.generic_name.trim(), commercial_name: form.commercial_name.trim() });
      const updated = await getMedications();
      setMedications(updated);
      setShowModal(false);
      setSuggestions([]);
      setInteractions([]);
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
    setWithSound(true);
    setShowReminderModal(true);
  }

  async function handleSaveReminder() {
    if (!reminderMed || computedTimes.length === 0) return;
    try {
      for (const time of computedTimes) {
        const [h, m] = time.split(':').map(Number);
        await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, withSound);
        await addReminder({ medication_id: reminderMed.id, time, with_sound: withSound, is_active: true });
      }
      setReminders(await getRemindersForMedication(reminderMed.id));
      setShowAddForm(false);
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o lembrete.');
    }
  }

  async function handleDeleteReminder(r: MedicationReminder) {
    await cancelReminderByTime(r.medication_id, r.time).catch(() => {});
    await deleteReminder(r.id);
    setReminders(await getRemindersForMedication(r.medication_id));
  }

  async function handleToggleActive(r: MedicationReminder) {
    const newActive = !r.is_active;
    await toggleReminderActive(r.id, newActive);
    if (newActive && reminderMed) {
      const [h, m] = r.time.split(':').map(Number);
      await scheduleReminder(reminderMed.id, reminderMed.generic_name, reminderMed.dose, h, m, r.with_sound).catch(() => {});
    } else {
      await cancelReminderByTime(r.medication_id, r.time).catch(() => {});
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
            </View>
            <TouchableOpacity style={styles.bellBtn} onPress={() => openReminders(item)}>
              <Text style={styles.bellBtnText}>🔔</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={() => { setForm(EMPTY_MED); setSuggestions([]); setCommercialSuggestions([]); setInteractions([]); setShowModal(true); }}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add medication modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Novo Medicamento</Text>

            <Text style={styles.fieldLabel}>Nome genérico *</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.generic_name}
              onChangeText={handleGenericNameChange}
              placeholder="Ex: Metformina"
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
                </View>
              );
            })}

            <Text style={styles.fieldLabel}>Nome comercial</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.commercial_name}
              onChangeText={handleCommercialNameChange}
              onFocus={() => setSuggestions([])}
              placeholder="Ex: Glifage"
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
            <TextInput style={styles.fieldInput} value={form.dose} onChangeText={v => setForm(f => ({ ...f, dose: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} placeholder="Ex: 850 mg" />

            <Text style={styles.fieldLabel}>Frequência</Text>
            <TextInput style={styles.fieldInput} value={form.frequency} onChangeText={v => setForm(f => ({ ...f, frequency: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} placeholder="Ex: 2x ao dia com as refeições" />

            <Text style={styles.fieldLabel}>Observações</Text>
            <TextInput style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} onFocus={() => { setSuggestions([]); setCommercialSuggestions([]); }} placeholder="Informações adicionais para socorristas..." multiline />

            <View style={styles.criticalRow}>
              <View>
                <Text style={styles.criticalLabel}>Medicamento crítico ⚠️</Text>
                <Text style={styles.criticalHint}>Aparecerá em destaque no alerta</Text>
              </View>
              <Switch value={form.is_critical} onValueChange={v => setForm(f => ({ ...f, is_critical: v }))} trackColor={{ true: '#1a3a6b', false: '#ccc' }} thumbColor="#fff" />
            </View>

            {form.is_critical && (
              <View style={styles.criticalInfo}>
                <Text style={styles.criticalInfoText}>⚠️ Marque como crítico medicamentos que interagem com procedimentos comuns de emergência (ex: Metformina com contraste, Varfarina com cirurgias).</Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Salvar</Text>
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
                <Text style={styles.reminderTime}>{r.time}</Text>
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

                <Text style={styles.fieldLabel}>Horário inicial</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="08:00"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />

                <Text style={styles.fieldLabel}>Vezes por dia</Text>
                <View style={styles.timesRow}>
                  {TIMES_PER_DAY_OPTIONS.map(n => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.timesBtn, timesPerDay === n && styles.timesBtnActive]}
                      onPress={() => setTimesPerDay(n)}
                    >
                      <Text style={[styles.timesBtnText, timesPerDay === n && styles.timesBtnTextActive]}>{n}x</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {computedTimes.length > 0 && (
                  <View style={styles.timesPreview}>
                    <Text style={styles.timesPreviewLabel}>Horários dos avisos:</Text>
                    <Text style={styles.timesPreviewValue}>{computedTimes.join('  •  ')}</Text>
                  </View>
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
                  <TouchableOpacity style={[styles.saveBtn, computedTimes.length === 0 && styles.saveBtnDisabled]} onPress={handleSaveReminder} disabled={computedTimes.length === 0}>
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
  bellBtn: { padding: 8, marginLeft: 4 },
  bellBtnText: { fontSize: 18 },
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
  // Reminder modal
  reminderMedName: { fontSize: 14, color: '#888', marginBottom: 16 },
  reminderEmpty: { fontSize: 14, color: '#bbb', textAlign: 'center', marginVertical: 16 },
  reminderRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  reminderTime: { fontSize: 20, fontWeight: '700', color: '#1a3a6b', width: 70 },
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
