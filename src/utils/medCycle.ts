// ---------------------------------------------------------------------------
// Ritmo com pausa: cartela (21 tomando / 7 parado), adesivo (3 semanas / 1) e anel
// (21 dentro / 7 fora). Serve também a corticoide cíclico, reposição hormonal e quimio.
//
// POR QUE NÃO REUSA O cyclePhase.ts
// Os dois calculam "onde estou a partir de uma data-âncora", mas divergem no essencial: o
// cyclePhase NÃO faz módulo de propósito — deixa o dia passar do fim do ciclo para poder dizer
// "atrasado", que é informação clínica. Uma cartela precisa do oposto: dar a volta e recomeçar,
// para sempre. Acoplar os dois faria um dos lados mentir.
//
// O QUE QUEBRA EM SILÊNCIO AQUI
// O módulo de JS devolve resto NEGATIVO para dividendo negativo (-3 % 28 === -3, não 25). Sem o
// `+ total` antes do segundo módulo, qualquer data ANTERIOR à âncora — corrigir a data de início,
// editar o cadastro, cruzar fuso — inverte ativo e pausa. A pessoa tomaria na semana de descanso
// e descansaria na de tomar, e nada acusaria.
//
// Datas são normalizadas para MEIA-NOITE LOCAL antes de subtrair. Comparar timestamps crus faz o
// horário de verão virar ±1 hora, e um `Math.floor` de 23h vira um dia a menos.
// ---------------------------------------------------------------------------

export type CycleKind = 'pill' | 'patch' | 'ring' | 'custom';

export interface MedCycle {
  kind: CycleKind;
  daysOn: number;
  daysOff: number;
  anchor: string; // 'YYYY-MM-DD' — dia 1 da cartela
}

export interface MedCycleState {
  dayInCycle: number;   // 1-based, sempre dentro do ciclo (dá a volta)
  active: boolean;      // true = dia de tomar; false = pausa
  dayOfBlock: number;   // 1-based dentro do bloco atual (ativo ou pausa)
  daysUntilFlip: number;// dias até virar (entrar na pausa, ou recomeçar)
  isFirstOfCycle: boolean;
  isLastActive: boolean;// último dia tomando — véspera da pausa
  isPauseEve: boolean;  // último dia de pausa — véspera do recomeço
}

/** Meia-noite local. Aceita 'YYYY-MM-DD' e ignora qualquer hora que venha junto. */
function meiaNoite(d: string | Date): Date {
  const dt = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00`) : d;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function diasEntre(de: Date, ate: Date): number {
  // Math.round, não floor: mesmo normalizado, o horário de verão desloca a diferença em ±1h.
  return Math.round((ate.getTime() - de.getTime()) / 86400000);
}

/** Lança em configuração impossível — melhor estourar no cadastro que agendar errado por meses. */
export function validarCiclo(c: MedCycle): string | null {
  if (!Number.isInteger(c.daysOn) || c.daysOn < 1) return 'O período tomando precisa de pelo menos 1 dia.';
  if (!Number.isInteger(c.daysOff) || c.daysOff < 1) return 'A pausa precisa de pelo menos 1 dia.';
  if (c.daysOn + c.daysOff > 366) return 'O ciclo não pode passar de um ano.';
  if (isNaN(meiaNoite(c.anchor).getTime())) return 'Data de início inválida.';
  return null;
}

export function cycleState(c: MedCycle, hoje: Date = new Date()): MedCycleState {
  const total = c.daysOn + c.daysOff;
  const decorridos = diasEntre(meiaNoite(c.anchor), meiaNoite(hoje));

  // O duplo módulo é obrigatório — ver o cabeçalho.
  const pos = ((decorridos % total) + total) % total;

  const active = pos < c.daysOn;
  const dayOfBlock = active ? pos + 1 : pos - c.daysOn + 1;
  const daysUntilFlip = active ? c.daysOn - pos : total - pos;

  return {
    dayInCycle: pos + 1,
    active,
    dayOfBlock,
    daysUntilFlip,
    isFirstOfCycle: pos === 0,
    isLastActive: active && pos === c.daysOn - 1,
    isPauseEve: !active && pos === total - 1,
  };
}

/**
 * Converte "estou no dia N da cartela hoje" na data-âncora.
 * É assim que perguntamos no cadastro: escolher um dia num calendário é o campo que mais erra,
 * e quem tem a cartela na mão sabe dizer em que comprimido está.
 */
export function ancoraPorDiaAtual(diaAtual: number, hoje: Date = new Date()): string {
  const base = meiaNoite(hoje);
  base.setDate(base.getDate() - (diaAtual - 1));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Doses por ciclo — o estoque erra 25% sem isto: 21 comprimidos duram 28 dias, não 21.
 * `dosesPorDiaAtivo` vem dos horários cadastrados; para o anel a dose é única no ciclo.
 */
export function dosesPorCiclo(c: MedCycle, dosesPorDiaAtivo: number, diasDaSemanaAtivos = 7): number {
  if (c.kind === 'ring') return 1;
  if (c.kind === 'patch' || diasDaSemanaAtivos < 7) {
    // Dose semanal: quantas vezes o dia da semana cai dentro do bloco ativo.
    return Math.ceil((c.daysOn * diasDaSemanaAtivos) / 7) * dosesPorDiaAtivo;
  }
  return c.daysOn * dosesPorDiaAtivo;
}

/** Dias de calendário que o estoque cobre — conta a pausa, que não consome dose. */
export function diasDeEstoque(c: MedCycle, estoque: number, dosesPorDiaAtivo: number): number {
  const porCiclo = dosesPorCiclo(c, dosesPorDiaAtivo);
  if (porCiclo <= 0) return 0;
  const total = c.daysOn + c.daysOff;
  const ciclosInteiros = Math.floor(estoque / porCiclo);
  const resto = estoque % porCiclo;
  // O resto só rende dias ATIVOS — a pausa do último ciclo não é "cobertura".
  const diasDoResto = Math.ceil(resto / Math.max(1, dosesPorDiaAtivo));
  return ciclosInteiros * total + diasDoResto;
}
