import React, { useCallback, useEffect, useRef, useState, Component } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Modal, StyleSheet, Text, View, Image, TouchableOpacity, TextInput } from 'react-native';
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
import OnboardingScreen from './src/screens/OnboardingScreen';

import {
  setupNotificationChannels, requestPermissions, setupReminderCategory,
  initReminderListeners, initActivityListeners, dismissNotification,
  ReminderAlertPayload, ActivityAlertPayload,
  scheduleRepeatAlarm, cancelRepeatAlarm, rescheduleAllActiveNotifications,
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

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [medCount, setMedCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [reminderAlert, setReminderAlert] = useState<ReminderAlertPayload | null>(null);
  const alertQueueRef = useRef<ReminderAlertPayload[]>([]);
  const [activityAlert, setActivityAlert] = useState<ActivityAlertPayload | null>(null);
  const [activityValue, setActivityValue] = useState('');

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
      const done = await getKV('onboarding_done').catch(() => '1');
      setOnboardingDone(done === '1');
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
      setActivityValue('');
    });

    return () => { cleanupMed(); cleanupAct(); };
  }, [loadCounts]);

  if (onboardingDone === null) return null; // aguarda check de DB

  if (!onboardingDone) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onComplete={() => { setOnboardingDone(true); }} />
      </SafeAreaProvider>
    );
  }

  return (
    <>
      <NavigationContainer onStateChange={loadCounts}>
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
          const placeholder = activityAlert.activityType === 'bp' ? 'Ex: 120/80' : activityAlert.activityType === 'glucose' ? 'Ex: 95 mg/dL' : 'Ex: 70.5 kg';
          const unit = activityAlert.activityType === 'bp' ? 'mmHg' : activityAlert.activityType === 'glucose' ? 'mg/dL' : 'kg';

          async function logAndClose(realized: boolean) {
            await addActivityLog({
              activity_id: activityAlert!.activityId,
              activity_name: activityAlert!.name,
              activity_type: activityAlert!.activityType,
              realized,
              value: realized && isMeasurement ? activityValue.trim() : '',
            }).catch(() => {});
            setActivityAlert(null);
          }

          return (
            <View style={ras.overlay}>
              <View style={[ras.box, { paddingBottom: insets.bottom + 16 }]}>
                <Text style={ras.title}>⏰ Hora da atividade</Text>
                <Text style={ras.name}>{activityAlert.name}</Text>
                {isMeasurement && (
                  <>
                    <Text style={ras.dose}>Registre o valor medido ({unit})</Text>
                    <TextInput
                      style={ras.valueInput}
                      value={activityValue}
                      onChangeText={setActivityValue}
                      placeholder={placeholder}
                      keyboardType="numeric"
                      autoFocus
                    />
                  </>
                )}
                <View style={ras.btnRow}>
                  <TouchableOpacity style={ras.btnNo} onPress={() => logAndClose(false)}>
                    <Text style={ras.btnNoText}>Não realizei</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={ras.btnYes} onPress={() => logAndClose(true)}>
                    <Text style={ras.btnYesText}>{isMeasurement ? '✓ Salvar' : '✓ Realizei'}</Text>
                  </TouchableOpacity>
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
  valueInput: {
    borderWidth: 1, borderColor: '#D0D5E8', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 18,
    fontWeight: '600', color: '#1C3F7A', textAlign: 'center',
    marginBottom: 4, marginTop: 8,
  },
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
