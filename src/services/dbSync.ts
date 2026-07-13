/**
 * Sincroniza o banco de medicamentos com a versão mais recente hospedada no GitHub.
 *
 * Fluxo:
 *   1. Carrega do cache SQLite imediatamente (substitui bundled se mais completo)
 *   2. Em background, lê o manifesto da branch para descobrir o commit publicado
 *   3. Baixa .json + .sig FIXADOS naquele commit, verifica a assinatura e valida o schema
 *   4. Se o lote passar em tudo → atualiza cache e memória
 *
 * Não bloqueia o startup. Em caso de erro de rede, o app funciona normalmente
 * com o bundled ou com a última versão cacheada.
 *
 * ⚙️  CONFIGURAÇÃO: defina GITHUB_USER com seu usuário do GitHub.
 */

import { getDb, getKV, setKV, getKVAge } from '../database/db';
import { loadExternalDb, loadExternalInteractions } from '../utils/drugSearch';
import { DrugInteraction } from '../types';
import { verifyDataSignature } from './dataSignature';

// Seed local — sempre disponível, não depende de rede
const bundledMeds = require('../data/medications-db.json');
const bundledInts: DrugInteraction[] = require('../data/interactions.json');
// O PISO do guard: os IDs que passaram pela revisão da Play Store. Ver acceptInteractions.
const PISO_IDS: Set<string> = new Set(bundledInts.map(i => i.id));

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
const MANIFEST_PATH = 'src/data/manifest.json';

// ─── Por que o app NÃO baixa os dados direto da branch ────────────────────────
//
// O jsDelivr cacheia uma URL de BRANCH (`@main`) por 12h — inclusive a resolução
// branch→commit. Como o .json e o .sig são duas entradas de cache independentes, cada
// publicação abria uma janela em que uma delas estava fresca e a outra velha:
//
//     .sig novo  +  .json velho  →  assinatura não confere  →  app rejeita o lote
//
// Falha fechada, então nunca foi perigoso — mas derrubava o canal de atualização justamente
// nas horas seguintes a publicar, que é quando a atualização mais importa. E `purge` não
// resolve: o jsDelivr também cacheia a resolução da branch.
//
// A correção é tirar a branch do caminho dos DADOS:
//
//   1. o app lê um MANIFESTO minúsculo da branch, que contém só o SHA do commit publicado
//      (raw.githubusercontent → `max-age=300`, 5 min de cache);
//   2. baixa .json e .sig FIXADOS naquele commit
//      (jsDelivr @<sha> → `immutable`, cache de 1 ano).
//
// Fixados no mesmo commit, .json e .sig são coerentes POR CONSTRUÇÃO — dessincronizar deixa
// de ser possível. O cache do manifesto só pode ATRASAR a atualização (por até 5 min), nunca
// corrompê-la: um manifesto velho aponta para um commit velho, cujos dados e assinatura
// batem entre si.
//
// Um atacante com push pode apontar o manifesto para outro commit, mas não consegue assinar
// dados novos. O máximo que consegue é servir uma versão ANTERIOR já assinada por nós — e o
// piso de IDs (acceptInteractions) barra qualquer commit em que falte um alerta que já veio
// embarcado. Por isso o manifesto não precisa de assinatura própria: assiná-lo criaria uma
// segunda entrada de cache e traria o problema de volta.

const RAW_MANIFEST_URL =
  `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${MANIFEST_PATH}`;
const JSDELIVR_MANIFEST_URL =
  `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${GITHUB_BRANCH}/${MANIFEST_PATH}`;

const dataUrl = (commit: string, filePath: string) =>
  `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@${commit}/${filePath}`;

/**
 * Descobre de qual commit baixar os dados. Uma resolução por execução do app: os dois syncs
 * (medicamentos e interações) compartilham a mesma, para não baterem duas vezes na rede e —
 * mais importante — para não pegarem commits diferentes um do outro.
 *
 * O raw.githubusercontent é a fonte preferida (5 min de cache). Se ele falhar, cai no
 * jsDelivr (12h) — mais velho, porém ainda coerente. Se ambos falharem, devolve null e o app
 * simplesmente não atualiza: segue com o cache ou com a base embarcada.
 */
let commitResolvido: Promise<string | null> | null = null;

function resolveDataCommit(timeoutMs: number): Promise<string | null> {
  if (!commitResolvido) commitResolvido = fetchDataCommit(timeoutMs);
  return commitResolvido;
}

async function fetchDataCommit(timeoutMs: number): Promise<string | null> {
  for (const url of [RAW_MANIFEST_URL, JSDELIVR_MANIFEST_URL]) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) continue;
      const commit = JSON.parse(await res.text())?.commit;
      // Validação estrita: o valor vai direto para dentro de uma URL. Só SHA de 40 hex.
      if (typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)) return commit;
    } catch { /* tenta a próxima origem */ }
  }
  return null;
}

/**
 * Baixa o JSON e a sua assinatura, e só devolve o texto se a assinatura CONFERIR.
 *
 * Falha fechada: sem .sig, com .sig inválido, ou com qualquer erro → devolve null e o
 * chamador descarta o lote, seguindo com a base embarcada. Preferimos dados desatualizados
 * (mas revisados pela Play Store) a dados adulterados.
 *
 * Assinamos e verificamos os BYTES CRUS do arquivo — não o objeto re-serializado. Qualquer
 * diferença de formatação invalidaria uma assinatura legítima.
 */
async function fetchSigned(url: string, sigUrl: string, timeoutMs: number): Promise<string | null> {
  const [res, sigRes] = await Promise.all([
    fetchWithTimeout(url, timeoutMs),
    fetchWithTimeout(sigUrl, timeoutMs),
  ]);
  if (!res.ok || !sigRes.ok) return null;

  const raw = await res.text();
  const sig = await sigRes.text();
  return (await verifyDataSignature(raw, sig)) ? raw : null;
}

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
// Regra adotada: **todo alerta EMBARCADO precisa continuar presente no remoto.**
// O bundled passou pela revisão da loja — é a linha de base confiável. Assim, a Play Store
// vira o portão para qualquer REMOÇÃO de alerta; o canal remoto só serve para ACRESCENTAR.
// Se uma auditoria futura precisar remover entradas, isso sai numa versão nova do app.
//
// A regra ANTIGA comparava só a QUANTIDADE (`data.length < baselineCount`), e tinha um furo:
// um payload que trocasse as 2.768 entradas por outras 2.768 FALSAS tinha o mesmo tamanho e
// PASSAVA — todo alerta real sumia e o app não via diferença. Por isso o piso virou o conjunto
// de IDs.
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
// O piso deixou de ser uma CONTAGEM e passou a ser o conjunto de IDs embarcado (revisado pela
// Play Store). Comparar quantidade era frouxo: um payload que trocasse as 2.768 entradas por
// outras 2.768 FALSAS tinha o mesmo `length` e PASSAVA — todo alerta real sumia e o app não via
// diferença. Agora, cada alerta que passou pela loja precisa continuar presente; remover um
// exige uma versão nova do app.
function acceptInteractions(data: unknown, pisoIds: Set<string>): DrugInteraction[] | null {
  if (!Array.isArray(data)) return null;
  if (!data.every(isValidInteraction)) return null;          // schema íntegro em todos
  const presentes = new Set(data.map((e: any) => e.id));
  for (const id of pisoIds) if (!presentes.has(id)) return null;   // sumiu alerta que a loja revisou
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
    const commit = await resolveDataCommit(8000);
    if (!commit) return; // sem manifesto → não atualiza (segue com cache/bundled)

    const url = dataUrl(commit, DB_PATH);
    const raw = await fetchSigned(url, `${url}.sig`, 8000);
    if (!raw) return; // assinatura ausente ou inválida → descarta

    const accepted = acceptMeds(JSON.parse(raw), bundledMeds.medications.length);
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
      const accepted = acceptInteractions(JSON.parse(cached), PISO_IDS);
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
    const commit = await resolveDataCommit(8000);
    if (!commit) return; // sem manifesto → não atualiza (segue com cache/bundled)

    const url = dataUrl(commit, INT_PATH);
    const raw = await fetchSigned(url, `${url}.sig`, 8000);
    if (!raw) return; // assinatura ausente ou inválida → descarta

    const accepted = acceptInteractions(JSON.parse(raw), PISO_IDS);
    if (!accepted) return; // menor que o embarcado ou schema inválido → descarta o lote

    await setKV(INT_CACHE_KEY, JSON.stringify(accepted));
    loadExternalInteractions(accepted);
  } catch {}
}
