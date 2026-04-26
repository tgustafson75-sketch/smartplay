import { useEffect } from 'react';
import { Stack, useRouter, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { usePlayerProfileStore } from '../store/playerProfileStore';

export default function RootLayout() {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const { isSetupComplete } = usePlayerProfileStore();

  useEffect(() => {
    // navigationState.key is undefined until the navigator has fully mounted.
    // Calling router.replace before this point crashes on Android (java.io).
    if (!navigationState?.key) return;
    if (!isSetupComplete) {
      router.replace('/intro');
    }
  }, [navigationState?.key, isSetupComplete]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: '#060f09',
          },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="intro" />
        <Stack.Screen name="auth" />
        <Stack.Screen
          name="hole-view"
          options={{ animation: 'slide_from_bottom' }}
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
          name="settings"
          options={{ animation: 'slide_from_right' }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
