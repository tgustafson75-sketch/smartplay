import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SmartVisionProvider } from '../contexts/SmartVisionContext';

export default function RootLayout() {
  return (
    <SmartVisionProvider>
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#060f09' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="intro" />
        <Stack.Screen name="auth" />
        <Stack.Screen
          name="hole-view"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="settings"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="hole-view-3d"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="cage"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="arena"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="smartmotion"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
      </Stack>
    </SafeAreaProvider>
    </SmartVisionProvider>
  );
}
