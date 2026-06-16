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
