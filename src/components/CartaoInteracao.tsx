import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DrugInteraction } from '../types';
import { isPhytotherapicInteraction, bulaUrlDoSlug, InteracaoDoUsuario } from '../utils/drugSearch';
import { useBulaViewer } from '../utils/useBulaViewer';
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
  /** No catálogo (Tabelas) vem sem meu1/meu2: ali não há "os remédios do usuário". */
  item: InteracaoDoUsuario;
  /** Modal de detalhe abre tudo; a lista do catálogo abre ao toque. */
  aberto: boolean;
  onToggle?: () => void;
};

// 13% das entradas têm um RÓTULO DE CLASSE de um lado ("Captopril / Enalapril (IECA)"). O cartão
// imprimia esse rótulo cru, e quem tomava só enalapril lia "Captopril" e ia procurar na caixa um
// remédio que nunca tomou. O alerta estava certo e o app parecia errado — que é o pior dos casos,
// porque queima a confiança nos alertas que importam. Agora o título é o nome DO USUÁRIO, e o
// rótulo da classe desce para uma linha que explica POR QUE aquilo disparou.
const igual = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// A fonte pode ser a bula de OUTRO medicamento: a interação IECA × AAS está documentada na bula
// do captopril, e é dali que o alerta do enalapril vem; a de AAS × álcool veio de uma bula de
// AAS + cafeína + paracetamol. As duas são fontes legítimas, mas tem que ser DITO — senão o
// usuário toca em "Fonte" e cai numa bula que não é a dele. E o aviso não pode dizer "mesma
// classe": um composto não é a classe do ingrediente puro. "Outro medicamento" é o que é
// verdade nos dois casos.
function fonteEhDoUsuario(item: InteracaoDoUsuario): boolean {
  const ref = item.source_ref?.trim().toLowerCase();
  if (!ref) return true;   // sem source_ref não há surpresa a avisar
  return [item.meu1, item.meu2].some(meu => {
    const m = meu?.trim().toLowerCase();
    return !!m && (m.includes(ref) || ref.includes(m));
  });
}

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

// "Fonte: ANVISA" não diz nada: ANVISA é a AGÊNCIA. O documento é a BULA DA VARFARINA — e é
// ela que o usuário precisa poder abrir e conferir. source_ref guarda o fármaco cuja bula cita
// o outro; source_bula guarda o slug, que aponta para o PDF no nosso servidor.
function textoDaFonte(item: DrugInteraction): string {
  const ref = item.source_ref;
  switch (item.source) {
    // "bula de X" e não "bula da X": o nome pode ser masculino (Captopril) ou feminino
    // (Varfarina), e o app não tem como saber — "de" serve para os dois.
    case 'ANVISA':  return ref ? `Fonte: bula de ${ref} (ANVISA)` : 'Fonte: bula da ANVISA';
    case 'FDA':     return ref ? `Fonte: bula do FDA — ${ref}` : 'Fonte: bulas do FDA';
    // O Poison Control publica ORIENTAÇÃO AO PÚBLICO, não bula. Dizer "bula" aqui prometeria
    // um documento regulatório e entregaria um artigo — as outras fontes criam essa expectativa.
    case 'poison.org': return ref ? `Fonte: Poison Control — ${ref}` : 'Fonte: Poison Control';
    case undefined:
    case 'desconhecida': return 'Sem fonte verificada';
    default:        return `Fonte: ${item.source}`;
  }
}

export default function CartaoInteracao({ item, aberto, onToggle }: Props) {
  const [reportar, setReportar] = useState(false);
  const { openBula, modal: bulaModal } = useBulaViewer();
  const risco = RISCO[item.risk_level] ?? RISCO.moderate;
  const fito = isPhytotherapicInteraction(item);
  const cor = fito ? '#1a6b3a' : risco.cor;
  const fundo = fito ? '#EAF4EC' : risco.fundo;
  const temFonte = !!item.source && item.source !== 'desconhecida';
  const mecanismo = mecanismoUtil(item.risk_description, item.mechanism);

  // O que o usuário TOMA vai no título; o rótulo da base explica a regra logo abaixo.
  const nome1 = item.meu1 ?? item.drug1;
  const nome2 = item.meu2 ?? item.drug2;
  const daBase = (!igual(nome1, item.drug1) || !igual(nome2, item.drug2))
    ? `${item.drug1} + ${item.drug2}`
    : null;
  const fonteDeOutro = !!item.source_bula && !fonteEhDoUsuario(item);

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
        <Text style={styles.nome}>{nome1}</Text>
        <Text style={[styles.mais, { color: cor }]}>{' + '}</Text>
        <Text style={styles.nome}>{nome2}</Text>
      </Text>

      {!!daBase && <Text style={styles.daBase}>Alerta da classe: {daBase}</Text>}

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
            {item.source_bula ? (
              <TouchableOpacity
                style={styles.fonteBox}
                onPress={() => openBula(bulaUrlDoSlug(item.source_bula!), item.source_ref ?? '')}
                activeOpacity={0.6}
              >
                <Text style={styles.fonteLink}>{textoDaFonte(item)} ›</Text>
                <Text style={styles.porIA}>
                  {fonteDeOutro ? 'a bula é de outro medicamento · apontado por IA' : 'apontado por IA'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.fonteBox}>
                <Text style={temFonte ? styles.fonteOk : styles.fonteNenhuma}>{textoDaFonte(item)}</Text>
                <Text style={styles.porIA}>apontado por IA</Text>
              </View>
            )}
            <TouchableOpacity style={styles.btnErro} onPress={() => setReportar(true)} activeOpacity={0.7}>
              <Text style={styles.btnErroText}>⚑ Informar erro</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {bulaModal}

      <ReportarErroModal
        visible={reportar}
        tipo="interacao"
        alvo={`${item.id} · ${item.drug1} × ${item.drug2}`}
        titulo={`${nome1} + ${nome2}`}
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
  daBase: { fontSize: 11, color: '#9CA3AF', marginTop: 2, lineHeight: 15 },
  resumo: { fontSize: 12, color: '#6B7280', fontStyle: 'italic', marginTop: 2 },

  caixa: { borderRadius: 8, padding: 10, marginTop: 10 },
  caixaTitulo: { fontSize: 11, fontWeight: '700', color: '#444', marginBottom: 4 },
  caixaTexto: { fontSize: 12, color: '#333', lineHeight: 18 },

  rodape: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.10)',
  },
  fonteBox:     { flex: 1 },
  fonteOk:      { fontSize: 11, color: '#5A6472', fontStyle: 'italic' },
  fonteNenhuma: { fontSize: 11, color: '#8A5A00', fontStyle: 'italic', fontWeight: '600' },
  fonteLink:    { fontSize: 11, color: '#1C3F7A', fontWeight: '600' },
  porIA:        { fontSize: 10.5, color: '#9CA3AF', marginTop: 1 },
  bold: { fontWeight: '700' },

  btnErro: {
    paddingVertical: 5, paddingHorizontal: 9,
    borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  btnErroText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
});
