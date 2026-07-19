import { MedicationLogEntry } from '../database/db';

// ---------------------------------------------------------------------------
// Resumo de adesão para levar ao médico.
//
// A REGRA QUE NÃO PODE SER QUEBRADA: o app tem TRÊS estados, e os três vão inteiros para o
// papel. "Sem resposta" não é "não tomou" — é ninguém sabe.
//
//   juntar sem-resposta com NÃO TOMOU  → a paciente parece pior do que talvez esteja, e o
//                                        médico troca uma receita que estava funcionando
//   juntar sem-resposta com TOMOU      → pior ainda: o médico conclui que o remédio não faz
//                                        efeito na dose atual e aumenta
//
// Nos dois casos a decisão clínica sai errada por causa de um arredondamento nosso. Por isso
// a terceira coluna existe mesmo quando é zero, e por isso o documento diz, em cima, que é
// registro do paciente e não medição.
// ---------------------------------------------------------------------------

export interface ResumoMedicamento {
  nome: string;
  dose: string;
  tomou: number;
  naoTomou: number;
  semResposta: number;
  total: number;
  primeiraDose: string | null;  // ISO — a mais ANTIGA no período
  ultimaDose: string | null;    // ISO — a mais RECENTE em que houve resposta
}

export interface RelatorioAdesao {
  desde: string;   // a PRIMEIRA dose que existe, quando o período é o histórico inteiro
  ate: string;
  dias: number | null;  // null = histórico inteiro
  medicamentos: ResumoMedicamento[];
}

/** Estado de UMA linha do log. Espelha o que a tela do Histórico mostra. */
function estado(e: MedicationLogEntry): 'tomou' | 'naoTomou' | 'semResposta' {
  if (e.status === 'taken' || e.taken === 1) return 'tomou';
  if (e.status === 'skipped' || e.taken === 0) return 'naoTomou';
  return 'semResposta';
}

/**
 * Agrupa o log por medicamento. `dias` é a janela (180 por padrão).
 *
 * Agrupa por NOME e não por medication_id de propósito: medicamento arquivado ou recadastrado
 * troca de id, e o histórico dele sumiria do relatório justamente quando o médico pergunta
 * "e aquele que você tomava antes?". O nome é o que a pessoa e o médico reconhecem.
 *
 * As linhas de aviso (low_stock, treatment_ended) NÃO são dose e ficam fora da conta — elas
 * existem no log para a tela do Histórico, e contá-las inflaria o total.
 */
export function montarRelatorio(
  log: MedicationLogEntry[],
  dias: number | null = null,
  hoje: Date = new Date(),
): RelatorioAdesao {
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);
  // `dias = null` é o padrão: HISTÓRICO INTEIRO. Um remédio que a pessoa tomou ano passado
  // pode ser a pista que falta para o médico que a conhece há dez minutos — e o custo de
  // incluí-lo é uma linha a mais na tabela.
  const ini = dias == null ? new Date(0) : new Date(fim.getTime() - dias * 86400000);

  const porNome = new Map<string, ResumoMedicamento>();
  for (const e of log) {
    if (e.status === 'low_stock' || e.status === 'treatment_ended') continue;
    const t = new Date(e.scheduled_at).getTime();
    if (isNaN(t) || t < ini.getTime() || t > fim.getTime()) continue;

    const nome = (e.medication_name || '').trim() || 'Sem nome';
    let r = porNome.get(nome);
    if (!r) {
      r = { nome, dose: e.dose || '', tomou: 0, naoTomou: 0, semResposta: 0, total: 0,
            primeiraDose: null, ultimaDose: null };
      porNome.set(nome, r);
    }
    r[estado(e)]++;
    r.total++;
    if (!r.dose && e.dose) r.dose = e.dose;

    // Primeira dose = a mais antiga AGENDADA no período, respondida ou não: é quando o
    // tratamento começou a ser acompanhado, e é isso que o médico quer situar no tempo.
    if (!r.primeiraDose || t < new Date(r.primeiraDose).getTime()) r.primeiraDose = e.scheduled_at;

    // Última dose = a mais recente em que a pessoa CONFIRMOU ter tomado. Usar a última
    // agendada diria "última dose ontem" para quem parou de tomar há um mês mas segue com o
    // lembrete ligado — exatamente o contrário do que aconteceu.
    if (estado(e) === 'tomou') {
      const quando = e.taken_at || e.scheduled_at;
      if (!r.ultimaDose || new Date(quando).getTime() > new Date(r.ultimaDose).getTime()) {
        r.ultimaDose = quando;
      }
    }
  }

  // Com o histórico inteiro, "desde 01/01/1970" seria absurdo no papel: o início real é a
  // primeira dose que existe.
  const primeiras = [...porNome.values()].map(r => r.primeiraDose).filter(Boolean) as string[];
  const desde = dias == null && primeiras.length
    ? primeiras.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b))
    : ini.toISOString();

  return {
    desde,
    ate: fim.toISOString(),
    dias,
    // Mais doses primeiro: o de uso contínuo interessa mais que o eventual.
    medicamentos: [...porNome.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)),
  };
}

/**
 * Adesão como FAIXA, não como número único.
 *
 * A primeira versão dividia só pelas doses respondidas, e isso mentia para cima: sinvastatina
 * com 45 tomadas e 16 sem resposta virava "100%", que o médico lê como "tomou tudo". Excluir
 * o desconhecido do denominador é, na prática, assumir que o desconhecido foi tomado.
 *
 * Dividir pelo total mentiria para baixo — assumiria que ninguém tomou nas doses sem resposta.
 *
 * A faixa não escolhe nenhuma das duas mentiras: o PISO supõe que nenhuma sem-resposta foi
 * tomada, o TETO supõe que todas foram. A verdade está entre as duas, e a LARGURA da faixa é
 * a própria mensagem — 90–94% é um dado firme; 7–100% diz "não dá para afirmar nada", que é
 * exatamente o caso da varfarina com 57 doses sem resposta.
 */
export function faixaAdesao(r: ResumoMedicamento): { piso: number; teto: number } | null {
  if (r.total <= 0) return null;
  return {
    piso: Math.round((r.tomou / r.total) * 100),
    teto: Math.round(((r.tomou + r.semResposta) / r.total) * 100),
  };
}

/** Texto pronto: "94%" quando não há dúvida, "7–100%" quando há. */
export function textoAdesao(r: ResumoMedicamento): string {
  const f = faixaAdesao(r);
  if (!f) return '—';
  return f.piso === f.teto ? `${f.piso}%` : `${f.piso}–${f.teto}%`;
}
