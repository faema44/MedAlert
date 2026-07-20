import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { LinhaCompra, AVISO_NAO_E_RECEITA } from '../utils/listaCompras';

// O PDF da lista de compras. Mesma regra do relatório médico: quem lê não conhece o app e tem
// trinta segundos. Aqui, porém, o leitor costuma ser o BALCÃO da farmácia — por isso o aviso de
// que não é receita vem no topo, antes da tabela, e não escondido no rodapé.

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function dataBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function montarHtmlLista(linhas: LinhaCompra[], nomePaciente: string | null, quando = new Date()): string {
  const corpo = linhas.map(l => `
    <tr>
      <td class="nome"><strong>${esc(l.nome)}</strong>${l.dose ? `<span class="dose"> · ${esc(l.dose)}</span>` : ''}</td>
      <td class="n">${l.estoque != null ? l.estoque : '—'}</td>
      <td class="n comprar">${l.quantidade != null ? l.quantidade : '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1A1F2E; font-size: 12px; }
  h1 { font-size: 18px; color: #1C3F7A; margin: 0 0 2px; }
  .sub { color: #666; font-size: 11px; margin-bottom: 14px; }
  /* Antes da tabela de propósito: depois dela a lista já foi lida como prescrição. */
  .aviso { margin: 0 0 14px; padding: 9px 11px; border-radius: 5px;
           background: #FDF0EA; border-left: 3px solid #E07B4F; color: #A2431C; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1C3F7A; color: #fff; font-size: 11px; font-weight: 600;
       padding: 7px 6px; text-align: center; }
  th.esq, td.nome { text-align: left; }
  td { border-bottom: 1px solid #e6e9ef; padding: 8px 6px; }
  td.n { text-align: center; white-space: nowrap; }
  .comprar { font-weight: 700; font-size: 14px; color: #1C3F7A; }
  .dose { color: #666; font-weight: 400; }
  .nota { margin-top: 12px; color: #666; font-size: 10px; line-height: 1.5; }
  .rodape { margin-top: 14px; color: #888; font-size: 9px; text-align: center; }
</style></head><body>

  <h1>Lista de compras</h1>
  <div class="sub">${nomePaciente ? `${esc(nomePaciente)} · ` : ''}emitida em ${dataBR(quando)}</div>

  <div class="aviso"><strong>Atenção:</strong> ${esc(AVISO_NAO_E_RECEITA)}</div>

  <table>
    <thead><tr>
      <th class="esq">Medicamento</th><th>Tenho em casa</th><th>Comprar</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
  </table>

  <div class="nota">
    <strong>“Tenho em casa”</strong> é a quantidade que o próprio paciente anotou no aplicativo —
    não é contagem conferida. <strong>“Comprar”</strong> é o que ele decidiu levar.
  </div>

  <div class="rodape">Gerado pelo aplicativo Alerta Médico · alertamedico.ia.br</div>
</body></html>`;
}

/**
 * Gera o PDF e abre a folha de compartilhamento. Devolve o caminho, ou lança.
 *
 * Sem catch silencioso, pelo mesmo motivo do relatório: uma lista que não sai e não avisa faz a
 * pessoa chegar na farmácia de mãos vazias achando que levou.
 */
export async function gerarListaComprasPdf(
  linhas: LinhaCompra[], nomePaciente: string | null,
): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: montarHtmlLista(linhas, nomePaciente), base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Lista de compras',
      UTI: 'com.adobe.pdf',
    });
  }
  return uri;
}
