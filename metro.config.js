const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Push-only modules removed from Expo Go SDK 53+ — redirect to stubs so the
// app can run in Expo Go without crashing at module initialization.
const PUSH_MODULE_STUBS = {
  'warnOfExpoGoPushUsage': path.resolve(__dirname, 'src/patches/warnOfExpoGoPushUsage.js'),
  'TopicSubscriptionModule': path.resolve(__dirname, 'src/patches/pushModuleStub.js'),
  'TopicSubscriptionModule.android': path.resolve(__dirname, 'src/patches/pushModuleStub.js'),
  'PushTokenManager': path.resolve(__dirname, 'src/patches/pushModuleStub.js'),
  'PushTokenManager.native': path.resolve(__dirname, 'src/patches/pushModuleStub.js'),
};

const original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [key, filePath] of Object.entries(PUSH_MODULE_STUBS)) {
    if (moduleName.endsWith('/' + key) || moduleName.endsWith('\\' + key)) {
      return { filePath, type: 'sourceFile' };
    }
  }
  if (original) return original(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
