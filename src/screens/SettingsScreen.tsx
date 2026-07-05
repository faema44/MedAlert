import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getProfile, getContacts, getKV } from '../database/db';

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

  const load = useCallback(async () => {
    const [p, c, alertActive] = await Promise.all([getProfile(), getContacts(), getKV(KV_ALERT_ACTIVE)]);
    const profileDone = !!p?.name;
    const contactDone = c.length > 0;
    const notifActive = alertActive === '1' && profileDone;
    if (!profileDone || !contactDone) {
      setLockSubtitle('Complete o perfil e o contato para ativar');
    } else {
      setLockSubtitle(notifActive ? 'Alerta ativado — visível na tela de bloqueio' : 'Alerta desativado');
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <MenuRow
        icon="🔒"
        title="Tela de Bloqueio"
        subtitle={lockSubtitle}
        onPress={() => (navigation as any).navigate('LockScreen')}
      />
      <MenuRow
        icon="💾"
        title="Backup"
        subtitle="Exportar ou restaurar seus dados"
        onPress={() => (navigation as any).navigate('Backup')}
      />
      <MenuRow
        icon="🎵"
        title="Som"
        subtitle="Melodias dos lembretes por tipo"
        onPress={() => (navigation as any).navigate('SoundSettings')}
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
