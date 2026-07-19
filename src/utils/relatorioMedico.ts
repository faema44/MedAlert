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
  desde: string;
  ate: string;
  dias: number;
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
  dias = 180,
  hoje: Date = new Date(),
): RelatorioAdesao {
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);
  const ini = new Date(fim.getTime() - dias * 86400000);

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

  return {
    desde: ini.toISOString(),
    ate: fim.toISOString(),
    dias,
    // Mais doses primeiro: o de uso contínuo interessa mais que o eventual.
    medicamentos: [...porNome.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)),
  };
}

/** "24 de 28" — percentual só quando há base para ele. */
export function percentualAdesao(r: ResumoMedicamento): number | null {
  // Com sem-resposta demais o percentual vira ficção: 2 tomadas de 3 respondidas não é "67%"
  // se outras 25 doses ficaram sem resposta. Abaixo de metade respondida, não afirmamos.
  const respondidas = r.tomou + r.naoTomou;
  if (respondidas === 0 || respondidas < r.total / 2) return null;
  return Math.round((r.tomou / respondidas) * 100);
}
