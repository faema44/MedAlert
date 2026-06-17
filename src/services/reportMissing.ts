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
 *  function doGet(e) {
 *    SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().appendRow([
 *      new Date().toLocaleString('pt-BR'),
 *      e.parameter.drug, e.parameter.platform, e.parameter.version
 *    ]);
 *    return ContentService.createTextOutput('ok');
 *  }
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Usamos GET com query params em vez de POST+JSON porque o Google Apps Script
 * redireciona requisições POST (302) e o redirect descarta o body, fazendo os
 * dados nunca chegarem à planilha.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Cole aqui a URL do seu Apps Script após publicar
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwYZpz8iyd4cmIFdxrD8mvgbSuDvdIDv5A1ThyFcA7kBkqBnqMWUIQGyE4xKphw9cG3qQ/exec';

export async function reportMissingDrug(drugName: string): Promise<void> {
  if (!WEBHOOK_URL.includes('/exec')) return;

  try {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set('drug', drugName.trim());
    url.searchParams.set('platform', Platform.OS);
    url.searchParams.set('version', Constants.expoConfig?.version ?? '?');

    await fetch(url.toString());
  } catch {
    // Falha silenciosa — não impacta o usuário
  }
}
