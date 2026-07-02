import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getProfile, getMedications, getContacts, getKV, setKV } from '../database/db';
import { updateEmergencyNotification, cancelEmergencyNotification } from '../services/notifications';
import { Profile, Medication, EmergencyContact } from '../types';
import EmergencyChecklist from '../components/EmergencyChecklist';

const KV_ALERT_ACTIVE = 'alert_active';

export default function EmergencyScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [notifActive, setNotifActive] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);

  const load = useCallback(async () => {
    const [p, m, c, alertActive] = await Promise.all([
      getProfile(), getMedications(), getContacts(), getKV(KV_ALERT_ACTIVE),
    ]);
    setProfile(p);
    setMedications(m);
    setContacts(c);
    setNotifActive(alertActive === '1' && !!p?.name);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const canActivateAlert = !!profile?.name && contacts.length > 0;

  const profileDone = !!profile?.name;
  const contactDone = contacts.length > 0;
  const alertDone = notifActive;
  const doneCount = [profileDone, contactDone, alertDone].filter(Boolean).length;
  const allDone = doneCount === 3;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Progresso da configuração */}
      {allDone ? (
        <View style={styles.progressDoneBanner}>
          <Text style={styles.progressDoneIcon}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.progressDoneTitle}>Configuração completa</Text>
            <Text style={styles.progressDoneSub}>Perfil, contato e alerta configurados</Text>
          </View>
          <TouchableOpacity style={styles.progressDoneBtn} onPress={() => (navigation as any).navigate('Home')}>
            <Text style={styles.progressDoneBtnText}>Início →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>{doneCount} de 3 configurados</Text>
        </View>
      )}

      <EmergencyChecklist
        profile={profile}
        contacts={contacts}
        notifActive={notifActive}
        onPressProfile={() => (navigation as any).navigate('Profile')}
        onPressContacts={() => (navigation as any).navigate('Contacts')}
        onPressAlert={() => canActivateAlert ? setShowAlertModal(true) : (navigation as any).navigate('Profile')}
      />

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

  progressBar: {
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  progressText: { fontSize: 12, color: '#8A8F9D', fontWeight: '600' },
  progressDoneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#f0faf4', borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: 'rgba(93,201,148,0.3)',
  },
  progressDoneIcon: { fontSize: 20, color: '#1a6b3a', fontWeight: '700' },
  progressDoneTitle: { fontSize: 14, fontWeight: '700', color: '#1a6b3a' },
  progressDoneSub: { fontSize: 12, color: '#4d8a6a', marginTop: 2 },
  progressDoneBtn: { backgroundColor: '#1a6b3a', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  progressDoneBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

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
