import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch, Alert, AppState, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { getProfile, getMedications, getContacts, getKV, setKV } from '../database/db';
import { updateEmergencyNotification, cancelEmergencyNotification, buildEmergencyCardLines } from '../services/notifications';
import { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } from '../services/medNotification';
import {
  getMedIdOptIn, setMedIdOptIn, isMedicalIdPending, ackMedicalIdUpdate, buildMedListText,
} from '../services/medicalId';
import { Profile, Medication, EmergencyContact } from '../types';
import EmergencyChecklist from '../components/EmergencyChecklist';

const KV_ALERT_ACTIVE = 'alert_active';

// No iPhone a ficha da tela de bloqueio não existe pra apps — só a Ficha Médica nativa da Apple,
// que nenhum app pode ler nem preencher. Lá o app só ensina e lembra (ver IOSMedicalIdScreen).
export default function LockScreenScreen() {
  if (Platform.OS === 'ios') return <IOSMedicalIdScreen />;
  return <AndroidLockScreen />;
}

function AndroidLockScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [cardLines, setCardLines] = useState<string[]>([]);
  const [batteryOk, setBatteryOk] = useState(true);

  const load = useCallback(async () => {
    const [p, m, c, alertActive, battOk] = await Promise.all([
      getProfile(), getMedications(), getContacts(), getKV(KV_ALERT_ACTIVE), isIgnoringBatteryOptimizations(),
    ]);
    setProfile(p);
    setMedications(m);
    setContacts(c);
    setNotifActive(alertActive === '1' && !!p?.name);
    setBatteryOk(battOk);
    setCardLines(p?.name ? await buildEmergencyCardLines(p, m) : []);
    return p;
  }, []);

  useFocusEffect(useCallback(() => {
    load().then((p) => {
      if (route.params?.openAlert) {
        navigation.setParams({ openAlert: undefined } as never);
        if (p?.name) setShowAlertModal(true);
      }
    });
    // Reconfere a isenção de bateria ao voltar da tela de Configurações do sistema
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') isIgnoringBatteryOptimizations().then(setBatteryOk);
    });
    return () => sub.remove();
  }, [load, route.params?.openAlert, navigation]));

  async function handleAlertToggle() {
    if (!profile?.name) return;
    if (notifActive) {
      await cancelEmergencyNotification();
      await setKV(KV_ALERT_ACTIVE, '0');
      setNotifActive(false);
    } else {
      await updateEmergencyNotification(profile, medications);
      await setKV(KV_ALERT_ACTIVE, '1');
      setNotifActive(true);
    }
  }

  // Contato é opcional (só aparece no card se marcado "mostrar na tela de bloqueio"
  // — ver buildEmergencyCardLines); só o nome no Perfil é realmente obrigatório,
  // pois updateEmergencyNotification usa profile.name incondicionalmente.
  const canActivateAlert = !!profile?.name;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <EmergencyChecklist
        profile={profile}
        contacts={contacts}
        notifActive={notifActive}
        batteryWarn={notifActive && !batteryOk}
        onPressProfile={() => (navigation as any).navigate('Profile', { returnTo: 'LockScreen' })}
        onPressContacts={() => (navigation as any).navigate('Contacts')}
        onPressAlert={() => {
          if (canActivateAlert) { setShowAlertModal(true); return; }
          Alert.alert(
            'Perfil necessário',
            'Para ativar o alerta na tela de bloqueio, complete seu Perfil Médico primeiro (pelo menos o nome).',
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Completar perfil', onPress: () => (navigation as any).navigate('Profile', { returnTo: 'LockScreen' }) },
            ],
          );
        }}
      />

      {cardLines.length > 0 && (
        <View style={styles.previewCard}>
          <Text style={styles.previewHeader}>🔒 Como aparece na tela de bloqueio</Text>
          <View style={styles.previewNotif}>
            <Text style={styles.previewNotifTitle}>Informações Médicas</Text>
            {cardLines.map((line, i) => (
              <Text key={i} style={styles.previewNotifLine}>{line || ' '}</Text>
            ))}
          </View>
        </View>
      )}

      {/* Alert modal */}
      <Modal visible={showAlertModal} animationType="slide" transparent onRequestClose={() => setShowAlertModal(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            <Text style={styles.modalTitle}>Alerta de Emergência</Text>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>{notifActive ? 'Ativado' : 'Desativado'}</Text>
                <Text style={styles.toggleHint}>
                  {notifActive ? 'Visível na tela de bloqueio' : 'Toque para ativar'}
                </Text>
              </View>
              <Switch
                value={notifActive}
                onValueChange={handleAlertToggle}
                trackColor={{ true: '#1C3F7A', false: '#ccc' }}
                thumbColor="#fff"
              />
            </View>
            {notifActive && !batteryOk && (
              <View style={styles.battModalBox}>
                <Text style={styles.battModalTitle}>⚠️ A bateria pode escondê-la</Text>
                <Text style={styles.battModalBody}>
                  A economia de bateria pode remover a ficha da tela de bloqueio depois de um
                  tempo. Abra o ajuste, encontre o Alerta Médico na lista e escolha “Não otimizar”.
                </Text>
                <TouchableOpacity style={styles.battBtn} onPress={() => requestIgnoreBatteryOptimizations()}>
                  <Text style={styles.battBtnText}>Abrir ajuste de bateria</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.modalSection}>Para que serve</Text>
            <Text style={styles.modalBody}>
              Exibe suas informações médicas — medicamentos, doses e contatos de emergência — na tela de bloqueio do celular, sem precisar desbloquear.
            </Text>
            <Text style={styles.modalSection}>Como configurar o celular</Text>
            {[
              'Abra as Configurações do celular',
              'Vá em Notificações → Alerta Médico',
              'Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"',
              'Certifique-se de que as notificações estão ativadas',
            ].map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
            <View style={styles.tipBox}>
              <Text style={styles.tipText}>
                💡 O caminho exato varia por fabricante. Geralmente em Configurações → Notificações → Tela de Bloqueio.
              </Text>
            </View>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowAlertModal(false)}>
              <Text style={styles.modalCloseText}>Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

    </ScrollView>
  );
}

// ───────────────────────── iOS: Ficha Médica (Medical ID) ─────────────────────────
// O app não configura nada aqui — não tem como. Ele só ajuda a copiar a lista de remédios
// e lembra quando eles mudam. Nunca diz que está feito, porque não consegue conferir.
function IOSMedicalIdScreen() {
  const [optIn, setOptIn] = useState(false);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [on, m] = await Promise.all([getMedIdOptIn(), getMedications()]);
    const active = m.filter(x => !x.suspended);
    setOptIn(on);
    setMeds(active);
    setPending(on ? await isMedicalIdPending(m) : false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggle(v: boolean) {
    await setMedIdOptIn(v);
    setOptIn(v);
    setPending(false);
  }

  async function markDone() {
    await ackMedicalIdUpdate();
    setPending(false);
  }

  const listText = buildMedListText(meds);

  async function copyList() {
    // Carregado sob demanda: expo-clipboard é módulo nativo e só é usado no iOS. Importar no topo
    // faria o Android tentar linká-lo já na inicialização e derrubaria o app num build sem o rebuild.
    const Clipboard = require('expo-clipboard');
    await Clipboard.setStringAsync(listText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScrollView style={ios.container} contentContainerStyle={ios.content}>
      <View style={ios.card}>
        <Text style={ios.title}>Ficha Médica do iPhone</Text>
        <Text style={ios.body}>
          O iPhone mostra a sua Ficha Médica (Medical ID) na tela de bloqueio, em Emergência — e
          socorristas são treinados a procurar ali. Mas nenhum app pode preenchê-la nem lê-la por
          você: quem preenche é você mesmo, no app Saúde da Apple.{'\n\n'}
          O Alerta Médico só te lembra de manter os medicamentos atualizados lá. Não temos como
          conferir se está feito — por isso nunca dizemos que está.
        </Text>
      </View>

      <View style={ios.toggleRow}>
        <Text style={ios.toggleLabel}>
          Uso o Medical ID e quero receber os alertas para não esquecer de atualizar o Medical ID
          da Apple
        </Text>
        <Switch
          value={optIn}
          onValueChange={toggle}
          trackColor={{ true: '#1C3F7A', false: '#ccc' }}
          thumbColor="#fff"
        />
      </View>

      {optIn && (
        <>
          {pending && (
            <View style={ios.pendingBox}>
              <Text style={ios.pendingTitle}>⚠️ Seus remédios mudaram</Text>
              <Text style={ios.pendingBody}>
                Atualize a lista de medicamentos na sua Ficha Médica. Uma ficha desatualizada é mais
                perigosa que uma vazia. Quando terminar, toque abaixo.
              </Text>
              <TouchableOpacity style={ios.doneBtn} onPress={markDone}>
                <Text style={ios.doneBtnText}>Já atualizei</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={ios.card}>
            <Text style={ios.section}>Como atualizar</Text>
            {[
              'Abra o app Saúde',
              'Toque na sua foto (canto superior) → Ficha Médica',
              'Toque em Editar',
              'No campo Medicamentos, cole a lista abaixo',
              'Toque em OK',
            ].map((step, i) => (
              <View key={i} style={ios.stepRow}>
                <View style={ios.stepNum}><Text style={ios.stepNumText}>{i + 1}</Text></View>
                <Text style={ios.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          <View style={ios.card}>
            <Text style={ios.section}>Seus medicamentos</Text>
            <Text selectable style={ios.listText}>
              {listText || 'Nenhum medicamento cadastrado.'}
            </Text>
            {!!listText && (
              <TouchableOpacity style={ios.copyBtn} onPress={copyList}>
                <Text style={ios.copyBtnText}>{copied ? '✓ Copiado' : 'Copiar lista'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const ios = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 8 },
  body: { fontSize: 13, color: '#444', lineHeight: 20 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  toggleLabel: { flex: 1, fontSize: 13, color: '#1A1F2E', lineHeight: 19 },
  section: { fontSize: 11, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5, marginBottom: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  listText: {
    fontSize: 14, color: '#1A1F2E', lineHeight: 22,
    backgroundColor: '#F2F4F8', borderRadius: 8, padding: 12,
  },
  copyBtn: {
    marginTop: 12, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 12, alignItems: 'center',
  },
  copyBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  pendingBox: {
    backgroundColor: '#fff5ef', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: '#E07B4F',
  },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: '#b45526', marginBottom: 6 },
  pendingBody: { fontSize: 13, color: '#7a4a30', lineHeight: 19, marginBottom: 12 },
  doneBtn: { backgroundColor: '#E07B4F', borderRadius: 10, padding: 12, alignItems: 'center' },
  doneBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },

  battModalBox: {
    backgroundColor: '#fff5ef', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 0.5, borderColor: '#E07B4F',
  },
  battModalTitle: { fontSize: 14, fontWeight: '700', color: '#b45526', marginBottom: 6 },
  battModalBody: { fontSize: 13, color: '#7a4a30', lineHeight: 19, marginBottom: 12 },
  battBtn: { backgroundColor: '#E07B4F', borderRadius: 10, padding: 12, alignItems: 'center' },
  battBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },

  previewCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  previewHeader: { fontSize: 12, fontWeight: '700', color: '#8A8F9D', marginBottom: 10 },
  previewNotif: {
    backgroundColor: '#F2F4F8', borderRadius: 10, padding: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)',
  },
  previewNotifTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E', marginBottom: 6 },
  previewNotifLine: { fontSize: 13, color: '#333', lineHeight: 19 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '85%',
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: '#1A1F2E' },
  toggleHint: { fontSize: 12, color: '#888', marginTop: 2 },
  modalSection: { fontSize: 11, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  modalBody: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNum: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText: { fontSize: 13, color: '#333', lineHeight: 20, flex: 1 },
  tipBox: { backgroundColor: '#f0faf4', borderRadius: 8, padding: 10, marginTop: 4, marginBottom: 14 },
  tipText: { fontSize: 12, color: '#1a6b3a', lineHeight: 18 },
  modalClose: {
    marginTop: 12, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  modalCloseText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
