// Ficha Médica (Medical ID) do iPhone.
//
// O iOS não deixa nenhum app ler nem escrever a Ficha Médica — nem a Apple expõe API pra isso.
// Então aqui o app NÃO configura nada: ele só (1) ajuda a pessoa a copiar a lista de remédios
// pra colar no app Saúde e (2) lembra quando os remédios mudam, pra ela não esquecer de atualizar.
// Nunca afirmamos que está feito, porque não temos como conferir.
//
// Tudo aqui é no-op fora do iOS.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { getKV, setKV, getMedications } from '../database/db';
import { Medication } from '../types';

const KV_OPTIN = 'medid_optin';       // '1' = usa o Medical ID e quer os lembretes
const KV_ACK_SIG = 'medid_ack_sig';   // assinatura da lista que a pessoa disse já ter atualizado
const KV_NOTIF_SIG = 'medid_notif_sig'; // assinatura já notificada (evita re-disparar a cada abertura)
const NOTIF_ID = 'medid_update';

// Só entra na Ficha Médica o que a pessoa realmente toma: ativos e não suspensos.
// getMedications() já exclui os arquivados (removidos), então um remédio removido some da
// assinatura → a lista "mudou" → lembrete. (Nome + dose, ordenados, pra ser estável.)
export function medListSignature(meds: Medication[]): string {
  return meds
    .filter(m => !m.suspended)
    .map(m => `${(m.generic_name || m.commercial_name || '').trim().toLowerCase()}|${(m.dose || '').trim().toLowerCase()}`)
    .sort()
    .join('\n');
}

// Texto pronto pra colar no campo Medicamentos da Ficha Médica.
export function buildMedListText(meds: Medication[]): string {
  return meds
    .filter(m => !m.suspended)
    .map(m => {
      const name = (m.commercial_name || m.generic_name || '').trim();
      const dose = (m.dose || '').trim();
      return dose ? `${name} — ${dose}` : name;
    })
    .filter(Boolean)
    .join('\n');
}

export async function getMedIdOptIn(): Promise<boolean> {
  return (await getKV(KV_OPTIN)) === '1';
}

// Liga/desliga. Ao LIGAR, marca a lista atual como baseline — assim o aviso de "mudou" só
// aparece em mudanças FUTURAS, não pelos remédios que já existiam. Ao DESLIGAR, apaga o lembrete.
export async function setMedIdOptIn(on: boolean): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await setKV(KV_OPTIN, on ? '1' : '0');
  if (on) {
    const meds = await getMedications();
    await setKV(KV_ACK_SIG, medListSignature(meds));
    await setKV(KV_NOTIF_SIG, '');
  } else {
    await clearReminder();
  }
}

async function clearReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIF_ID).catch(() => {});
  await Notifications.dismissNotificationAsync(NOTIF_ID).catch(() => {});
  await setKV(KV_NOTIF_SIG, '');
}

// Há atualização pendente? (opt-in ligado e a lista mudou desde o último "já atualizei".)
export async function isMedicalIdPending(meds?: Medication[]): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (!(await getMedIdOptIn())) return false;
  const list = meds ?? await getMedications();
  const ack = (await getKV(KV_ACK_SIG)) ?? '';
  return medListSignature(list) !== ack;
}

// Chamado depois de qualquer mudança na lista de remédios. Se opt-in e a lista mudou, dispara
// UMA notificação por assinatura nova (não re-dispara a cada abertura). O aviso na tela é o
// sinal durável; a notificação é só o empurrão de fora.
export async function syncMedicalIdReminder(meds?: Medication[]): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!(await getMedIdOptIn())) return;
  const list = meds ?? await getMedications();
  const sig = medListSignature(list);
  const ack = (await getKV(KV_ACK_SIG)) ?? '';
  if (sig === ack) { await clearReminder(); return; }
  if (((await getKV(KV_NOTIF_SIG)) ?? '') === sig) return; // já avisamos desta mudança
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: 'Atualize sua Ficha Médica',
        body: 'Seus remédios mudaram. Abra o app Saúde e atualize os medicamentos da Ficha Médica (Medical ID) do iPhone.',
      },
      trigger: null, // imediato
    });
    await setKV(KV_NOTIF_SIG, sig);
  } catch (e) {
    // Se o lembrete não disparar, o aviso dentro do app ainda cobre — mas não engolir em silêncio.
    console.warn('[medicalId] falha ao agendar lembrete', e);
    Sentry.captureException(e);
  }
}

// "Já atualizei": passa a considerar a lista atual como a que está na Ficha Médica.
export async function ackMedicalIdUpdate(): Promise<void> {
  const meds = await getMedications();
  await setKV(KV_ACK_SIG, medListSignature(meds));
  await clearReminder();
}
