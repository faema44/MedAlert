import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import appJson from '../../app.json';
import {
  getCaregiver, getProfile, getKV, setKV, getMedications, getRemindersForMedication, Caregiver,
} from '../database/db';
import { newSharedKey, encrypt, decrypt } from './caregiverCrypto';

// ---------------------------------------------------------------------------
// CUIDADOR — quem dispara o alerta é o celular DELE.
//
// A primeira versão fazia o contrário: o celular do idoso acordava por alarme exato e cobrava a
// dose. Funcionava, e mesmo assim estava errada. Tinha um buraco que só apareceu quando o
// usuário perguntou pelo iPhone: se o celular do idoso estivesse DESLIGADO, sem bateria ou sem
// rede, o alarme não disparava e o cuidador NÃO RECEBIA NADA — lendo o silêncio como "está tudo
// bem". Justo no cenário em que algo de fato aconteceu.
//
// Agora: o celular do cuidador recebe a AGENDA do idoso e marca uma notificação LOCAL para si
// mesmo em cada dose ("Vovó não confirmou Enalapril às 15:00"). Quando o idoso responde, chega
// uma push que CANCELA essa notificação.
//
//   O silêncio deixou de ser ausência de aviso. O silêncio VIROU o aviso.
//
// Não importa mais por que o idoso não respondeu — se esqueceu, se o celular morreu, se ficou
// sem sinal. O cuidador é avisado, e quem julga é ele. O app não precisa adivinhar.
//
// Três consequências:
//   1. Some o alarme exato — a única coisa que o iOS proíbe. Funciona no iPhone.
//   2. Some o código nativo do cuidador (~250 linhas de Kotlin, apagadas).
//   3. O idoso só envia quando alguém TOCA num botão — e aí o JS está vivo.
//
// FALSO ALARME CONHECIDO: se a push de confirmação não conseguir acordar o app do cuidador a
// tempo (a Apple estrangula push silenciosa), a notificação local dispara mesmo com a dose
// tomada. O cuidador toca, o app abre, processa a push represada e mostra a verdade. Errar para
// MAIS aviso é recuperável; errar para menos é silêncio, e silêncio aqui é indistinguível de
// "está tudo bem".
// ---------------------------------------------------------------------------

const EAS_PROJECT_ID: string = (appJson as any).expo?.extra?.eas?.projectId;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PAIR_SCHEME = 'alertamedico://cuidador';

export const CAREGIVER_CHANNEL = 'caregiver_alerts';
export const CAREGIVER_TASK = 'caregiver-push';

// Quem EU acompanho. Um cuidador pode cuidar de várias pessoas — cada pareamento tem seu próprio
// pid e sua própria chave, e é o pid que diz qual chave usar quando a push chega.
const KV_PATIENTS = 'caregiver_patients';
const KV_INBOX = 'caregiver_inbox';
// Livro-razão das cobranças ("não confirmou") agendadas. O alerta é uma notificação LOCAL que
// dispara mesmo com o app do cuidador FECHADO — e aí nenhum JS roda para registrá-lo no histórico.
// Então gravamos aqui a cobrança futura; ao abrir o app, reconcileCaregiverMisses varre o que já
// venceu e ainda está no livro (não foi confirmado) e passa para o histórico.
const KV_MISSES = 'caregiver_misses';
const HORIZONTE_DIAS = 3;

// `nick` vem do idoso (na 1ª mensagem dele). `label` é o apelido que o CUIDADOR deu ao gerar o
// convite — serve pra ele saber quem é enquanto o convite ainda não foi aceito (nick vazio).
export type Patient = { pid: string; key: string; nick: string; label?: string };

// ---------------------------------------------------------------------------
// As duas mensagens que o idoso envia
// ---------------------------------------------------------------------------
// A agenda viaja como REGRA, não como lista de doses expandida.
//
// Expandir aqui parecia mais simples e teria quebrado em produção: 6 medicamentos × 2 doses/dia
// × 4 dias ≈ 4,8 KB, e o payload de dados de uma push tem ~4 KB. A mensagem seria REJEITADA — e
// o cuidador simplesmente pararia de ser avisado, sem erro visível. Mandando a regra (remédio +
// horários + recorrência), são ~60 bytes por medicamento, e quem expande é o celular do cuidador.
export type MedRule = {
  i: number;      // medication_id
  n: string;      // nome
  d: string;      // dose
  h: string[];    // horários "HH:MM"
  p: string;      // recorrência: 'day' | 'week:1,3' | 'month:5'
};

type Msg =
  | { t: 'schedule'; nick: string; delayMin: number; meds: MedRule[] }
  | {
      t: 'event'; id: string; nick: string; name: string; dose?: string;
      status: 'taken' | 'skipped' | 'done'; at: string; value?: string;
    };

export type CaregiverEvent = {
  kind: 'med' | 'activity';
  name: string;
  status: 'taken' | 'skipped' | 'done';
  at: string;
  dose?: string;
  value?: string;
  medId?: number;
};

export type InboxItem = { pid: string; text: string; at: string; id?: string };

// Uma cobrança agendada. `id` é o doseId (mesma chave que o cancelamento usa), `at` é quando ela
// DISPARA (horário da dose + tolerância). Vira aviso de histórico se vencer sem ser confirmada.
type Miss = { pid: string; id: string; at: string; text: string };

/**
 * Identidade da dose. Os dois lados calculam a MESMA string, senão o cancelamento não casa.
 *
 * O pid ENTRA na chave, e não é zelo: sem ele, o medicamento de id 1 da Vovó e o de id 1 do Vô
 * dariam a mesma string, e confirmar a dose de um CANCELARIA o alerta do outro — em silêncio.
 */
export function doseId(pid: string, medId: number, slot: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${pid}_${medId}_${slot.getFullYear()}${p(slot.getMonth() + 1)}${p(slot.getDate())}_${p(slot.getHours())}${p(slot.getMinutes())}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Primeira letra maiúscula — os nomes chegam como a pessoa digitou ("guard teste" → "Guard teste").
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Apelido vazio NUNCA cai no nome do perfil — seria exatamente o que o apelido veio evitar.
// O cuidador acompanha uma pessoa só; ele não precisa do nome para saber de quem se trata.
function apelido(cg: Caregiver): string {
  return cg.nickname?.trim() || 'A pessoa que você acompanha';
}

function frase(m: Extract<Msg, { t: 'event' }>): string {
  const nome = cap(m.name);
  const oQue = m.dose ? `${nome} ${m.dose}` : nome;
  switch (m.status) {
    case 'taken':   return `${m.nick} tomou ${oQue} (${hora(m.at)})`;
    case 'skipped': return `${m.nick} NÃO tomou ${oQue} (${hora(m.at)})`;
    case 'done':    return m.value
      ? `${m.nick}: ${nome} — ${m.value} (${hora(m.at)})`
      : `${m.nick} fez: ${nome} (${hora(m.at)})`;
  }
}

// ---------------------------------------------------------------------------
// LADO DO IDOSO — envia
// ---------------------------------------------------------------------------
async function enviar(cg: Caregiver, msg: Msg): Promise<boolean> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: cg.push_token,
      // Título e corpo são o que o Expo, o Google e a Apple conseguem ler — por isso não dizem
      // NADA. Nem o remédio, nem a dose, nem o apelido. O conteúdo vai cifrado em data.c.
      title: 'Alerta Médico',
      body: 'Novo aviso — toque para ver',
      // `p` vai em TEXTO porque o cuidador precisa saber qual chave usar antes de decifrar. É um
      // id aleatório do pareamento — não diz quem é ninguém, nem qual remédio. O conteúdo é `c`.
      data: { p: cg.pid, c: encrypt(JSON.stringify(msg), cg.key) },
      channelId: CAREGIVER_CHANNEL,
      priority: 'high',
      // Acorda o app do cuidador em segundo plano para ele CANCELAR a notificação local da dose.
      // Sem isto, um "Tomei" com o app do cuidador morto não cancela nada e o alerta dispara
      // mesmo o remédio tendo sido tomado.
      _contentAvailable: true,
    }),
  });
  // O Expo responde 200 mesmo recusando a mensagem — o veredito está no corpo. Um `return false`
  // silencioso aqui já me custou um ciclo inteiro de depuração: a agenda não chegava e nada
  // indicava o motivo. Quem chama PRECISA saber que o cuidador ficou sem ser avisado.
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.data?.status !== 'ok') {
    // A resposta de erro do Expo repete o push token do cuidador (ex.: "ExponentPushToken[…]
    // is not a registered push notification recipient"). Este erro sobe até o Sentry
    // (MedicationsScreen captura) — o token é identificador de dispositivo e não pode ir junto.
    const resumo = JSON.stringify(json?.data ?? json?.errors ?? json)
      ?.replace(/Expo(nent)?PushToken\[[^\]]*\]/g, 'PushToken[…]');
    throw new Error(`Expo recusou a mensagem (HTTP ${res.status}): ${resumo}`);
  }
  return true;
}

/** Uma resposta do idoso (Tomei / Não tomei / atividade). Silencioso se ninguém estiver pareado. */
export async function notifyCaregiver(e: CaregiverEvent): Promise<boolean> {
  const cg = await getCaregiver();
  if (!cg) return false;

  const id = e.medId != null
    ? doseId(cg.pid, e.medId, new Date(e.at))
    : `${cg.pid}_act_${e.at}`;
  return enviar(cg, {
    t: 'event', id, nick: apelido(cg),
    name: e.name, dose: e.dose, status: e.status, at: e.at, value: e.value,
  });
}

/**
 * Manda a agenda das próximas doses. É ela que permite ao cuidador saber o que COBRAR.
 * Chamada na abertura do app, no pareamento e quando os lembretes mudam.
 */
export async function syncCaregiverSchedule(): Promise<void> {
  const cg = await getCaregiver();
  if (!cg) return;

  const meds = await getMedications();
  const regras: MedRule[] = [];

  for (const med of meds) {
    // save_history=0 → "só alerta": o app não pergunta nada, logo não há resposta a cobrar.
    // Cobrar seria inventar uma falta que o app nunca deu chance de evitar.
    if (med.save_history === 0) continue;

    const reminders = (await getRemindersForMedication(med.id).catch(() => []))
      .filter(r => r.is_active && /^\d{1,2}:\d{2}$/.test(r.time));
    if (!reminders.length) continue;

    // Um medicamento pode ter horários com recorrências diferentes; uma regra por recorrência.
    const porPeriodo = new Map<string, string[]>();
    for (const r of reminders) {
      const p = r.period || 'day';
      if (!porPeriodo.has(p)) porPeriodo.set(p, []);
      porPeriodo.get(p)!.push(r.time);
    }
    for (const [p, horarios] of porPeriodo) {
      regras.push({
        i: med.id,
        n: med.commercial_name?.trim() || med.generic_name,
        d: med.dose ?? '',
        h: horarios.sort(),
        p,
      });
    }
  }

  await enviar(cg, { t: 'schedule', nick: apelido(cg), delayMin: cg.delay_minutes, meds: regras });
}

function ocorreNoDia(period: string | undefined, d: Date): boolean {
  const p = period || 'day';
  if (p === 'day') return true;
  if (p.startsWith('week:')) return p.split(':')[1].split(',').map(Number).includes(d.getDay() + 1);
  if (p.startsWith('month:')) return p.split(':')[1].split(',').map(Number).includes(d.getDate());
  return false;
}

// ---------------------------------------------------------------------------
// LADO DO CUIDADOR — recebe, agenda o alerta local, e o cancela na confirmação
// ---------------------------------------------------------------------------
export async function getPatients(): Promise<Patient[]> {
  const raw = await getKV(KV_PATIENTS);
  if (!raw) return [];
  try { return JSON.parse(raw) as Patient[]; } catch { return []; }
}

async function savePatients(ps: Patient[]): Promise<void> {
  await setKV(KV_PATIENTS, JSON.stringify(ps));
}

export async function getInbox(pid?: string): Promise<InboxItem[]> {
  const raw = await getKV(KV_INBOX);
  if (!raw) return [];
  try {
    const todos = JSON.parse(raw) as InboxItem[];
    return pid ? todos.filter(i => i.pid === pid) : todos;
  } catch {
    return [];
  }
}

// Mantém só os avisos das últimas `horas` de UMA pessoa e apaga os mais antigos (o pareamento e
// os avisos das outras pessoas ficam intactos). Para arrumar a lista sem desconectar.
export async function clearOldInbox(pid: string, horas = 24): Promise<void> {
  const limite = Date.now() - horas * 3600_000;
  const todos = await getInbox();
  await setKV(
    KV_INBOX,
    JSON.stringify(todos.filter(i => i.pid !== pid || new Date(i.at).getTime() >= limite))
  );
  emitInbox();
}

// Quem quer saber quando um aviso novo entra no inbox — a tela do Cuidador, para atualizar ao
// vivo em vez de esperar o usuário sair e voltar. Só vale com o app em primeiro plano (o ingest
// roda no mesmo contexto JS da UI); com o app fechado a tela nem está visível e recarrega ao abrir.
type InboxListener = () => void;
const inboxListeners = new Set<InboxListener>();
export function subscribeInbox(cb: InboxListener): () => void {
  inboxListeners.add(cb);
  return () => { inboxListeners.delete(cb); };
}
function emitInbox(): void {
  inboxListeners.forEach(cb => { try { cb(); } catch {} });
}

async function getMisses(): Promise<Miss[]> {
  const raw = await getKV(KV_MISSES);
  if (!raw) return [];
  try { return JSON.parse(raw) as Miss[]; } catch { return []; }
}

async function setMisses(m: Miss[]): Promise<void> {
  await setKV(KV_MISSES, JSON.stringify(m.slice(0, 300)));
}

// O idoso confirmou (ou foi removido): a cobrança daquela dose não é mais uma falta.
async function removeMiss(doseId: string): Promise<void> {
  const livro = await getMisses();
  if (livro.some(e => e.id === doseId)) {
    await setMisses(livro.filter(e => e.id !== doseId));
  }
}

// Varre o livro-razão: toda cobrança cujo horário já passou e que AINDA está lá (não foi
// confirmada) virou uma falta real → entra no histórico do cuidador. Chamada ao abrir o app e ao
// voltar do background — é o que registra a falta mesmo quando o alerta disparou com o app fechado.
export async function reconcileCaregiverMisses(): Promise<number> {
  const agora = Date.now();
  const livro = await getMisses();
  const vencidas = livro.filter(e => new Date(e.at).getTime() <= agora);
  if (!vencidas.length) return 0;

  const inbox = await getInbox();
  const jaTem = new Set(inbox.map(i => i.id).filter(Boolean));
  const novas = vencidas
    .filter(e => !jaTem.has(e.id)) // dedup: já registrada numa reconciliação anterior
    .map(e => ({ pid: e.pid, text: e.text, at: e.at, id: e.id }));

  // Grava no histórico ANTES de tirar do livro: se algo falhar no meio, na pior das hipóteses a
  // falta é reprocessada (o dedup por id evita duplicar) — nunca some em silêncio.
  if (novas.length) {
    await setKV(KV_INBOX, JSON.stringify([...novas, ...inbox].slice(0, 300)));
  }
  await setMisses(livro.filter(e => new Date(e.at).getTime() > agora));
  if (novas.length) emitInbox();
  return novas.length;
}

/** Remove uma pessoa acompanhada: a chave, o histórico dela e os alertas locais já marcados. */
export async function removePatient(pid: string): Promise<void> {
  await savePatients((await getPatients()).filter(p => p.pid !== pid));
  await setKV(KV_INBOX, JSON.stringify((await getInbox()).filter(i => i.pid !== pid)));
  await setMisses((await getMisses()).filter(e => e.pid !== pid));

  // Sem isto, os alertas locais dela continuariam disparando para sempre — cobrando doses de
  // alguém que o cuidador acabou de remover, e sem nenhuma forma de silenciá-los.
  const marcados = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of marcados) {
    if (n.identifier.startsWith(LOCAL_PREFIX + pid + '_')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }
}

/**
 * Monta um convite. Cada convite cria uma PESSOA nova: pid próprio e chave própria.
 * Chamar de novo não substitui ninguém — o cuidador pode acompanhar várias pessoas.
 */
export async function createInvite(myName: string, label = ''): Promise<string> {
  const pushToken = await getMyPushToken();
  const key = newSharedKey();
  const pid = novoPid();

  await savePatients([...(await getPatients()), { pid, key, nick: '', label: label.trim() }]);

  const q = new URLSearchParams({ n: myName, t: pushToken, k: key, p: pid });
  return `${PAIR_SCHEME}?${q.toString()}`;
}

// Id do pareamento: 12 caracteres aleatórios. Não é segredo (viaja em texto na push) e não
// identifica ninguém — só diz "esta mensagem é da conversa nº tal".
function novoPid(): string {
  const b = newSharedKey().replace(/[^a-zA-Z0-9]/g, '');
  return b.slice(0, 12);
}

export async function getMyPushToken(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') throw new Error('SEM_PERMISSAO_NOTIFICACAO');
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
}

export function parsePairingLink(url: string): Caregiver | null {
  if (!url.startsWith(PAIR_SCHEME)) return null;
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const name = q.get('n');
  const push_token = q.get('t');
  const key = q.get('k');
  const pid = q.get('p');
  if (!name || !push_token || !key || !pid) return null;
  return {
    name, push_token, key, pid,
    nickname: '',            // o idoso escolhe depois; vazio NÃO cai no nome do perfil
    delay_minutes: 30,
    paired_at: new Date().toISOString(),
  };
}

const LOCAL_PREFIX = 'cg_';

/**
 * Processa uma push recebida NESTE aparelho (sou o cuidador). Devolve o texto quando é um evento,
 * null quando é a agenda (que só reprograma os alertas) ou quando a push não é de cuidador.
 *
 * Estoura se a chave não bater — não engula: significa que alguém está mandando lixo, ou que o
 * pareamento foi refeito do outro lado e este aparelho parou de entender o que recebe.
 */
export async function ingestCaregiverPush(data: unknown): Promise<string | null> {
  const env = data as { p?: unknown; c?: unknown };
  if (typeof env?.c !== 'string' || typeof env?.p !== 'string') return null;

  const pacientes = await getPatients();
  const paciente = pacientes.find(p => p.pid === env.p);
  if (!paciente) return null; // não é de ninguém que este aparelho acompanha

  const msg = JSON.parse(decrypt(env.c, paciente.key)) as Msg;

  // O apelido chega em toda mensagem: é assim que o cuidador aprende como chamar a pessoa (o
  // convite é gerado antes de saber quem vai aceitar) e acompanha se ela mudar de ideia.
  if (msg.nick && msg.nick !== paciente.nick) {
    await savePatients(pacientes.map(p => (p.pid === paciente.pid ? { ...p, nick: msg.nick } : p)));
  }

  if (msg.t === 'schedule') {
    await reprogramarAlertas(paciente.pid, msg);
    return null;
  }

  // Chegou a resposta: a dose foi confirmada, então o alerta local DELA não deve mais disparar,
  // e ela deixa de ser uma cobrança pendente (senão a reconciliação a marcaria como falta).
  await Notifications.cancelScheduledNotificationAsync(LOCAL_PREFIX + msg.id).catch(() => {});
  await removeMiss(msg.id);

  const text = frase(msg);
  const atual = await getInbox();
  await setKV(
    KV_INBOX,
    JSON.stringify([{ pid: paciente.pid, text, at: new Date().toISOString(), id: msg.id }, ...atual].slice(0, 300))
  );
  emitInbox(); // atualiza a tela do Cuidador ao vivo se ela estiver aberta
  return text;
}

/**
 * Marca uma notificação LOCAL para cada dose da agenda, em (horário + tolerância).
 * É este alerta que dispara quando o idoso não responde — inclusive quando o celular dele está
 * desligado, que é o caso que o desenho antigo perdia em silêncio.
 *
 * O texto aqui é detalhado de propósito: esta notificação é local, nasce e morre no aparelho do
 * cuidador, e não passa por servidor nenhum.
 */
// O iOS descarta silenciosamente qualquer notificação local além de 64 PENDENTES NO APARELHO —
// não por pessoa acompanhada. Passar do teto faria as últimas doses simplesmente não serem
// cobradas, e ninguém saberia. Por isso o orçamento é DIVIDIDO entre as pessoas: cuidar de mais
// gente reduz o horizonte de cada uma, nunca faz alguém deixar de ser coberto.
const MAX_ALERTAS_APARELHO = 60;

async function reprogramarAlertas(pid: string, msg: Extract<Msg, { t: 'schedule' }>): Promise<void> {
  // Limpa SÓ os alertas DESTA pessoa antes de remarcar. O prefixo tem que incluir o pid: apagar
  // por `LOCAL_PREFIX` puro varreria também os alertas das OUTRAS pessoas acompanhadas, e elas
  // deixariam de ser cobradas — em silêncio, e sem nada ligando a causa ao efeito.
  const meu = LOCAL_PREFIX + pid + '_';
  const marcados = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of marcados) {
    if (n.identifier.startsWith(meu)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }

  const agora = Date.now();
  const alertas: { quando: number; id: string; texto: string }[] = [];

  // Doses que o idoso JÁ respondeu (tomou/não tomou) estão no histórico com seu doseId. Reenviar a
  // agenda NÃO pode ressuscitar a cobrança delas: seria uma "não confirmou" contradizendo uma dose
  // já respondida. O histórico é a memória do que já foi resolvido.
  const respondidas = new Set((await getInbox()).map(i => i.id).filter(Boolean));

  for (const med of msg.meds) {
    for (let d = 0; d <= HORIZONTE_DIAS; d++) {
      const dia = new Date();
      dia.setDate(dia.getDate() + d);
      if (!ocorreNoDia(med.p, dia)) continue;

      for (const hhmm of med.h) {
        const [h, m] = hhmm.split(':').map(Number);
        const slot = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), h, m, 0, 0);
        const quando = slot.getTime() + msg.delayMin * 60_000;
        if (quando <= agora) continue;

        const id = doseId(pid, med.i, slot);
        if (respondidas.has(id)) continue; // já respondida — não cobrar de novo

        const nome = cap(med.n);
        const oQue = med.d ? `${nome} ${med.d}` : nome;
        alertas.push({
          quando,
          id,
          texto: `${msg.nick} não confirmou ${oQue} (${hhmm})`,
        });
      }
    }
  }

  // As doses mais próximas primeiro: se o teto cortar alguma, que seja a mais distante — ela
  // será remarcada na próxima agenda que chegar.
  alertas.sort((a, b) => a.quando - b.quando);

  const quantasPessoas = Math.max(1, (await getPatients()).length);
  const cota = Math.floor(MAX_ALERTAS_APARELHO / quantasPessoas);

  const agendados = alertas.slice(0, cota);
  for (const a of agendados) {
    await Notifications.scheduleNotificationAsync({
      identifier: LOCAL_PREFIX + a.id,
      content: { title: 'Alerta Médico', body: a.texto, data: { local: true } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(a.quando),
        channelId: CAREGIVER_CHANNEL,
      },
    }).catch(() => {});
  }

  // Espelha as cobranças agendadas no livro-razão: troca as FUTURAS desta pessoa pelas recém-marcadas,
  // mas preserva as já vencidas (podem aguardar reconciliação) e todas as de outras pessoas.
  const agoraMs = Date.now();
  const novos: Miss[] = agendados.map(a => ({
    pid, id: a.id, at: new Date(a.quando).toISOString(), text: a.texto,
  }));
  const idsNovos = new Set(novos.map(n => n.id));
  const preservados = (await getMisses()).filter(
    e => e.id && !idsNovos.has(e.id) && (e.pid !== pid || new Date(e.at).getTime() <= agoraMs)
  );
  await setMisses([...preservados, ...novos]);
}

// A tarefa que acorda o app do cuidador quando a push chega com ele MORTO. É ela que cancela o
// alerta local de uma dose confirmada sem ninguém abrir nada — sem ela, toda dose TOMADA geraria
// um alerta falso de "não confirmou".
//
// defineTask FICA NO ESCOPO GLOBAL DO MÓDULO, e isso não é estilo: quando o Android acorda o app
// em modo headless para entregar a push, o React NÃO MONTA — só o escopo global do bundle roda.
// Definindo dentro de um useEffect, a tarefa só existiria com o app aberto, ou seja, jamais no
// cenário para o qual ela foi criada.
TaskManager.defineTask(CAREGIVER_TASK, async ({ data, error }: any) => {
  if (error) return;
  const payload = data?.notification?.request?.content?.data
    ?? data?.notification?.data
    ?? data;
  await ingestCaregiverPush(payload).catch(() => {});
});

export function registerCaregiverTask(): void {
  Notifications.registerTaskAsync(CAREGIVER_TASK).catch(() => {});
}
