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

// Agenda do banner "Próximo medicamento": JSON de [{ ms, title, body }] com as doses de
// hoje. O nativo posta a próxima e reagenda um alarme exato em cada horário para avançar
// o banner sozinho (mesmo com o app fechado). Passar "[]" limpa o banner.
export function setNextMedSchedule(scheduleJson: string): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.setNextMedSchedule?.(scheduleJson)?.catch?.(() => {});
}

export function cancelNextMedBanner(): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.cancelNextMedBanner?.()?.catch?.(() => {});
}

// O card de emergência é ongoing, mas o Samsung o remove ao chegar um heads-up. Sem
// checar a presença real, a assinatura em cache faz o app achar que ainda está na tela
// e nunca repostar. undefined (método ausente em build antigo) → assume ativo.
export async function isEmergencyActive(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await MedNotification?.isEmergencyActive?.();
    return res === undefined ? true : !!res;
  } catch {
    return true;
  }
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await MedNotification?.isIgnoringBatteryOptimizations?.();
    return res === undefined ? true : !!res;
  } catch {
    return true;
  }
}

export function requestIgnoreBatteryOptimizations(): void {
  if (Platform.OS !== 'android') return;
  MedNotification?.requestIgnoreBatteryOptimizations?.()?.catch?.(() => {});
}

/**
 * Entrega ao widget o que ele deve mostrar.
 *
 * Só Android: no iOS o widget exigiria um target WidgetKit, que é outra história (ver
 * project_widget_adiado). O `?.` protege quem está num build sem o módulo nativo — melhor o
 * widget ficar parado que o app quebrar por causa dele.
 */
export function setWidgetData(json: string): void {
  if (Platform.OS !== 'android') return;
  // console.warn e não catch vazio: se a gravação falha, o widget continua mostrando o plano
  // antigo na tela inicial e NADA dentro do app contradiz isso. Sem o aviso, a falha é
  // literalmente invisível. (Não usa relatarFalhaSilenciosa para não criar import circular
  // com notifications.ts, que importa este arquivo.)
  MedNotification?.setWidgetData?.(json)?.catch?.((e: unknown) => {
    console.warn('[widget] setWidgetData falhou — a tela inicial fica com o dado antigo', e);
  });
}
