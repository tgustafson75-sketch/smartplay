import { useEffect, useRef, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { AppState, Text } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import LockScreen from '../components/LockScreen';
import { checkBiometricSupport } from '../services/BiometricService';
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

/**
 * Module-level bridge so other screens (e.g. PlayScreenClean) can
 * trigger a lock or toggle biometrics without prop drilling or extra state libs.
 * The layout component populates these on every render.
 */
export const BiometricLayoutControls: {
  _setBiometricEnabled: ((v: boolean) => void) | null;
  _lockApp: (() => void) | null;
} = {
  _setBiometricEnabled: null,
  _lockApp:             null,
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const isGuest = useUserStore((s) => s.isGuest);
  const profileComplete = usePlayerProfileStore((s) => s.profileComplete);
  const [mounted, setMounted] = useState(false);

  // ── Biometric lock state ────────────────────────────────────────────────
  // biometricEnabled: user preference — defaults to true but only activates
  //                   when the device actually supports biometrics.
  const [biometricEnabled, setBiometricEnabled] = useState(true);
  const [isUnlocked,       setIsUnlocked]       = useState(false);
  const [biometricReady,   setBiometricReady]   = useState(false);
  const lastActiveTimeRef = useRef<number>(Date.now());

  // Check hardware support once on mount; if unavailable skip the lock gate
  useEffect(() => {
    checkBiometricSupport().then((supported) => {
      if (!supported) {
        // Device has no enrolled biometrics — bypass lock entirely
        setIsUnlocked(true);
        setBiometricEnabled(false);
      }
      setBiometricReady(true);
    });
  }, []);

  // Re-lock after 2 min in background (only when biometrics are enabled)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lastActiveTimeRef.current = Date.now();
      }
      if (nextState === 'active') {
        const diff = Date.now() - lastActiveTimeRef.current;
        // 2 minutes = 120 000 ms; never re-lock in low-power (dim) session
        if (biometricEnabled && diff > 120_000) {
          setIsUnlocked(false);
        }
      }
    });
    return () => subscription.remove();
  }, [biometricEnabled]);

  // Expose setters globally so PlayScreenClean can toggle biometrics / lock app.
  // We attach them to a stable module-level ref instead of global to avoid
  // polluting the global scope and breaking strict-mode.
  useEffect(() => {
    BiometricLayoutControls._setBiometricEnabled = setBiometricEnabled;
    BiometricLayoutControls._lockApp = () => setIsUnlocked(false);
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
          // Skip splash — route straight to play (Pro mode default)
          router.replace(profileComplete ? '/(tabs)/play' : '/profile-setup');
        }
      } else if (!isGuest && !inAuthGroup && !inSetupGroup) {
        // Not signed in and not a guest — send to auth
        router.replace('/auth');
      }
    });
    return unsubscribe;
  }, [segments, mounted]);

  if (!fontsLoaded && !fontError) return null;
  // Wait for biometric hardware check before rendering anything
  if (!biometricReady) return null;

  // Show lock screen when auth is required
  if (biometricEnabled && !isUnlocked) {
    return <LockScreen onUnlock={() => setIsUnlocked(true)} />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="splash" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="profile-setup" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="swing-lab" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
