import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Modal, StyleSheet, Text, View, Image, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MedicationsScreen from './src/screens/MedicationsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import InteractionsScreen from './src/screens/InteractionsScreen';
import HelpScreen from './src/screens/HelpScreen';

import { setupNotificationChannels, requestPermissions, setupReminderCategory } from './src/services/notifications';
import { getDb, getMedications, getContacts, getMedicationById, updateMedicationStock } from './src/database/db';
import { syncMedicationsDb, syncInteractionsDb } from './src/services/dbSync';

const Tab = createBottomTabNavigator();

const TITLES: Record<string, string> = {
  Home: 'Alerta Médico',
  Profile: 'Perfil Médico',
  Medications: 'Medicamentos',
  Contacts: 'Contatos',
  Interactions: 'Tabelas',
  Help: 'Ajuda',
};

// Simple unicode icons that render consistently cross-platform
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

interface ReminderAlertData {
  notificationId: string;
  medicationId: number;
  name: string;
  dose: string;
}

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const [medCount, setMedCount] = useState(0);
  const [contactCount, setContactCount] = useState(0);
  const [reminderAlert, setReminderAlert] = useState<ReminderAlertData | null>(null);
  const alertQueueRef = useRef<ReminderAlertData[]>([]);

  function showNextAlert() {
    const next = alertQueueRef.current.shift();
    setReminderAlert(next ?? null);
  }

  async function handleTomei(alert: ReminderAlertData) {
    const med = await getMedicationById(alert.medicationId).catch(() => null);
    if (med?.stock_quantity != null && med.stock_quantity > 0) {
      await updateMedicationStock(alert.medicationId, med.stock_quantity - 1).catch(() => {});
    }
    await Notifications.dismissNotificationAsync(alert.notificationId).catch(() => {});
    showNextAlert();
  }

  function handleNaoTomei(alert: ReminderAlertData) {
    Notifications.dismissNotificationAsync(alert.notificationId).catch(() => {});
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
      await setupNotificationChannels().catch(() => {});
      await setupReminderCategory().catch(() => {});
      await requestPermissions().catch(() => {});
      syncMedicationsDb().catch(() => {});
      syncInteractionsDb().catch(() => {});
      loadCounts();
    }
    init();

    // Foreground: notification received while app is open
    const foregroundSub = Notifications.addNotificationReceivedListener(notif => {
      if (notif.request.content.data?.type !== 'reminder') return;
      const medicationId = notif.request.content.data.medicationId as number;
      const body = notif.request.content.body ?? '';
      const [name, dose] = body.split(' — ');
      const data: ReminderAlertData = { notificationId: notif.request.identifier, medicationId, name: name ?? '', dose: dose ?? '' };
      setReminderAlert(current => {
        if (current !== null) { alertQueueRef.current.push(data); return current; }
        return data;
      });
    });

    // Background: user tapped action button on notification
    const responseSub = Notifications.addNotificationResponseReceivedListener(async response => {
      if (response.notification.request.content.data?.type !== 'reminder') return;
      const medicationId = response.notification.request.content.data.medicationId as number;
      const notifId = response.notification.request.identifier;
      if (response.actionIdentifier === 'tomei') {
        const med = await getMedicationById(medicationId).catch(() => null);
        if (med?.stock_quantity != null && med.stock_quantity > 0) {
          await updateMedicationStock(medicationId, med.stock_quantity - 1).catch(() => {});
        }
      }
      await Notifications.dismissNotificationAsync(notifId).catch(() => {});
    });

    return () => {
      foregroundSub.remove();
      responseSub.remove();
    };
  }, [loadCounts]);

  return (
    <NavigationContainer onStateChange={loadCounts}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route, navigation }) => ({
          headerStyle: { backgroundColor: '#1C3F7A' },
          headerTintColor: '#fff',
          headerTitle: () => <HeaderTitle route={route} />,
          headerRight: route.name !== 'Help' ? () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('Help' as never)}
              style={{ marginRight: 16, padding: 4 }}
            >
              <View style={{
                width: 26, height: 26, borderRadius: 13,
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 }}>?</Text>
              </View>
            </TouchableOpacity>
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
        <Tab.Screen name="Medications"  component={MedicationsScreen}  options={{ tabBarLabel: 'Remédios', tabBarBadge: medCount > 0 ? medCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
        <Tab.Screen name="Contacts"     component={ContactsScreen}     options={{ tabBarLabel: 'Contatos', tabBarBadge: contactCount > 0 ? contactCount : undefined, tabBarBadgeStyle: { backgroundColor: '#1C3F7A', minWidth: 17, height: 17, borderRadius: 9 } }} />
        <Tab.Screen name="Interactions" component={InteractionsScreen} options={{ tabBarLabel: 'Tabelas' }} />
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
              <TouchableOpacity style={ras.btnYes} onPress={() => handleTomei(reminderAlert)}>
                <Text style={ras.btnYesText}>✓ Tomei</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </Modal>
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
});

export default function App() {
  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
