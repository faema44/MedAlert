// ---------------------------------------------------------------------------
// O que o widget da tela inicial mostra.
//
// O widget roda FORA do JS: ele é desenhado pelo launcher, num processo que não tem acesso ao
// nosso código. Então o app não "manda desenhar" — ele DEIXA ESCRITO o que deve aparecer, e o
// Kotlin lê. Este arquivo monta esse recado.
//
// Consequência que governa o desenho: o que estiver escrito aqui pode ficar na tela por horas
// depois de calculado. Por isso a linha guarda o INSTANTE (ms), e não um texto pronto tipo
// "em 2 horas" — o Kotlin recalcula na hora de desenhar. Texto pronto envelheceria e mentiria.
// ---------------------------------------------------------------------------

export interface LinhaWidget {
  nome: string;
  dose: string;
  quandoMs: number;   // instante da dose; o Kotlin formata na hora de desenhar
  critico: boolean;
}

export interface EstoqueBaixoWidget {
  nome: string;
  dias: number;
}

export interface DadosWidget {
  geradoEm: number;
  proximas: LinhaWidget[];     // já em ordem; o tamanho do widget decide quantas usa
  estoqueBaixo: EstoqueBaixoWidget[];
}

// 3 é o que o widget grande mostra. Guardar mais seria escrever dado que ninguém lê; guardar
// menos obrigaria a regravar quando a pessoa aumenta o widget.
export const MAX_PROXIMAS = 3;
// Estoque baixo só aparece no widget grande, e mais de 3 linhas não caberia.
export const MAX_ESTOQUE = 3;
// O mesmo piso do aviso de estoque do app — dois números diferentes para a mesma ideia
// confundiriam quem vê os dois.
export const DIAS_ESTOQUE_BAIXO = 3;

export interface ItemParaWidget {
  nome: string;
  dose?: string | null;
  quandoMs: number | null;
  critico?: boolean;
  diasDeEstoque?: number | null;
}

/**
 * Monta o recado a partir do que a Home já calculou.
 *
 * Não recalcula nada: a Home já resolve ciclo, pausa e estoque (ver proximaDoseComCiclo e
 * diasDeEstoque). Duas contas para a mesma pergunta divergiriam, e a que aparece no widget é
 * a que ninguém confere.
 */
export function montarDadosWidget(itens: ItemParaWidget[], agora = Date.now()): DadosWidget {
  const proximas = itens
    .filter(i => i.quandoMs != null && i.quandoMs >= agora)
    .sort((a, b) => (a.quandoMs as number) - (b.quandoMs as number))
    .slice(0, MAX_PROXIMAS)
    .map(i => ({
      nome: i.nome,
      dose: (i.dose ?? '').trim(),
      quandoMs: i.quandoMs as number,
      critico: !!i.critico,
    }));

  const estoqueBaixo = itens
    .filter(i => i.diasDeEstoque != null && (i.diasDeEstoque as number) <= DIAS_ESTOQUE_BAIXO)
    // Menos dias primeiro: quem acaba amanhã importa mais que quem acaba em três dias.
    .sort((a, b) => (a.diasDeEstoque as number) - (b.diasDeEstoque as number))
    .slice(0, MAX_ESTOQUE)
    .map(i => ({ nome: i.nome, dias: Math.max(0, i.diasDeEstoque as number) }));

  // Dedup por nome no estoque: um remédio com 3 horários apareceria 3 vezes na mesma lista.
  const vistos = new Set<string>();
  const estoqueUnico = estoqueBaixo.filter(e => {
    if (vistos.has(e.nome)) return false;
    vistos.add(e.nome);
    return true;
  });

  return { geradoEm: agora, proximas, estoqueBaixo: estoqueUnico };
}
