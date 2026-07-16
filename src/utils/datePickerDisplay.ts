import { Platform } from 'react-native';

// 'calendar' e 'clock' só existem no Android. O conversor de enum do iOS
// (RNDateTimePickerManager.m) aceita apenas default/compact/spinner/inline e ABORTA o app
// (SIGABRT em displayIOS) com qualquer outro valor. Os equivalentes mais próximos — e os
// maiores, que é o que importa para o público do app — são inline (calendário) e spinner (roda).
export const DATE_DISPLAY = Platform.OS === 'ios' ? 'inline' : 'calendar';
export const TIME_DISPLAY = Platform.OS === 'ios' ? 'spinner' : 'clock';
