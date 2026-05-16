import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './src/theme/colors';
import { AppProvider, useAppContext } from './src/context/AppContext';

import FeedScreen from './src/screens/FeedScreen';
import OfflineMapScreen from './src/screens/OfflineMapScreen';
import GemmaChatScreen from './src/screens/GemmaChatScreen';
import ChatScreen from './src/screens/ChatScreen';
import MeshScannerScreen from './src/screens/MeshScannerScreen';

const Tab = createBottomTabNavigator();

const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.colors.background,
    card: theme.colors.card,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.primary,
  },
};

function ErrorBanner() {
  const { ready } = useAppContext();
  const insets = useSafeAreaInsets();
  if (ready !== 'error') return null;
  return (
    <View style={[styles.errorBanner, { paddingTop: insets.top + 6 }]} pointerEvents="none">
      <Ionicons name="alert-circle" size={14} color="#fff" style={{ marginRight: 6 }} />
      <Text style={styles.errorText}>BOOT FAILURE — IDENTITY/MESH OFFLINE. RESTART APP.</Text>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
        },
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: keyof typeof Ionicons.glyphMap;
          if (route.name === 'Tactical Map') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Local Feed') {
            iconName = focused ? 'list' : 'list-outline';
          } else if (route.name === 'Analysis LPU') {
            iconName = focused ? 'server' : 'server-outline';
          } else if (route.name === 'Chat') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Mesh Scanner') {
            iconName = focused ? 'bluetooth' : 'bluetooth-outline';
          } else {
            iconName = 'alert-circle-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Mesh Scanner" component={MeshScannerScreen} />
      <Tab.Screen name="Tactical Map" component={OfflineMapScreen} />
      <Tab.Screen name="Local Feed" component={FeedScreen} />
      <Tab.Screen name="Analysis LPU" component={GemmaChatScreen} />
      <Tab.Screen name="Chat" component={ChatScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppProvider>
        <NavigationContainer theme={MyDarkTheme}>
          <ErrorBanner />
          <Tabs />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#9B1B1B',
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  errorText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: theme.typography.mono,
  },
});
