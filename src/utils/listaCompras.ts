// ---------------------------------------------------------------------------
// A lista de compras.
//
// Uma coisa distingue esta tela de todas as outras: ela produz um PAPEL que SAI do aplicativo,
// com nomes e doses de medicamentos, e vai parar na mão de terceiros — balconista de farmácia,
// filho, médico. Isso governa duas decisões que não são de estilo:
//
//   1. TODA saída diz, sem rodeio, que é lembrete de compra do próprio paciente e NÃO é receita.
//      Um documento limpo, com data e logo, listando medicamentos, é lido como prescrição por
//      quem está do outro lado do balcão. O aviso não é juridiquês — é o que impede o mal-
//      entendido.
//   2. O saldo vai junto porque é o que o leitor precisa para decidir ("tenho 8" muda o quanto
//      comprar), mas ele é o que a PESSOA digitou, não uma contagem. A tela não promete exatidão
//      que não tem.
// ---------------------------------------------------------------------------

export interface ItemCompra {
  id: number;
  nome: string;
  dose: string;
  estoque: number | null;       // o que a pessoa disse ter em casa; null = não controla
  diasRestantes: number | null; // null = sem controle de estoque, ou sem lembrete para dividir
  dosesPorDia: number;          // 0 = sem lembrete ativo
  suspenso: boolean;
}

// Vem MARCADO quem acaba em uma semana. Deliberadamente mais largo que os 3 dias do aviso de
// estoque (widgetDados.DIAS_ESTOQUE_BAIXO): lá o número responde "corro risco de ficar sem?",
// aqui responde "preciso ir à farmácia?" — e ir à farmácia leva dias, não horas. Marcar só aos
// 3 dias faria a lista chegar tarde.
export const DIAS_PARA_REPOR = 7;

// Quanto a sugestão de quantidade cobre. É palpite editável, não recomendação: 30 dias é o
// intervalo usual de receita de uso contínuo no Brasil.
export const DIAS_SUGERIDOS = 30;

export function precisaRepor(i: ItemCompra): boolean {
  return !i.suspenso && i.diasRestantes != null && i.diasRestantes <= DIAS_PARA_REPOR;
}

/**
 * Quanto sugerir ao marcar o item. null quando não há como saber — e aí o campo fica VAZIO em
 * vez de chutar. Número inventado num papel que vai à farmácia é pior que campo em branco.
 */
export function sugestaoQuantidade(i: ItemCompra): number | null {
  if (!i.dosesPorDia || i.dosesPorDia <= 0) return null;
  return Math.ceil(i.dosesPorDia * DIAS_SUGERIDOS);
}

/**
 * Quem está acabando primeiro, e entre esses o que acaba antes. O resto em ordem alfabética, e
 * os pausados por último: eles continuam na lista (a pessoa pode querer repor mesmo assim), mas
 * não competem com o que está acabando de verdade.
 */
export function ordenarParaCompra(itens: ItemCompra[]): ItemCompra[] {
  const rank = (i: ItemCompra) => (i.suspenso ? 2 : precisaRepor(i) ? 0 : 1);
  return [...itens].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.diasRestantes as number) - (b.diasRestantes as number);
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export interface LinhaCompra {
  nome: string;
  dose: string;
  quantidade: number | null; // null = a pessoa não disse quanto quer
  estoque: number | null;
}

export const AVISO_NAO_E_RECEITA =
  'Esta lista foi feita pelo próprio paciente no aplicativo Alerta Médico. ' +
  'É um lembrete de compra — não é receita e não substitui prescrição médica.';

function dataBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * O texto que vai para o WhatsApp, para o e-mail ou para a área de transferência.
 *
 * Texto puro, sem tabela e sem markdown: o WhatsApp não alinha coluna nenhuma, e o que aqui
 * pareceria uma tabela chega lá como uma papa de traços. Uma linha por remédio é o que sobrevive
 * a qualquer aplicativo.
 */
export function montarTextoLista(linhas: LinhaCompra[], quando = new Date()): string {
  const corpo = linhas.map(l => {
    const nome = [l.nome.trim(), l.dose?.trim()].filter(Boolean).join(' ');
    const partes: string[] = [];
    if (l.quantidade != null) partes.push(`comprar ${l.quantidade}`);
    if (l.estoque != null) partes.push(`tenho ${l.estoque}`);
    return partes.length ? `• ${nome} — ${partes.join(', ')}` : `• ${nome}`;
  }).join('\n');

  return `Lista de compras — ${dataBR(quando)}\n\n${corpo}\n\n${AVISO_NAO_E_RECEITA}`;
}
