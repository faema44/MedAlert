import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Alert, ActivityIndicator,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { getCaregiver, setCaregiver, clearCaregiver, getProfile, Caregiver } from '../database/db';
import {
  createInvite, getInbox, InboxItem, notifyCaregiver, syncCaregiverSchedule,
  getPatients, removePatient, Patient, subscribeInbox, clearPatientInbox,
} from '../services/caregiver';

const TOLERANCIAS = [15, 30, 60, 120];

export default function CaregiverScreen() {
  const [cuidador, setCuidador] = useState<Caregiver | null>(null);
  const [pacientes, setPacientes] = useState<Patient[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [aberto, setAberto] = useState<string | null>(null); // pid cujo histórico está expandido
  const [gerando, setGerando] = useState(false);
  const [testando, setTestando] = useState(false);

  const load = useCallback(async () => {
    const [c, ps, i] = await Promise.all([getCaregiver(), getPatients(), getInbox()]);
    setCuidador(c);
    setPacientes(ps);
    setInbox(i);
    // Com uma pessoa só, não faz sentido obrigar um toque para ver o histórico dela.
    setAberto(prev => prev ?? (ps.length === 1 ? ps[0].pid : null));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Atualiza ao vivo quando um aviso chega com esta tela aberta (app em primeiro plano).
  useEffect(() => subscribeInbox(() => { load(); }), [load]);

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
    // O cuidador já marcou os alertas locais com a tolerância ANTIGA. Sem reenviar a agenda,
    // mudar este número não muda nada no mundo real.
    await syncCaregiverSchedule().catch(() => {});
    setCuidador(novo);
  }

  function removerPaciente(p: Patient) {
    Alert.alert(
      `Parar de acompanhar ${p.nick || 'esta pessoa'}?`,
      'O histórico dela some deste celular e os avisos param de chegar. Ela não é avisada disso.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Parar', style: 'destructive',
          onPress: async () => { await removePatient(p.pid); load(); },
        },
      ]
    );
  }

  function limparAvisos(p: Patient) {
    Alert.alert(
      'Limpar avisos',
      `Apagar todos os avisos de ${p.nick || 'este contato'}? O pareamento continua — novos avisos seguem chegando.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar', style: 'destructive',
          onPress: async () => { await clearPatientInbox(p.pid); load(); },
        },
      ]
    );
  }

  // Cor e ícone por tipo de aviso, para diferenciar num relance.
  function avisoEstilo(text: string): { emoji: string; color: string } {
    if (text.includes('não confirmou')) return { emoji: '⏰', color: '#E07B4F' }; // silêncio (sem resposta)
    if (text.includes('NÃO tomou'))     return { emoji: '⚠️', color: '#C0392B' }; // respondeu que não tomou
    return { emoji: '✓', color: '#1a6b3a' };                                       // tomou / fez
  }

  async function salvarApelido() {
    if (!cuidador) return;
    await setCaregiver(cuidador);
    // O apelido viaja dentro da agenda. Sem reenviar, os alertas já marcados no celular do
    // cuidador continuariam usando o apelido velho.
    await syncCaregiverSchedule().catch(() => {});
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
          onPress: async () => {
            await clearCaregiver();
            // Sem isto, os alarmes já marcados continuariam disparando avisos para alguém que
            // o usuário acabou de remover — o pior tipo de vazamento: o que ele acha que cortou.
            await syncCaregiverSchedule().catch(() => {});
            load();
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Quem cuida de mim (papel de idoso) some quando o aparelho já é cuidador: acompanhar
          alguém e ser acompanhado ao mesmo tempo na mesma tela confunde. */}
      {pacientes.length === 0 && (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quem cuida de mim</Text>
        {cuidador ? (
          <>
            <Text style={styles.pareado}>👤 {cuidador.name}</Text>
            <Text style={styles.hint}>
              Recebe um aviso a cada resposta sua — e é avisado se uma dose ficar sem resposta,
              mesmo que seu celular esteja desligado.
            </Text>

            <Text style={styles.label}>Como {cuidador.name} te chama:</Text>
            <TextInput
              style={styles.apelidoInput}
              value={cuidador.nickname}
              onChangeText={t => setCuidador({ ...cuidador, nickname: t })}
              onBlur={salvarApelido}
              placeholder="Vovó, Mãe, Seu João..."
              placeholderTextColor="#B0B5C0"
              maxLength={30}
            />
            <Text style={styles.hint}>
              É este apelido que aparece nos avisos — seu nome completo nunca sai do celular.
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
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Eu cuido de alguém</Text>
        <Text style={styles.hint}>
          Gere um convite e mande para a pessoa (pelo WhatsApp, por exemplo). Basta ela tocar no
          link uma vez. Você pode acompanhar mais de uma pessoa — gere um convite para cada.
        </Text>
        <TouchableOpacity style={styles.btnMain} onPress={convidar} disabled={gerando}>
          {gerando
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnMainText}>Gerar convite</Text>}
        </TouchableOpacity>
      </View>

      {pacientes.map(p => {
        const historico = inbox.filter(i => i.pid === p.pid);
        const expandido = aberto === p.pid;
        // Convite gerado mas ainda não aceito: o apelido só chega na primeira mensagem dela.
        const aguardando = !p.nick;
        return (
          <View key={p.pid} style={styles.card}>
            <TouchableOpacity
              style={styles.pacienteHeader}
              activeOpacity={0.7}
              onPress={() => setAberto(expandido ? null : p.pid)}
              onLongPress={() => removerPaciente(p)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {aguardando ? 'Convite enviado' : p.nick}
                </Text>
                <Text style={styles.hint}>
                  {aguardando
                    ? 'Aguardando a pessoa tocar no link. Nada chega até lá.'
                    : `${historico.length} aviso${historico.length === 1 ? '' : 's'} · toque para ${expandido ? 'fechar' : 'ver'}`}
                </Text>
              </View>
              {!aguardando && <Text style={styles.cardChevron}>{expandido ? '⌄' : '›'}</Text>}
            </TouchableOpacity>

            {expandido && historico.length === 0 && (
              <Text style={[styles.hint, { marginTop: 8 }]}>
                Nenhum aviso ainda. O histórico começa a partir do pareamento.
              </Text>
            )}

            {expandido && historico.map((item, i) => {
              const est = avisoEstilo(item.text);
              return (
                <View key={i} style={styles.inboxRow}>
                  <View style={styles.inboxLine}>
                    <Text style={styles.inboxEmoji}>{est.emoji}</Text>
                    <Text style={[styles.inboxText, { color: est.color }]}>{item.text}</Text>
                  </View>
                  <Text style={styles.inboxAt}>
                    {new Date(item.at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
              );
            })}

            {expandido && historico.length > 0 && (
              <TouchableOpacity style={styles.btnLimpar} onPress={() => limparAvisos(p)}>
                <Text style={styles.btnLimparText}>Limpar avisos</Text>
              </TouchableOpacity>
            )}

            {(expandido || aguardando) && (
              <TouchableOpacity style={styles.btnApagar} onPress={() => removerPaciente(p)}>
                <Text style={styles.btnApagarText}>
                  Apagar {aguardando ? 'este convite' : p.nick}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
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
  apelidoInput: {
    borderWidth: 1, borderColor: '#C8CDD8', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1A1F2E',
    marginBottom: 6,
  },
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
  btnApagar: {
    alignItems: 'center', paddingVertical: 10, marginTop: 10,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)',
  },
  btnApagarText: { color: '#C0392B', fontSize: 13, fontWeight: '600' },
  pacienteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardChevron: { fontSize: 22, color: '#C0C5D0', lineHeight: 24 },
  inboxRow: { paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.06)' },
  inboxLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  inboxEmoji: { fontSize: 13, lineHeight: 18 },
  inboxText: { flex: 1, fontSize: 13, color: '#1A1F2E', fontWeight: '600', lineHeight: 18 },
  inboxAt: { fontSize: 11, color: '#8A8F9D', marginTop: 2, marginLeft: 20 },
  btnLimpar: { alignItems: 'center', paddingVertical: 10, marginTop: 8 },
  btnLimparText: { color: '#8A8F9D', fontSize: 13, fontWeight: '600' },
});
