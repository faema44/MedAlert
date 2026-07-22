import { Profile, Medication, EmergencyContact } from '../types';

// ---------------------------------------------------------------------------
// Ficha de emergência em QR code.
//
// PARA QUE SERVE, E POR QUE ISSO MUDA O DESENHO: quem lê é um socorrista, com o celular
// dele, nos primeiros minutos. Então:
//
//   • É TEXTO PURO, não link. Link exigiria internet (que pode não haver) e um servidor
//     nosso com prontuário de gente — que este app não tem e não quer ter. Texto abre na
//     câmera de qualquer celular, offline, sem instalar nada.
//   • O QR tem LIMITE. Cabe ~1 KB com folga de leitura; um paciente com 20 remédios estoura.
//     Por isso o corte é POR PRIORIDADE e nunca no meio: alergia jamais cai, remédio crítico
//     cai por último, e o que sobrar vira "+N outros" em vez de sumir sem aviso.
//   • Não vai nome de app nem enfeite: cada caractere gasto é um remédio a menos que cabe.
// ---------------------------------------------------------------------------

// Acima disto o QR fica denso demais para a câmera ler rápido — e ler rápido é o ponto.
const LIMITE = 900;

function idade(nascimento?: string | null): string {
  if (!nascimento) return '';
  const n = new Date(nascimento);
  if (isNaN(n.getTime())) return '';
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  const m = h.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < n.getDate())) a--;
  return a > 0 && a < 130 ? `${a}a` : '';
}

/**
 * Monta o texto do QR, cortando por prioridade se não couber.
 *
 * A ordem NÃO é estética, é clínica: alergia muda a conduta imediata (aplicar o que a pessoa
 * não tolera pode matar em minutos); o remédio crítico explica o quadro; o resto é contexto.
 */
export function montarTextoQr(
  perfil: Profile | null,
  meds: Medication[],
  contatos: EmergencyContact[] = [],
): string {
  const linhas: string[] = [];

  const nome = perfil?.name?.trim();
  const a = idade(perfil?.birth_date);
  const sangue = perfil?.blood_type && perfil.blood_type !== 'Desconhecido' ? perfil.blood_type : '';
  if (nome || a || sangue) {
    linhas.push([nome, a, sangue && `Sangue ${sangue}`].filter(Boolean).join(' · '));
  }

  // 1º, sempre: alergia. Se só isto couber, é isto que vai.
  const alergias = perfil?.allergies?.trim();
  linhas.push(alergias ? `ALERGIA: ${alergias}` : 'ALERGIA: nenhuma informada');

  // 2º: contato — quem o socorrista liga para saber o resto.
  const c = contatos.find(x => x.is_primary) ?? contatos[0];
  if (c?.name && c?.phone) linhas.push(`CONTATO: ${c.name} ${c.phone}`);

  // 3º: remédios, na ordem em que estão cadastrados.
  const ordenados = meds.filter(m => !m.suspended);

  const cabecalho = linhas.join('\n');
  const usadas: string[] = [];
  let sobra = LIMITE - cabecalho.length - '\nMEDICAMENTOS:\n'.length;
  let cortados = 0;

  for (const m of ordenados) {
    const nomeM = (m.commercial_name || m.generic_name || '').trim();
    if (!nomeM) continue;
    const dose = (m.dose || '').trim();
    const linha = dose ? `${nomeM} ${dose}` : nomeM;
    // Reserva espaço para o aviso de corte: melhor caber "+3 outros" do que perder a
    // informação de que existem outros.
    if (linha.length + 1 > sobra - 14) { cortados++; continue; }
    usadas.push(linha);
    sobra -= linha.length + 1;
  }

  if (usadas.length) linhas.push('MEDICAMENTOS:', ...usadas);
  else if (ordenados.length) cortados = ordenados.length;

  // Silenciar o corte seria pior que cortar: o socorrista precisa saber que a lista está
  // incompleta, senão ele decide como se fosse completa.
  if (cortados > 0) linhas.push(`+${cortados} outro${cortados > 1 ? 's' : ''} — ver no celular`);

  return linhas.join('\n');
}

/** Cabe no QR sem ficar ilegível? Quem chama pode avisar antes de a pessoa imprimir. */
export function cabeNoQr(texto: string): boolean {
  return texto.length <= LIMITE;
}
