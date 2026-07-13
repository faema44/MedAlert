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
 *   AVISO DE IA — colado na afirmação, não no topo da tela. O MedDisclaimer é recolhível e some
 *   da vista justamente quando o usuário está lendo o alerta e decidindo o que fazer.
 *
 *   INFORMAR ERRO — o usuário é a última linha de defesa e a mais valiosa. As auditorias pegam
 *   bula de composto no slug do puro e alarme falso por token de sal; não pegam "esta interação
 *   está exagerada". Foi ele quem achou o fenobarbital.
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

export default function CartaoInteracao({ item, aberto, onToggle }: Props) {
  const [reportar, setReportar] = useState(false);
  const risco = RISCO[item.risk_level] ?? RISCO.moderate;
  const fito = isPhytotherapicInteraction(item);
  const cor = fito ? '#1a6b3a' : risco.cor;
  const fundo = fito ? '#EAF4EC' : risco.fundo;
  const temFonte = !!item.source && item.source !== 'desconhecida';

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
          {!!item.mechanism && (
            <>
              <Text style={styles.caixaTitulo}>Como ocorre:</Text>
              <Text style={styles.caixaTexto}>{item.mechanism}</Text>
            </>
          )}

          <Text style={temFonte ? styles.fonteOk : styles.fonteNenhuma}>
            {temFonte
              ? `Fonte: ${item.source}`
              : 'Sem fonte verificada — não conseguimos rastrear este texto até uma bula ou publicação.'}
          </Text>

          <Text style={styles.aviso}>
            🤖 Interação apontada por <Text style={styles.bold}>IA</Text> e sujeita a erro.
            Confira na <Text style={styles.bold}>bula impressa</Text> do seu medicamento e fale
            com seu <Text style={styles.bold}>médico ou farmacêutico</Text>.
          </Text>

          <TouchableOpacity style={styles.btnErro} onPress={() => setReportar(true)} activeOpacity={0.7}>
            <Text style={styles.btnErroText}>⚑ Informar erro nesta interação</Text>
          </TouchableOpacity>
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

  fonteOk:      { fontSize: 11, color: '#5A6472', marginTop: 8, fontStyle: 'italic' },
  fonteNenhuma: { fontSize: 11, color: '#8A5A00', marginTop: 8, fontStyle: 'italic', fontWeight: '600' },

  aviso: {
    fontSize: 11, color: '#3730A3', lineHeight: 16,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.10)',
  },
  bold: { fontWeight: '700' },

  btnErro: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  btnErroText: { fontSize: 11.5, color: '#6B7280', fontWeight: '600' },
});
