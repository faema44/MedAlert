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

const KV_MY_KEY = 'caregiver_my_key';   // a chave que EU gerei para cuidar de alguém
const KV_INBOX = 'caregiver_inbox';
const HORIZONTE_DIAS = 3;

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

export type InboxItem = { text: string; at: string };

/** Identidade da dose. Os dois lados calculam a MESMA string, senão o cancelamento não casa. */
export function doseId(medId: number, slot: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${medId}_${slot.getFullYear()}${p(slot.getMonth() + 1)}${p(slot.getDate())}_${p(slot.getHours())}${p(slot.getMinutes())}`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Apelido vazio NUNCA cai no nome do perfil — seria exatamente o que o apelido veio evitar.
// O cuidador acompanha uma pessoa só; ele não precisa do nome para saber de quem se trata.
function apelido(cg: Caregiver): string {
  return cg.nickname?.trim() || 'A pessoa que você acompanha';
}

function frase(m: Extract<Msg, { t: 'event' }>): string {
  const oQue = m.dose ? `${m.name} ${m.dose}` : m.name;
  switch (m.status) {
    case 'taken':   return `${m.nick} tomou ${oQue} (${hora(m.at)})`;
    case 'skipped': return `${m.nick} NÃO tomou ${oQue} (${hora(m.at)})`;
    case 'done':    return m.value
      ? `${m.nick}: ${m.name} — ${m.value} (${hora(m.at)})`
      : `${m.nick} fez: ${m.name} (${hora(m.at)})`;
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
      data: { c: encrypt(JSON.stringify(msg), cg.key) },
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
    throw new Error(
      `Expo recusou a mensagem (HTTP ${res.status}): ${JSON.stringify(json?.data ?? json?.errors ?? json)}`
    );
  }
  return true;
}

/** Uma resposta do idoso (Tomei / Não tomei / atividade). Silencioso se ninguém estiver pareado. */
export async function notifyCaregiver(e: CaregiverEvent): Promise<boolean> {
  const cg = await getCaregiver();
  if (!cg) return false;

  const id = e.medId != null ? doseId(e.medId, new Date(e.at)) : `act_${e.at}`;
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
export async function getMyCaregiverKey(): Promise<string | null> {
  return getKV(KV_MY_KEY);
}

export async function getInbox(): Promise<InboxItem[]> {
  const raw = await getKV(KV_INBOX);
  if (!raw) return [];
  try { return JSON.parse(raw) as InboxItem[]; } catch { return []; }
}

/** Monta o convite: gera a chave, guarda a MINHA cópia dela e devolve o link para compartilhar. */
export async function createInvite(myName: string): Promise<string> {
  const [pushToken, key] = await Promise.all([getMyPushToken(), Promise.resolve(newSharedKey())]);
  await setKV(KV_MY_KEY, key);
  const q = new URLSearchParams({ n: myName, t: pushToken, k: key });
  return `${PAIR_SCHEME}?${q.toString()}`;
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
  if (!name || !push_token || !key) return null;
  return {
    name, push_token, key,
    nickname: '',            // o idoso escolhe depois; vazio = usa o nome do perfil
    delay_minutes: 30,
    paired_at: new Date().toISOString(),
  };
}

const LOCAL_PREFIX = 'cg_';

/**
 * Processa uma push recebida NESTE aparelho (sou o cuidador). Devolve o texto quando é um evento,
 * null quando é a agenda (que não vira notificação, só reprograma os alertas) ou quando a push
 * não é de cuidador.
 *
 * Estoura se a chave não bater — não engula: significa que alguém está mandando lixo, ou que o
 * pareamento foi refeito do outro lado e este aparelho parou de entender o que recebe.
 */
export async function ingestCaregiverPush(data: unknown): Promise<string | null> {
  const sealed = (data as { c?: unknown })?.c;
  if (typeof sealed !== 'string') return null;

  const key = await getMyCaregiverKey();
  if (!key) return null;

  const msg = JSON.parse(decrypt(sealed, key)) as Msg;

  if (msg.t === 'schedule') {
    await reprogramarAlertas(msg);
    return null;
  }

  // Chegou a resposta: a dose foi confirmada, então o alerta local dela não deve mais disparar.
  await Notifications.cancelScheduledNotificationAsync(LOCAL_PREFIX + msg.id).catch(() => {});

  const text = frase(msg);
  const atual = await getInbox();
  await setKV(KV_INBOX, JSON.stringify([{ text, at: new Date().toISOString() }, ...atual].slice(0, 100)));
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
// O iOS descarta silenciosamente qualquer notificação local além de 64 pendentes. Ficar abaixo
// disso é obrigação, não zelo: passar do teto faria as últimas doses simplesmente não serem
// cobradas, e ninguém saberia. Com 3 dias de horizonte, sobra folga para uma rotina pesada.
const MAX_ALERTAS = 60;

async function reprogramarAlertas(msg: Extract<Msg, { t: 'schedule' }>): Promise<void> {
  // Limpa os alertas antigos antes de remarcar: sem isso, um medicamento removido ou um horário
  // alterado continuaria cobrando para sempre uma dose que já não existe.
  const marcados = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of marcados) {
    if (n.identifier.startsWith(LOCAL_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }

  const agora = Date.now();
  const alertas: { quando: number; id: string; texto: string }[] = [];

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

        const oQue = med.d ? `${med.n} ${med.d}` : med.n;
        alertas.push({
          quando,
          id: doseId(med.i, slot),
          texto: `${msg.nick} não confirmou ${oQue} (${hhmm})`,
        });
      }
    }
  }

  // As doses mais próximas primeiro: se o teto cortar alguma, que seja a mais distante — ela
  // será remarcada na próxima agenda que chegar.
  alertas.sort((a, b) => a.quando - b.quando);

  for (const a of alertas.slice(0, MAX_ALERTAS)) {
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
