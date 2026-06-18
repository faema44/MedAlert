import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, Image, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import MedicationsScreen from './src/screens/MedicationsScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import InteractionsScreen from './src/screens/InteractionsScreen';
import HelpScreen from './src/screens/HelpScreen';

import { setupNotificationChannels, requestPermissions } from './src/services/notifications';
import { getDb } from './src/database/db';
import { syncMedicationsDb, syncInteractionsDb } from './src/services/dbSync';

const Tab = createBottomTabNavigator();

const TITLES: Record<string, string> = {
  Home: 'MedAlert',
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

function AppNavigator() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    async function init() {
      await getDb();
      await setupNotificationChannels();
      await requestPermissions();
      syncMedicationsDb().catch(() => {});
      syncInteractionsDb().catch(() => {});
    }
    init();
  }, []);

  return (
    <NavigationContainer>
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
            height: 56 + insets.bottom,
            paddingBottom: insets.bottom + 2,
            paddingTop: 6,
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
        <Tab.Screen name="Medications"  component={MedicationsScreen}  options={{ tabBarLabel: 'Remédios' }} />
        <Tab.Screen name="Contacts"     component={ContactsScreen}     options={{ tabBarLabel: 'Contatos' }} />
        <Tab.Screen name="Interactions" component={InteractionsScreen} options={{ tabBarLabel: 'Tabelas' }} />
        <Tab.Screen name="Help"         component={HelpScreen}         options={{ tabBarItemStyle: { display: 'none' } }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}
