import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';

const PRIVACY_URL = 'https://faema44.github.io/MedAlert/privacy.html';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNumber}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return <Text style={styles.bullet}>• {text}</Text>;
}

export default function HelpScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>🏥</Text>
        <Text style={styles.heroTitle}>Para que serve o MedAlert?</Text>
        <Text style={styles.heroText}>
          Em caso de acidente ou emergência médica, os socorristas e médicos precisam saber
          rapidamente quais medicamentos você toma — antes de aplicar qualquer tratamento.
          Certos medicamentos podem interagir perigosamente com anestesias, anticoagulantes
          e outros procedimentos de urgência.
        </Text>
        <Text style={styles.heroText}>
          O MedAlert coloca essas informações visíveis na <Text style={styles.bold}>tela de bloqueio do celular</Text>,
          acessíveis sem precisar desbloqueá-lo — mesmo que você esteja inconsciente.
        </Text>
      </View>

      {/* Como usar */}
      <Section title="Como usar — passo a passo">
        <Step number="1" text="Abra a aba Perfil e preencha seu nome, tipo sanguíneo e alergias." />
        <Step number="2" text="Cadastre todos os medicamentos que você usa regularmente na aba Medicamentos. Marque como 'crítico' os que não podem ser interrompidos." />
        <Step number="3" text="Adicione ao menos um contato de emergência na aba Contatos (familiar ou médico de referência)." />
        <Step number="4" text="Na tela Início, toque em 'Ícone na Tela de Bloqueio (Emergência)' para ativar. A partir daí, sua ficha médica fica visível na notificação persistente." />
      </Section>

      {/* Tela de bloqueio */}
      <Section title="🔒 Ícone na tela de bloqueio">
        <Text style={styles.bodyText}>
          Quando o alerta está ativo, uma notificação permanente aparece na tela de bloqueio
          do Android. Ao expandir (deslizando para baixo), o socorrista vê:
        </Text>
        <Bullet text="Seu nome e tipo sanguíneo" />
        <Bullet text="Todos os medicamentos cadastrados (com dose)" />
        <Bullet text="Medicamentos críticos sinalizados com ⚠️" />
        <Bullet text="Alergias e observações médicas" />
        <Text style={styles.tip}>
          💡 Nenhum desbloqueio é necessário. O médico vê tudo na própria tela de bloqueio.
        </Text>
      </Section>

      {/* Configurar tela de bloqueio */}
      <Section title="⚙️ Como liberar a notificação na tela de bloqueio">
        <Text style={styles.bodyText}>
          Para que o conteúdo da notificação apareça na tela de bloqueio (e não apenas um ícone),
          é necessário ajustar as configurações do Android:
        </Text>
        <Step number="1" text='Abra as Configurações do celular' />
        <Step number="2" text='Vá em Notificações (ou Aplicativos → MedAlert → Notificações)' />
        <Step number="3" text='Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"' />
        <Step number="4" text='Confirme que as notificações do MedAlert estão ativadas' />
        <Text style={styles.tip}>
          💡 O caminho exato varia por fabricante. Em Samsung: Configurações → Notificações → Configurações avançadas → Mostrar na tela de bloqueio. Em Motorola: Configurações → Notificações → Privacidade de notificações.
        </Text>
      </Section>

      {/* Interações */}
      <Section title="⚡ Interações medicamentosas">
        <Text style={styles.bodyText}>
          O app verifica automaticamente combinações perigosas entre os seus medicamentos.
          Alertas aparecem diretamente nos cartões da lista e são classificados em três níveis:
        </Text>
        <View style={styles.riskRow}>
          <View style={[styles.riskBadge, { backgroundColor: '#fff0f0', borderLeftColor: '#CC0000' }]}>
            <Text style={[styles.riskLabel, { color: '#CC0000' }]}>⚡ CRÍTICO</Text>
            <Text style={styles.riskDesc}>Combinação contraindicada. Informe imediatamente seu médico.</Text>
          </View>
        </View>
        <View style={styles.riskRow}>
          <View style={[styles.riskBadge, { backgroundColor: '#fff5f0', borderLeftColor: '#e65c00' }]}>
            <Text style={[styles.riskLabel, { color: '#e65c00' }]}>⚡ ALTO</Text>
            <Text style={styles.riskDesc}>Risco significativo. Monitoramento médico necessário.</Text>
          </View>
        </View>
        <View style={styles.riskRow}>
          <View style={[styles.riskBadge, { backgroundColor: '#fffbf0', borderLeftColor: '#b58900' }]}>
            <Text style={[styles.riskLabel, { color: '#b58900' }]}>⚡ MODERADO</Text>
            <Text style={styles.riskDesc}>Atenção recomendada. Converse com seu médico ou farmacêutico.</Text>
          </View>
        </View>
        <Text style={styles.tip}>
          💡 Use a aba Interações para ver o relatório completo com mecanismos e recomendações.
        </Text>
      </Section>

      {/* Lembretes */}
      <Section title="🔔 Lembretes de medicamentos">
        <Text style={styles.bodyText}>
          Na aba Medicamentos, toque no ícone 🔔 de qualquer medicamento para configurar
          lembretes. Você pode definir:
        </Text>
        <Bullet text="Horário(s) diários" />
        <Bullet text="Dias específicos da semana (ex.: seg, qua e sex)" />
        <Bullet text="Dias específicos do mês (ex.: dias 1 e 15)" />
        <Bullet text="Intervalo periódico (ex.: a cada 2 meses, no dia 10)" />
        <Text style={styles.tip}>
          💡 Lembretes funcionam offline. Nenhuma conexão é necessária para receber as notificações.
        </Text>
      </Section>

      {/* Privacidade */}
      <Section title="🔐 Privacidade e segurança">
        <Text style={styles.bodyText}>
          Todos os seus dados ficam armazenados <Text style={styles.bold}>exclusivamente no seu celular</Text>.
          O MedAlert não envia informações para servidores externos. A base de interações
          medicamentosas é embutida no aplicativo e funciona 100% offline.
        </Text>
        <Text style={styles.bodyText}>
          A notificação da tela de bloqueio é visível por qualquer pessoa com acesso físico ao
          aparelho — isso é intencional para situações de emergência, mas lembre-se de desativar
          o alerta se não quiser que terceiros vejam suas informações médicas.
        </Text>
      </Section>

      {/* Política de Privacidade */}
      <TouchableOpacity style={styles.privacyBtn} onPress={() => Linking.openURL(PRIVACY_URL)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.privacyBtnText}>🔐 Política de Privacidade</Text>
          <Text style={styles.privacyBtnSub}>Seus dados ficam apenas no seu celular</Text>
        </View>
        <Text style={styles.privacyArrow}>›</Text>
      </TouchableOpacity>

      {/* Dica final */}
      <View style={styles.finalCard}>
        <Text style={styles.finalTitle}>Mostre ao seu médico</Text>
        <Text style={styles.finalText}>
          Na sua próxima consulta, mostre a lista de medicamentos cadastrada e os alertas de
          interação ao seu médico. Ele pode confirmar se a lista está correta e se há riscos
          que precisam de atenção especial.
        </Text>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: '#1a3a6b',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  heroIcon: { fontSize: 40, marginBottom: 10 },
  heroTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  heroText: { fontSize: 14, color: '#ccd9f0', lineHeight: 21, marginBottom: 8, textAlign: 'center' },
  bold: { fontWeight: '700', color: '#fff' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a3a6b', marginBottom: 12 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#1a3a6b',
    alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1, flexShrink: 0,
  },
  stepNumber: { color: '#fff', fontWeight: '700', fontSize: 12 },
  stepText: { fontSize: 14, color: '#333', lineHeight: 21, flex: 1 },

  bodyText: { fontSize: 14, color: '#444', lineHeight: 21, marginBottom: 10 },
  bullet: { fontSize: 14, color: '#333', lineHeight: 22, marginLeft: 4, marginBottom: 2 },
  tip: {
    fontSize: 13, color: '#1a6b3a', backgroundColor: '#f0faf4',
    borderRadius: 8, padding: 10, marginTop: 10, lineHeight: 19,
  },

  riskRow: { marginBottom: 8 },
  riskBadge: { borderLeftWidth: 4, borderRadius: 6, padding: 10 },
  riskLabel: { fontWeight: '700', fontSize: 13, marginBottom: 2 },
  riskDesc: { fontSize: 13, color: '#555' },

  privacyBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#dde3f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  privacyBtnText: { fontSize: 15, fontWeight: '600', color: '#1a3a6b' },
  privacyBtnSub: { fontSize: 12, color: '#888', marginTop: 2 },
  privacyArrow: { fontSize: 22, color: '#bbb', lineHeight: 24 },

  finalCard: {
    backgroundColor: '#e8f4fd',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0066cc',
  },
  finalTitle: { fontSize: 15, fontWeight: '700', color: '#0066cc', marginBottom: 8 },
  finalText: { fontSize: 14, color: '#333', lineHeight: 21 },
});
