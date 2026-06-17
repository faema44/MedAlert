/**
 * Reporta medicamento não encontrado no banco de dados.
 *
 * SETUP (admin):
 *   1. Abra https://script.google.com e crie um novo projeto
 *   2. Cole o código do Apps Script abaixo, salve e publique como Web App:
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   3. Copie a URL gerada e cole em WEBHOOK_URL abaixo
 *
 * ──── Apps Script ────────────────────────────────────────────────────────────
 *  function doPost(e) {
 *    const d = JSON.parse(e.postData.contents);
 *    SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow([
 *      new Date().toLocaleString('pt-BR'),
 *      d.drug, d.platform, d.version
 *    ]);
 *    return ContentService.createTextOutput('ok');
 *  }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Cole aqui a URL do seu Apps Script após publicar
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxPIih5WJK5WtGYeRTwCTURkTzIoDnUuX_hDdlomxTeZyxGQTToezPc2afw4NWEPn3POg/exec';

export async function reportMissingDrug(drugName: string): Promise<void> {
  if (!WEBHOOK_URL.includes('/exec')) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drug: drugName.trim(),
        platform: Platform.OS,
        version: Constants.expoConfig?.version ?? '?',
      }),
    });
  } catch {
    // Falha silenciosa — não impacta o usuário
  }
}
