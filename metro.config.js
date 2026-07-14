const { getDefaultConfig } = require('expo/metro-config');

// Havia aqui um resolver que trocava PushTokenManager, TopicSubscriptionModule e
// warnOfExpoGoPushUsage por stubs vazios (src/patches/). Existia para o app não crashar no
// Expo Go, que perdeu o push no SDK 53+.
//
// REMOVIDO em 14/07/2026: o resolver valia para TODOS os bundles, inclusive o APK de release.
// Com o stub no lugar, `getDevicePushTokenAsync` não existia e o app NUNCA conseguiria emitir um
// token de push em produção — falhava com ERR_UNAVAILABLE ("are you sure you've linked all the
// native dependencies properly?"), uma mensagem que aponta para o lado nativo e esconde que a
// causa estava aqui, no bundler. Ficou invisível por meses porque o app não usava push.
//
// E o cenário que ele protegia já não existe: o app tem módulo nativo próprio
// (MedNotificationModule.kt), que o Expo Go não carrega de jeito nenhum. O fluxo é bare
// workflow (`npm run android`). Se um dia o Expo Go voltar a ser usado, o push terá que ser
// desligado por outro caminho — não por um stub que também vaza para a produção.
module.exports = getDefaultConfig(__dirname);
