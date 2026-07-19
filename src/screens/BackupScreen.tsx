import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal, TextInput,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { exportBackup, importBackup, getAppointments } from '../database/db';
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../services/backupCrypto';
import { rescheduleAllActiveNotifications, scheduleAppointmentReminders } from '../services/notifications';
import * as Notifications from 'expo-notifications';

const IS_IOS = Platform.OS === 'ios';

// O modal de senha serve aos dois fluxos. 'criar' = exportando (senha + confirmação — um erro
// de digitação aqui produz um arquivo que NUNCA mais abre, por isso os dois campos);
// 'abrir' = restaurando um arquivo cifrado (uma tentativa por vez, erro vira "senha incorreta").
type PedidoSenha =
  | { modo: 'criar'; destino: 'share' | 'pasta' }
  | { modo: 'abrir'; json: string };

// O arquivo NASCE para circular — WhatsApp, Drive, pendrive. O modelo de ameaça já assume que
// ele vaza; quem segura a porta é só a senha. O scrypt encarece cada tentativa, mas encarecer
// 10 mil tentativas (4 dígitos) ainda dá um número pequeno para quem tem uma GPU. Daí o piso de
// 6 e a recusa das óbvias: são elas que aparecem quando se pede "pelo menos 6".
//
// Deliberadamente NÃO exigimos maiúscula/número/símbolo. O público é idoso, e senha que não se
// lembra é pior que senha fraca: sem ela o backup não volta — por ninguém, nem por nós. Uma
// frase de três palavras é mais forte que "Ab1@x" e infinitamente mais fácil de lembrar, e é
// para lá que o texto do modal empurra.
const SENHA_MIN = 6;

const SENHAS_OBVIAS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  '654321', '111111', '000000', 'senha', 'senha123', 'password',
  'qwerty', 'abcdef', 'aaaaaa', 'medalert', 'backup',
]);

/** Devolve o motivo da recusa, ou null se a senha serve. */
function recusaSenha(s: string): string | null {
  if (s.length < SENHA_MIN) return `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  const baixa = s.toLowerCase();
  if (SENHAS_OBVIAS.has(baixa)) return 'Essa senha é das primeiras que alguém tentaria. Escolha outra.';
  if (/^(.)\1+$/.test(s)) return 'Repetir o mesmo caractere não protege o arquivo. Escolha outra.';
  // Sequências (123456, abcdef e as de trás para frente) — o mesmo caso das repetições.
  const seq = (passo: number) => s.split('').every((c, i) =>
    i === 0 || c.charCodeAt(0) === s.charCodeAt(i - 1) + passo);
  if (seq(1) || seq(-1)) return 'Sequências como 123456 são das primeiras tentativas. Escolha outra.';
  return null;
}

export default function BackupScreen() {
  const insets = useSafeAreaInsets();
  const [pedido, setPedido] = useState<PedidoSenha | null>(null);
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  function fecharModal() {
    setPedido(null);
    setSenha('');
    setSenha2('');
    setErroSenha(null);
    setProcessando(false);
  }

  function handleExport() {
    // O Storage Access Framework é só do Android. No iOS não há pasta a escolher: o
    // "Salvar em Arquivos" já vem dentro da própria folha de compartilhamento.
    if (IS_IOS) { setPedido({ modo: 'criar', destino: 'share' }); return; }
    Alert.alert('Exportar backup', 'Onde deseja guardar o arquivo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Compartilhar', onPress: () => setPedido({ modo: 'criar', destino: 'share' }) },
      { text: 'Salvar no celular', onPress: () => setPedido({ modo: 'criar', destino: 'pasta' }) },
    ]);
  }

  // Salva numa pasta escolhida pelo usuário (ex.: Downloads) — o arquivo fica
  // visível no gerenciador de arquivos do próprio celular.
  async function exportToFolder(conteudo: string) {
    try {
      const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;
      const date = new Date().toISOString().slice(0, 10);
      // Sem extensão no nome: o Android acrescenta .json a partir do MIME
      const uri = await StorageAccessFramework.createFileAsync(
        permissions.directoryUri, `medalert_backup_${date}`, 'application/json'
      );
      await writeAsStringAsync(uri, conteudo);
      Alert.alert('Backup salvo', 'Arquivo salvo na pasta escolhida. Para restaurar em outro celular, copie o arquivo, use "Restaurar backup" e digite a mesma senha.');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o backup.');
    }
  }

  async function exportViaShare(conteudo: string) {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const file = new File(Paths.document, `medalert_backup_${date}.json`);
      file.write(conteudo);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Exportar backup MedAlert' });
    } catch {
      Alert.alert('Erro', 'Não foi possível exportar o backup.');
    }
  }

  // Tudo o que acontece DEPOIS de ter o JSON em claro — comum ao arquivo cifrado e ao legado.
  async function restaurar(json: string) {
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
  }

  function handleImport() {
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
              // Backup antigo (em claro) continua restaurável — só o cifrado pede senha.
              if (isEncryptedBackup(json)) {
                setPedido({ modo: 'abrir', json });
                return;
              }
              await restaurar(json);
            } catch (e: any) {
              Alert.alert('Erro ao restaurar', e?.message ?? 'Arquivo inválido ou corrompido.');
            }
          },
        },
      ]
    );
  }

  async function confirmarSenha() {
    if (!pedido) return;
    const p = pedido;
    const s = senha.trim();
    if (p.modo === 'criar') {
      const recusa = recusaSenha(s);
      if (recusa) { setErroSenha(recusa); return; }
      if (s !== senha2.trim()) { setErroSenha('As duas senhas não são iguais.'); return; }
    } else if (!s) {
      setErroSenha('Digite a senha deste backup.');
      return;
    }

    setErroSenha(null);
    setProcessando(true);
    try {
      if (p.modo === 'criar') {
        const cifrado = await encryptBackup(await exportBackup(), s);
        fecharModal();
        if (p.destino === 'share') await exportViaShare(cifrado);
        else await exportToFolder(cifrado);
      } else {
        let claro: string;
        try {
          claro = await decryptBackup(p.json, s);
        } catch {
          // Poly1305 estourou: senha errada OU arquivo adulterado — para quem digita, dá no mesmo.
          setErroSenha('Senha incorreta para este arquivo.');
          setProcessando(false);
          return;
        }
        fecharModal();
        await restaurar(claro);
      }
    } catch (e: any) {
      fecharModal();
      Alert.alert('Erro', e?.message ?? 'Não foi possível concluir a operação.');
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup de Dados</Text>
        <Text style={styles.backupHint}>{IS_IOS
          ? 'Salve seus medicamentos, contatos e atividades em um arquivo protegido por senha e guarde no Arquivos/iCloud ou compartilhe por WhatsApp. Útil ao trocar de celular.'
          : 'Salve seus medicamentos, contatos e atividades em um arquivo protegido por senha, no celular (ex.: pasta Downloads) ou na nuvem/WhatsApp. Útil ao trocar de celular.'}</Text>
        <TouchableOpacity style={styles.backupBtn} onPress={handleExport}>
          <Text style={styles.backupBtnText}>Exportar backup</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.backupBtn, styles.backupBtnImport]} onPress={handleImport}>
          <Text style={[styles.backupBtnText, styles.backupBtnTextImport]}>Restaurar backup</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          ℹ️  {IS_IOS
            ? 'O backup do iCloud (Ajustes → [seu nome] → iCloud) já protege seus dados na nuvem. Este backup manual é uma garantia extra — guarde o arquivo fora do celular.'
            : 'O backup automático do Android (Configurações → Google → Backup) já protege seus dados na nuvem. Este backup manual é uma garantia extra — guarde o arquivo fora do celular.'}
        </Text>
      </View>

      <Modal visible={pedido != null} animationType="slide" transparent onRequestClose={fecharModal}>
        <View style={styles.senhaBackdrop}>
          <View style={styles.senhaCard}>
            <Text style={styles.senhaTitulo}>
              {pedido?.modo === 'criar' ? 'Proteja o backup com uma senha' : 'Este backup tem senha'}
            </Text>
            <Text style={styles.senhaTexto}>
              {pedido?.modo === 'criar'
                ? 'O arquivo só abre com esta senha. Uma frase curta que só você lembra — como "meu cachorro bingo" — protege melhor que uma senha curta e é mais fácil de guardar. Anote em lugar seguro: sem ela, o backup não pode ser restaurado — por ninguém.'
                : 'Digite a senha escolhida quando este backup foi exportado.'}
            </Text>

            <TextInput
              style={styles.senhaInput}
              value={senha}
              onChangeText={setSenha}
              placeholder="Senha"
              placeholderTextColor="#B0B5C0"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!processando}
            />
            {pedido?.modo === 'criar' && (
              <TextInput
                style={styles.senhaInput}
                value={senha2}
                onChangeText={setSenha2}
                placeholder="Repita a senha"
                placeholderTextColor="#B0B5C0"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!processando}
              />
            )}
            {erroSenha != null && <Text style={styles.senhaErro}>{erroSenha}</Text>}

            <TouchableOpacity
              style={[styles.backupBtn, styles.senhaBtnOk, processando && styles.senhaBtnOff]}
              onPress={confirmarSenha}
              disabled={processando}
            >
              {processando
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.backupBtnText}>{pedido?.modo === 'criar' ? 'Exportar' : 'Restaurar'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.senhaBtnCancelar} onPress={fecharModal} disabled={processando}>
              <Text style={styles.senhaBtnCancelarText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  senhaBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 20,
  },
  senhaCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 18,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  senhaTitulo: { fontSize: 16, fontWeight: '700', color: '#1C3F7A' },
  senhaTexto: { fontSize: 13, color: '#666', lineHeight: 18, marginTop: 6, marginBottom: 12 },
  senhaInput: {
    borderWidth: 1, borderColor: '#C8CDD8', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1A1F2E',
    marginBottom: 8,
  },
  senhaErro: { fontSize: 12.5, color: '#C0392B', marginBottom: 6 },
  senhaBtnOk: { marginTop: 4, marginBottom: 0 },
  senhaBtnOff: { opacity: 0.6 },
  senhaBtnCancelar: { alignItems: 'center', paddingVertical: 11, marginTop: 4 },
  senhaBtnCancelarText: { color: '#8A8F9D', fontSize: 13, fontWeight: '600' },
});
