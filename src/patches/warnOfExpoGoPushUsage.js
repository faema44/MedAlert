let didWarn = false;
export const warnOfExpoGoPushUsage = () => {
  if (!didWarn) {
    didWarn = true;
    console.warn('[expo-notifications] Push notifications (remote) not available in Expo Go SDK 53+. Use a development build for full functionality.');
  }
};
