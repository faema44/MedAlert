import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Profile, EmergencyContact } from '../types';
import { calculateAge } from '../services/notifications';

interface Props {
  profile: Profile | null;
  contacts: EmergencyContact[];
  notifActive: boolean;
  onPressProfile: () => void;
  onPressContacts: () => void;
  onPressAlert: () => void;
}

function profileSummary(profile: Profile | null): string {
  if (!profile?.name) return 'Toque para configurar';
  const parts = [profile.name];
  if (profile.blood_type && profile.blood_type !== 'Desconhecido') parts.push(profile.blood_type);
  const age = calculateAge(profile.birth_date);
  if (age != null) parts.push(`${age} anos`);
  if (profile.allergies?.trim()) parts.push(`Alergia: ${profile.allergies.trim()}`);
  return parts.join(' · ');
}

export default function EmergencyChecklist({ profile, contacts, notifActive, onPressProfile, onPressContacts, onPressAlert }: Props) {
  const primaryContact = contacts.find(c => c.is_primary) ?? contacts[0] ?? null;
  const canActivateAlert = !!profile?.name;
  const profileDone = !!profile?.name;
  const contactDone = contacts.length > 0;

  return (
    <>
      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPressProfile}>
        <Text style={styles.cardIcon}>👤</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Perfil Médico</Text>
          <Text style={styles.cardSub} numberOfLines={2}>{profileSummary(profile)}</Text>
        </View>
        {profileDone && <Text style={styles.doneCheck}>✓</Text>}
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPressContacts}>
        <Text style={styles.cardIcon}>📞</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Contato de Emergência</Text>
          <Text style={styles.cardSub}>
            {primaryContact ? `${primaryContact.name} · ${primaryContact.phone}` : 'Nenhum contato cadastrado'}
          </Text>
        </View>
        {contactDone && <Text style={styles.doneCheck}>✓</Text>}
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPressAlert}>
        <View style={[styles.statusDot, notifActive ? styles.dotActive : styles.dotInactive]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: notifActive ? '#1a6b3a' : canActivateAlert ? '#C0392B' : '#8A8F9D' }]}>
            {notifActive ? 'Alerta ativado' : 'Alerta desativado'}
          </Text>
          <Text style={styles.cardSub}>
            {notifActive
              ? 'Visível na tela de bloqueio'
              : canActivateAlert ? 'Toque para ativar a tela de bloqueio' : 'Preencha o perfil primeiro'}
          </Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardIcon: { fontSize: 22, width: 22, textAlign: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotActive: { backgroundColor: '#5DC994' },
  dotInactive: { backgroundColor: '#E07B4F' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  cardSub: { fontSize: 12, color: '#8A8F9D', marginTop: 2 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },
  doneCheck: { fontSize: 16, color: '#5DC994', fontWeight: '700' },
});
