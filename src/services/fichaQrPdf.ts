import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Profile } from '../types';

// ---------------------------------------------------------------------------
// Folha imprimível com o QR da ficha de emergência.
//
// POR QUE IMPRIMIR: o cenário que mais importa é aquele em que o celular NÃO ajuda —
// desligado, sem bateria, quebrado no acidente, ou trancado com senha. Um QR de papel na
// carteira funciona nos quatro. O QR na tela cobre o caso em que o aparelho sobreviveu; o
// papel cobre o resto.
//
// O QR é gerado aqui pela API do goqr.me? NÃO. Seria mandar o prontuário da pessoa para um
// servidor de terceiros só para desenhar quadradinhos. O SVG é montado localmente pelo mesmo
// react-native-qrcode-svg da tela, e vai embutido no HTML.
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/**
 * `svg` é o QR já desenhado (string SVG). Quem chama tem o componente montado e consegue
 * extraí-lo; se não vier, a folha sai só com o texto — que ainda é útil, e é melhor que
 * recusar a impressão.
 */
export function montarHtmlFicha(texto: string, perfil: Profile | null, svg?: string): string {
  const nome = perfil?.name?.trim() || 'Paciente';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
  @page { margin: 12mm; }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #1A1F2E; }
  .cartao {
    border: 2px dashed #999; border-radius: 8px; padding: 14px;
    width: 86mm; margin: 0 auto; text-align: center;
  }
  h1 { font-size: 13px; margin: 0 0 2px; color: #B03A2E; letter-spacing: .5px; }
  .nome { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
  .qr svg { width: 46mm; height: 46mm; }
  .texto {
    text-align: left; font-size: 8px; line-height: 1.35; margin-top: 8px;
    white-space: pre-wrap; color: #333; border-top: 1px solid #ddd; padding-top: 6px;
  }
  .corte { font-size: 8px; color: #888; margin-top: 6px; text-align: center; }
</style></head><body>
  <div class="cartao">
    <h1>EMERGÊNCIA MÉDICA</h1>
    <div class="nome">${esc(nome)}</div>
    <div class="qr">${svg ?? ''}</div>
    <!-- O texto vai impresso ABAIXO do QR de propósito: se o código borrar na impressão, na
         dobra da carteira ou com o papel molhado, a informação continua legível a olho nu. -->
    <div class="texto">${esc(texto)}</div>
    <div class="corte">Recorte e guarde na carteira · Alerta Médico</div>
  </div>
</body></html>`;
}

export async function imprimirFichaQr(texto: string, perfil: Profile | null, svg?: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html: montarHtmlFicha(texto, perfil, svg), base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Ficha de emergência',
      UTI: 'com.adobe.pdf',
    });
  }
  return uri;
}
