import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';

const PRIVACY_URL = 'https://alertamedico.ia.br/privacy.html';
const CARDIODF_URL = 'https://www.youtube.com/watch?v=lPaP_QgjEW4';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionArrow}>{open ? '▼' : '›'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.sectionContent}>{children}</View>}
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
            <Text style={styles.heroFeatureText}>Lembretes com melodias distintas para remédios, atividades e consultas</Text>
          </View>
          <View style={styles.heroFeatureRow}>
            <Text style={styles.heroFeatureIcon}>📅</Text>
            <Text style={styles.heroFeatureText}>Agenda de atividades físicas e consultas médicas com lembretes automáticos</Text>
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
        <Step number="1" text="Abra a aba Emergência e complete os 3 passos: Perfil Médico (nome, tipo sanguíneo, alergias), Contato de emergência e Ativar alerta." />
        <Step number="2" text="Cadastre os medicamentos que você usa na aba Medicamentos, tocando em +. O assistente pergunta nome, dose, horários, prazo e estoque — um passo de cada vez." />
        <Step number="3" text="Use a aba Atividades para registrar atividades físicas, medições (pressão, glicose, peso) e consultas médicas — lembretes são criados automaticamente." />
        <Step number="4" text="Acompanhe na aba Histórico as doses que você tomou ou pulou e as atividades realizadas." />
        <Step number="5" text="Com o alerta ativo, sua ficha médica fica visível na tela de bloqueio imediatamente — sem precisar desbloquear o celular." />
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
            <Text style={[styles.riskLabel, { color: '#CC0000' }]}>⚡ Crítico</Text>
            <Text style={styles.riskDesc}>Combinação contraindicada. Informe imediatamente seu médico.</Text>
          </View>
        </View>
        <View style={styles.riskRow}>
          <View style={[styles.riskBadge, { backgroundColor: '#fff5f0', borderLeftColor: '#e65c00' }]}>
            <Text style={[styles.riskLabel, { color: '#e65c00' }]}>⚡ Alto</Text>
            <Text style={styles.riskDesc}>Risco significativo. Monitoramento médico necessário.</Text>
          </View>
        </View>
        <View style={styles.riskRow}>
          <View style={[styles.riskBadge, { backgroundColor: '#fffbf0', borderLeftColor: '#b58900' }]}>
            <Text style={[styles.riskLabel, { color: '#b58900' }]}>⚡ Moderado</Text>
            <Text style={styles.riskDesc}>Atenção recomendada. Converse com seu médico ou farmacêutico.</Text>
          </View>
        </View>
        <Text style={styles.tip}>
          💡 Toque no ícone 📋 no topo de qualquer tela para abrir as Tabelas — todas as interações da base (mais de 900), com busca e filtros por risco, além das listas completas de medicamentos e fitoterápicos.
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
          Os lembretes são definidos ao cadastrar o medicamento. Para alterá-los depois,
          toque no cartão do medicamento na aba Medicamentos. Você pode definir:
        </Text>
        <Bullet text="Horário(s) diários — inclusive pelos horários das suas refeições" />
        <Bullet text="Dias específicos da semana (ex.: seg, qua e sex)" />
        <Bullet text="Dias específicos do mês (ex.: dias 1 e 15)" />
        <Bullet text="Intervalo livre (ex.: a cada 2 meses, no dia 10)" />
        <Bullet text="Repetição do alarme a cada 5 min até confirmar Tomei / Não tomei" />
        <Bullet text="Prazo do tratamento e controle de estoque com aviso de reposição" />
        <Text style={styles.tip}>
          💡 O ícone 🔔 / 🔕 no cartão do medicamento silencia ou reativa o som do lembrete sem apagá-lo. Lembretes funcionam offline — nenhuma conexão é necessária.
        </Text>
      </Section>

      {/* Sons diferenciados */}
      <Section title="🎵 Sons diferenciados por tipo">
        <Text style={styles.bodyText}>
          Cada tipo de lembrete toca uma melodia diferente para você identificar o aviso antes mesmo de olhar para o celular:
        </Text>
        <Bullet text="💊 Remédios — três notas ascendentes (ding-ding-ding), mais urgentes" />
        <Bullet text="🏃 Atividades — dois tons suaves e crescentes" />
        <Bullet text="🩺 Consultas — dois tons descendentes e calmos" />
        <Text style={styles.tip}>
          💡 Na tela Início, toque em 🔔 / 🔕 ao lado de qualquer item para silenciar ou reativar o som daquele lembrete individualmente.
        </Text>
      </Section>

      {/* Agenda */}
      <Section title="📅 Atividades e Consultas">
        <Text style={styles.bodyText}>
          A aba Atividades permite registrar compromissos de saúde:
        </Text>
        <Bullet text="Atividades de rotina — caminhada, fisioterapia, tomar água e outras com lembretes diários" />
        <Bullet text="Medições de saúde — pressão arterial (❤️), glicose (🩸) e peso/IMC (⚖️) com histórico e faixas de referência coloridas" />
        <Bullet text="Consultas — médico, dentista, exames, com lembretes automáticos 1 dia e 1 hora antes" />
        <Text style={styles.bodyText}>
          Para registrar uma medição (pressão, glicose ou peso), toque no cartão da atividade na lista —
          o ícone de lápis ✏️ serve para editar nome e horários. O app calcula o IMC automaticamente ao pesar.
        </Text>
        <Text style={styles.tip}>
          💡 Consultas passadas não aparecem nos lembretes — apenas futuras são exibidas.
        </Text>
      </Section>

      {/* Busca de medicamentos */}
      <Section title="🔍 Busca e bula de medicamentos">
        <Text style={styles.bodyText}>
          Ao cadastrar um medicamento, o app sugere nomes automaticamente conforme você digita,
          buscando na base da ANVISA. Toque em uma sugestão para preencher o nome correto.
        </Text>
        <Text style={styles.bodyText}>
          Nos cartões de medicamento, toque no ícone 📋 para abrir a bula oficial
          — sem sair do aplicativo.
        </Text>
        <Text style={styles.tip}>
          💡 A busca funciona por nome genérico e comercial. Se um medicamento não aparecer,
          verifique a grafia ou consulte o Bulário em bulario.anvisa.gov.br.
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

      {/* Backup */}
      <Section title="💾 Backup dos seus dados">
        <Text style={styles.bodyText}>
          Seus dados são protegidos de duas formas:
        </Text>
        <Bullet text="Automático — com o backup do Android ativo (Configurações → Google → Backup), uma cópia criptografada vai para sua conta Google e é restaurada sozinha ao trocar de celular ou reinstalar o app" />
        <Bullet text="Manual — em Emergência → Perfil Médico → Backup de Dados, salve um arquivo no celular (ex.: pasta Downloads) ou compartilhe por WhatsApp/e-mail, e restaure quando precisar" />
        <Text style={styles.tip}>
          💡 O backup automático depende do backup do Google estar ativado no aparelho. O arquivo manual é uma garantia extra — guarde-o fora do celular.
        </Text>
      </Section>

      {/* Privacidade */}
      <Section title="🔐 Privacidade e segurança (LGPD)">
        <Text style={styles.bodyText}>
          Seus dados de saúde (nome, tipo sanguíneo, medicamentos, contatos) ficam armazenados no seu celular. A Lei Geral de Proteção de Dados (Lei 13.709/2018) classifica dados de saúde como dados sensíveis — e o Alerta Médico respeita essa exigência.
        </Text>
        <Text style={styles.bodyText}>
          Se o backup do Android estiver ativo na sua conta Google (Configurações → Google → Backup), uma cópia criptografada dos dados do app é guardada no Google Drive e restaurada automaticamente ao reinstalar o app ou trocar de celular com a mesma conta.
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
          <Text style={styles.privacyBtnSub}>Como tratamos seus dados de saúde</Text>
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
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 16, paddingBottom: 40 },

  hero: {
    backgroundColor: '#1C3F7A',
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1C3F7A', flex: 1 },
  sectionArrow: { fontSize: 20, color: '#1C3F7A', fontWeight: '600', paddingLeft: 8, lineHeight: 24 },
  sectionContent: { marginTop: 12 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#1C3F7A',
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
  privacyBtnText: { fontSize: 15, fontWeight: '600', color: '#1C3F7A' },
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
  videoTitle: { fontSize: 13, fontWeight: '600', color: '#1C3F7A', marginBottom: 4, lineHeight: 18 },
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
