import {
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    useFonts,
} from '@expo-google-fonts/outfit';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { shouldShowTutorial } from '../screens/TutorialScreen';

// Disable NetInfo's default Android reachability probe to clients3.google.com.
// Without this, the native okhttp client throws java.io.IOException:
// "Failed to load remote host" when the probe is blocked or the network is
// unavailable, which surfaces as an uncaught red-screen error in Expo Go.
NetInfo.configure({ reachabilityShouldRun: () => false });

SplashScreen.preventAutoHideAsync();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { CaddieProvider } from '../context/CaddieContext';
import { RoundProvider } from '../context/RoundContext';
import { useWatchBle } from '../hooks/useWatchBle';
import { auth } from '../lib/firebase';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUserStore } from '../store/userStore';
import { warnExpoGoStartupOnce } from '../utils/expoGoGuard';
import { setGlobalGender } from '../services/voice';

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
  const [fontReady, setFontReady] = useState(false);

  // Warn once when running in Expo Go so unsupported native features are clear.
  useEffect(() => {
    warnExpoGoStartupOnce();
  }, []);

  // Apply the persisted voice gender once at boot so any tab (not just Caddie)
  // gets the right voice on first launch.
  useEffect(() => {
    setGlobalGender(useSettingsStore.getState().voiceGender);
  }, []);

  // Start BLE scan after initial shell readiness to reduce launch contention.
  useWatchBle(fontReady);

  // ── Bluetooth audio routing ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { Audio } = await import('expo-av');
        if (cancelled) return;
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // Keep startup resilient if audio setup fails.
      }
    })();

    return () => {
      cancelled = true;
    };
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

  // Mark fonts ready when loaded (or when there is a load error).
  useEffect(() => {
    if (fontsLoaded || fontError) {
      setFontReady(true);
    }
  }, [fontsLoaded, fontError]);

  // Cap splash wait so app shell appears quickly even if web font loading is slow.
  useEffect(() => {
    if (fontReady) return;
    const timeout = setTimeout(() => setFontReady(true), 1200);
    return () => clearTimeout(timeout);
  }, [fontReady]);

  // Apply Outfit as default font and hide splash once shell is ready.
  useEffect(() => {
    if (fontReady) {
      if (!(Text as any).defaultProps) (Text as any).defaultProps = {};
      if (fontsLoaded) {
        (Text as any).defaultProps.style = { fontFamily: 'Outfit_400Regular' };
      }
      SplashScreen.hideAsync();
    }
  }, [fontReady, fontsLoaded]);

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
            router.replace('/tabs/caddie');
          } else {
            void shouldShowTutorial().then((show) => {
              router.replace(show ? '/tutorial' : '/tabs/caddie');
            });
          }
        }
      } else if (!isGuest && !inAuthGroup && !inSetupGroup) {
        // No Firebase user and no guest session — auto-create guest session and go to caddie.
        initGuestSession();
        void shouldShowTutorial().then((show) => {
          router.replace(show ? '/tutorial' : '/tabs/caddie');
        });
      }
    });
    return unsubscribe;
  }, [segments, mounted]);

  if (!fontReady) return null;

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
        <Stack.Screen name="tabs" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
    </RoundProvider>
    </CaddieProvider>
    </ErrorBoundary>
  );
}
