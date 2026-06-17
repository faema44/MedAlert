import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal,
} from 'react-native';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import { getProfile, getMedications, getContacts, getKV, setKV } from '../database/db';

type RootTabs = { Home: undefined; Profile: undefined; Medications: undefined; Contacts: undefined; Interactions: undefined };
import { updateEmergencyNotification, cancelEmergencyNotification } from '../services/notifications';
import { Profile, Medication, EmergencyContact, DrugInteraction } from '../types';
import { checkInteractions } from '../utils/drugSearch';

const KV_LOCKSCREEN_SEEN = 'lockscreen_instructions_seen';

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootTabs>>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [allInteractions, setAllInteractions] = useState<DrugInteraction[]>([]);

  const load = useCallback(async () => {
    const [p, m, c] = await Promise.all([getProfile(), getMedications(), getContacts()]);
    setProfile(p);
    setMedications(m);
    setContacts(c);
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
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function doActivate() {
    if (!profile) return;
    await updateEmergencyNotification(profile, medications);
    setNotifActive(true);
  }

  async function handleToggleNotification() {
    if (!profile?.name) {
      Alert.alert('Perfil incompleto', 'Preencha seu nome no perfil antes de ativar o alerta.');
      return;
    }
    if (notifActive) {
      await cancelEmergencyNotification();
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

            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
              <Text style={styles.stepText}>
                Abra as <Text style={styles.bold}>Configurações</Text> do celular
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
              <Text style={styles.stepText}>
                Vá em <Text style={styles.bold}>Notificações</Text> (ou Aplicativos → MedAlert → Notificações)
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
              <Text style={styles.stepText}>
                Em <Text style={styles.bold}>Tela de Bloqueio</Text>, selecione{' '}
                <Text style={styles.bold}>"Mostrar todo o conteúdo"</Text>
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>4</Text></View>
              <Text style={styles.stepText}>
                Certifique-se de que as notificações do <Text style={styles.bold}>MedAlert</Text> estão ativadas
              </Text>
            </View>

            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 O caminho exato varia por fabricante (Samsung, Motorola, etc.), mas geralmente está
                em Configurações → Notificações → Tela de Bloqueio.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setDontShowAgain(v => !v)}
              activeOpacity={0.7}
            >
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

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Status do Alerta</Text>
        <View style={[styles.statusBadge, notifActive ? styles.badgeActive : styles.badgeInactive]}>
          <Text style={styles.badgeText}>{notifActive ? '🔔 ATIVO' : '🔕 INATIVO'}</Text>
        </View>
        <Text style={styles.statusDesc}>
          {notifActive
            ? 'Visível na tela de bloqueio sem desbloquear o celular'
            : 'Ative para exibir suas informações na tela de bloqueio'}
        </Text>
        <TouchableOpacity
          style={[styles.toggleBtn, notifActive ? styles.btnDeactivate : styles.btnActivate]}
          onPress={handleToggleNotification}
        >
          <Text style={styles.toggleBtnText}>
            {notifActive ? 'Desativar Alerta' : 'Ícone na Tela de Bloqueio (Emergência)'}
          </Text>
        </TouchableOpacity>
      </View>

      {profile ? (
        <TouchableOpacity style={styles.summaryCard} activeOpacity={0.8} onPress={() => navigation.navigate('Profile')}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>📋 Perfil Médico</Text>
            <Text style={styles.cardChevron}>›</Text>
          </View>
          <Text style={styles.name}>{profile.name}</Text>
          {profile.blood_type !== 'Desconhecido' && (
            <Text style={styles.detail}>🩸 {profile.blood_type}</Text>
          )}
          {profile.allergies ? (
            <Text style={styles.detail}>🚫 Alergias: {profile.allergies}</Text>
          ) : null}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.warningCard} activeOpacity={0.8} onPress={() => navigation.navigate('Profile')}>
          <Text style={styles.warningText}>⚠️ Perfil não preenchido — toque para cadastrar seus dados.</Text>
        </TouchableOpacity>
      )}

      {criticalMeds.length > 0 && (
        <TouchableOpacity style={styles.criticalCard} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <View style={styles.cardRow}>
            <Text style={styles.cardTitle}>⚠️ Medicamentos Críticos</Text>
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
            <Text style={styles.interactionCardTitle}>
              ⚡ {allInteractions.length} interaç{allInteractions.length > 1 ? 'ões' : 'ão'} detectada{allInteractions.length > 1 ? 's' : ''}
            </Text>
            <Text style={styles.cardChevron}>›</Text>
          </View>
          {allInteractions.slice(0, 3).map(i => {
            const color = i.risk_level === 'critical' ? '#CC0000' : i.risk_level === 'high' ? '#e65c00' : '#b58900';
            const label = i.risk_level === 'critical' ? 'CRÍTICO' : i.risk_level === 'high' ? 'ALTO' : 'MODERADO';
            return (
              <Text key={i.id} style={[styles.interactionItem, { color }]} numberOfLines={1}>
                ⚡ {label}: {i.drug1} + {i.drug2}
              </Text>
            );
          })}
          {allInteractions.length > 3 && (
            <Text style={styles.interactionMore}>
              + {allInteractions.length - 3} outra{allInteractions.length - 3 > 1 ? 's' : ''} — toque para ver todas
            </Text>
          )}
        </TouchableOpacity>
      )}

      <View style={styles.statsRow}>
        <TouchableOpacity style={styles.statBox} activeOpacity={0.8} onPress={() => navigation.navigate('Medications')}>
          <Text style={styles.statNum}>{medications.length}</Text>
          <Text style={styles.statLabel}>Medicamentos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBox} activeOpacity={0.8} onPress={() => navigation.navigate('Contacts')}>
          <Text style={styles.statNum}>{contacts.length}</Text>
          <Text style={styles.statLabel}>Contatos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.statBox} activeOpacity={0.8} onPress={() => navigation.navigate('Interactions')}>
          <Text style={styles.statNum}>{criticalMeds.length}</Text>
          <Text style={styles.statLabel}>Críticos</Text>
        </TouchableOpacity>
      </View>

      {!profileComplete && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Como usar o MedAlert</Text>
          <Text style={styles.infoStep}>1. Preencha seu perfil médico (aba Perfil)</Text>
          <Text style={styles.infoStep}>2. Cadastre seus medicamentos (aba Medicamentos)</Text>
          <Text style={styles.infoStep}>3. Adicione contatos de emergência (aba Contatos)</Text>
          <Text style={styles.infoStep}>4. Ative o Alerta de Emergência aqui</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 32 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  modalBox: {
    backgroundColor: '#fff', borderRadius: 16, padding: 22, width: '100%',
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a3a6b', marginBottom: 10 },
  modalIntro: { fontSize: 13, color: '#555', lineHeight: 19, marginBottom: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#1a3a6b',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  bold: { fontWeight: '700' },
  tipBox: {
    backgroundColor: '#f0faf4', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 14,
  },
  tipText: { fontSize: 12, color: '#1a6b3a', lineHeight: 18 },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#1a3a6b',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  checkboxChecked: { backgroundColor: '#1a3a6b' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkLabel: { fontSize: 14, color: '#444' },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10,
    padding: 13, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, color: '#666', fontWeight: '600' },
  confirmBtn: { flex: 1, backgroundColor: '#1a3a6b', borderRadius: 10, padding: 13, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },

  // Existing
  statusCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16,
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4,
  },
  statusTitle: { fontSize: 14, color: '#666', marginBottom: 8 },
  statusBadge: {
    alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 8,
  },
  badgeActive: { backgroundColor: '#e8f5e9' },
  badgeInactive: { backgroundColor: '#f5f5f5' },
  badgeText: { fontSize: 13, fontWeight: '600' },
  statusDesc: { fontSize: 13, color: '#666', marginBottom: 12 },
  toggleBtn: { borderRadius: 8, padding: 14, alignItems: 'center' },
  btnActivate: { backgroundColor: '#1a3a6b' },
  btnDeactivate: { backgroundColor: '#666' },
  toggleBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 13, color: '#666' },
  cardChevron: { fontSize: 22, color: '#bbb', lineHeight: 24 },
  name: { fontSize: 20, fontWeight: '700', color: '#222', marginBottom: 4 },
  detail: { fontSize: 14, color: '#444', marginTop: 2 },
  warningCard: {
    backgroundColor: '#fff3cd', borderRadius: 12, padding: 14, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#ffc107',
  },
  warningText: { fontSize: 14, color: '#856404' },
  criticalCard: {
    backgroundColor: '#fff8f8', borderRadius: 12, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#CC0000',
  },
  criticalMed: { fontSize: 14, color: '#444', marginTop: 4 },
  interactionCard: {
    backgroundColor: '#fff8f0', borderRadius: 12, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#e65c00',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  interactionCardTitle: { fontSize: 13, fontWeight: '700', color: '#e65c00', flex: 1 },
  interactionItem: { fontSize: 13, marginTop: 4, fontWeight: '600' },
  interactionMore: { fontSize: 12, color: '#888', marginTop: 6, fontStyle: 'italic' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2,
  },
  statNum: { fontSize: 28, fontWeight: '700', color: '#1a3a6b' },
  statLabel: { fontSize: 11, color: '#666', marginTop: 2 },
  infoCard: { backgroundColor: '#e8f4fd', borderRadius: 12, padding: 16 },
  infoTitle: { fontSize: 15, fontWeight: '600', color: '#0066cc', marginBottom: 10 },
  infoStep: { fontSize: 14, color: '#333', marginBottom: 6 },
});
