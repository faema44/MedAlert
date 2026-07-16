import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ScrollView, Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TIME_DISPLAY } from '../utils/datePickerDisplay';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedicationLog, deleteMedicationLog, updateMedicationLogEntry, getActivityLogs, MedicationLogEntry,
} from '../database/db';
import { ActivityLog } from '../database/db';

type Tab = 'medications' | 'activities';

const LOG_ICONS: Record<string, string> = {
  water: '💧', walk: '🚶', physio: '🏋️', bp: '❤️', glucose: '🩸', weight: '⚖️', cycle: '🌸', custom: '📌',
};

function parseDate(iso: string): Date {
  return new Date(iso.includes('T') ? iso : iso + 'Z');
}

function dayLabel(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (dt.getTime() === today.getTime()) return 'Hoje';
  if (dt.getTime() === yesterday.getTime()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeStr(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Registros antigos não têm "status" (só o campo taken 1/0/null) — deriva a partir dele.
function logStatus(log: MedicationLogEntry): 'taken' | 'skipped' | 'treatment_ended' | 'low_stock' | 'dismissed' | null {
  if (log.status) return log.status;
  if (log.taken === 1) return 'taken';
  if (log.taken === 0) return 'skipped';
  return null;
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('medications');

  // Medication log state
  const [medLogs, setMedLogs] = useState<MedicationLogEntry[]>([]);
  const [medFilter, setMedFilter] = useState<string | null>(null);

  // Edit modal state
  const [editingLog, setEditingLog] = useState<MedicationLogEntry | null>(null);
  const [editStatus, setEditStatus] = useState<'taken' | 'skipped'>('taken');
  const [editHour, setEditHour] = useState(0);
  const [editMinute, setEditMinute] = useState(0);
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);

  // Activity log state
  const [actLogs, setActLogs] = useState<ActivityLog[]>([]);
  const [actFilter, setActFilter] = useState<number | null>(null);
  const [actPeriod, setActPeriod] = useState<'month' | 'year' | 'all'>('all');

  const loadMedLogs = useCallback(async () => {
    setMedLogs(await getMedicationLog());
  }, []);

  const loadActLogs = useCallback(async () => {
    setActLogs(await getActivityLogs());
  }, []);

  useFocusEffect(useCallback(() => {
    loadMedLogs();
    loadActLogs();
  }, [loadMedLogs, loadActLogs]));

  // Unique medication names from log
  const medNames = useMemo(() => {
    const seen = new Set<string>();
    for (const l of medLogs) {
      if (l.medication_name) seen.add(l.medication_name);
    }
    return Array.from(seen);
  }, [medLogs]);

  // Filtered medication logs
  const filteredMedLogs = useMemo(() => {
    if (!medFilter) return medLogs;
    return medLogs.filter(l => l.medication_name === medFilter);
  }, [medLogs, medFilter]);

  // Grouped by day
  const groupedMedLogs = useMemo(() => {
    const groups: { label: string; items: MedicationLogEntry[] }[] = [];
    let currentDay = '';
    let currentItems: MedicationLogEntry[] = [];
    for (const item of filteredMedLogs) {
      const d = parseDate(item.scheduled_at);
      const dl = dayLabel(d);
      if (dl !== currentDay) {
        if (currentItems.length > 0) groups.push({ label: currentDay, items: currentItems });
        currentDay = dl;
        currentItems = [];
      }
      currentItems.push(item);
    }
    if (currentItems.length > 0) groups.push({ label: currentDay, items: currentItems });
    return groups;
  }, [filteredMedLogs]);

  // Flat list data with section headers
  const medListData = useMemo(() => {
    const rows: ({ type: 'header'; label: string } | { type: 'item'; item: MedicationLogEntry })[] = [];
    for (const group of groupedMedLogs) {
      rows.push({ type: 'header', label: group.label });
      for (const item of group.items) rows.push({ type: 'item', item });
    }
    return rows;
  }, [groupedMedLogs]);

  // Activity log data
  const actLogActivities = useMemo(() => {
    const seen = new Map<number, string>();
    for (const l of actLogs) {
      if (l.activity_id !== null && !seen.has(l.activity_id)) seen.set(l.activity_id, l.activity_name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [actLogs]);

  const filteredActLogs = useMemo(() => {
    const now = Date.now();
    const cutoff = actPeriod === 'month'
      ? new Date(now - 30 * 24 * 60 * 60 * 1000)
      : actPeriod === 'year'
      ? new Date(now - 365 * 24 * 60 * 60 * 1000)
      : null;
    return actLogs.filter(l => {
      if (cutoff && parseDate(l.logged_at) < cutoff) return false;
      if (actFilter !== null && l.activity_id !== actFilter) return false;
      return true;
    });
  }, [actLogs, actPeriod, actFilter]);

  function openEditLog(log: MedicationLogEntry) {
    const status = logStatus(log);
    // "Sem resposta" (null) também é editável — o usuário informa depois se tomou
    if (status !== 'taken' && status !== 'skipped' && status !== null) return;
    const d = parseDate(log.taken_at ?? log.scheduled_at);
    setEditStatus(status === 'skipped' ? 'skipped' : 'taken');
    setEditHour(d.getHours());
    setEditMinute(d.getMinutes());
    setEditingLog(log);
  }

  async function saveEditLog() {
    if (!editingLog) return;
    const d = parseDate(editingLog.scheduled_at);
    d.setHours(editHour, editMinute, 0, 0);
    await updateMedicationLogEntry(editingLog.id, editStatus, d.toISOString());
    setEditingLog(null);
    loadMedLogs();
  }

  function handleDeleteMedLogs() {
    Alert.alert('Apagar histórico de medicamentos', 'Escolha o período a apagar:', [
      {
        text: 'Registros com mais de 1 ano',
        onPress: () => {
          Alert.alert('Confirmar', 'Apagar registros com mais de 1 ano?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Apagar', style: 'destructive', onPress: async () => { await deleteMedicationLog('year'); loadMedLogs(); } },
          ]);
        },
      },
      {
        text: 'Tudo',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Confirmar', 'Apagar todo o histórico de medicamentos?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Apagar tudo', style: 'destructive', onPress: async () => { await deleteMedicationLog('all'); loadMedLogs(); } },
          ]);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'medications' && styles.tabBtnActive]}
          onPress={() => setTab('medications')}
        >
          <Text style={[styles.tabBtnText, tab === 'medications' && styles.tabBtnTextActive]}>Medicamentos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'activities' && styles.tabBtnActive]}
          onPress={() => setTab('activities')}
        >
          <Text style={[styles.tabBtnText, tab === 'activities' && styles.tabBtnTextActive]}>Atividades</Text>
        </TouchableOpacity>
      </View>

      {tab === 'medications' ? (
        <>
          {/* Medication name filter chips */}
          {medNames.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
              <TouchableOpacity
                style={[styles.filterChip, !medFilter && styles.filterChipActive]}
                onPress={() => setMedFilter(null)}
              >
                <Text style={[styles.filterChipText, !medFilter && styles.filterChipTextActive]}>Todos</Text>
              </TouchableOpacity>
              {medNames.map(name => (
                <TouchableOpacity
                  key={name}
                  style={[styles.filterChip, medFilter === name && styles.filterChipActive]}
                  onPress={() => setMedFilter(medFilter === name ? null : name)}
                >
                  <Text style={[styles.filterChipText, medFilter === name && styles.filterChipTextActive]} numberOfLines={1}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Header row */}
          <View style={styles.histHeader}>
            <Text style={styles.histCount}>{filteredMedLogs.length} registro(s)</Text>
            <TouchableOpacity style={[styles.histIconBtn, { backgroundColor: '#E07B4F' }]} onPress={handleDeleteMedLogs} accessibilityLabel="Apagar histórico de medicamentos" accessibilityRole="button">
              <Text style={styles.histIconBtnText}>🗑️</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={medListData}
            keyExtractor={(item, idx) => String(idx)}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>💊</Text>
                <Text style={styles.emptyText}>Nenhum registro ainda.</Text>
                <Text style={styles.emptyHint}>Os lembretes de medicamentos aparecerão aqui.</Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === 'header') {
                return <Text style={styles.dayHeader}>{item.label}</Text>;
              }
              const { item: log } = item;
              const d = parseDate(log.scheduled_at);
              const status = logStatus(log);
              const takenAtDiffers = status === 'taken' && log.taken_at && timeStr(parseDate(log.taken_at)) !== timeStr(d);
              const editable = status === 'taken' || status === 'skipped' || status === null;
              return (
                <View style={styles.medLogCard}>
                  <Text style={styles.medLogIcon}>{status === 'treatment_ended' ? '🏁' : status === 'low_stock' ? '📦' : status === 'dismissed' ? '🔕' : '💊'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medLogName} numberOfLines={1}>{log.medication_name}</Text>
                    {!!log.dose && <Text style={styles.medLogDose}>{log.dose}</Text>}
                    {takenAtDiffers ? (
                      <Text style={styles.medLogTime}>
                        Previsto {timeStr(d)}
                        <Text style={{ color: '#E07B4F' }}> · Tomado {timeStr(parseDate(log.taken_at!))}</Text>
                      </Text>
                    ) : (
                      <Text style={styles.medLogTime}>{timeStr(d)}</Text>
                    )}
                  </View>
                  <View style={[styles.takenBadge,
                    status === 'taken' ? styles.takenBadgeYes :
                    status === 'low_stock' ? styles.takenBadgeWarn :
                    styles.takenBadgeNo]}>
                    <Text style={[styles.takenBadgeText,
                      status === 'taken' ? styles.takenBadgeTextYes :
                      status === 'low_stock' ? styles.takenBadgeTextWarn :
                      styles.takenBadgeTextNo]}>
                      {status === 'taken' ? '✓ Tomei'
                        : status === 'skipped' ? '✗ Não tomei'
                        : status === 'treatment_ended' ? 'Encerrado'
                        : status === 'low_stock' ? 'Estoque baixo'
                        : status === 'dismissed' ? 'Dispensado'
                        : 'Sem resposta'}
                    </Text>
                  </View>
                  {editable && (
                    <TouchableOpacity
                      style={styles.medLogEditBtn}
                      onPress={() => openEditLog(log)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Editar registro"
                      accessibilityRole="button"
                    >
                      <Text style={styles.medLogEditBtnText}>✏️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />
        </>
      ) : (
        <>
          {/* Activity period filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
            {(['month', 'year', 'all'] as const).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.filterChip, actPeriod === p && styles.filterChipActive]}
                onPress={() => setActPeriod(p)}
              >
                <Text style={[styles.filterChipText, actPeriod === p && styles.filterChipTextActive]}>
                  {p === 'month' ? '30 dias' : p === 'year' ? '1 ano' : 'Tudo'}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterSep} />
            <TouchableOpacity
              style={[styles.filterChip, !actFilter && styles.filterChipActive]}
              onPress={() => setActFilter(null)}
            >
              <Text style={[styles.filterChipText, !actFilter && styles.filterChipTextActive]}>Todas</Text>
            </TouchableOpacity>
            {actLogActivities.map(a => (
              <TouchableOpacity
                key={a.id}
                style={[styles.filterChip, actFilter === a.id && styles.filterChipActive]}
                onPress={() => setActFilter(actFilter === a.id ? null : a.id)}
              >
                <Text style={[styles.filterChipText, actFilter === a.id && styles.filterChipTextActive]} numberOfLines={1}>{a.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.histHeader}>
            <Text style={styles.histCount}>{filteredActLogs.length} registro(s)</Text>
          </View>

          <FlatList
            data={filteredActLogs}
            keyExtractor={item => String(item.id)}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📋</Text>
                <Text style={styles.emptyText}>Nenhum registro no período.</Text>
                <Text style={styles.emptyHint}>Ajuste o filtro de período ou atividade.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const d = parseDate(item.logged_at);
              const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
              const tStr = timeStr(d);
              return (
                <View style={[styles.actLogCard, !item.realized && styles.actLogCardMissed]}>
                  <Text style={styles.actLogIcon}>{LOG_ICONS[item.activity_type] ?? '📌'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actLogName}>{item.activity_name}</Text>
                    {!!item.value && <Text style={styles.actLogValue}>{item.value}</Text>}
                    <Text style={styles.actLogDate}>{dateStr} · 🕐 {tStr}</Text>
                  </View>
                  <View style={[styles.takenBadge, item.realized ? styles.takenBadgeYes : styles.takenBadgeNo]}>
                    <Text style={[styles.takenBadgeText, item.realized ? styles.takenBadgeTextYes : styles.takenBadgeTextNo]}>
                      {item.realized ? 'Realizado' : 'Não realiz.'}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}

      {editingLog && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setEditingLog(null)}>
          <View style={styles.editOverlay}>
            <View style={styles.editBox}>
              <Text style={styles.editTitle} numberOfLines={1}>{editingLog.medication_name}</Text>
              <View style={styles.editStatusRow}>
                <TouchableOpacity
                  style={[styles.editStatusBtn, editStatus === 'taken' && styles.editStatusBtnTakenActive]}
                  onPress={() => setEditStatus('taken')}
                >
                  <Text style={[styles.editStatusBtnText, editStatus === 'taken' && styles.editStatusBtnTextActive]}>✓ Tomei</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editStatusBtn, editStatus === 'skipped' && styles.editStatusBtnSkippedActive]}
                  onPress={() => setEditStatus('skipped')}
                >
                  <Text style={[styles.editStatusBtnText, editStatus === 'skipped' && styles.editStatusBtnTextActive]}>✗ Não tomei</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.editTimeInput} onPress={() => setShowEditTimePicker(true)}>
                <Text style={styles.editTimeInputText}>
                  {String(editHour).padStart(2, '0')}:{String(editMinute).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
              {showEditTimePicker && (
                <DateTimePicker
                  value={(() => { const d = new Date(); d.setHours(editHour, editMinute, 0, 0); return d; })()}
                  mode="time"
                  is24Hour={true}
                  display={TIME_DISPLAY}
                  onChange={(e, date) => {
                    setShowEditTimePicker(false);
                    if (e.type === 'set' && date) { setEditHour(date.getHours()); setEditMinute(date.getMinutes()); }
                  }}
                />
              )}
              <TouchableOpacity style={styles.editSaveBtn} onPress={saveEditLog}>
                <Text style={styles.editSaveBtnText}>Salvar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editCancelBtn} onPress={() => setEditingLog(null)}>
                <Text style={styles.editCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },

  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  tabBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: '#1C3F7A' },
  tabBtnText: { fontSize: 14, fontWeight: '500', color: '#888' },
  tabBtnTextActive: { color: '#1C3F7A', fontWeight: '700' },

  filterScroll: { backgroundColor: '#F2F4F8', maxHeight: 54 },
  filterContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  filterChip: {
    backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#C8CDD8',
  },
  filterChipActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  filterChipText: { fontSize: 13, color: '#444', fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },
  filterSep: { width: 1, height: 24, backgroundColor: 'rgba(0,0,0,0.1)', marginHorizontal: 4 },

  histHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
  },
  histCount: { fontSize: 12, color: '#888' },
  histIconBtn: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  histIconBtnText: { fontSize: 15 },

  list: { paddingHorizontal: 12, paddingBottom: 24 },

  dayHeader: {
    fontSize: 11, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5,
    paddingVertical: 8, paddingTop: 14,
  },

  medLogCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  medLogIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  medLogName: { fontSize: 14, fontWeight: '600', color: '#1A1F2E' },
  medLogDose: { fontSize: 12, color: '#666', marginTop: 1 },
  medLogTime: { fontSize: 11, color: '#999', marginTop: 2 },
  medLogEditBtn: { padding: 2 },
  medLogEditBtnText: { fontSize: 14 },

  takenBadge: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    alignSelf: 'center',
  },
  takenBadgeYes: { backgroundColor: '#e8f8ef' },
  takenBadgeNo:  { backgroundColor: '#f5f5f5' },
  takenBadgeWarn: { backgroundColor: '#fff3ec' },
  takenBadgeText: { fontSize: 11, fontWeight: '700' },
  takenBadgeTextYes: { color: '#1a6b3a' },
  takenBadgeTextNo:  { color: '#999' },
  takenBadgeTextWarn: { color: '#E07B4F' },

  actLogCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  actLogCardMissed: { opacity: 0.7 },
  actLogIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  actLogName: { fontSize: 14, fontWeight: '600', color: '#1A1F2E' },
  actLogValue: { fontSize: 12, color: '#1C3F7A', marginTop: 2, fontWeight: '500' },
  actLogDate: { fontSize: 11, color: '#999', marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#555', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 19 },

  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  editBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%' },
  editTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 14, textAlign: 'center' },
  editStatusRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  editStatusBtn: {
    flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1, borderColor: '#C8CDD8',
  },
  editStatusBtnTakenActive: { backgroundColor: '#2E9E5B', borderColor: '#2E9E5B' },
  editStatusBtnSkippedActive: { backgroundColor: '#CC0000', borderColor: '#CC0000' },
  editStatusBtnText: { fontSize: 13, fontWeight: '700', color: '#666' },
  editStatusBtnTextActive: { color: '#fff' },
  editTimeInput: {
    borderWidth: 1, borderColor: '#C8CDD8', borderRadius: 8,
    paddingVertical: 10, marginBottom: 14, alignItems: 'center',
  },
  editTimeInputText: { fontSize: 20, fontWeight: '700', color: '#1C3F7A' },
  editSaveBtn: { backgroundColor: '#1C3F7A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  editSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  editCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  editCancelBtnText: { color: '#999', fontSize: 14, fontWeight: '600' },
});
