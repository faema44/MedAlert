import React, { useCallback, useEffect, useState, Component } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppState, Modal, StyleSheet, Text, View, Image, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: any) { return { error: String(e?.message ?? e) }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' }}>
          <Text style={{ color: 'red', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Erro no render:</Text>
          <Text style={{ color: '#333', fontSize: 13 }}>{this.state.error}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MedicationsScreen from './src/screens/MedicationsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import InteractionsScreen from './src/screens/InteractionsScreen';
import AgendaScreen from './src/screens/AgendaScreen';
import HelpScreen from './src/screens/HelpScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import EmergencyScreen from './src/screens/EmergencyScreen';
import {
  setupNotificationChannels, requestPermissions, setupReminderCategory,
  initReminderListeners, initActivityListeners, initResponseListeners, dismissNotification,
  ActivityAlertPayload,
  scheduleRepeatAlarm, cancelRepeatAlarm, rescheduleAllActiveNotifications,
  snoozeActivityReminder, getLastResponse, notifyTreatmentEnded, notifyLowStock, cancelAllRemindersForMedication,
  dismissStaleNonInteractiveReminders,
} from './src/services/notifications';
import { getDb, getMedications, getActivities, getMedicationById, updateMedicationStock, addActivityLog, getKV, setKV, addMedicationLog, upsertMedicationLogTaken, archiveMedication, getExpiredUnarchivedMedications, getRemindersForMedication, getMedicationLog } from './src/database/db';
import { syncMedicationsDb, syncInteractionsDb } from './src/services/dbSync';

const Tab = createBottomTabNavigator();

const TITLES: Record<string, string> = {
  Home: 'Alerta Médico',
  Profile: 'Perfil Médico',
  Medications: 'Medicamentos',
  Contacts: 'Contatos',
  Agenda: 'Atividades',
  Interactions: 'Tabelas',
  Help: 'Ajuda',
  History: 'Histórico',
  Emergency: 'Emergência',
};

const TAB_ICONS: Record<string, { icon: string; activeIcon: string }> = {
  Home:         { icon: '⌂',  activeIcon: '⌂' },
  Profile:      { icon: '◯',  activeIcon: '●' },
  Medications:  { icon: '✦',  activeIcon: '✦' },
  Contacts:     { icon: '☎',  activeIcon: '☎' },
  Interactions: { icon: '≡',  activeIcon: '≡' },
};

function HeaderTitle({ route }: { route: { name: string } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Image
        source={require('./assets/icon.png')}
        style={{ width: 28, height: 28, borderRadius: 7 }}
      />
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 17 }}>
        {TITLES[route.name] ?? route.name}
      </Text>
    </View>
  );
}

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home:         '🏠',
    Profile:      '👤',
    Medications:  '💊',
    Contacts:     '📞',
    Agenda:       '📅',
    Interactions: '📋',
    History:      '📋',
  };
  if (name === 'Emergency') {
    return (
      <View style={{ alignItems: 'center' }}>
        <View style={{
          width: 22, height: 22, borderRadius: 11,
          backgroundColor: '#CC0000', alignItems: 'center', justifyContent: 'center',
          opacity: focused ? 1 : 0.75,
        }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 15 }}>+</Text>
        </View>
        {focused && (
          <View style={{
            width: 4, height: 4, borderRadius: 2,
            backgroundColor: '#1C3F7A', marginTop: 2,
          }} />
        )}
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.55 }}>
        {icons[name] ?? '•'}
      </Text>
      {focused && (
        <View style={{
          width: 4, height: 4, borderRadius: 2,
          backgroundColor: '#1C3F7A', marginTop: 2,
        }} />
      )}
    </View>
  );
}

const navRef = createNavigationContainerRef<any>();

async function checkLowStockAndNotify(medicationId: number, medName: string, newStock: number) {
  const [reminders, med] = await Promise.all([
    getRemindersForMedication(medicationId).catch(() => []),
    getMedicationById(medicationId).catch(() => null),
  ]);
  const dailyDoses = (reminders as any[]).filter(r => r.is_active).length || 1;
  const daysLeft = Math.floor(newStock / dailyDoses);

  if (med?.end_date) {
    const daysUntilEnd = Math.ceil((new Date(med.end_date + 'T23:59:59').getTime() - Date.now()) / 86400000);
    if (daysLeft >= daysUntilEnd) return; // stock cobre o restante do tratamento
  }

  if (daysLeft <= 3) {
    await notifyLowStock(medicationId, medName, daysLeft).catch(() => {});
  }
}

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const [dbReady, setDbReady] = useState(false);
  const [medCount, setMedCount] = useState(0);
  const [activityCount, setActivityCount] = useState(0);
  const [activityAlert, setActivityAlert] = useState<ActivityAlertPayload | null>(null);

  const loadCounts = useCallback(async () => {
    const [meds, activities] = await Promise.all([getMedications(), getActivities()]);
    setMedCount(meds.length);
    setActivityCount(activities.length);
  }, []);

  useEffect(() => {
    async function init() {
      await getDb();
      setDbReady(true);

      // Check for medications with expired treatment date
      try {
        const expired = await getExpiredUnarchivedMedications();
        for (const med of expired) {
          await cancelAllRemindersForMedication(med.id).catch(() => {});
          const displayName = med.commercial_name?.trim() || med.generic_name;
          await notifyTreatmentEnded(med.id, displayName).catch(() => {});
        }
      } catch {}

      // Rede de segurança: se o app foi morto entre um lembrete "não interativo" disparar
      // e o timer de dispensa (15 min) rodar, limpa qualquer alerta esquecido na tela.
      dismissStaleNonInteractiveReminders().catch(() => {});

      // Process any "Tomei"/"Pular" tapped on the lock screen while the app was killed.
      // addNotificationResponseReceivedListener doesn't fire in that scenario (opensAppToForeground: false),
      // so we pick it up here on the next cold-start.
      try {
        const lastResponse = await getLastResponse();
        if (lastResponse) {
          const notifId = lastResponse.notification.request.identifier;
          const processedId = await getKV('last_notif_response_id').catch(() => null);
          if (processedId !== notifId) {
            const data = lastResponse.notification.request.content.data as any;
            const actionId = lastResponse.actionIdentifier;
            if (data?.type === 'reminder') {
              const medId = data.medicationId as number;
              const medName = (data.name as string) ?? '';
              const medDose = (data.dose as string) ?? '';
              if (actionId === 'TOOK') {
                cancelRepeatAlarm(medId).catch(() => {});
                upsertMedicationLogTaken(notifId, medId, medName, medDose, true).catch(() => {});
                const med = await getMedicationById(medId).catch(() => null);
                if (med?.stock_quantity != null && med.stock_quantity > 0) {
                  const next = med.stock_quantity - 1;
                  await updateMedicationStock(medId, next).catch(() => {});
                  const displayName = med.commercial_name?.trim() || med.generic_name;
                  checkLowStockAndNotify(medId, displayName, next).catch(() => {});
                }
                dismissNotification(notifId).catch(() => {});
              } else if (actionId === 'SKIP') {
                cancelRepeatAlarm(medId).catch(() => {});
                upsertMedicationLogTaken(notifId, medId, medName, medDose, false).catch(() => {});
                dismissNotification(notifId).catch(() => {});
              }
              await setKV('last_notif_response_id', notifId).catch(() => {});
            }
          }
        }
      } catch {}

      await setupNotificationChannels().catch(() => {});
      await setupReminderCategory().catch(() => {});
      await requestPermissions().catch(() => {});
      syncMedicationsDb().catch(() => {});
      syncInteractionsDb().catch(() => {});
      rescheduleAllActiveNotifications().catch(() => {});
      loadCounts();
    }
    init();

    const cleanupMed = initReminderListeners(async (data) => {
      // Check if treatment has already ended while app was closed
      const med = await getMedicationById(data.medicationId).catch(() => null);
      if (med?.end_date) {
        const ended = new Date(med.end_date + 'T23:59:59') < new Date();
        if (ended) {
          await cancelAllRemindersForMedication(data.medicationId).catch(() => {});
          await archiveMedication(data.medicationId).catch(() => {});
          const displayName = med.commercial_name?.trim() || med.generic_name;
          await notifyTreatmentEnded(data.medicationId, displayName).catch(() => {});
          dismissNotification(data.notificationId).catch(() => {});
          return;
        }
      }
      // "Salvar no Histórico = Não": não pergunta Tomei/Não tomei nem grava no histórico.
      // O alerta some sozinho quando o app é reaberto (ver dismissStaleNonInteractiveReminders).
      if (!data.interactive) return;
      addMedicationLog({
        medication_id: data.medicationId,
        medication_name: data.name,
        dose: data.dose,
        notification_id: data.notificationId,
        scheduled_at: new Date().toISOString(),
      }).catch(() => {});
      // Se o estoque já está baixo quando o lembrete dispara, notifica junto
      getMedicationById(data.medicationId).then(med => {
        if (med?.stock_quantity != null) {
          const displayName = med.commercial_name?.trim() || med.generic_name;
          checkLowStockAndNotify(data.medicationId, displayName, med.stock_quantity).catch(() => {});
        }
      }).catch(() => {});
      if (data.repeatInterval > 0) {
        scheduleRepeatAlarm(data.medicationId, data.name, data.dose, data.repeatInterval, true).catch(() => {});
        if (data.notificationId.startsWith('reminder_repeat_')) {
          dismissNotification(data.notificationId).catch(() => {});
        }
      }
    });

    const cleanupAct = initActivityListeners((data) => {
      setActivityAlert(data);
    });

    const cleanupResponse = initResponseListeners({
      onMedTook: async (medicationId, notifId, name, dose) => {
        cancelRepeatAlarm(medicationId).catch(() => {});
        upsertMedicationLogTaken(notifId, medicationId, name, dose, true).catch(() => {});
        const med = await getMedicationById(medicationId).catch(() => null);
        if (med?.stock_quantity != null && med.stock_quantity > 0) {
          const next = med.stock_quantity - 1;
          await updateMedicationStock(medicationId, next).catch(() => {});
          const displayName = med.commercial_name?.trim() || med.generic_name;
          checkLowStockAndNotify(medicationId, displayName, next).catch(() => {});
        }
        await dismissNotification(notifId);
      },
      onMedSkip: (medicationId, notifId, name, dose) => {
        cancelRepeatAlarm(medicationId).catch(() => {});
        upsertMedicationLogTaken(notifId, medicationId, name, dose, false).catch(() => {});
        dismissNotification(notifId);
      },
      onMedDefault: () => {},
      onActivityDone: async (activityId, activityName, activityType, notifId) => {
        await addActivityLog({ activity_id: activityId, activity_name: activityName, activity_type: activityType, realized: true, value: '' }).catch(() => {});
        await dismissNotification(notifId);
      },
      onActivitySnooze: async (activityId, activityName, activityType, notifId) => {
        await snoozeActivityReminder(activityId, activityName, activityType, 5);
        await dismissNotification(notifId);
      },
      onActivitySkip: async (activityId, activityName, activityType, notifId) => {
        await addActivityLog({ activity_id: activityId, activity_name: activityName, activity_type: activityType, realized: false, value: '' }).catch(() => {});
        dismissNotification(notifId);
      },
      onActivityMeasure: (activityId, notifId) => {
        dismissNotification(notifId);
        if (navRef.isReady()) {
          navRef.navigate('Agenda', { tab: 'activities', openActivityId: activityId });
        }
      },
      onActivityDefault: (payload) => {
        setActivityAlert(payload);
      },
      onTreatmentEndedOk: async (medicationId) => {
        await archiveMedication(medicationId).catch(() => {});
        loadCounts();
      },
    });

    return () => { cleanupMed(); cleanupAct(); cleanupResponse(); };
  }, [loadCounts]);

  // When app returns from background and user is NOT on HomeScreen,
  // navigate to Home if there are overdue medications so the banner is visible.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      dismissStaleNonInteractiveReminders().catch(() => {});
      if (!navRef.isReady()) return;
      if (navRef.getCurrentRoute()?.name === 'Home') return;
      try {
        const nowD = new Date();
        const nowMins = nowD.getHours() * 60 + nowD.getMinutes();
        const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
        const [meds, allLogs] = await Promise.all([getMedications(), getMedicationLog()]);
        for (const med of meds) {
          if (!med.home_reminder) continue;
          const reminders = await getRemindersForMedication(med.id).catch(() => [] as any[]);
          for (const r of reminders) {
            if (!r.is_active) continue;
            const [h, mm] = (r.time as string).split(':').map(Number);
            if (isNaN(h) || h * 60 + mm > nowMins) continue;
            if (r.period && r.period !== 'day') continue;
            const slotMs = new Date(`${todayStr}T${r.time}:00`).getTime();
            const taken = (allLogs as any[]).some(l =>
              l.medication_id === med.id && l.taken === 1 &&
              Math.abs(new Date(l.scheduled_at).getTime() - slotMs) < 4 * 60 * 60 * 1000
            );
            if (!taken) { navRef.navigate('Home'); return; }
          }
        }
      } catch {}
    });
    return () => sub.remove();
  }, []);

  if (!dbReady) return null;

  return (
    <>
      <NavigationContainer ref={navRef} onStateChange={loadCounts}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route, navigation }) => ({
            headerStyle: { backgroundColor: '#1C3F7A' },
            headerTintColor: '#fff',
            headerTitle: () => <HeaderTitle route={route} />,
            headerRight: (route.name !== 'Help' && route.name !== 'Interactions') ? () => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Interactions' as never)}
                  style={{ padding: 6 }}
                >
                  <Text style={{ color: '#fff', fontSize: 19 }}>📋</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Help' as never)}
                  style={{ padding: 4 }}
                >
                  <View style={{
                    width: 26, height: 26, borderRadius: 13,
                    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 }}>?</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : undefined,
            tabBarActiveTintColor: '#1C3F7A',
            tabBarInactiveTintColor: '#9CA3AF',
            tabBarStyle: {
              height: 64 + insets.bottom,
              paddingBottom: insets.bottom + 10,
              paddingTop: 8,
              backgroundColor: '#fff',
              borderTopWidth: 0.5,
              borderTopColor: '#E8EAF0',
            },
            tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
            tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
          })}
        >
          <Tab.Screen name="Home"         component={HomeScreen}         options={{ tabBarLabel: 'Início' }} />
          <Tab.Screen name="Medications"  component={MedicationsScreen}  options={{ tabBarLabel: 'Medicamentos', tabBarBadge: medCount > 0 ? medCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
          <Tab.Screen name="Agenda"       component={AgendaScreen}       options={{ tabBarLabel: 'Atividades', tabBarBadge: activityCount > 0 ? activityCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
          <Tab.Screen name="Emergency"    component={EmergencyScreen}    options={{ tabBarLabel: 'Emergência' }} />
          <Tab.Screen name="History"      component={HistoryScreen}      options={{ tabBarLabel: 'Hist', headerTitle: () => <HeaderTitle route={{ name: 'History' }} /> }} />
          <Tab.Screen name="Profile"      component={ProfileScreen}      options={{ tabBarItemStyle: { display: 'none' } }} />
          <Tab.Screen name="Contacts"     component={ContactsScreen}     options={{ tabBarItemStyle: { display: 'none' } }} />
          <Tab.Screen name="Interactions" component={InteractionsScreen} options={{ tabBarItemStyle: { display: 'none' } }} />
          <Tab.Screen name="Help"         component={HelpScreen}         options={{ tabBarItemStyle: { display: 'none' } }} />
        </Tab.Navigator>
      </NavigationContainer>

      <Modal visible={!!activityAlert} transparent animationType="fade" onRequestClose={() => setActivityAlert(null)}>
        {activityAlert && (() => {
          const isMeasurement = ['bp', 'glucose', 'weight'].includes(activityAlert.activityType);

          async function handleMedir() {
            setActivityAlert(null);
            await dismissNotification(activityAlert!.notificationId);
            if (navRef.isReady()) {
              navRef.navigate('Agenda', { tab: 'activities', openActivityId: activityAlert!.activityId });
            }
          }

          async function handleRealizei() {
            await addActivityLog({
              activity_id: activityAlert!.activityId,
              activity_name: activityAlert!.name,
              activity_type: activityAlert!.activityType,
              realized: true,
              value: '',
            }).catch(() => {});
            await dismissNotification(activityAlert!.notificationId);
            setActivityAlert(null);
          }

          async function handlePular() {
            await addActivityLog({ activity_id: activityAlert!.activityId, activity_name: activityAlert!.name, activity_type: activityAlert!.activityType, realized: false, value: '' }).catch(() => {});
            await dismissNotification(activityAlert!.notificationId);
            setActivityAlert(null);
          }

          async function handleAdiar() {
            await snoozeActivityReminder(activityAlert!.activityId, activityAlert!.name, activityAlert!.activityType, 5);
            await dismissNotification(activityAlert!.notificationId);
            setActivityAlert(null);
          }

          return (
            <View style={ras.overlay}>
              <View style={[ras.box, { paddingBottom: insets.bottom + 16 }]}>
                <Text style={ras.title}>⏰ Hora da atividade</Text>
                <Text style={ras.name}>{activityAlert.name}</Text>
                <View style={ras.actBtnCol}>
                  <TouchableOpacity style={ras.btnMedir} onPress={isMeasurement ? handleMedir : handleRealizei}>
                    <Text style={ras.btnMedirText}>{isMeasurement ? '📋 Medir' : '✓ Registrar'}</Text>
                  </TouchableOpacity>
                  <View style={ras.actBtnRow}>
                    <TouchableOpacity style={ras.btnSnooze} onPress={handleAdiar}>
                      <Text style={ras.btnSnoozeText}>⏱ Adiar 5 min</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ras.btnPular} onPress={handlePular}>
                      <Text style={ras.btnPularText}>Pular</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          );
        })()}
      </Modal>
    </>
  );
}

const ras = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  box: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingTop: 28,
  },
  title: { fontSize: 13, color: '#888', fontWeight: '500', marginBottom: 8 },
  name: { fontSize: 22, fontWeight: '700', color: '#1C3F7A', marginBottom: 4 },
  actBtnCol: { marginTop: 20, gap: 10 },
  actBtnRow: { flexDirection: 'row', gap: 10 },
  btnMedir: {
    backgroundColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 15, alignItems: 'center',
  },
  btnMedirText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnSnooze: {
    flex: 1, borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  btnSnoozeText: { color: '#1C3F7A', fontWeight: '600', fontSize: 14 },
  btnPular: {
    flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
  },
  btnPularText: { color: '#999', fontWeight: '600', fontSize: 14 },
});

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
