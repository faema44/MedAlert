import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { getCaregiver, setCaregiver, clearCaregiver, getProfile, Caregiver } from '../database/db';
import { createInvite, getInbox, InboxItem, notifyCaregiver } from '../services/caregiver';

const TOLERANCIAS = [15, 30, 60, 120];

export default function CaregiverScreen() {
  const [cuidador, setCuidador] = useState<Caregiver | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [gerando, setGerando] = useState(false);
  const [testando, setTestando] = useState(false);

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([getCaregiver(), getInbox()]);
    setCuidador(c);
    setInbox(i);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function convidar() {
    setGerando(true);
    try {
      const perfil = await getProfile();
      const meuNome = perfil?.name?.trim() || 'Seu cuidador';
      const link = await createInvite(meuNome);
      await Share.share({
        message:
          `Vou acompanhar seus remédios pelo Alerta Médico.\n\n` +
          `Toque neste link no seu celular para me conectar:\n${link}`,
      });
    } catch (e: any) {
      // O texto amigável não pode ser o ÚNICO destino do erro: sem a causa técnica em algum
      // lugar, um pareamento que falha vira "tente de novo" para sempre, e ninguém descobre
      // por quê. Vai para o logcat e para o Sentry, que já está ligado.
      console.warn('[cuidador] falha ao gerar convite:', e?.code, e?.message, e);
      Sentry.captureException(e);
      Alert.alert(
        'Não deu para gerar o convite',
        e?.message === 'SEM_PERMISSAO_NOTIFICACAO'
          ? 'Você precisa permitir notificações — é por elas que os avisos chegam.'
          : `Não foi possível obter o endereço de notificação deste celular.\n\n${e?.message ?? e}`
      );
    } finally {
      setGerando(false);
    }
  }

  async function alterarTolerancia(min: number) {
    if (!cuidador) return;
    const novo = { ...cuidador, delay_minutes: min };
    await setCaregiver(novo);
    setCuidador(novo);
  }

  async function testar() {
    setTestando(true);
    try {
      const ok = await notifyCaregiver({
        kind: 'med',
        name: 'Teste do Alerta Médico',
        status: 'taken',
        at: new Date().toISOString(),
      });
      Alert.alert(
        ok ? 'Aviso enviado' : 'O aviso NÃO saiu',
        ok
          ? `Confira o celular de ${cuidador?.name}. Se nada chegar em um minuto, o pareamento não está valendo.`
          : 'O servidor de notificações recusou a mensagem. O cuidador não receberia nada — refaça o pareamento.'
      );
    } catch {
      Alert.alert('O aviso NÃO saiu', 'Sem conexão, ou o pareamento está inválido.');
    } finally {
      setTestando(false);
    }
  }

  function desconectar() {
    Alert.alert(
      'Desconectar cuidador',
      `${cuidador?.name} deixa de receber qualquer aviso seu. Você fica sem acompanhamento.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar', style: 'destructive',
          onPress: async () => { await clearCaregiver(); load(); },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quem cuida de mim</Text>
        {cuidador ? (
          <>
            <Text style={styles.pareado}>👤 {cuidador.name}</Text>
            <Text style={styles.hint}>
              Recebe um aviso a cada resposta sua — e também quando uma dose fica sem resposta.
            </Text>

            <Text style={styles.label}>Avisar se eu não responder em:</Text>
            <View style={styles.chips}>
              {TOLERANCIAS.map(min => (
                <TouchableOpacity
                  key={min}
                  style={[styles.chip, cuidador.delay_minutes === min && styles.chipOn]}
                  onPress={() => alterarTolerancia(min)}
                >
                  <Text style={[styles.chipText, cuidador.delay_minutes === min && styles.chipTextOn]}>
                    {min < 60 ? `${min} min` : `${min / 60} h`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.btnTest} onPress={testar} disabled={testando}>
              {testando
                ? <ActivityIndicator color="#1C3F7A" />
                : <Text style={styles.btnTestText}>Enviar um aviso de teste</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnOut} onPress={desconectar}>
              <Text style={styles.btnOutText}>Desconectar</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.hint}>
            Ninguém acompanha seus avisos. Peça à pessoa que cuida de você para abrir o Alerta
            Médico no celular dela, entrar aqui e mandar o convite.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Eu cuido de alguém</Text>
        <Text style={styles.hint}>
          Gere um convite e mande para a pessoa (pelo WhatsApp, por exemplo). Basta ela tocar no
          link uma vez: os avisos dela passam a chegar neste celular.
        </Text>
        <TouchableOpacity style={styles.btnMain} onPress={convidar} disabled={gerando}>
          {gerando
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnMainText}>Gerar convite</Text>}
        </TouchableOpacity>
      </View>

      {inbox.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Avisos recebidos</Text>
          {inbox.map((item, i) => (
            <View key={i} style={styles.inboxRow}>
              <Text style={styles.inboxText}>{item.text}</Text>
              <Text style={styles.inboxAt}>
                {new Date(item.at).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          ))}
        </View>
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
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1C3F7A', marginBottom: 6 },
  pareado: { fontSize: 16, fontWeight: '700', color: '#1A1F2E', marginBottom: 4 },
  hint: { fontSize: 12, color: '#8A8F9D', lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '600', color: '#1A1F2E', marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: '#C8CDD8',
  },
  chipOn: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  chipText: { fontSize: 13, color: '#4A5163', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  btnMain: {
    backgroundColor: '#1C3F7A', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginTop: 12,
  },
  btnMainText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnTest: {
    borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 10, paddingVertical: 11,
    alignItems: 'center', marginTop: 14,
  },
  btnTestText: { color: '#1C3F7A', fontSize: 14, fontWeight: '700' },
  btnOut: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  btnOutText: { color: '#8A8F9D', fontSize: 13, fontWeight: '600' },
  inboxRow: { paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)' },
  inboxText: { fontSize: 13, color: '#1A1F2E' },
  inboxAt: { fontSize: 11, color: '#8A8F9D', marginTop: 2 },
});
