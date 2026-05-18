import '../services/polyfills';
import { Stack , router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { SmartVisionProvider } from '../contexts/SmartVisionContext';
import { KevinPresenceProvider } from '../contexts/KevinPresenceContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { usePlayerProfileStore, isOwnerEmail, OWNER_EMAILS } from '../store/playerProfileStore';
import { SUBSCRIPTIONS_ENABLED } from '../services/featureAccess';
import { useSettingsStore, type Persona } from '../store/settingsStore';
import { useRoundStore, whenRoundStoreHydrated } from '../store/roundStore';
import { initListeningSession } from '../services/listeningSession';
import { setEnabled as setEarbudEnabled } from '../services/earbudControl';
import { activateMediaSession, deactivateMediaSession } from '../services/mediaKeyBridge';
import { startHoleDetection, stopHoleDetection, subscribeToHoleDetection } from '../services/holeDetection';
import { startOffCourseDetector, stopOffCourseDetector } from '../services/offCourseDetector';
import { startMovementModeDetector, stopMovementModeDetector } from '../services/movementModeDetector';
import { subscribePoorSignal } from '../services/gpsManager';
// Phase 411-hotfix — REMOVED the side-effect import of
// services/backgroundLocationTask. That module's TaskManager.defineTask
// at module load was the root cause of a white-screen boot crash on
// the Phase 405 wave 4 EAS build: when defineTask threw (native binding
// issue or task-name conflict), the throw propagated through the
// _layout.tsx module load and the entire render tree failed to mount.
// Lazy-registered now from inside startBackgroundLocation() instead.
// Background updates can't fire until startBackgroundLocation is
// called anyway (which only happens after the user starts a round),
// so the lazy pattern is equivalent for normal use AND eliminates the
// boot risk.
import { useToastStore } from '../store/toastStore';
import { consumeDeferredPaywall } from '../services/paywallGuard';
import { initAudioLifecycle } from '../services/audioLifecycle';
import { initBatteryMonitor } from '../services/batteryMonitor';
import { shotDetectionService } from '../services/shotDetectionService';
import { conversationalLoggingOrchestrator } from '../services/conversationalLoggingOrchestrator';
import { subscribeToMark } from '../services/positionMarkBus';
import { setMarkedFix } from '../services/smartFinderService';
import BatteryPrompt from '../components/battery/BatteryPrompt';
import { subscribeActiveSurface } from '../services/activeSurfaceRegistry';
import { getActiveCaddie, mapSurfaceToPillar } from '../services/caddieResolver';
import { speak as speakHandoff, stopSpeaking } from '../services/voiceService';
import { useTeamIntelligenceStore } from '../store/teamIntelligenceStore';
import { initTeamIntelligenceForSession } from '../services/teamIntelligence';
import CaddieSuggestionCard from '../components/CaddieSuggestionCard';
import GpsQualityOverlay from '../components/dev/GpsQualityOverlay';
import CaptureOverlay from '../components/CaptureOverlay';
import { UpdateAvailableBanner } from '../components/UpdateAvailableBanner';
import CaptionStrip from '../components/CaptionStrip';
import { GlobalToolsMenu } from '../components/tools/GlobalToolsMenu';
import { GlobalToast } from '../components/toast/GlobalToast';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Phase Y — whenRoundStoreHydrated lives in store/roundStore.ts (was
// inlined here originally; audit moved it to remove a brittle
// Zustand-internals cast from this file).

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

  // Trial lifecycle: init on first open, expire after 7 days.
  // Owner override: if the user's email (or EXPO_PUBLIC_OWNER_EMAIL env)
  // matches the owner allow-list, grant lifetime instead of starting a
  // trial. Lifetime accounts skip the expire check entirely.
  //
  // Subscriptions kill-switch (services/featureAccess.SUBSCRIPTIONS_ENABLED):
  // when false, the entire trial lifecycle is short-circuited — every user
  // is granted lifetime so no paywall, no expire, no countdown ever fires.
  // Flip back to true once a real billing provider is wired up.
  useEffect(() => {
    const profile = usePlayerProfileStore.getState();
    const { first_opened_at, trial_started_at, subscription_status, initTrial, setSubscriptionStatus, grantLifetime } = profile;

    // 2026-05-19 — Owner email auto-mirror. Runs BEFORE the
    // subscriptions kill-switch so Owner Tools (Settings → Owner Tools)
    // are reachable even when SUBSCRIPTIONS_ENABLED is false. Previously
    // the kill-switch returned early before the env-mirror code at line
    // 106 ran, so profile.email stayed blank and isOwnerEmail() returned
    // false → Owner Tools section never rendered for Tim on the preview
    // build (env var EXPO_PUBLIC_OWNER_EMAIL only lives in .env.local,
    // not in the preview eas.json profile).
    //
    // Mirror order: explicit env var > single-entry OWNER_EMAILS default.
    // The single-entry default catches the single-tester beta case so
    // owner mode works without env or build-config hassle. When the
    // allowlist grows past one entry, the auto-set stops and email must
    // be set explicitly via setEmail (login / Settings text input).
    if (!profile.email) {
      const envOwner = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim();
      if (envOwner.length > 0) {
        profile.setEmail(envOwner);
      } else if (OWNER_EMAILS.length === 1) {
        profile.setEmail(OWNER_EMAILS[0]);
      }
    }

    // 0) Global kill-switch — make everyone lifetime, skip everything else.
    if (!SUBSCRIPTIONS_ENABLED) {
      if (subscription_status !== 'lifetime') grantLifetime();
      return;
    }

    // 1) Lifetime override wins over everything. Re-asserts every boot
    // so a corrupted/manually-edited status snaps back.
    const envOwner = (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim();
    if (isOwnerEmail(profile.email) || envOwner.length > 0) {
      if (subscription_status !== 'lifetime') grantLifetime();
      return;
    }
    // 2) Already lifetime — leave it alone.
    if (subscription_status === 'lifetime') return;
    // 3) Standard trial lifecycle.
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

  // Phase BH — silent OTA on app start. checkForUpdateAsync + fetch happen
  // in the background; the bundle applies on the *next* cold launch (we
  // never auto-reload mid-session because that would interrupt a round).
  // Manual "App Refresh" in the Tools menu is still the way to apply
  // immediately when the user wants it.
  useEffect(() => {
    void (async () => {
      try {
        const Updates = await import('expo-updates');
        if (!Updates.isEnabled) return;
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        console.log('[updates] background fetch complete — applies on next launch');
      } catch (e) {
        console.log('[updates] background fetch failed', e);
      }
    })();
  }, []);

  // Phase 106 — boot team intelligence: reset per-session counters and
  // wire the handoff orchestrator. When a pending suggestion is accepted,
  // temporarily reassign the suggestion's pillar to the suggested caddie.
  // When the user leaves that pillar (return condition), revert to the
  // originally-assigned caddie for that pillar so the handoff doesn't
  // permanently change the user's preferences.
  useEffect(() => {
    initTeamIntelligenceForSession();

    // Track per-pillar overrides made by accepted handoffs so we can
    // revert when the user leaves that pillar. Map: pillar → original caddie.
    const handoffOverrides = new Map<string, Persona>();

    const unsubAccept = useTeamIntelligenceStore.subscribe((s, prev) => {
      // Detect a freshly-accepted suggestion: prev had pendingSuggestion,
      // current has acceptedHandoffs grown by one with no decline cooldown
      // bump. The store's acceptPendingSuggestion clears pending and
      // appends to acceptedHandoffs in one set call, so this comparison is
      // race-safe.
      if (s.acceptedHandoffs.length <= prev.acceptedHandoffs.length) return;
      const acceptedId = s.acceptedHandoffs[s.acceptedHandoffs.length - 1];
      if (!acceptedId) return;
      // Find the suggestion that was just accepted (already cleared from
      // pendingSuggestion). We need its original details from prev.
      const accepted = prev.pendingSuggestion;
      if (!accepted || accepted.id !== acceptedId) return;

      // Stash the current assignment so we can revert on return.
      const assignments = useSettingsStore.getState().caddieAssignments;
      const originalForPillar = assignments[accepted.pillar];
      handoffOverrides.set(accepted.pillar, originalForPillar);

      // Apply the override (this triggers _layout's existing pillar →
      // caddiePersonality sync via the assignment subscription).
      useSettingsStore.getState().setCaddieForPillar(accepted.pillar, accepted.toPersona);

      // Voice handoff line if not in 'soft' or 'off' suppression mode.
      const settings = useSettingsStore.getState();
      if (settings.caddieSuggestions === 'on' && settings.voiceEnabled && !settings.discreteMode) {
        const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
        const NAME: Record<Persona, string> = { kevin: 'Kevin', serena: 'Serena', harry: 'Harry', tank: 'Tank' };
        const handoffLine = `Alright — handing off to ${NAME[accepted.toPersona]} for this. ${NAME[accepted.toPersona]} will bring you back when ready.`;
        speakHandoff(handoffLine, settings.voiceGender, settings.language, apiUrl, { userInitiated: false }).catch(() => {});
      }
    });

    // Return condition: when the active surface leaves the pillar where
    // a handoff was active, revert that pillar's assignment back to the
    // original caddie (the user's prior preference).
    const unsubReturn = subscribeActiveSurface((next) => {
      if (handoffOverrides.size === 0) return;
      const nextPillar = mapSurfaceToPillar(next);
      // Any pillar in the override map that isn't the new pillar reverts.
      for (const [pillar, original] of handoffOverrides.entries()) {
        if (pillar === nextPillar) continue;
        useSettingsStore.getState().setCaddieForPillar(pillar as 'round' | 'cage' | 'drills' | 'play', original);
        handoffOverrides.delete(pillar);
      }
    });

    return () => { unsubAccept(); unsubReturn(); };
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

  // Phase 105 — sync caddiePersonality to the active pillar's caddie.
  // When the user crosses surfaces (e.g. Round → Cage), caddiePersonality
  // flips to that pillar's assigned caddie. Existing consumers (voice,
  // brain, avatar) already read caddiePersonality so this routes the
  // team architecture through every site without per-call-site refactor.
  // setCaddiePersonality also clears the persona-keyed audio caches so
  // the user doesn't hear the prior pillar's caddie's filler clips.
  //
  // Handoff line: when the active caddie actually changes (not on first
  // mount), the new caddie says one short in-character line so the user
  // hears the team handoff explicitly. Suppressed when the change came
  // from a manual override in Settings (no surface transition).
  useEffect(() => {
    const HANDOFF_LINES: Record<string, string> = {
      kevin: "Hey, ready when you are.",
      serena: "Serena. Let's get to it.",
      harry: "Harry here. Let's think this through together.",
      tank: "Tank here. Let's work.",
    };

    let firstSync = true;
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

    // PGA HOPE follow-up (B2): cart power-cycles re-fire the active-surface
    // subscriber, which used to deliver the handoff line twice in quick
    // succession. Debounce identical (cur → next) transitions inside a 2s
    // window so a wake event after a momentary sleep doesn't double-speak.
    let lastHandoffKey = '';
    let lastHandoffAt = 0;
    const HANDOFF_DEBOUNCE_MS = 2000;

    const syncFromSurface = () => {
      const next = getActiveCaddie();
      const cur = useSettingsStore.getState().caddiePersonality;
      if (next === cur) return;
      const key = `${cur}->${next}`;
      const now = Date.now();
      if (key === lastHandoffKey && now - lastHandoffAt < HANDOFF_DEBOUNCE_MS) return;
      lastHandoffKey = key;
      lastHandoffAt = now;
      // Phase BM — await stopSpeaking BEFORE issuing the handoff line so the
      // queued briefing/proactive utterance is fully cancelled. Previously
      // both ran in parallel via the singleton, which gave the ~50ms two-voice
      // overlap Tim reported at round-start.
      useSettingsStore.getState().setCaddiePersonality(next);
      if (firstSync) { firstSync = false; return; }
      const settings = useSettingsStore.getState();
      if (!settings.voiceEnabled || settings.discreteMode) return;
      const line = HANDOFF_LINES[next];
      if (!line) return;
      void (async () => {
        await stopSpeaking().catch(() => {});
        await speakHandoff(line, settings.voiceGender, settings.language, apiUrl, { userInitiated: false }).catch(() => {});
      })();
    };

    const syncFromAssignmentChange = () => {
      const next = getActiveCaddie();
      const cur = useSettingsStore.getState().caddiePersonality;
      if (next === cur) return;
      // Same race guard for Settings-driven swaps.
      stopSpeaking().catch(() => {});
      // Manual Settings edit — suppress voice handoff (the user was just
      // tapping a row, no need to talk over them).
      useSettingsStore.getState().setCaddiePersonality(next);
    };

    syncFromSurface();
    const unsub = subscribeActiveSurface(syncFromSurface);
    const unsubAssign = useSettingsStore.subscribe((s, prev) => {
      if (s.caddieAssignments === prev.caddieAssignments) return;
      syncFromAssignmentChange();
    });
    return () => { unsub(); unsubAssign(); };
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
    // Phase 405 wave 2 — sustained-poor-signal callout. Fires once
     // when accuracy has been weak for 45s during an active round; the
     // listener pops a toast so the user gets actionable feedback
     // ("step into open sky") instead of just a passive dot color
     // change in SmartFinder. Subscription is process-lifetime — the
     // service itself only emits during active rounds (evaluateMode
     // only ticks while the watch is running).
    const unsubPoor = subscribePoorSignal((info) => {
      const acc = info.accuracy_m != null ? `~${Math.round(info.accuracy_m)}m` : 'unknown';
      useToastStore.getState().show(`GPS weak (${acc}) — step into open sky or tap Mark.`);
    });
    let active = useRoundStore.getState().isRoundActive;
    if (active) {
      startHoleDetection();
      startOffCourseDetector();
      // Phase 405 wave 3 — movement-mode detector starts with the
      // others so the UI can show a cart/walking indicator from the
      // first hole.
      startMovementModeDetector();
    }
    const unsubRound = useRoundStore.subscribe((s) => {
      if (s.isRoundActive === active) return;
      active = s.isRoundActive;
      if (active) {
        startHoleDetection();
        startOffCourseDetector();
        startMovementModeDetector();
      } else {
        stopHoleDetection();
        stopOffCourseDetector();
        stopMovementModeDetector();
      }
    });
    return () => {
      unsubDetect();
      unsubRound();
      unsubPoor();
      stopHoleDetection();
      stopOffCourseDetector();
      stopMovementModeDetector();
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
      // Phase 405 wave 4 — manual shot-location correction. When the
      // user taps Mark within 60s of logging a shot, treat the Mark
      // position as a correction of that shot's end_location (the
      // "ball location" after the swing). Same semantics as the
      // "I'm at my ball" voice intent, but bound to the Mark button
      // so users who don't use voice still have a manual correction
      // path. The 60s window matches the typical walk-to-ball time
      // and prevents Marks-for-other-reasons from accidentally
      // mutating shot records far after the fact.
      try {
        const round = useRoundStore.getState();
        if (round.isRoundActive) {
          const hole = round.currentHole;
          const lastShotOnHole = [...round.shots]
            .reverse()
            .find(s => s.hole === hole);
          if (lastShotOnHole) {
            const ageMs = Date.now() - lastShotOnHole.timestamp;
            if (ageMs < 60_000 && !lastShotOnHole.end_location) {
              round.closeHoleEndLocation(hole, { lat: mark.lat, lng: mark.lng });
              console.log(`[mark] shot-location correction applied to shot ${lastShotOnHole.id} (${Math.round(ageMs / 1000)}s old)`);
            }
          }
        }
      } catch (e) {
        console.log('[mark] shot-location correction skipped:', e);
      }
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
        // Apply cart-aware thresholds at every round-start so a toggle
        // flipped mid-session takes effect on the next round without a
        // relaunch. Walking mode resets the defaults; cart mode shortens
        // the stationary window and switches to current-speed suppression.
        shotDetectionService.configure({ cartMode: useSettingsStore.getState().cartMode });
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
    // Reconfigure live when cartMode toggles during an active round so the
    // change takes effect immediately (next sample evaluation cycle).
    const unsubSettings = useSettingsStore.subscribe((s, prev) => {
      if (s.cartMode === prev.cartMode) return;
      if (useRoundStore.getState().isRoundActive) {
        shotDetectionService.configure({ cartMode: s.cartMode });
      }
    });
    return () => {
      unsub();
      unsubSettings();
      conversationalLoggingOrchestrator.stop();
      shotDetectionService.stop();
    };
  }), []);

  return (
    <>
      <StatusBar style="auto" />
      <BatteryPrompt />
      {/* Auto-update banner — slides in from the top safe area when EAS
          Update has a newer JS bundle fetched and ready. Tap "Update" to
          reload. Suppressed mid-round and during voice interaction so
          the user isn't yanked off mid-hole / mid-conversation. */}
      <UpdateAvailableBanner />
      {/* Phase 106 — caddie team handoff suggestion overlay. */}
      <CaddieSuggestionCard />
      {/* Phase 107 — GPS quality debug overlay (gated by settings flag). */}
      <GpsQualityOverlay />
      {/* Phase 110-followup — Round-side capture surface. Subscribes for
          'shot' kind; renders CameraView only when active. */}
      <CaptureOverlay />
      {/* PGA HOPE follow-up (A2) — pinned TTS caption strip for hearing
          accessibility. Renders only while TTS is playing AND ttsCaptions
          is enabled in settings. */}
      <CaptionStrip />
      {/* Global Tools menu — opened from the ••• pill in every tab's
          BrandHeaderRow. Mounts once here so the modal is reachable from
          anywhere without prop-drilling. State lives in toolsMenuStore. */}
      <GlobalToolsMenu />
      {/* Tiny snackbar for one-shot confirmations (mode change, etc.). */}
      <GlobalToast />
      <RoundActiveDevIndicator />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        {/* First-launch intro video. fade animation matches greeting;
            gestureEnabled false so users can't swipe back into it after
            it routes them forward. */}
        <Stack.Screen
          name="intro-video"
          options={{ animation: 'fade', headerShown: false, gestureEnabled: false }}
        />
        {/* One-time core permissions pre-flight. Same gating model as
            intro-video — fade in/out, no swipe-back. */}
        <Stack.Screen
          name="permissions"
          options={{ animation: 'fade', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="greeting"
          options={{ animation: 'fade', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="intro" />
        <Stack.Screen name="auth" />
        {/* Phase 410 — first-launch welcome (single-screen profile
            capture: name + caddie + optional handicap). Reached on
            fresh installs with no first_opened_at + no name, and from
            the Settings → Edit Profile row. fade animation so the
            transition feels intentional rather than navigational. */}
        <Stack.Screen
          name="welcome"
          options={{ animation: 'fade', headerShown: false }}
        />
        {/* Phase 411 — in-app Quick Start Guide. Reachable from
            Settings → Help → Quick Start Guide and from the welcome
            screen's "Quick tour" button. Same content as the PDF
            tester guide. slide_from_bottom for the "reference doc"
            feel — feels like a sheet you can dismiss. */}
        <Stack.Screen
          name="quick-start"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        {/* 2026-05-17 — Owner-only issue log surface. Gated to the
            owner email inside the screen itself; non-owners see a
            polite placeholder. Reachable from Settings -> Owner Tools. */}
        <Stack.Screen name="owner-logs" options={{ headerShown: false }} />
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
        {/* Phase 403 — SmartMotion Quick: course-mode simplified swing
            capture. /swinglab/cage-drill remains the cage-mode flow with
            full bullseye + calibration setup. This route is for the
            "open SmartMotion" voice intent and the Tools menu shortcut —
            camera goes live immediately, acoustic detector arms the
            stop. */}
        <Stack.Screen
          name="smartmotion-quick"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        {/* Phase 405b — internal authoring tool. Tank (the real
            instructor behind the persona) uses this to capture
            per-category swing references that appear instantly in the
            side-by-side fault modal via the runtime overlay in
            services/swingReferences.ts. Not surfaced to end users
            today; reachable via the Tools menu "Reference Authoring"
            row. */}
        <Stack.Screen
          name="author/reference-assets"
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
  // Custom ErrorBoundary replaces Sentry.ErrorBoundary. The Sentry variant
  // renders `null` when no `fallback` prop is provided AND no DSN is set —
  // which produces a visually-indistinguishable white screen and was the
  // PROBABLE cause of "post-permissions white screen" reports through
  // 2026-05-16. Our boundary always renders a visible error UI with the
  // stack so we never fly blind again. Sentry breadcrumbs still flow via
  // explicit Sentry.addBreadcrumb calls elsewhere in the codebase when
  // EXPO_PUBLIC_SENTRY_DSN is set.
  return (
    <ErrorBoundary>
    <SmartVisionProvider>
    <KevinPresenceProvider>
    <SafeAreaProvider>
      <ThemeProvider>
        <AppNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
    </KevinPresenceProvider>
    </SmartVisionProvider>
    </ErrorBoundary>
  );
}
