import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { exportBackup, importBackup, getAppointments } from '../database/db';
import { rescheduleAllActiveNotifications, scheduleAppointmentReminders } from '../services/notifications';
import * as Notifications from 'expo-notifications';

export default function BackupScreen() {
  const insets = useSafeAreaInsets();

  async function handleExport() {
    Alert.alert('Exportar backup', 'Onde deseja guardar o arquivo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Compartilhar', onPress: exportViaShare },
      { text: 'Salvar no celular', onPress: exportToFolder },
    ]);
  }

  // Salva numa pasta escolhida pelo usuário (ex.: Downloads) — o arquivo fica
  // visível no gerenciador de arquivos do próprio celular.
  async function exportToFolder() {
    try {
      const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;
      const json = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      // Sem extensão no nome: o Android acrescenta .json a partir do MIME
      const uri = await StorageAccessFramework.createFileAsync(
        permissions.directoryUri, `medalert_backup_${date}`, 'application/json'
      );
      await writeAsStringAsync(uri, json);
      Alert.alert('Backup salvo', 'Arquivo salvo na pasta escolhida. Para restaurar em outro celular, copie o arquivo e use "Restaurar backup".');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o backup.');
    }
  }

  async function exportViaShare() {
    try {
      const json = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.document, `medalert_backup_${date}.json`);
      file.write(json);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Exportar backup MedAlert' });
    } catch {
      Alert.alert('Erro', 'Não foi possível exportar o backup.');
    }
  }

  async function handleImport() {
    Alert.alert(
      'Restaurar backup',
      'Restaurar o backup apagará os dados atuais deste aparelho — medicamentos, contatos, atividades, consultas e o histórico de doses — e colocará os do arquivo no lugar. Deseja restaurar assim mesmo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Escolher arquivo',
          onPress: async () => {
            try {
              // type '*/*': arquivos .json copiados do PC via USB muitas vezes não têm
              // MIME application/json e ficariam invisíveis/bloqueados no seletor
              const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
              if (result.canceled || !result.assets?.length) return;
              const json = await new File(result.assets[0].uri).text();
              await importBackup(json);
              // Reagenda tudo na hora — sem exigir reinício do app.
              // Cancela agendamentos dos dados antigos (substituídos pelo import) e recria dos novos.
              await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
              await rescheduleAllActiveNotifications().catch(() => {});
              const appts = await getAppointments().catch(() => []);
              for (const a of appts) {
                await scheduleAppointmentReminders(a.id, a.doctor_name, a.date, a.time).catch(() => {});
              }
              Alert.alert('Backup restaurado', 'Dados e lembretes restaurados com sucesso.');
            } catch (e: any) {
              Alert.alert('Erro ao restaurar', e?.message ?? 'Arquivo inválido ou corrompido.');
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup de Dados</Text>
        <Text style={styles.backupHint}>Salve seus medicamentos, contatos e atividades em um arquivo no celular (ex.: pasta Downloads) ou compartilhe para nuvem/WhatsApp. Útil ao trocar de celular.</Text>
        <TouchableOpacity style={styles.backupBtn} onPress={handleExport}>
          <Text style={styles.backupBtnText}>Exportar backup</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.backupBtn, styles.backupBtnImport]} onPress={handleImport}>
          <Text style={[styles.backupBtnText, styles.backupBtnTextImport]}>Restaurar backup</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          ℹ️  O backup automático do Android (Configurações → Google → Backup) já protege seus dados na nuvem. Este backup manual é uma garantia extra — guarde o arquivo fora do celular.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 16, paddingBottom: 24 },
  section: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1C3F7A', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  backupHint: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 18 },
  backupBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 8,
  },
  backupBtnImport: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#1C3F7A' },
  backupBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  backupBtnTextImport: { color: '#1C3F7A' },
  infoBox: { backgroundColor: '#e8f4fd', borderRadius: 10, padding: 12 },
  infoText: { fontSize: 13, color: '#0066cc', lineHeight: 18 },
});
