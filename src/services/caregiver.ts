import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import appJson from '../../app.json';
import { getCaregiver, getProfile, getKV, setKV, Caregiver } from '../database/db';

// ---------------------------------------------------------------------------
// Cuidador: uma pessoa recebe, por notificação, o que aconteceu com os remédios e as
// atividades do idoso.
//
// COMO O CONTEÚDO CLÍNICO NÃO VAZA
// A push atravessa os servidores do Expo e do Google (FCM). O que vai VISÍVEL nela é genérico
// ("Novo aviso sobre a Maria"). O conteúdo — qual remédio, qual dose, qual pressão — vai só no
// campo `data`, cifrado em AES-GCM com a chave que os dois trocaram no pareamento. O cuidador
// toca na notificação, o app abre, decifra e mostra. Expo e Google carregam um blob opaco.
//
// POR QUE A CIFRA É NATIVA
// Não é preciosismo: o aviso de "sem resposta" precisa sair com o app MORTO (é a definição de
// sem resposta — ninguém tocou em nada), e lá não existe runtime de JS. A cifra tem que existir
// em Kotlin de qualquer jeito, então o JS chama a MESMA implementação (CaregiverCrypto.kt) em
// vez de trazer uma biblioteca de cripto para o package.json.
//
// SEM SERVIDOR
// O POST vai direto do aparelho do idoso para o serviço de push do Expo. Não há backend, não há
// contas, não há mensalidade — o app continua sendo local.
// ---------------------------------------------------------------------------

// Lido do app.json, NUNCA copiado para cá. O token de push é emitido por projectId: com o valor
// errado, o Expo entrega o token de outro projeto e a push some sem erro nenhum. E este id muda
// sozinho — o `eas` o reescreve ao (re)vincular o projeto. Uma cópia aqui envelheceria calada.
const EAS_PROJECT_ID: string = (appJson as any).expo?.extra?.eas?.projectId;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PAIR_SCHEME = 'alertamedico://cuidador';

export const CAREGIVER_CHANNEL = 'caregiver_alerts';

const Med = NativeModules.MedNotification as {
  caregiverNewKey(): Promise<string>;
  caregiverEncrypt(plaintext: string, keyB64: string): Promise<string>;
  caregiverDecrypt(payloadB64: string, keyB64: string): Promise<string>;
};

export type CaregiverEvent = {
  kind: 'med' | 'activity';
  name: string;
  status: 'taken' | 'skipped' | 'no_response' | 'done';
  at: string;          // ISO do horário AGENDADO (não o de agora)
  dose?: string;
  value?: string;      // medições: "12/8", "110 mg/dL"
};

// O nome do paciente vai CIFRADO, junto com o resto. Poderia ir no corpo visível da push ("Novo
// aviso sobre a Maria"), o que seria mais bonito — mas entregaria a identificação ao Expo e ao
// Google de graça, e o cuidador acompanha uma pessoa só: ele não precisa do nome no banner.
type SealedPayload = CaregiverEvent & { patient: string };

export function describeEvent(e: SealedPayload): string {
  const hora = new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const oQue = e.dose ? `${e.name} ${e.dose}` : e.name;
  switch (e.status) {
    case 'taken':       return `${e.patient} tomou ${oQue} (${hora})`;
    case 'skipped':     return `${e.patient} NÃO tomou ${oQue} (${hora})`;
    case 'no_response': return `${e.patient} não respondeu ao aviso de ${oQue} (${hora})`;
    case 'done':        return e.value
      ? `${e.patient}: ${e.name} — ${e.value} (${hora})`
      : `${e.patient} fez: ${e.name} (${hora})`;
  }
}

// ---------------------------------------------------------------------------
// O LADO DE QUEM CUIDA
//
// Quem GERA a chave é o cuidador, ao montar o convite — e ele precisa guardá-la, senão recebe a
// push cifrada e não consegue abrir a própria mensagem. Duas chaves distintas no kv_store:
//   caregiver         → "quem cuida de MIM" (gravado pelo idoso ao tocar no link)
//   caregiver_my_key  → "a chave que EU gerei para cuidar de alguém" (gravado pelo cuidador)
// Um mesmo aparelho pode ter as duas: nada impede que duas pessoas se cuidem mutuamente.
// ---------------------------------------------------------------------------
const KV_MY_KEY = 'caregiver_my_key';
const KV_INBOX = 'caregiver_inbox';

export type InboxItem = { text: string; at: string };

export async function getMyCaregiverKey(): Promise<string | null> {
  return getKV(KV_MY_KEY);
}

export async function getInbox(): Promise<InboxItem[]> {
  const raw = await getKV(KV_INBOX);
  if (!raw) return [];
  try { return JSON.parse(raw) as InboxItem[]; } catch { return []; }
}

export async function addToInbox(item: InboxItem): Promise<void> {
  const atual = await getInbox();
  await setKV(KV_INBOX, JSON.stringify([item, ...atual].slice(0, 100)));
}

/** Monta o convite: gera a chave, guarda a MINHA cópia dela e devolve o link para compartilhar. */
export async function createInvite(myName: string): Promise<string> {
  const [pushToken, key] = await Promise.all([getMyPushToken(), Med.caregiverNewKey()]);
  await setKV(KV_MY_KEY, key);
  return buildPairingLink(myName, pushToken, key);
}

/**
 * Recebe uma push que chegou neste aparelho. Decifra, guarda na caixa e devolve a frase pronta.
 * Devolve null quando a push não é de cuidador (ou este aparelho não cuida de ninguém).
 * Estoura se a chave não bater — o GCM detecta adulteração, e engolir isso seria esconder que
 * alguém está mandando lixo para o cuidador.
 */
export async function ingestCaregiverPush(data: unknown): Promise<string | null> {
  const sealed = (data as { c?: unknown })?.c;
  if (typeof sealed !== 'string') return null;

  const key = await getMyCaregiverKey();
  if (!key) return null;

  const payload = JSON.parse(await Med.caregiverDecrypt(sealed, key)) as SealedPayload;
  const text = describeEvent(payload);
  await addToInbox({ text, at: new Date().toISOString() });
  return text;
}

/** Token de push DESTE aparelho — é o que o cuidador põe no link de convite. */
export async function getMyPushToken(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') throw new Error('SEM_PERMISSAO_NOTIFICACAO');
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  return token.data;
}

export function buildPairingLink(name: string, pushToken: string, key: string): string {
  const q = new URLSearchParams({ n: name, t: pushToken, k: key });
  return `${PAIR_SCHEME}?${q.toString()}`;
}

/** Devolve o cuidador contido num link de convite, ou null se o link não for um convite válido. */
export function parsePairingLink(url: string): Caregiver | null {
  if (!url.startsWith(PAIR_SCHEME)) return null;
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const name = q.get('n');
  const push_token = q.get('t');
  const key = q.get('k');
  if (!name || !push_token || !key) return null;
  return { name, push_token, key, delay_minutes: 30, paired_at: new Date().toISOString() };
}

/**
 * Envia um evento ao cuidador. Silencioso se não houver ninguém pareado.
 *
 * Devolve true só quando o Expo ACEITOU a mensagem. Quem chama decide o que fazer com um false —
 * mas nunca deixe o erro sumir: um cuidador que não recebe o aviso é pior do que nenhum
 * cuidador, porque ele confia no silêncio.
 */
export async function notifyCaregiver(e: CaregiverEvent): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const cg = await getCaregiver();
  if (!cg) return false;

  const profile = await getProfile();
  const patient = profile?.name?.trim() || 'A pessoa que você cuida';

  const payload: SealedPayload = { ...e, patient };
  const sealed = await Med.caregiverEncrypt(JSON.stringify(payload), cg.key);

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: cg.push_token,
      // Título e corpo são o que o Expo e o Google conseguem ler — por isso não dizem NADA.
      // O conteúdo real vai em `data.c`, cifrado. O Android exibe este texto sozinho, sem JS;
      // se o app do cuidador não conseguir acordar para decifrar, ele ainda vê que há um aviso.
      title: 'Alerta Médico',
      body: 'Novo aviso — toque para ver',
      data: { c: sealed },
      channelId: CAREGIVER_CHANNEL,
      priority: 'high',
    }),
  });

  if (!res.ok) return false;
  const json = await res.json().catch(() => null);
  return json?.data?.status === 'ok';
}
