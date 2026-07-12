/**
 * Sincroniza o banco de medicamentos com a versão mais recente hospedada no GitHub.
 *
 * Fluxo:
 *   1. Carrega do cache SQLite imediatamente (substitui bundled se mais completo)
 *   2. Em background, busca versão nova do jsDelivr (CDN do GitHub)
 *   3. Se nova versão tem mais medicamentos → atualiza cache e memória
 *
 * Não bloqueia o startup. Em caso de erro de rede, o app funciona normalmente
 * com o bundled ou com a última versão cacheada.
 *
 * ⚙️  CONFIGURAÇÃO: defina GITHUB_USER com seu usuário do GitHub.
 */

import { getDb, getKV, setKV, getKVAge } from '../database/db';
import { loadExternalDb, loadExternalInteractions } from '../utils/drugSearch';
import { DrugInteraction } from '../types';

// Seed local — sempre disponível, não depende de rede
const bundledMeds = require('../data/medications-db.json');
const bundledInts: DrugInteraction[] = require('../data/interactions.json');

// ─── Configure aqui ──────────────────────────────────────────────────────────
const GITHUB_USER = 'faema44';
const GITHUB_REPO = 'MedAlert';
const GITHUB_BRANCH = 'main';
const DB_PATH = 'src/data/medications-db.json';
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'medications_db_v1';
const INT_CACHE_KEY = 'interactions_db_v1';
const CACHE_TTL_DAYS = 1;

const INT_PATH = 'src/data/interactions.json';

const JSDELIVR_URL =
  `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}/${DB_PATH}`;
const JSDELIVR_INT_URL =
  `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}/${INT_PATH}`;

type MedsDb = { version?: string; medications: { genericName: string; brands: string[]; category: string }[] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ─── Validação do payload remoto ─────────────────────────────────────────────
//
// O app baixa a base de INTERAÇÕES MEDICAMENTOSAS de um repositório PÚBLICO em runtime.
// Antes, a única checagem era "é um array não-vazio" — então um payload com 1 entrada
// zerava as ~2.800 interações em todo aparelho instalado, sem update e sem passar pela
// revisão da Play Store. O paciente deixaria de receber alertas reais e não teria como
// saber.
//
// Regra adotada: **o remoto só pode CRESCER em relação ao que veio embarcado no app.**
// O bundled passou pela revisão da loja — é a linha de base confiável. Assim, a Play Store
// vira o portão para qualquer REMOÇÃO de alerta; o canal remoto só serve para ACRESCENTAR.
// Se uma auditoria futura precisar remover entradas, isso sai numa versão nova do app.
//
// ⚠️ Isto NÃO impede a injeção de uma entrada falsa plausível — para isso seria preciso
// assinar o JSON e verificar com chave pública embarcada. O que estas checagens fecham é o
// esvaziamento e a corrupção, que é o cenário provável (erro de pipeline ou push indevido).

const RISK_LEVELS = new Set(['critical', 'high', 'moderate']);

function isValidInteraction(e: any): boolean {
  return !!e
    && typeof e.id === 'string' && e.id.length > 0
    && typeof e.drug1 === 'string' && e.drug1.length > 0
    && typeof e.drug2 === 'string' && e.drug2.length > 0
    && typeof e.risk_description === 'string' && e.risk_description.length > 0
    && RISK_LEVELS.has(e.risk_level);
}

// Aceita o lote inteiro ou nenhum: um payload com QUALQUER item malformado é descartado.
// Filtrar os ruins e ficar com o resto seria pior — aceitaria silenciosamente uma base
// adulterada pela metade.
function acceptInteractions(data: unknown, baselineCount: number): DrugInteraction[] | null {
  if (!Array.isArray(data)) return null;
  if (data.length < baselineCount) return null;      // só pode crescer
  if (!data.every(isValidInteraction)) return null;  // schema íntegro em todos
  return data as DrugInteraction[];
}

function acceptMeds(data: any, baselineCount: number): MedsDb | null {
  const list = data?.medications;
  if (!Array.isArray(list)) return null;
  if (list.length < baselineCount) return null;
  const ok = list.every((m: any) =>
    !!m && typeof m.genericName === 'string' && m.genericName.length > 0 && Array.isArray(m.brands));
  return ok ? (data as MedsDb) : null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function syncMedicationsDb(): Promise<void> {
  // Ensure DB is initialised before we touch kv_store
  await getDb();

  // Step 0 — seed from bundled JSON (offline-safe, sempre tem os dados mais recentes do build)
  loadExternalDb(bundledMeds);

  // Step 1 — load from SQLite cache (fast, synchronous-ish).
  // O cache passa pela MESMA validação do fetch: um lote adulterado gravado por uma versão
  // antiga do app (que aceitava qualquer coisa) seria carregado sem checagem nenhuma.
  try {
    const cached = await getKV(CACHE_KEY);
    if (cached) {
      const accepted = acceptMeds(JSON.parse(cached), bundledMeds.medications.length);
      if (accepted) loadExternalDb(accepted);
      else await setKV(CACHE_KEY, '').catch(() => {}); // cache suspeito: descarta
    }
  } catch { /* cache miss or parse error — bundled DB is fine */ }

  // Step 2 — fire-and-forget background fetch
  fetchAndUpdate().catch(() => {});
}

async function fetchAndUpdate(): Promise<void> {
  // Skip network only if cache is very fresh AND already has plenty of entries
  try {
    const age = await getKVAge(CACHE_KEY);
    if (age < CACHE_TTL_DAYS) {
      const cached = await getKV(CACHE_KEY);
      if (cached) {
        const parsed: MedsDb = JSON.parse(cached);
        if (parsed.medications.length >= 600) return;
      }
    }
  } catch { /* proceed */ }

  try {
    const res = await fetchWithTimeout(JSDELIVR_URL, 8000);
    if (!res.ok) return;

    const accepted = acceptMeds(await res.json(), bundledMeds.medications.length);
    if (!accepted) return; // menor que o embarcado ou schema inválido → descarta o lote

    await setKV(CACHE_KEY, JSON.stringify(accepted));
    loadExternalDb(accepted);
  } catch {
    // Network error, timeout, JSON parse error — silently ignore
  }
}

// ─── Interactions DB sync ─────────────────────────────────────────────────────

export async function syncInteractionsDb(): Promise<void> {
  await getDb();

  // Step 0 — seed from bundled JSON
  loadExternalInteractions(bundledInts);

  // Mesma validação do fetch — ver comentário em syncMedicationsDb.
  try {
    const cached = await getKV(INT_CACHE_KEY);
    if (cached) {
      const accepted = acceptInteractions(JSON.parse(cached), bundledInts.length);
      if (accepted) loadExternalInteractions(accepted);
      else await setKV(INT_CACHE_KEY, '').catch(() => {}); // cache suspeito: descarta
    }
  } catch {}

  fetchAndUpdateInteractions().catch(() => {});
}

async function fetchAndUpdateInteractions(): Promise<void> {
  try {
    const age = await getKVAge(INT_CACHE_KEY);
    if (age < CACHE_TTL_DAYS) {
      const cached = await getKV(INT_CACHE_KEY);
      if (cached) {
        const parsed: DrugInteraction[] = JSON.parse(cached);
        if (parsed.length >= 80) return;
      }
    }
  } catch {}

  try {
    const res = await fetchWithTimeout(JSDELIVR_INT_URL, 8000);
    if (!res.ok) return;

    const accepted = acceptInteractions(await res.json(), bundledInts.length);
    if (!accepted) return; // menor que o embarcado ou schema inválido → descarta o lote

    await setKV(INT_CACHE_KEY, JSON.stringify(accepted));
    loadExternalInteractions(accepted);
  } catch {}
}
