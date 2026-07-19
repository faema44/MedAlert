import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Profile } from '../types';
import { RelatorioAdesao, ResumoMedicamento, textoAdesao, faixaAdesao } from '../utils/relatorioMedico';

// ---------------------------------------------------------------------------
// O PDF que a pessoa leva na consulta.
//
// O leitor tem ~10 minutos e não conhece este app. Duas consequências no desenho:
//
//   1. NADA de log dose a dose. Vinte páginas que ninguém lê enterram as quatro linhas que
//      importam. Só o resumo por medicamento.
//   2. O documento DIZ, em cima e sem rodeio, que é registro do próprio paciente. Uma tabela
//      limpa é lida como medição, e este dado não é medido — é lembrado.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function dataBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function idade(nascimento?: string | null): string {
  if (!nascimento) return '';
  const n = new Date(nascimento);
  if (isNaN(n.getTime())) return '';
  const hoje = new Date();
  let a = hoje.getFullYear() - n.getFullYear();
  const m = hoje.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < n.getDate())) a--;
  return a > 0 && a < 130 ? `${a} anos` : '';
}

function linhaMed(m: ResumoMedicamento): string {
  const f = faixaAdesao(m);
  // Faixa larga = incerteza grande. Marcar em cinza evita que o médico leia o piso como
  // se fosse o número.
  const incerto = f != null && f.teto - f.piso > 15;
  return `
    <tr>
      <td class="nome"><strong>${esc(m.nome)}</strong>${m.dose ? `<span class="dose"> · ${esc(m.dose)}</span>` : ''}</td>
      <td class="n ok">${m.tomou}</td>
      <td class="n nao">${m.naoTomou}</td>
      <td class="n sem">${m.semResposta}</td>
      <td class="n tot">${m.total}</td>
      <td class="n pct${incerto ? ' incerto' : ''}">${textoAdesao(m)}</td>
      <td class="dt">${dataBR(m.primeiraDose)}</td>
      <td class="dt">${dataBR(m.ultimaDose)}</td>
    </tr>`;
}

export function montarHtml(rel: RelatorioAdesao, perfil: Profile | null): string {
  const nome = perfil?.name?.trim() || 'Paciente';
  const anos = idade(perfil?.birth_date);
  const alergias = perfil?.allergies?.trim();
  const emitido = dataBR(new Date().toISOString());

  const corpo = rel.medicamentos.length
    ? rel.medicamentos.map(linhaMed).join('')
    : `<tr><td colspan="8" class="vazio">Nenhuma dose registrada no período.</td></tr>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1A1F2E; font-size: 11px; }
  h1 { font-size: 17px; color: #1C3F7A; margin: 0 0 2px; }
  .sub { color: #666; font-size: 11px; margin-bottom: 14px; }
  .ficha { border: 1px solid #d8dde6; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }
  .ficha .linha { margin: 2px 0; }
  .rot { color: #666; }
  /* Alergia é a informação que muda conduta na hora — não pode competir com o resto. */
  .alergia { margin-top: 6px; padding: 7px 10px; border-radius: 5px;
             background: #FDF0EA; border: 1px solid #E07B4F; color: #A2431C; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #1C3F7A; color: #fff; font-size: 10px; font-weight: 600;
       padding: 6px 5px; text-align: center; }
  th.esq, td.nome { text-align: left; }
  td { border-bottom: 1px solid #e6e9ef; padding: 6px 5px; vertical-align: top; }
  td.n, td.dt { text-align: center; white-space: nowrap; }
  .dose { color: #666; font-weight: 400; }
  .ok  { color: #1E7A4A; font-weight: 700; }
  .nao { color: #B03A2E; font-weight: 700; }
  .sem { color: #8A6D1F; font-weight: 700; }
  .tot, .pct { font-weight: 700; }
  .semdado { color: #aaa; }
  .incerto { color: #8A6D1F; font-weight: 600; }
  .vazio { text-align: center; color: #888; padding: 16px; }
  /* O aviso vem ANTES da tabela de propósito: depois dela, já foi lida como medição. */
  .aviso { margin: 12px 0 0; padding: 9px 11px; border-radius: 5px;
           background: #F2F4F8; border-left: 3px solid #1C3F7A; color: #333; line-height: 1.5; }
  .rodape { margin-top: 14px; color: #888; font-size: 9px; text-align: center; }
</style></head><body>

  <h1>Relatório de uso de medicamentos</h1>
  <div class="sub">${rel.dias == null
    ? `Histórico completo — desde ${dataBR(rel.desde)}`
    : `Período de ${dataBR(rel.desde)} a ${dataBR(rel.ate)} · ${rel.dias} dias`} · emitido em ${emitido}</div>

  <div class="ficha">
    <div class="linha"><span class="rot">Paciente:</span> <strong>${esc(nome)}</strong>${anos ? ` · ${anos}` : ''}${perfil?.blood_type && perfil.blood_type !== 'Desconhecido' ? ` · sangue ${esc(perfil.blood_type)}` : ''}</div>
    ${alergias ? `<div class="alergia">⚠ Alergias: ${esc(alergias)}</div>` : ''}
  </div>

  <div class="aviso">
    <strong>Como ler:</strong> os números abaixo são o que o paciente registrou no aplicativo,
    respondendo a cada lembrete — <strong>não são medição</strong>.
    <strong>“Sem resposta”</strong> significa que o lembrete tocou e não houve resposta:
    <strong>não é o mesmo que “não tomou”</strong>, e não deve ser lido como tal.
  </div>

  <table>
    <thead><tr>
      <th class="esq">Medicamento</th>
      <th>Tomou</th><th>Não tomou</th><th>Sem resposta</th><th>Doses</th><th>Adesão</th>
      <th>1ª dose</th><th>Última dose</th>
    </tr></thead>
    <tbody>${corpo}</tbody>
  </table>

  <div class="aviso">
    <strong>Adesão</strong> é uma faixa, não um número: o menor valor supõe que <em>nenhuma</em>
    dose sem resposta foi tomada, e o maior supõe que <em>todas</em> foram. A verdade está entre
    os dois — e uma faixa larga (ex.: 7–100%) significa que não há como afirmar a adesão, não
    que ela seja ruim. Quando não houve dose sem resposta, aparece um número só.
    <strong>Última dose</strong> é a última que o paciente <em>confirmou</em> ter tomado.
  </div>

  <div class="rodape">Gerado pelo aplicativo Alerta Médico · alertamedico.ia.br</div>
</body></html>`;
}

/**
 * Gera o PDF e abre a folha de compartilhamento. Devolve o caminho, ou lança.
 *
 * Sem catch silencioso: se falhar, quem chamou mostra o erro. Um relatório que não sai e não
 * avisa faz a pessoa chegar na consulta de mãos vazias achando que levou.
 */
export async function gerarRelatorioPdf(rel: RelatorioAdesao, perfil: Profile | null): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: montarHtml(rel, perfil), base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Relatório para o médico',
      UTI: 'com.adobe.pdf',
    });
  }
  return uri;
}
