import { Stack , router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { SmartVisionProvider } from '../contexts/SmartVisionContext';
import { KevinPresenceProvider } from '../contexts/KevinPresenceContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore } from '../store/roundStore';
import { initListeningSession } from '../services/listeningSession';
import { setEnabled as setEarbudEnabled } from '../services/earbudControl';
import { activateMediaSession, deactivateMediaSession } from '../services/mediaKeyBridge';
import { startHoleDetection, stopHoleDetection, subscribeToHoleDetection } from '../services/holeDetection';
import { consumeDeferredPaywall } from '../services/paywallGuard';
import { initAudioLifecycle } from '../services/audioLifecycle';
import { initBatteryMonitor } from '../services/batteryMonitor';
import { shotDetectionService } from '../services/shotDetectionService';
import { conversationalLoggingOrchestrator } from '../services/conversationalLoggingOrchestrator';
import { subscribeToMark } from '../services/positionMarkBus';
import { setMarkedFix } from '../services/smartFinderService';
import BatteryPrompt from '../components/battery/BatteryPrompt';

// Phase Y — run `body` only after roundStore rehydration completes. Prevents
// the rehydration race where a fast user tapping Start Round before
// AsyncStorage finishes loading sees `isRoundActive` flip true → false (the
// rehydrated snapshot lands AFTER startRound and overwrites it). All three
// subscribers in this file initialise `let active = getState().isRoundActive`
// at effect-mount; without this gate, they'd capture the pre-hydration
// default (false) and miss the user's startRound() flip when hydration
// races in afterwards.
function whenRoundStoreHydrated(body: () => void | (() => void)): () => void {
  let cleanup: void | (() => void) = undefined;
  const persistApi = (useRoundStore as unknown as {
    persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
  }).persist;
  if (persistApi.hasHydrated()) {
    cleanup = body();
  } else {
    const unsub = persistApi.onFinishHydration(() => {
      cleanup = body();
      unsub();
    });
    return () => {
      unsub();
      if (typeof cleanup === 'function') cleanup();
    };
  }
  return () => {
    if (typeof cleanup === 'function') cleanup();
  };
}

// TODO (Wednesday MacBook setup): add EXPO_PUBLIC_SENTRY_DSN + Sentry org/project to eas.json,
// then remove SENTRY_DISABLE_AUTO_UPLOAD=true from eas.json build profiles.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? 'development' : 'production',
  });
}

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Inner layout reads theme and guards onboarding
function AppNavigator() {
  const { colors } = useTheme();

  // Intentionally removed: do not redirect here. app/index.tsx owns initial
  // routing after hydration. A guard here fires before AsyncStorage hydrates,
  // races against index.tsx's redirect, and corrupts the nav stack.

  // Trial lifecycle: init on first open, expire after 7 days
  useEffect(() => {
    const { first_opened_at, trial_started_at, subscription_status, initTrial, setSubscriptionStatus } =
      usePlayerProfileStore.getState();
    if (!first_opened_at) {
      initTrial();
    } else if (subscription_status === 'trial' && trial_started_at) {
      if (Date.now() - trial_started_at > TRIAL_DURATION_MS) {
        setSubscriptionStatus('expired');
      }
    }
  }, []);

  // Pre-beta — boot battery discipline lifecycles. Both are idempotent.
  useEffect(() => {
    initAudioLifecycle();
    initBatteryMonitor();
  }, []);

  // Phase O — boot earbud listening session bus, honoring user setting
  useEffect(() => {
    initListeningSession();
    const unsub = useSettingsStore.subscribe((s) => {
      setEarbudEnabled(s.earbudTapToTalk);
    });
    setEarbudEnabled(useSettingsStore.getState().earbudTapToTalk);
    return () => { unsub(); };
  }, []);

  // Phase O.5 — activate the native media session only while a round is
  // active, so other media apps (Spotify, podcasts) keep their system
  // controls when SmartPlay isn't the relevant earbud-tap target.
  // Cage and Arena screens activate locally via their own focus effects.
  // Phase Y — gated on roundStore rehydration so the captured `active`
  // baseline reflects persisted state, not the pre-hydration default.
  useEffect(() => whenRoundStoreHydrated(() => {
    let active = useRoundStore.getState().isRoundActive;
    if (active) void activateMediaSession();
    const unsub = useRoundStore.subscribe((s) => {
      if (s.isRoundActive === active) return;
      active = s.isRoundActive;
      if (active) void activateMediaSession();
      else void deactivateMediaSession();
    });
    return () => {
      unsub();
      void deactivateMediaSession();
    };
  }), []);

  // Pre-beta — consume any deferred paywall on cold start AND when an
  // active round transitions to inactive (round finalize). The guard in
  // services/paywallGuard.ts writes the flag whenever a paywall would
  // otherwise have interrupted play.
  // Phase Y — gated on rehydration. Same race fingerprint as media session.
  useEffect(() => whenRoundStoreHydrated(() => {
    const showIfPending = async () => {
      const deferred = await consumeDeferredPaywall();
      if (!deferred) return;
      console.log('[paywall] resuming deferred paywall —', deferred.reason);
      try { router.push('/paywall' as never); } catch {}
    };
    void showIfPending();
    let active = useRoundStore.getState().isRoundActive;
    const unsub = useRoundStore.subscribe((s) => {
      if (s.isRoundActive === active) return;
      const wasActive = active;
      active = s.isRoundActive;
      if (wasActive && !active) void showIfPending();
    });
    return () => { unsub(); };
  }), []);

  // Phase Q.5b — hole detection polling tied to round-active state.
  // Subscriber routes detected transitions through roundStore.setCurrentHole
  // (which in turn closes the prior hole's last shot end_location via
  // courseGeometryService — Component 3).
  // Phase Y — rehydration-gated; previously this captured `active=false`
  // pre-hydration and never engaged auto-advance for the round.
  useEffect(() => whenRoundStoreHydrated(() => {
    const unsubDetect = subscribeToHoleDetection((nextHole) => {
      const round = useRoundStore.getState();
      if (round.currentHole !== nextHole) round.setCurrentHole(nextHole);
    });
    let active = useRoundStore.getState().isRoundActive;
    if (active) startHoleDetection();
    const unsubRound = useRoundStore.subscribe((s) => {
      if (s.isRoundActive === active) return;
      active = s.isRoundActive;
      if (active) startHoleDetection();
      else stopHoleDetection();
    });
    return () => {
      unsubDetect();
      unsubRound();
      stopHoleDetection();
    };
  }), []);

  // Phase AL — wire global subscribers to the position Mark bus.
  // Each consumer that depends on GPS position handles refresh in its
  // own way; the bus is decoupled so adding a new GPS-dependent
  // service later is a one-line subscribeToMark() call.
  useEffect(() => {
    const unsub = subscribeToMark((mark) => {
      // SmartFinder: seed lastFix to the marked spot so front/middle/back
      // yardages reflect the new position immediately instead of waiting
      // for the next watch tick.
      setMarkedFix(mark.lat, mark.lng, mark.accuracy_m);
      // Hole detection: trigger an immediate evaluate by nudging
      // currentHole to itself (no-op store write that fires the
      // subscriber chain). The actual hole-recheck happens inside
      // holeDetection.ts's poll loop on the next tick (~1s).
      // Future: holeDetection could expose a forceEvaluate() that runs
      // synchronously when called from this subscriber.
    });
    return () => { unsub(); };
  }, []);

  // Phase Y — shot detection + conversational logging lifecycle moved here
  // from app/(tabs)/caddie.tsx so they are independent of which tab is
  // focused. Previously, briefly leaving the caddie tab tore down the GPS
  // shot subscription. Same hydration-gated subscriber pattern as above.
  useEffect(() => whenRoundStoreHydrated(() => {
    let active = useRoundStore.getState().isRoundActive;
    const apply = (next: boolean) => {
      if (next) {
        shotDetectionService.start().catch(() => {});
        conversationalLoggingOrchestrator.start();
      } else {
        conversationalLoggingOrchestrator.stop();
        shotDetectionService.stop();
      }
    };
    if (active) apply(true);
    const unsub = useRoundStore.subscribe((s) => {
      if (s.isRoundActive === active) return;
      active = s.isRoundActive;
      apply(active);
    });
    return () => {
      unsub();
      conversationalLoggingOrchestrator.stop();
      shotDetectionService.stop();
    };
  }), []);

  return (
    <>
      <StatusBar style="auto" />
      <BatteryPrompt />
      <RoundActiveDevIndicator />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen
          name="greeting"
          options={{ animation: 'fade', headerShown: false, gestureEnabled: false }}
        />
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
          name="reference"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="swinglab/upload"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="swinglab/library"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="swinglab/swing/[swing_id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="swinglab/tutorials"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="swinglab/tutorial-upload"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="swinglab/tutorial/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="swinglab/space-scan"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="swinglab/cage-drill"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="cage-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="api-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="patterns-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="plan-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="ghost-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="landmark-curate"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="cage-review"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="recap/[round_id]"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="onboarding"
          options={{ animation: 'fade', headerShown: false }}
        />
        <Stack.Screen
          name="round/briefing"
          options={{ animation: 'fade', headerShown: false }}
        />
        <Stack.Screen
          name="smartfinder"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="smartfinder-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="paywall"
          options={{ animation: 'slide_from_bottom', presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="subscription-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="battery-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        {/* Nav audit — register the remaining route files so none of them
            fall back to Expo Router's default header on a deep-link entry. */}
        <Stack.Screen
          name="tutorials"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="voice-debug"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="kevin-learning"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="lie-analysis"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="smartfinder-camera"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="settings/trust-level"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="course/[course_id]"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        <Stack.Screen
          name="recap/hole/[round_id]/[hole]"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
      </Stack>
    </>
  );
}

// Phase Y — dev-only round-state indicator. Lets Tim verify state is
// propagating during testing without opening the debug screen. Renders
// only when __DEV__ is true; production builds drop the component to null.
function RoundActiveDevIndicator(): React.ReactElement | null {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const courseHoles = useRoundStore(s => s.courseHoles);
  if (!__DEV__) return null;
  const hydrated = (useRoundStore as unknown as {
    persist: { hasHydrated: () => boolean };
  }).persist.hasHydrated();
  const totalHoles = courseHoles?.length ?? 0;
  const label = !hydrated
    ? 'HYDRATING…'
    : isRoundActive
      ? `ROUND ACTIVE: hole ${currentHole}${totalHoles ? `/${totalHoles}` : ''}`
      : 'ROUND IDLE';
  const bg = !hydrated ? 'rgba(245,166,35,0.85)' : isRoundActive ? 'rgba(0,200,150,0.85)' : 'rgba(107,114,128,0.6)';
  return (
    <View
      pointerEvents="none"
      style={{
        // Phase AT — bottom-right was overlapping tab bar buttons. Now
        // anchored to top-right corner, BELOW the system status bar but
        // tucked into the corner where there's no tappable chrome.
        position: 'absolute',
        top: 4,
        right: 4,
        paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3,
        backgroundColor: bg, zIndex: 9999,
        opacity: 0.6,
      }}
    >
      <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <Sentry.ErrorBoundary>
    <SmartVisionProvider>
    <KevinPresenceProvider>
    <SafeAreaProvider>
      <ThemeProvider>
        <AppNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
    </KevinPresenceProvider>
    </SmartVisionProvider>
    </Sentry.ErrorBoundary>
  );
}
