import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getProfile, getKV, getCaregiver } from '../database/db';
import { getMedIdOptIn } from '../services/medicalId';

const IS_IOS = Platform.OS === 'ios';

const KV_ALERT_ACTIVE = 'alert_active';

interface MenuRowProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function MenuRow({ icon, title, subtitle, onPress }: MenuRowProps) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub} numberOfLines={2}>{subtitle}</Text>
      </View>
      <Text style={styles.cardChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation();
  const [lockSubtitle, setLockSubtitle] = useState('Perfil, contato e alerta de emergência');
  const [caregiverSubtitle, setCaregiverSubtitle] = useState('Ninguém acompanha seus avisos');

  const load = useCallback(async () => {
    const [p, alertActive, cg] = await Promise.all([getProfile(), getKV(KV_ALERT_ACTIVE), getCaregiver()]);
    if (IS_IOS) {
      // iPhone: a ficha da tela de bloqueio é a Ficha Médica nativa da Apple; o app só lembra.
      const on = await getMedIdOptIn();
      setLockSubtitle(on ? 'Lembretes de atualização ativados' : 'Ajuda a manter sua Ficha Médica atualizada');
    } else {
      const profileDone = !!p?.name;
      const notifActive = alertActive === '1' && profileDone;
      if (!profileDone) {
        setLockSubtitle('Necessário completar o Perfil Médico');
      } else {
        setLockSubtitle(notifActive ? 'Alerta ativado — visível na tela de bloqueio' : 'Alerta desativado');
      }
    }
    setCaregiverSubtitle(cg ? `${cg.name} recebe seus avisos` : 'Ninguém acompanha seus avisos');
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <MenuRow
        icon="🔒"
        title={IS_IOS ? 'Ficha Médica (Apple)' : 'Tela de Bloqueio'}
        subtitle={lockSubtitle}
        onPress={() => (navigation as any).navigate('LockScreen')}
      />
      <MenuRow
        icon="👤"
        title="Cuidador"
        subtitle={caregiverSubtitle}
        onPress={() => (navigation as any).navigate('Caregiver')}
      />
      <MenuRow
        icon="💾"
        title="Backup"
        subtitle="Exportar ou restaurar seus dados"
        onPress={() => (navigation as any).navigate('Backup')}
      />
      <MenuRow
        icon="📋"
        title="Tabelas"
        subtitle="Medicamentos, fitoterápicos e interações"
        onPress={() => (navigation as any).navigate('Interactions')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardIcon: { fontSize: 22, width: 22, textAlign: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  cardSub: { fontSize: 12, color: '#8A8F9D', marginTop: 2 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },
});
