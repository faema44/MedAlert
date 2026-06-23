import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import {
  getProfile, getMedications, getKV, setKV,
  getRemindersForMedication, updateAllRemindersSound,
  getActivities, getRemindersForActivity, updateAllActivityRemindersSound,
  getAppointments,
} from '../database/db';

type RootTabs = {
  Home: undefined; Profile: undefined; Medications: undefined;
  Contacts: undefined; Agenda: undefined; Interactions: undefined;
};

import {
  updateEmergencyNotification, cancelEmergencyNotification, nextReminderInfo,
  cancelAllRemindersForMedication, cancelAllRemindersForActivity, cancelRepeatAlarm,
  rescheduleRemindersForMedication, rescheduleRemindersForActivity,
} from '../services/notifications';
import { Profile, Medication, MedicationReminder, DrugInteraction, ActivityReminder, Appointment, ACTIVITY_PRESETS } from '../types';
import { checkInteractions, isPhytotherapic } from '../utils/drugSearch';

const KV_ALERT_ACTIVE = 'alert_active';

type UnifiedItem = {
  id: number;
  type: 'med' | 'activity' | 'appointment';
  icon: string;
  name: string;
  label: string;
  sortMs: number;
  isMuted: boolean;
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
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [notifActive, setNotifActive] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [allInteractions, setAllInteractions] = useState<DrugInteraction[]>([]);
  const [showInteractionsModal, setShowInteractionsModal] = useState(false);
  const [unifiedItems, setUnifiedItems] = useState<UnifiedItem[]>([]);

  const load = useCallback(async () => {
    const [p, m, alertActive, acts, appts, obDone] = await Promise.all([
      getProfile(), getMedications(), getKV(KV_ALERT_ACTIVE), getActivities(), getAppointments(),
      getKV('onboarding_done'),
    ]);
    setOnboardingDone(obDone === '1');
    setProfile(p);
    setMedications(m);

    if (alertActive === '1' && p?.name) {
      await updateEmergencyNotification(p, m).catch(() => {});
      setNotifActive(true);
    } else {
      setNotifActive(false);
    }

    // Drug interactions
    const seen = new Set<string>();
    const ints: DrugInteraction[] = [];
    const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
    m.forEach(med => {
      const others = m.filter(x => x.id !== med.id).map(x => x.generic_name);
      checkInteractions(med.generic_name, others).forEach(i => {
        if (!seen.has(i.id)) { seen.add(i.id); ints.push(i); }
      });
    });
    ints.sort((a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3));
    setAllInteractions(ints);

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
      items.push({
        id: med.id, type: 'med', icon: med.is_critical ? '⚠️' : isPhytotherapic(med.generic_name) ? '🌿' : '💊',
        name: med.generic_name,
        label: info.label,
        sortMs: info.sortMs,
        isMuted,
      });
    });

    const actReminders = await Promise.all(acts.map(a => getRemindersForActivity(a.id).catch(() => [] as ActivityReminder[])));
    acts.forEach((act, idx) => {
      const reminders = actReminders[idx] ?? [];
      if (reminders.length === 0) return;
      const activeReminders = reminders.filter(r => r.is_active);
      const isMuted = activeReminders.length > 0 && activeReminders.every(r => !r.with_sound);
      const info = nextDailyInfo(reminders);
      if (!info) return;
      items.push({
        id: act.id, type: 'activity', icon: ACTIVITY_PRESETS[act.type]?.icon ?? '📌',
        name: act.name,
        label: info.label,
        sortMs: info.sortMs,
        isMuted,
      });
    });

    appts.forEach(appt => {
      const info = appointmentInfo(appt);
      if (!info) return;
      const docLabel = appt.specialty ? `${appt.doctor_name} · ${appt.specialty}` : appt.doctor_name;
      items.push({
        id: appt.id, type: 'appointment', icon: '🩺',
        name: docLabel,
        label: info.label,
        sortMs: info.sortMs,
        isMuted: false,
      });
    });

    items.sort((a, b) => a.sortMs - b.sortMs);
    setUnifiedItems(items);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleAlertToggle() {
    if (!profile?.name) {
      return;
    }
    if (notifActive) {
      await cancelEmergencyNotification();
      await setKV(KV_ALERT_ACTIVE, '0');
      setNotifActive(false);
    } else {
      if (!profile) return;
      await updateEmergencyNotification(profile, medications);
      await setKV(KV_ALERT_ACTIVE, '1');
      setNotifActive(true);
    }
  }

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

  const criticalMeds = medications.filter(m => m.is_critical);
  const profileComplete = profile?.name && medications.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Alert status chip */}
      <TouchableOpacity style={styles.alertChip} activeOpacity={0.7} onPress={() => setShowAlertModal(true)}>
        <View style={[styles.statusDot, notifActive ? styles.dotActive : styles.dotInactive]} />
        <Text style={[styles.alertChipText, { color: notifActive ? '#1a6b3a' : '#888' }]}>
          {notifActive ? 'Alerta ativado' : 'Alerta desativado'}
        </Text>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      {/* Alert modal */}
      <Modal visible={showAlertModal} animationType="slide" transparent onRequestClose={() => setShowAlertModal(false)}>
        <View style={styles.intModalOverlay}>
          <ScrollView style={styles.alertModalBox} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            <Text style={styles.alertModalTitle}>Alerta de Emergência</Text>
            <View style={styles.alertToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertToggleLabel}>{notifActive ? 'Ativado' : 'Desativado'}</Text>
                <Text style={styles.alertToggleHint}>
                  {notifActive ? 'Visível na tela de bloqueio' : 'Toque para ativar'}
                </Text>
              </View>
              <Switch
                value={notifActive}
                onValueChange={handleAlertToggle}
                trackColor={{ true: '#1C3F7A', false: '#ccc' }}
                thumbColor="#fff"
              />
            </View>
            <Text style={styles.alertModalSection}>Para que serve</Text>
            <Text style={styles.alertModalBody}>
              Exibe suas informações médicas — medicamentos, doses e contatos de emergência — na tela de bloqueio do celular, sem precisar desbloquear.
            </Text>
            <Text style={styles.alertModalSection}>Como configurar o celular</Text>
            {[
              'Abra as Configurações do celular',
              'Vá em Notificações → Alerta Médico',
              'Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"',
              'Certifique-se de que as notificações estão ativadas',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 O caminho exato varia por fabricante. Geralmente em Configurações → Notificações → Tela de Bloqueio.
              </Text>
            </View>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowAlertModal(false)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* Unified reminders list */}
      {unifiedItems.length > 0 && (
        <View style={styles.remindersCard}>
          <Text style={styles.remindersTitle}>PRÓXIMOS LEMBRETES</Text>
          {unifiedItems.map((item, idx) => (
            <TouchableOpacity
              key={`${item.type}-${item.id}`}
              style={[styles.reminderRow, idx === 0 && styles.reminderRowFirst]}
              activeOpacity={0.6}
              onPress={() => {
                if (item.type === 'med') (navigation as any).navigate('Medications', { openMedId: item.id });
                else if (item.type === 'appointment') (navigation as any).navigate('Agenda', { tab: 'appointments', openAppointmentId: item.id });
                else (navigation as any).navigate('Agenda', { tab: 'activities', openActivityId: item.id });
              }}
            >
              <Text style={styles.reminderIcon}>{item.icon}</Text>
              <Text style={styles.reminderName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.reminderLabel}>{item.label}</Text>
              {item.type !== 'appointment' ? (
                <TouchableOpacity
                  style={styles.reminderBellBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => handleToggleMute(item)}
                >
                  <Text style={styles.reminderBell}>{item.isMuted ? '🔕' : '🔔'}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.reminderBell}>📅</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {criticalMeds.length > 0 && (
        <TouchableOpacity style={styles.criticalCard} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <View style={styles.cardRow}>
            <Text style={styles.criticalCardTag}>MEDICAMENTOS CRÍTICOS</Text>
            <Text style={styles.cardChevron}>›</Text>
          </View>
          {criticalMeds.map(med => (
            <Text key={med.id} style={styles.criticalMed}>
              • {med.generic_name}{med.commercial_name ? ` (${med.commercial_name})` : ''}{med.dose ? ` — ${med.dose}` : ''}
            </Text>
          ))}
        </TouchableOpacity>
      )}

      {allInteractions.length > 0 && (
        <TouchableOpacity style={styles.interactionChip} activeOpacity={0.7} onPress={() => setShowInteractionsModal(true)}>
          <Text style={styles.interactionChipIcon}>⚠</Text>
          <Text style={styles.interactionChipText}>
            {allInteractions.length} interaç{allInteractions.length > 1 ? 'ões' : 'ão'} detectada{allInteractions.length > 1 ? 's' : ''}
          </Text>
          <Text style={styles.cardChevron}>›</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showInteractionsModal} animationType="slide" transparent onRequestClose={() => setShowInteractionsModal(false)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Interações detectadas</Text>
            <ScrollView>
              {allInteractions.map(i => {
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
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowInteractionsModal(false)}>
              <Text style={styles.intModalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!profileComplete && !onboardingDone && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Como usar o Alerta Médico</Text>
          <Text style={styles.infoStep}>1. Preencha seu perfil médico (aba Perfil)</Text>
          <Text style={styles.infoStep}>2. Cadastre seus medicamentos (aba Medicamentos)</Text>
          <Text style={styles.infoStep}>3. Adicione contatos de emergência (aba Contatos)</Text>
          <Text style={styles.infoStep}>4. Ative o alerta de emergência acima para aparecer na tela de bloqueio</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32 },

  alertChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#5DC994' },
  dotInactive: { backgroundColor: '#E07B4F' },
  alertChipText: { fontSize: 13, fontWeight: '500', flex: 1 },

  alertModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '85%',
  },
  alertModalTitle: { fontSize: 17, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  alertToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 20,
  },
  alertToggleLabel: { fontSize: 15, fontWeight: '700', color: '#1A1F2E' },
  alertToggleHint: { fontSize: 12, color: '#888', marginTop: 2 },
  alertModalSection: { fontSize: 11, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  alertModalBody: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 16 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  tipBox: { backgroundColor: '#f0faf4', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 14 },
  tipText: { fontSize: 12, color: '#1a6b3a', lineHeight: 18 },

  remindersCard: {
    backgroundColor: '#fff', borderRadius: 12, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  remindersTitle: {
    fontSize: 10, color: '#8A8F9D', fontWeight: '700', letterSpacing: 0.8,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },
  reminderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 14,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)',
  },
  reminderRowFirst: { borderTopWidth: 0 },
  reminderIcon: { fontSize: 17, marginRight: 10, width: 22, textAlign: 'center' },
  reminderName: { fontSize: 13, color: '#1A1F2E', fontWeight: '500', flex: 1, marginRight: 8 },
  reminderLabel: { fontSize: 12, color: '#1C3F7A', fontWeight: '600', marginRight: 8 },
  reminderBellBtn: { padding: 2 },
  reminderBell: { fontSize: 15 },

  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },

  criticalCard: {
    backgroundColor: '#fff8f8', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(204,0,0,0.12)', borderLeftWidth: 3, borderLeftColor: '#CC0000',
  },
  criticalCardTag: { fontSize: 10, color: '#CC0000', fontWeight: '600', letterSpacing: 0.5 },
  criticalMed: { fontSize: 13, color: '#444', marginTop: 4 },

  interactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 10, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  interactionChipIcon: { fontSize: 13, color: '#e65c00' },
  interactionChipText: { fontSize: 13, color: '#555', flex: 1 },

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

  infoCard: { backgroundColor: '#EEF3FF', borderRadius: 12, padding: 16 },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#1C3F7A', marginBottom: 10 },
  infoStep: { fontSize: 13, color: '#4A5270', marginBottom: 6 },
});
