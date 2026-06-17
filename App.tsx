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

function HeaderTitle({ route }: { route: { name: string } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Image
        source={require('./assets/icon.png')}
        style={{ width: 30, height: 30, borderRadius: 7 }}
      />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>
        {TITLES[route.name] ?? route.name}
      </Text>
    </View>
  );
}

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.6 }}>{emoji}</Text>
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
      syncInteractionsDb().catch(() => {}); // fire-and-forget: não bloqueia o startup
    }
    init();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Tab.Navigator
        screenOptions={({ route, navigation }) => ({
          headerStyle: { backgroundColor: '#1a3a6b' },
          headerTintColor: '#fff',
          headerTitle: () => <HeaderTitle route={route} />,
          headerRight: route.name !== 'Help' ? () => (
            <TouchableOpacity onPress={() => navigation.navigate('Help' as never)} style={{ marginRight: 16, padding: 4 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>?</Text>
            </TouchableOpacity>
          ) : undefined,
          tabBarActiveTintColor: '#1a3a6b',
          tabBarInactiveTintColor: '#999',
          tabBarStyle: {
            height: 56 + insets.bottom,
            paddingBottom: insets.bottom + 2,
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 11 },
        })}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Início',
            tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarLabel: 'Perfil',
            tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Medications"
          component={MedicationsScreen}
          options={{
            tabBarLabel: 'Remédios',
            tabBarIcon: ({ focused }) => <TabIcon emoji="💊" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Contacts"
          component={ContactsScreen}
          options={{
            tabBarLabel: 'Contatos',
            tabBarIcon: ({ focused }) => <TabIcon emoji="📞" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Interactions"
          component={InteractionsScreen}
          options={{
            tabBarLabel: 'Tabelas',
            tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
          }}
        />
        <Tab.Screen
          name="Help"
          component={HelpScreen}
          options={{
            tabBarItemStyle: { display: 'none' },
          }}
        />
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
