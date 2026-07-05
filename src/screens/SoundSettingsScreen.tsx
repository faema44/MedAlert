import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { previewReminderSound, ReminderSoundType } from '../services/notifications';

const SOUNDS: Array<{ type: ReminderSoundType; icon: string; label: string; desc: string }> = [
  { type: 'med',      icon: '💊', label: 'Medicamentos',    desc: 'Três notas ascendentes (ding-ding-ding), mais urgentes' },
  { type: 'herbal',   icon: '🌿', label: 'Fitoterápicos',   desc: 'Três notas suaves em sino, ritmo calmo' },
  { type: 'activity', icon: '🏃', label: 'Atividades',      desc: 'Dois tons suaves e crescentes' },
  { type: 'appt',     icon: '🩺', label: 'Consulta Médica', desc: 'Dois tons descendentes e calmos' },
];

export default function SoundSettingsScreen() {
  const [playing, setPlaying] = useState<ReminderSoundType | null>(null);

  async function handleTest(type: ReminderSoundType, label: string) {
    setPlaying(type);
    await previewReminderSound(type, label).catch(() => {});
    setTimeout(() => setPlaying(p => (p === type ? null : p)), 1500);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          🎵 Cada tipo de lembrete toca uma melodia diferente, para você identificar o aviso antes mesmo de olhar para o celular.
        </Text>
      </View>

      {SOUNDS.map(s => (
        <View key={s.type} style={styles.card}>
          <Text style={styles.cardIcon}>{s.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{s.label}</Text>
            <Text style={styles.cardSub}>{s.desc}</Text>
          </View>
          <TouchableOpacity
            style={styles.testBtn}
            onPress={() => handleTest(s.type, s.label)}
            disabled={playing === s.type}
          >
            <Text style={styles.testBtnText}>{playing === s.type ? '▶ Tocando…' : '▶ Testar'}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },
  infoBox: { backgroundColor: '#e8f4fd', borderRadius: 10, padding: 12, marginBottom: 4 },
  infoText: { fontSize: 13, color: '#0066cc', lineHeight: 18 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardIcon: { fontSize: 22, width: 22, textAlign: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  cardSub: { fontSize: 12, color: '#8A8F9D', marginTop: 2 },
  testBtn: {
    borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  testBtnText: { fontSize: 12, fontWeight: '700', color: '#1C3F7A' },
});
