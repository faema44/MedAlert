import * as ed from '@noble/ed25519';

/**
 * Verificação da assinatura da base médica baixada em runtime.
 *
 * O app baixa interactions.json e medications-db.json de um repositório PÚBLICO e os usa
 * para gerar alertas medicamentosos. As checagens de dbSync.ts (piso de quantidade + schema)
 * barram o ESVAZIAMENTO da base, mas não barram a INJEÇÃO: um atacante com push no `main`
 * podia ACRESCENTAR um alerta crítico falso — "Losartana + Paracetamol: risco de morte" — e
 * fazer o paciente parar um remédio de que precisa. É o dano que o app inteiro existe para
 * evitar.
 *
 * A assinatura fecha isso. Só quem tem a chave PRIVADA (fora do repositório, junto da
 * keystore) consegue produzir um payload que o app aceite. Comprometer o GitHub deixa de
 * ser suficiente.
 *
 * A chave PÚBLICA abaixo não é segredo — é pública por definição. O que a protege é a
 * revisão da Play Store: um atacante que só tenha o GitHub não consegue trocá-la nos
 * aparelhos já instalados.
 */
const PUBLIC_KEY_HEX = 'eaee826b76755bdf91065723bcfac72c02fbdd8b6a827d45fb5b9d83962416e2';

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Verifica a assinatura sobre os BYTES CRUS do JSON — exatamente o texto que veio do
 * jsDelivr. Não re-serializar: qualquer diferença de formatação (espaço, ordem de chave,
 * quebra de linha) mudaria os bytes e invalidaria uma assinatura legítima.
 *
 * Falha fechada: qualquer erro (assinatura ausente, malformada, inválida) devolve false, e
 * o dbSync descarta o lote e segue com a base embarcada.
 */
export async function verifyDataSignature(rawJson: string, signatureHex: string): Promise<boolean> {
  try {
    const sig = hexToBytes(signatureHex);
    const pub = hexToBytes(PUBLIC_KEY_HEX);
    if (!sig || !pub || sig.length !== 64 || pub.length !== 32) return false;

    const msg = new TextEncoder().encode(rawJson);
    return await ed.verifyAsync(sig, msg, pub);
  } catch {
    return false;
  }
}
