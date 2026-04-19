import { useEffect, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Text } from 'react-native';
import { shouldShowTutorial } from '../screens/TutorialScreen';
import { onAuthStateChanged } from 'firebase/auth';
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { auth } from '../lib/firebase';
import { useUserStore } from '../store/userStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRoundStore } from '../store/roundStore';
import { RoundProvider } from '../context/RoundContext';
import { CaddieProvider } from '../context/CaddieContext';
import { Audio } from 'expo-av';
import { useWatchBle } from '../hooks/useWatchBle';

/**
 * Module-level bridge so other screens (e.g. PlayScreenClean) can
 * trigger a lock or toggle biometrics without prop drilling or extra state libs.
 * The layout component populates these on every render.
 */
export const BiometricLayoutControls: {
  _setBiometricEnabled: ((v: boolean) => void) | null;
  _lockApp: (() => void) | null;
  _updateLastActive: (() => void) | null;
} = {
  _setBiometricEnabled: null,
  _lockApp:             null,
  _updateLastActive:    null,
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const isGuest = useUserStore((s) => s.isGuest);
  const initGuestSession = useUserStore((s) => s.initGuestSession);
  const profileComplete = usePlayerProfileStore((s) => s.profileComplete);
  const isRoundActive = useRoundStore((s) => s.isRoundActive);
  const [mounted, setMounted] = useState(false);

  // Galaxy Watch 7 — BLE scan runs for the lifetime of the app
  useWatchBle();

  // ── Bluetooth audio routing ────────────────────────────────────────────────
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS:         false,
      playsInSilentModeIOS:       true,
      staysActiveInBackground:    false,
      shouldDuckAndroid:          true,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);

  // Keep BiometricLayoutControls as stable no-ops (biometric disabled for now)
  useEffect(() => {
    BiometricLayoutControls._setBiometricEnabled = () => {};
    BiometricLayoutControls._lockApp             = () => {};
    BiometricLayoutControls._updateLastActive    = () => {};
  });

  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  // Apply Outfit as default font on all Text components and hide splash once ready
  useEffect(() => {
    if (fontsLoaded || fontError) {
      if (!(Text as any).defaultProps) (Text as any).defaultProps = {};
      (Text as any).defaultProps.style = { fontFamily: 'Outfit_400Regular' };
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Wait one tick for Expo Router's navigator to fully mount
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const inAuthGroup = segments[0] === 'auth' || segments[0] === 'splash';
      const inSetupGroup = segments[0] === 'profile-setup';
      if (user) {
        setIsGuest(false);
        if (inAuthGroup) {
          if (!profileComplete) {
            router.replace('/profile-setup');
          } else if (isRoundActive) {
            router.replace('/(tabs)/caddie');
          } else {
            void shouldShowTutorial().then((show) => {
              router.replace(show ? '/tutorial' : '/(tabs)/caddie');
            });
          }
        }
      } else if (!isGuest && !inAuthGroup && !inSetupGroup) {
        // No Firebase user and no guest session — auto-create guest session and go to caddie.
        initGuestSession();
        void shouldShowTutorial().then((show) => {
          router.replace(show ? '/tutorial' : '/(tabs)/caddie');
        });
      }
    });
    return unsubscribe;
  }, [segments, mounted]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
    <CaddieProvider>
    <RoundProvider>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          animation: 'fade',
          animationDuration: 250,
          headerShown: false,
        }}
      >
        <Stack.Screen name="tutorial" />
        <Stack.Screen name="splash" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="swing-lab" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
    </RoundProvider>
    </CaddieProvider>
    </ErrorBoundary>
  );
}
