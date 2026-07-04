import { NativeModules, Platform } from 'react-native';

const { MedNotification } = NativeModules;

export function postMedNotification(
  title: string,
  contentText: string,
  bigText: string,
  channelId: string
): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.postNotification(title, contentText, bigText, channelId)?.catch?.(() => {});
}

export function cancelMedNotification(): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.cancelNotification()?.catch?.(() => {});
}

// setShowWhen(false) nativo — esconde o carimbo de hora que o Android mostra por
// padrão (reflete quando a notificação foi postada, não o horário do remédio).
export function postSimpleNotification(
  title: string,
  body: string,
  channelId: string,
  notifId: number
): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.postSimpleNotification(title, body, channelId, notifId)?.catch?.(() => {});
}

export function cancelSimpleNotification(notifId: number): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.cancelSimpleNotification(notifId)?.catch?.(() => {});
}
