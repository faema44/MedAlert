import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';

const PRIVACY_URL = 'https://alertamedico.ia.br/privacy.html';
const CARDIODF_URL = 'https://www.youtube.com/watch?v=lPaP_QgjEW4';

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
        <Text style={styles.heroTitle}>Para que serve o Alerta Médico?</Text>

        <View style={styles.heroFeatures}>
          <View style={styles.heroFeatureRow}>
            <Text style={styles.heroFeatureIcon}>🔒</Text>
            <Text style={styles.heroFeatureText}>Exibe seus medicamentos e condição de saúde na tela de bloqueio para socorristas</Text>
          </View>
          <View style={styles.heroFeatureRow}>
            <Text style={styles.heroFeatureIcon}>⚡</Text>
            <Text style={styles.heroFeatureText}>Detecta interações perigosas entre seus medicamentos</Text>
          </View>
          <View style={styles.heroFeatureRow}>
            <Text style={styles.heroFeatureIcon}>🔔</Text>
            <Text style={styles.heroFeatureText}>Envia lembretes para você não esquecer de tomar seus remédios</Text>
          </View>
        </View>

        <View style={styles.heroDivider} />

        <Text style={styles.heroText}>
          Em caso de acidente ou emergência médica, os socorristas precisam saber rapidamente
          quais medicamentos você toma antes de aplicar qualquer tratamento — certos remédios
          podem interagir perigosamente com anestesias, contrastes e procedimentos de urgência.
        </Text>
        <Text style={styles.heroText}>
          O Alerta Médico mantém essas informações visíveis na tela de bloqueio do celular,
          acessíveis sem precisar desbloqueá-lo, mesmo que você esteja inconsciente.
        </Text>
      </View>

      {/* Como usar */}
      <Section title="Como usar — passo a passo">
        <Step number="1" text="Abra a aba Perfil e preencha seu nome, tipo sanguíneo e alergias." />
        <Step number="2" text="Cadastre todos os medicamentos que você usa regularmente na aba Medicamentos. Marque como 'crítico' os que não podem ser interrompidos." />
        <Step number="3" text="Adicione ao menos um contato de emergência na aba Contatos (familiar ou médico de referência)." />
        <Step number="4" text="Na tela Início, toque em 'Ícone na Tela de Bloqueio (Emergência)' para ativar. Sua ficha médica ficará visível na notificação persistente imediatamente." />
        <Text style={styles.tip}>
          💡 Após configurar lembretes, a tela Início exibe um card "Próximos lembretes" com o horário mais próximo de cada medicamento (ex.: Zyloric hoje às 14:00 · Glifage amanhã às 08:00). Toque no card para ir à lista de medicamentos.
        </Text>
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
        <Bullet text="Contatos de emergência" />
        <Bullet text="Próximo lembrete do dia (ex.: 🔔 Zyloric hoje às 14:00)" />
        <Text style={styles.tip}>
          💡 Nenhum desbloqueio é necessário. O socorrista vê tudo na própria tela de bloqueio.
        </Text>
      </Section>

      {/* Configurar tela de bloqueio */}
      <Section title="⚙️ Como liberar a notificação na tela de bloqueio">
        <Text style={styles.bodyText}>
          Para que o conteúdo da notificação apareça na tela de bloqueio (e não apenas um ícone),
          é necessário ajustar as configurações do Android:
        </Text>
        <Step number="1" text='Abra as Configurações do celular' />
        <Step number="2" text='Vá em Notificações (ou Aplicativos → Alerta Médico → Notificações)' />
        <Step number="3" text='Em Tela de Bloqueio, selecione "Mostrar todo o conteúdo"' />
        <Step number="4" text='Confirme que as notificações do Alerta Médico estão ativadas' />
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
          💡 Use a aba Interações para ver o relatório completo com mecanismos e recomendações. As abas Medicamentos e Contatos exibem um número em vermelho quando há itens cadastrados.
        </Text>
      </Section>

      {/* Vídeo educativo */}
      <TouchableOpacity style={styles.videoCard} onPress={() => Linking.openURL(CARDIODF_URL)}>
        <View style={styles.videoThumb}>
          <Text style={styles.videoPlay}>▶</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.videoTitle}>Por que as interações medicamentosas são perigosas?</Text>
          <Text style={styles.videoSub}>@CardioDF — Cardiologia e Saúde • YouTube</Text>
        </View>
        <Text style={styles.privacyArrow}>›</Text>
      </TouchableOpacity>

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

      {/* Bateria Samsung */}
      <Section title="🔋 Lembretes não tocam? Veja como corrigir">
        <Text style={styles.bodyText}>
          Samsung e outros fabricantes bloqueiam alarmes de apps em segundo plano por padrão.
          Para os lembretes funcionarem mesmo com o celular na tela de bloqueio:
        </Text>
        <Step number="1" text="Configurações → Apps → Alerta Médico → Bateria" />
        <Step number="2" text='Selecione "Sem restrições" (em vez de "Otimizada")' />
        <TouchableOpacity style={styles.settingsBtn} onPress={() => Linking.openSettings()}>
          <Text style={styles.settingsBtnText}>⚙️  Abrir configurações do Alerta Médico</Text>
        </TouchableOpacity>
        <Text style={styles.tip}>
          💡 Em Samsung: Configurações → Bateria → Limites de uso em segundo plano → adicione Alerta Médico em "Apps que nunca adormecem".
        </Text>
      </Section>

      {/* Privacidade */}
      <Section title="🔐 Privacidade e segurança (LGPD)">
        <Text style={styles.bodyText}>
          Seus dados de saúde (nome, tipo sanguíneo, medicamentos, contatos) ficam armazenados exclusivamente no seu celular. A Lei Geral de Proteção de Dados (Lei 13.709/2018) classifica dados de saúde como dados sensíveis — e o Alerta Médico respeita essa exigência.
        </Text>
        <Text style={styles.bodyText}>
          A única exceção é o recurso opcional "Reportar medicamento em falta": ao usá-lo, o
          nome do medicamento é enviado anonimamente — sem qualquer dado pessoal.
        </Text>
        <Text style={styles.bodyText}>
          A notificação da tela de bloqueio é visível por qualquer pessoa com acesso físico ao
          aparelho — isso é intencional para emergências. Desative o alerta se não quiser que
          terceiros vejam suas informações médicas.
        </Text>
      </Section>

      {/* Avisos e limitações */}
      <Section title="⚠️ Avisos e limitações importantes">

        <Text style={styles.warningLabel}>Desenvolvido com inteligência artificial</Text>
        <Text style={styles.bodyText}>
          Este aplicativo foi criado com o auxílio de inteligência artificial e pode conter
          erros, imprecisões ou omissões. Verifique sempre as informações com seu médico ou
          farmacêutico antes de tomar qualquer decisão sobre seus medicamentos.
        </Text>

        <Text style={styles.warningLabel}>Não substitui profissional de saúde</Text>
        <Text style={styles.bodyText}>
          As informações sobre interações medicamentosas têm caráter exclusivamente educativo e informativo. Elas não constituem diagnóstico, prescrição ou aconselhamento médico ou farmacêutico. Nos termos da Lei 12.842/2013 e das resoluções do CFM e CFF, apenas profissionais habilitados podem avaliar interações clinicamente. Consulte sempre seu médico.
        </Text>

        <Text style={styles.warningLabel}>Base de medicamentos e interações</Text>
        <Text style={styles.bodyText}>
          A base de dados pode estar incompleta ou desatualizada. Para informações oficiais
          sobre medicamentos registrados no Brasil, consulte o{' '}
          <Text style={styles.bold}>Bulário Eletrônico da ANVISA</Text> (bulario.anvisa.gov.br).
        </Text>

        <Text style={styles.warningLabel}>Funcionamento depende do seu celular</Text>
        <Text style={styles.bodyText}>
          A exibição na tela de bloqueio, os lembretes e as notificações dependem das
          configurações do seu dispositivo. O comportamento pode variar conforme o fabricante,
          modelo e versão do Android. O Alerta Médico não garante funcionamento idêntico em todos
          os aparelhos.
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
  heroFeatures: { alignSelf: 'stretch', marginBottom: 4 },
  heroFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  heroFeatureIcon: { fontSize: 18, marginRight: 10, marginTop: 1 },
  heroFeatureText: { fontSize: 14, color: '#fff', lineHeight: 20, flex: 1 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', marginVertical: 14 },

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

  videoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    borderWidth: 1,
    borderColor: '#ffd0d0',
  },
  videoThumb: {
    width: 52, height: 38, borderRadius: 6, backgroundColor: '#FF0000',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  videoPlay: { color: '#fff', fontSize: 18 },
  videoTitle: { fontSize: 13, fontWeight: '600', color: '#1a3a6b', marginBottom: 4, lineHeight: 18 },
  videoSub: { fontSize: 11, color: '#888' },

  settingsBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 8, paddingVertical: 11,
    alignItems: 'center', marginTop: 10, marginBottom: 4,
  },
  settingsBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  warningLabel: { fontSize: 13, fontWeight: '700', color: '#b05800', marginBottom: 4, marginTop: 8 },

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
