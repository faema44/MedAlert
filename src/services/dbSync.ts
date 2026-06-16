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
import { loadExternalDb } from '../utils/drugSearch';

// ─── Configure aqui ──────────────────────────────────────────────────────────
const GITHUB_USER = 'faema44';
const GITHUB_REPO = 'MedAlert';
const GITHUB_BRANCH = 'main';
const DB_PATH = 'src/data/medications-db.json';
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'medications_db_v1';
const CACHE_TTL_DAYS = 1;

const JSDELIVR_URL =
  `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}/${DB_PATH}`;

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

// ─── Public API ──────────────────────────────────────────────────────────────

export async function syncMedicationsDb(): Promise<void> {
  // Ensure DB is initialised before we touch kv_store
  await getDb();

  // Step 1 — load from SQLite cache (fast, synchronous-ish)
  try {
    const cached = await getKV(CACHE_KEY);
    if (cached) {
      const parsed: MedsDb = JSON.parse(cached);
      loadExternalDb(parsed);
    }
  } catch { /* cache miss or parse error — bundled DB is fine */ }

  // Step 2 — fire-and-forget background fetch
  fetchAndUpdate().catch(() => {});
}

async function fetchAndUpdate(): Promise<void> {
  if (GITHUB_USER === 'SEU_USUARIO') return; // not configured yet

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

    const data: MedsDb = await res.json();
    if (!data?.medications?.length) return;

    // Always update cache and memory if remote has more entries
    await setKV(CACHE_KEY, JSON.stringify(data));
    loadExternalDb(data);
  } catch {
    // Network error, timeout, JSON parse error — silently ignore
  }
}
