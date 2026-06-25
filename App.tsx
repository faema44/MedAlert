import React, { useCallback, useEffect, useRef, useState, Component } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Modal, StyleSheet, Text, View, Image, TouchableOpacity } from 'react-native';
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
import {
  setupNotificationChannels, requestPermissions, setupReminderCategory,
  initReminderListeners, initActivityListeners, initResponseListeners, dismissNotification,
  ReminderAlertPayload, ActivityAlertPayload,
  scheduleRepeatAlarm, cancelRepeatAlarm, rescheduleAllActiveNotifications,
  snoozeActivityReminder,
} from './src/services/notifications';
import { getDb, getMedications, getContacts, getMedicationById, updateMedicationStock, addActivityLog, getKV } from './src/database/db';
import { syncMedicationsDb, syncInteractionsDb } from './src/services/dbSync';

const Tab = createBottomTabNavigator();

const TITLES: Record<string, string> = {
  Home: 'Alerta Médico',
  Profile: 'Perfil Médico',
  Medications: 'Medicamentos',
  Contacts: 'Contatos',
  Agenda: 'Agenda',
  Interactions: 'Tabelas',
  Help: 'Ajuda',
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
  };
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

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const [dbReady, setDbReady] = useState(false);
  const [medCount, setMedCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [reminderAlert, setReminderAlert] = useState<ReminderAlertPayload | null>(null);
  const alertQueueRef = useRef<ReminderAlertPayload[]>([]);
  const [activityAlert, setActivityAlert] = useState<ActivityAlertPayload | null>(null);

  function showNextAlert() {
    const next = alertQueueRef.current.shift();
    setReminderAlert(next ?? null);
  }

  async function handleConfirmTomei(alert: ReminderAlertPayload) {
    cancelRepeatAlarm(alert.medicationId).catch(() => {});
    const med = await getMedicationById(alert.medicationId).catch(() => null);
    if (med?.stock_quantity != null && med.stock_quantity > 0) {
      await updateMedicationStock(alert.medicationId, med.stock_quantity - 1).catch(() => {});
    }
    await dismissNotification(alert.notificationId);
    showNextAlert();
  }

  function handleNaoTomei(alert: ReminderAlertPayload) {
    cancelRepeatAlarm(alert.medicationId).catch(() => {});
    dismissNotification(alert.notificationId);
    showNextAlert();
  }

  const loadCounts = useCallback(async () => {
    const [meds, contacts] = await Promise.all([getMedications(), getContacts()]);
    setMedCount(meds.length);
    setContactCount(contacts.length);
  }, []);

  useEffect(() => {
    async function init() {
      await getDb();
      setDbReady(true);
      await setupNotificationChannels().catch(() => {});
      await setupReminderCategory().catch(() => {});
      await requestPermissions().catch(() => {});
      syncMedicationsDb().catch(() => {});
      syncInteractionsDb().catch(() => {});
      rescheduleAllActiveNotifications().catch(() => {});
      loadCounts();
    }
    init();

    const cleanupMed = initReminderListeners((data) => {
      if (data.repeatInterval > 0) {
        scheduleRepeatAlarm(data.medicationId, data.name, data.dose, data.repeatInterval, true).catch(() => {});
      }
      setReminderAlert(current => {
        if (current !== null) { alertQueueRef.current.push(data); return current; }
        return data;
      });
    });

    const cleanupAct = initActivityListeners((data) => {
      setActivityAlert(data);
    });

    const cleanupResponse = initResponseListeners({
      onMedTook: async (medicationId, notifId) => {
        cancelRepeatAlarm(medicationId).catch(() => {});
        const med = await getMedicationById(medicationId).catch(() => null);
        if (med?.stock_quantity != null && med.stock_quantity > 0) {
          await updateMedicationStock(medicationId, med.stock_quantity - 1).catch(() => {});
        }
        await dismissNotification(notifId);
      },
      onMedSkip: (medicationId, notifId) => {
        cancelRepeatAlarm(medicationId).catch(() => {});
        dismissNotification(notifId);
      },
      onMedDefault: (payload) => {
        setReminderAlert(current => {
          if (current !== null) { alertQueueRef.current.push(payload); return current; }
          return payload;
        });
      },
      onActivityDone: async (activityId, activityName, activityType, notifId) => {
        await addActivityLog({ activity_id: activityId, activity_name: activityName, activity_type: activityType, realized: true, value: '' }).catch(() => {});
        await dismissNotification(notifId);
      },
      onActivitySnooze: async (activityId, activityName, activityType, notifId) => {
        await snoozeActivityReminder(activityId, activityName, activityType, 5);
        await dismissNotification(notifId);
      },
      onActivitySkip: (notifId) => {
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
    });

    return () => { cleanupMed(); cleanupAct(); cleanupResponse(); };
  }, [loadCounts]);

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
          <Tab.Screen name="Profile"      component={ProfileScreen}      options={{ tabBarLabel: 'Perfil' }} />
          <Tab.Screen name="Medications"  component={MedicationsScreen}  options={{ tabBarLabel: 'Medicamentos', tabBarBadge: medCount > 0 ? medCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
          <Tab.Screen name="Contacts"     component={ContactsScreen}     options={{ tabBarLabel: 'Contatos', tabBarBadge: contactCount > 0 ? contactCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
          <Tab.Screen name="Agenda"       component={AgendaScreen}       options={{ tabBarLabel: 'Atividades' }} />
          <Tab.Screen name="Interactions" component={InteractionsScreen} options={{ tabBarItemStyle: { display: 'none' } }} />
          <Tab.Screen name="Help"         component={HelpScreen}         options={{ tabBarItemStyle: { display: 'none' } }} />
        </Tab.Navigator>
      </NavigationContainer>

      <Modal visible={!!reminderAlert} transparent animationType="fade" onRequestClose={() => reminderAlert && handleNaoTomei(reminderAlert)}>
        {reminderAlert && (
          <View style={ras.overlay}>
            <View style={[ras.box, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={ras.title}>💊 Hora do medicamento</Text>
              <Text style={ras.name}>{reminderAlert.name}</Text>
              {!!reminderAlert.dose && <Text style={ras.dose}>{reminderAlert.dose}</Text>}
              <View style={ras.btnRow}>
                <TouchableOpacity style={ras.btnNo} onPress={() => handleNaoTomei(reminderAlert)}>
                  <Text style={ras.btnNoText}>Não tomei</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ras.btnYes} onPress={() => handleConfirmTomei(reminderAlert)}>
                  <Text style={ras.btnYesText}>✓ Tomei</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>

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
  dose: { fontSize: 14, color: '#555', marginBottom: 20 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btnNo: {
    flex: 1, borderWidth: 1.5, borderColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center',
  },
  btnNoText: { color: '#1C3F7A', fontWeight: '600', fontSize: 15 },
  btnYes: {
    flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center',
  },
  btnYesText: { color: '#fff', fontWeight: '700', fontSize: 15 },
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
