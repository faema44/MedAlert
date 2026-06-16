import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useFocusEffect, useNavigation, NavigationProp } from '@react-navigation/native';
import { getProfile, getMedications, getContacts } from '../database/db';

type RootTabs = { Home: undefined; Profile: undefined; Medications: undefined; Contacts: undefined; Interactions: undefined };
import { updateEmergencyNotification, cancelEmergencyNotification } from '../services/notifications';
import { Profile, Medication, EmergencyContact } from '../types';

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp<RootTabs>>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);

  const load = useCallback(async () => {
    const [p, m, c] = await Promise.all([getProfile(), getMedications(), getContacts()]);
    setProfile(p);
    setMedications(m);
    setContacts(c);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleToggleNotification() {
    if (!profile?.name) {
      Alert.alert('Perfil incompleto', 'Preencha seu nome no perfil antes de ativar o alerta.');
      return;
    }
    if (notifActive) {
      await cancelEmergencyNotification();
      setNotifActive(false);
    } else {
      await updateEmergencyNotification(profile, medications);
      setNotifActive(true);
    }
  }

  const criticalMeds = medications.filter(m => m.is_critical);
  const profileComplete = profile?.name && medications.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    backgroundColor: '#fff3cd', borderRadius: 12, padding: 14, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#ffc107',
  },
  warningText: { fontSize: 14, color: '#856404' },
  criticalCard: {
    backgroundColor: '#fff8f8', borderRadius: 12, padding: 16, marginBottom: 12,
    borderLeftWidth: 4, borderLeftColor: '#CC0000',
  },
  criticalMed: { fontSize: 14, color: '#444', marginTop: 4 },
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
