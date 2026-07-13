import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DrugInteraction } from '../types';
import { isPhytotherapicInteraction } from '../utils/drugSearch';
import ReportarErroModal from './ReportarErroModal';

/**
 * O cartão de interação, UM só.
 *
 * Ele estava desenhado TRÊS vezes — InteractionsScreen, MedicationsScreen e HomeScreen — e as
 * três cópias já tinham divergido: a da Home nem mostrava o mecanismo, e nenhuma das duas de
 * modal recebeu a fonte, o aviso de IA nem o botão de informar erro. Quem mexe num cartão não
 * lembra dos outros dois: é assim que a tela mente sobre o que o app sabe.
 *
 * O que ele mostra, e por quê:
 *
 *   FONTE — 210 das 2768 entradas (8%) não têm procedência, e carregam 52 dos alertas críticos.
 *   O app precisa DIZER isso em vez de apresentar tudo com a mesma autoridade. "Sem fonte" não
 *   é o mesmo que "errado": Metformina × Contraste Iodado está entre elas e é clássica — é que
 *   não temos o que citar, e aí quem confere é o usuário.
 *
 *   INFORMAR ERRO — o usuário é a última linha de defesa e a mais valiosa. As auditorias pegam
 *   bula de composto no slug do puro e alarme falso por token de sal; não pegam "esta interação
 *   está exagerada". Foi ele quem achou o fenobarbital.
 *
 * O QUE ELE NÃO REPETE
 * O rodapé chegou a trazer o aviso de IA por extenso ("feito por IA, confirme com a bula e com
 * seu médico") — três centímetros abaixo do MedDisclaimer, que diz exatamente isso. O usuário
 * lia a mesma frase duas vezes e ficava procurando a diferença, gastando a atenção que o alerta
 * precisa. O que faltava era uma ÂNCORA no ponto da decisão, não um segundo parágrafo: sobrou
 * uma linha curta com a FONTE (que o disclaimer não dá) e o botão de erro.
 */

const RISCO = {
  critical: { label: 'Crítico',  cor: '#CC3322', fundo: '#FEE9E9' },
  high:     { label: 'Alto',     cor: '#D07020', fundo: '#FFF3E0' },
  moderate: { label: 'Moderado', cor: '#886600', fundo: '#FFF8E0' },
};

type Props = {
  item: DrugInteraction;
  /** Modal de detalhe abre tudo; a lista do catálogo abre ao toque. */
  aberto: boolean;
  onToggle?: () => void;
};

// O mecanismo de várias entradas REPETE o resumo: risk_description = "Hemorragia grave" e
// mechanism = "Hemorragia grave. Conduta: Evitar." Mostrar os dois inteiros faz o usuário ler
// a mesma frase duas vezes e procurar a diferença — o que gasta a atenção que o alerta precisa.
// Aqui o prefixo repetido é cortado e sobra só o que ACRESCENTA ("Conduta: Evitar").
const enxuto = (s?: string) => (s ?? '').toLowerCase().replace(/[\s.;:,·-]+$/, '').trim();

function mecanismoUtil(resumo: string, mecanismo?: string): string | null {
  const m = (mecanismo ?? '').trim();
  if (!m) return null;
  const r = enxuto(resumo);
  let sobra = m;
  if (r && enxuto(m).startsWith(r)) sobra = m.slice(resumo.trim().length).replace(/^[\s.;:,·-]+/, '');
  return sobra.length >= 12 ? sobra : null;   // abaixo disso é só pontuação: não vale uma seção
}

export default function CartaoInteracao({ item, aberto, onToggle }: Props) {
  const [reportar, setReportar] = useState(false);
  const risco = RISCO[item.risk_level] ?? RISCO.moderate;
  const fito = isPhytotherapicInteraction(item);
  const cor = fito ? '#1a6b3a' : risco.cor;
  const fundo = fito ? '#EAF4EC' : risco.fundo;
  const temFonte = !!item.source && item.source !== 'desconhecida';
  const mecanismo = mecanismoUtil(item.risk_description, item.mechanism);

  const Wrapper: any = onToggle ? TouchableOpacity : View;

  return (
    <Wrapper
      style={[styles.card, { borderLeftColor: cor }]}
      {...(onToggle ? { onPress: onToggle, activeOpacity: 0.8 } : {})}
    >
      <View style={styles.topo}>
        <View style={[styles.badge, { backgroundColor: fundo }]}>
          <Text style={[styles.badgeText, { color: cor }]}>{risco.label}</Text>
        </View>
        <View style={styles.topoDir}>
          <Text style={styles.tipo}>{fito ? '🌿 Fito.' : '💊'}</Text>
          {onToggle && <Text style={styles.chevron}>{aberto ? '▲' : '▼'}</Text>}
        </View>
      </View>

      <Text style={styles.par}>
        <Text style={styles.nome}>{item.drug1}</Text>
        <Text style={[styles.mais, { color: cor }]}>{' + '}</Text>
        <Text style={styles.nome}>{item.drug2}</Text>
      </Text>

      <Text style={styles.resumo}>{item.risk_description}</Text>

      {aberto && (
        <View style={[styles.caixa, { backgroundColor: fundo }]}>
          {!!mecanismo && (
            <>
              <Text style={styles.caixaTitulo}>Como ocorre:</Text>
              <Text style={styles.caixaTexto}>{mecanismo}</Text>
            </>
          )}

          {/* O rodapé diz o que o MedDisclaimer do topo NÃO diz: DE ONDE veio este alerta.
              Antes ele repetia o disclaimer inteiro ("feito por IA, confirme com a bula e com
              seu médico") três centímetros abaixo do próprio disclaimer — o usuário lia a
              mesma frase duas vezes. O que faltava era uma ÂNCORA no ponto da decisão, não um
              segundo parágrafo. */}
          <View style={styles.rodape}>
            <Text style={temFonte ? styles.fonteOk : styles.fonteNenhuma}>
              {temFonte ? `Fonte: ${item.source} · apontado por IA` : 'Sem fonte verificada · apontado por IA'}
            </Text>
            <TouchableOpacity style={styles.btnErro} onPress={() => setReportar(true)} activeOpacity={0.7}>
              <Text style={styles.btnErroText}>⚑ Informar erro</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ReportarErroModal
        visible={reportar}
        tipo="interacao"
        alvo={`${item.id} · ${item.drug1} × ${item.drug2}`}
        titulo={`${item.drug1} + ${item.drug2}`}
        onClose={() => setReportar(false)}
      />
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 8,
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topoDir: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  tipo: { fontSize: 12, color: '#6B7280' },
  chevron: { fontSize: 10, color: '#9CA3AF' },

  par: { fontSize: 14.5, marginTop: 8, lineHeight: 20 },
  nome: { fontWeight: '600', color: '#1A1F2E' },
  mais: { fontWeight: '700' },
  resumo: { fontSize: 12, color: '#6B7280', fontStyle: 'italic', marginTop: 2 },

  caixa: { borderRadius: 8, padding: 10, marginTop: 10 },
  caixaTitulo: { fontSize: 11, fontWeight: '700', color: '#444', marginBottom: 4 },
  caixaTexto: { fontSize: 12, color: '#333', lineHeight: 18 },

  rodape: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.10)',
  },
  fonteOk:      { flex: 1, fontSize: 11, color: '#5A6472', fontStyle: 'italic' },
  fonteNenhuma: { flex: 1, fontSize: 11, color: '#8A5A00', fontStyle: 'italic', fontWeight: '600' },
  bold: { fontWeight: '700' },

  btnErro: {
    paddingVertical: 5, paddingHorizontal: 9,
    borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  btnErroText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
});
