import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getInbox, InboxItem, getPatients, Patient, subscribeInbox, clearOldInbox,
} from '../services/caregiver';

// Cor e ícone por tipo de aviso, para diferenciar num relance.
function avisoEstilo(text: string): { emoji: string; color: string } {
  if (text.includes('não confirmou')) return { emoji: '⏰', color: '#E07B4F' }; // silêncio (sem resposta)
  if (text.includes('NÃO tomou'))     return { emoji: '⚠️', color: '#C0392B' }; // respondeu que não tomou
  return { emoji: '✓', color: '#1a6b3a' };                                       // tomou / fez
}

// Só ver: escolhe o idoso e abre o histórico dele. Incluir/apagar idoso fica em Configurações.
export default function CaregiverHistoryScreen() {
  const [pacientes, setPacientes] = useState<Patient[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ps, i] = await Promise.all([getPatients(), getInbox()]);
    // Só quem já aceitou o convite (tem apelido) tem histórico para mostrar.
    const aceitos = ps.filter(p => p.nick);
    setPacientes(aceitos);
    setInbox(i);
    setAberto(prev => prev ?? (aceitos.length === 1 ? aceitos[0].pid : null));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Atualiza ao vivo quando um aviso chega com esta tela aberta.
  useEffect(() => subscribeInbox(() => { load(); }), [load]);

  function limparAntigos(p: Patient) {
    Alert.alert(
      'Limpar avisos antigos',
      `Apagar os avisos de ${p.nick} com mais de 24 horas? Os das últimas 24 horas continuam.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar', style: 'destructive',
          onPress: async () => { await clearOldInbox(p.pid, 24); load(); },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {pacientes.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nada por aqui ainda</Text>
          <Text style={styles.hint}>
            Quando alguém que você acompanha aceitar o convite, o histórico dela aparece aqui.
          </Text>
        </View>
      ) : (
        pacientes.map(p => {
          const historico = inbox.filter(i => i.pid === p.pid);
          const expandido = aberto === p.pid;
          return (
            <View key={p.pid} style={styles.card}>
              <TouchableOpacity
                style={styles.header}
                activeOpacity={0.7}
                onPress={() => setAberto(expandido ? null : p.pid)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{p.nick}</Text>
                  <Text style={styles.hint}>
                    {historico.length} aviso{historico.length === 1 ? '' : 's'} · toque para {expandido ? 'fechar' : 'ver'}
                  </Text>
                </View>
                <Text style={styles.chevron}>{expandido ? '⌄' : '›'}</Text>
              </TouchableOpacity>

              {expandido && historico.length === 0 && (
                <Text style={[styles.hint, { marginTop: 8 }]}>Nenhum aviso ainda.</Text>
              )}

              {expandido && historico.map((item, i) => {
                const est = avisoEstilo(item.text);
                return (
                  <View key={i} style={styles.row}>
                    <View style={styles.line}>
                      <Text style={styles.emoji}>{est.emoji}</Text>
                      <Text style={[styles.text, { color: est.color }]}>{item.text}</Text>
                    </View>
                    <Text style={styles.at}>
                      {new Date(item.at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                );
              })}

              {expandido && historico.length > 0 && (
                <TouchableOpacity style={styles.btnLimpar} onPress={() => limparAntigos(p)}>
                  <Text style={styles.btnLimparText}>Limpar avisos antigos (mantém as últimas 24h)</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1C3F7A', marginBottom: 4 },
  hint: { fontSize: 12, color: '#8A8F9D', lineHeight: 17 },
  chevron: { fontSize: 20, color: '#C0C4CE', paddingLeft: 8 },
  row: { paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  emoji: { fontSize: 13, lineHeight: 18 },
  text: { flex: 1, fontSize: 13, color: '#1A1F2E', fontWeight: '600', lineHeight: 18 },
  at: { fontSize: 11, color: '#8A8F9D', marginTop: 2, marginLeft: 20 },
  btnLimpar: { alignItems: 'center', paddingVertical: 10, marginTop: 8 },
  btnLimparText: { color: '#8A8F9D', fontSize: 13, fontWeight: '600' },
});
