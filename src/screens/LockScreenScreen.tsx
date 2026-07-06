import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { getProfile, getMedications, getContacts, getKV, setKV } from '../database/db';
import { updateEmergencyNotification, cancelEmergencyNotification, buildEmergencyCardLines } from '../services/notifications';
import { Profile, Medication, EmergencyContact } from '../types';
import EmergencyChecklist from '../components/EmergencyChecklist';

const KV_ALERT_ACTIVE = 'alert_active';

export default function LockScreenScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [cardLines, setCardLines] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [p, m, c, alertActive] = await Promise.all([
      getProfile(), getMedications(), getContacts(), getKV(KV_ALERT_ACTIVE),
    ]);
    setProfile(p);
    setMedications(m);
    setContacts(c);
    setNotifActive(alertActive === '1' && !!p?.name);
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 32, gap: 10 },

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
