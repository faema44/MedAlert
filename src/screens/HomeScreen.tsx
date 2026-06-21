import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal,
} from 'react-native';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import { getProfile, getMedications, getKV, setKV, getRemindersForMedication } from '../database/db';

type RootTabs = { Home: undefined; Profile: undefined; Medications: undefined; Contacts: undefined; Interactions: undefined };
import { updateEmergencyNotification, cancelEmergencyNotification, nextReminderInfo, ReminderInfo } from '../services/notifications';
import { Profile, Medication, MedicationReminder, DrugInteraction } from '../types';
import { checkInteractions } from '../utils/drugSearch';

const KV_LOCKSCREEN_SEEN = 'lockscreen_instructions_seen';
const KV_ALERT_ACTIVE = 'alert_active';

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootTabs>>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [allInteractions, setAllInteractions] = useState<DrugInteraction[]>([]);
  const [nextReminders, setNextReminders] = useState<{ name: string; label: string; sortMs: number }[]>([]);

  const load = useCallback(async () => {
    const [p, m, alertActive] = await Promise.all([
      getProfile(), getMedications(), getKV(KV_ALERT_ACTIVE),
    ]);
    setProfile(p);
    setMedications(m);

    if (alertActive === '1' && p?.name) {
      await updateEmergencyNotification(p, m).catch(() => {});
      setNotifActive(true);
    } else {
      setNotifActive(false);
    }

    const seen = new Set<string>();
    const ints: DrugInteraction[] = [];
    m.forEach(med => {
      const others = m.filter(x => x.id !== med.id).map(x => x.generic_name);
      checkInteractions(med.generic_name, others).forEach(i => {
        if (!seen.has(i.id)) { seen.add(i.id); ints.push(i); }
      });
    });
    ints.sort((a, b) => {
      const order = { critical: 0, high: 1, moderate: 2 };
      return order[a.risk_level] - order[b.risk_level];
    });
    setAllInteractions(ints);

    // Compute next reminder for each medication
    const remindersPerMed = await Promise.all(
      m.map(med => getRemindersForMedication(med.id).catch(() => [] as MedicationReminder[]))
    );
    const nexts: { name: string; label: string; sortMs: number }[] = [];
    m.forEach((med, idx) => {
      const info = nextReminderInfo(remindersPerMed[idx] ?? []);
      if (info) nexts.push({ name: med.generic_name, label: info.label, sortMs: info.sortMs });
    });
    nexts.sort((a, b) => a.sortMs - b.sortMs);
    setNextReminders(nexts);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function doActivate() {
    if (!profile) return;
    await updateEmergencyNotification(profile, medications);
    await setKV(KV_ALERT_ACTIVE, '1');
    setNotifActive(true);
  }

  async function handleToggleNotification() {
    if (!profile?.name) {
      Alert.alert('Perfil incompleto', 'Preencha seu nome no perfil antes de ativar o alerta.');
      return;
    }
    if (notifActive) {
      await cancelEmergencyNotification();
      await setKV(KV_ALERT_ACTIVE, '0');
      setNotifActive(false);
      return;
    }
    const seen = await getKV(KV_LOCKSCREEN_SEEN);
    if (seen) {
      await doActivate();
    } else {
      setDontShowAgain(false);
      setShowInstructions(true);
    }
  }

  async function handleInstructionsConfirm() {
    if (dontShowAgain) await setKV(KV_LOCKSCREEN_SEEN, '1');
    setShowInstructions(false);
    await doActivate();
  }

  const criticalMeds = medications.filter(m => m.is_critical);
  const profileComplete = profile?.name && medications.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Lock screen instructions modal */}
      <Modal visible={showInstructions} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>🔒 Configurar Tela de Bloqueio</Text>
            <Text style={styles.modalIntro}>
              Para que suas informações médicas apareçam na tela de bloqueio sem desbloquear o celular,
              siga os passos abaixo:
            </Text>
            {[
              'Abra as Configurações do celular',
              'Vá em Notificações (ou Aplicativos → Alerta Médico → Notificações)',
              'Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"',
              'Certifique-se de que as notificações do Alerta Médico estão ativadas',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 O caminho exato varia por fabricante (Samsung, Motorola, etc.), mas geralmente está
                em Configurações → Notificações → Tela de Bloqueio.
              </Text>
            </View>
            <TouchableOpacity style={styles.checkRow} onPress={() => setDontShowAgain(v => !v)} activeOpacity={0.7}>
              <View style={[styles.checkbox, dontShowAgain && styles.checkboxChecked]}>
                {dontShowAgain && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>Não mostrar novamente</Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowInstructions(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleInstructionsConfirm}>
                <Text style={styles.confirmBtnText}>Entendi — Ativar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Hero status card */}
      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <View style={[styles.statusDot, notifActive ? styles.dotActive : styles.dotInactive]} />
            <Text style={styles.heroStatusText}>
              {notifActive ? 'Alerta ativo — visível na tela de bloqueio' : 'Alerta inativo'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.heroBtn, notifActive ? styles.heroBtnOff : styles.heroBtnOn]}
            onPress={handleToggleNotification}
          >
            <Text style={styles.heroBtnText}>{notifActive ? 'Desativar' : 'Ativar'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {nextReminders.length > 0 && (
        <TouchableOpacity style={styles.remindersCard} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <Text style={styles.remindersTitle}>Próximos lembretes</Text>
          {nextReminders.slice(0, 5).map((r, i) => (
            <View key={i} style={styles.reminderRow}>
              <Text style={styles.reminderName} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.reminderLabel}>{r.label}</Text>
            </View>
          ))}
        </TouchableOpacity>
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
        <TouchableOpacity style={styles.interactionCard} activeOpacity={0.8} onPress={() => navigation.navigate('Interactions')}>
          <View style={styles.cardRow}>
            <Text style={styles.interactionCardTag}>
              {allInteractions.length} INTERAÇ{allInteractions.length > 1 ? 'ÕES' : 'ÃO'} DETECTADA{allInteractions.length > 1 ? 'S' : ''}
            </Text>
            <Text style={styles.cardChevron}>›</Text>
          </View>
          {allInteractions.slice(0, 3).map(i => {
            const color = i.risk_level === 'critical' ? '#CC0000' : i.risk_level === 'high' ? '#e65c00' : '#b58900';
            const label = i.risk_level === 'critical' ? 'Crítico' : i.risk_level === 'high' ? 'Alto' : 'Moderado';
            return (
              <View key={i.id} style={styles.interactionRow}>
                <View style={[styles.interactionBadge, { borderColor: color }]}>
                  <Text style={[styles.interactionBadgeText, { color }]}>{label}</Text>
                </View>
                <Text style={styles.interactionPair} numberOfLines={1}>{i.drug1} + {i.drug2}</Text>
              </View>
            );
          })}
          {allInteractions.length > 3 && (
            <Text style={styles.interactionMore}>
              + {allInteractions.length - 3} outra{allInteractions.length - 3 > 1 ? 's' : ''} — toque para ver todas
            </Text>
          )}
        </TouchableOpacity>
      )}

      {!profileComplete && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Como usar o Alerta Médico</Text>
          <Text style={styles.infoStep}>1. Preencha seu perfil médico (aba Perfil)</Text>
          <Text style={styles.infoStep}>2. Cadastre seus medicamentos (aba Remédios)</Text>
          <Text style={styles.infoStep}>3. Adicione contatos de emergência (aba Contatos)</Text>
          <Text style={styles.infoStep}>4. Ative o alerta de emergência aqui</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 16, padding: 22, width: '100%',
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1C3F7A', marginBottom: 10 },
  modalIntro: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  tipBox: { backgroundColor: '#f0faf4', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 14 },
  tipText: { fontSize: 12, color: '#1a6b3a', lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#1C3F7A' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkLabel: { fontSize: 14, color: '#444' },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10,
    padding: 13, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, color: '#666', fontWeight: '600' },
  confirmBtn: { flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 13, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },

  // Hero status
  heroCard: {
    backgroundColor: '#1C3F7A', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#5DC994' },
  dotInactive: { backgroundColor: '#E07B4F' },
  heroStatusText: { fontSize: 13, color: 'rgba(255,255,255,0.85)', flex: 1 },
  heroBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, marginLeft: 12 },
  heroBtnOn: { backgroundColor: '#E07B4F' },
  heroBtnOff: { backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  heroBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Reminders card
  remindersCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  remindersTitle: { fontSize: 10, color: '#8A8F9D', fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.05)' },
  reminderName: { fontSize: 13, color: '#1A1F2E', fontWeight: '500', flex: 1, marginRight: 8 },
  reminderLabel: { fontSize: 12, color: '#1C3F7A', fontWeight: '600' },

  // Shared card primitives
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },

  criticalCard: {
    backgroundColor: '#fff8f8', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(204,0,0,0.12)', borderLeftWidth: 3, borderLeftColor: '#CC0000',
  },
  criticalCardTag: { fontSize: 10, color: '#CC0000', fontWeight: '600', letterSpacing: 0.5 },
  criticalMed: { fontSize: 13, color: '#444', marginTop: 4 },

  interactionCard: {
    backgroundColor: '#fff8f5', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(230,92,0,0.15)', borderLeftWidth: 3, borderLeftColor: '#e65c00',
  },
  interactionCardTag: { fontSize: 10, color: '#e65c00', fontWeight: '600', letterSpacing: 0.5 },
  interactionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  interactionBadge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1,
  },
  interactionBadgeText: { fontSize: 10, fontWeight: '600' },
  interactionPair: { fontSize: 13, color: '#333', flex: 1, fontWeight: '500' },
  interactionMore: { fontSize: 12, color: '#888', marginTop: 8, fontStyle: 'italic' },

  infoCard: { backgroundColor: '#EEF3FF', borderRadius: 12, padding: 16 },
  infoTitle: { fontSize: 14, fontWeight: '600', color: '#1C3F7A', marginBottom: 10 },
  infoStep: { fontSize: 13, color: '#4A5270', marginBottom: 6 },
});
