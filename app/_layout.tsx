import '../services/polyfills';
import { Stack , router, usePathname } from 'expo-router';
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
import { useSettingsStore } from '../store/settingsStore';
import { useRoundStore, whenRoundStoreHydrated } from '../store/roundStore';
// 2026-05-27 — Fix EA: screenshot mode flag drives the global StatusBar
// hidden prop so the user can capture clean shots without the phone's
// top chrome (time / battery / wifi).
import { useScreenshotModeStore } from '../store/screenshotModeStore';
import i18n from '../i18n';
import { initFeelCapture } from '../services/feelCaptureService';
import { startSwingCommentarySubscription } from '../services/swingCommentaryService';
import { initListeningSession } from '../services/listeningSession';
import { hydrateCourseTruthCache } from '../services/courseTruth';
import { initVoiceTriggers } from '../services/voiceTriggers';
import { setEnabled as setEarbudEnabled } from '../services/earbudControl';
import { startHandsFreeOrchestrator } from '../services/handsFreeOrchestrator';
import { activateMediaSession, deactivateMediaSession } from '../services/mediaKeyBridge';
import { startHoleDetection, stopHoleDetection, subscribeToHoleDetection } from '../services/holeDetection';
import { startOffCourseDetector, stopOffCourseDetector } from '../services/offCourseDetector';
import { startMovementModeDetector, stopMovementModeDetector } from '../services/movementModeDetector';
// 2026-05-24 — GPS confidence-gated proactive ask orchestrator (Flow B).
// Wires the existing subscribePoorSignal → speak() with trust-level
// and cooldown gates so Kevin only asks "what hole?" when GPS is
// soft AND the user hasn't been asked recently. The proactive ask
// IS the honest "we don't know" tell. Initialized at app root next
// to the existing toast subscriber.
import { initGpsConfidenceAsk } from '../services/gpsConfidenceAsk';
// 2026-05-24 — Caddie reward speech (250+ measured drive, 1-putt). Subscribes
// to roundStore.shots / roundStore.putts, persona-aware via the existing
// voiceService.speak path, trust-gated to L2+. Reset on round-start so the
// previous round's dedupe set doesn't suppress new rewards.
import { initCaddieRewards, resetCaddieRewardsForRound } from '../services/caddieRewards';
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
// 2026-05-21 — Fix Q (Path B): subscribeActiveSurface, mapSurfaceToPillar,
// and speakHandoff are no longer needed at this layer — persona switches
// only on explicit user action via setCaddiePersonality (Settings tap or
// accept-handoff), and that store action speaks its own intro line.
import { useTeamIntelligenceStore } from '../store/teamIntelligenceStore';
import { initTeamIntelligenceForSession } from '../services/teamIntelligence';
import CaddieSuggestionCard from '../components/CaddieSuggestionCard';
import GpsQualityOverlay from '../components/dev/GpsQualityOverlay';
import CaptureOverlay from '../components/CaptureOverlay';
import { UpdateAvailableBanner } from '../components/UpdateAvailableBanner';
import NativeFallbackBanner from '../components/NativeFallbackBanner';
import CaptionStrip from '../components/CaptionStrip';
import { GlobalToolsMenu } from '../components/tools/GlobalToolsMenu';
import { GlobalToast } from '../components/toast/GlobalToast';
// 2026-05-24 (Flow C) — Tap-to-undo banner for silent tee Marks
// fired by the declare-hole cross-check. Reads from undoMarkStore;
// hides itself after the visibility window. Sibling to GlobalToast.
import { UndoMarkBanner } from '../components/UndoMarkBanner';
import { ErrorBoundary } from '../components/ErrorBoundary';
// 2026-05-21 — Consolidation 4: routine status logs gated.
import { devLog } from '../services/devLog';

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
// 2026-05-20 — Day 1 / Fix 3: central debug-route gate. Single source
// of truth for which routes are owner-only. Any deep link or
// accidental navigation to one of these paths by a non-owner (and
// not __DEV__) is redirected away. Per-screen useDebugRouteGate()
// calls remain as belt-and-suspenders defense.
const DEBUG_ROUTES: ReadonlySet<string> = new Set([
  '/gps-test',
  '/acoustic-test',
  '/api-debug',
  '/battery-debug',
  '/cage-debug',
  '/ghost-debug',
  '/patterns-debug',
  '/plan-debug',
  '/smartfinder-debug',
  '/subscription-debug',
  '/voice-debug',
  // 2026-05-21 — Consolidation 3: owner-only authoring + diagnostic
  // surfaces added for centralised gating. Each was reachable today
  // — /author/reference-assets via the Tools menu "Reference
  // Authoring" row (no row-level isOwnerEmail check), /landmark-curate
  // only from cage-debug (transitively gated but defence-in-depth),
  // /owner-logs from Settings → Owner Tools (section-gated but the
  // central gate is the canonical place).
  '/author/reference-assets',
  '/landmark-curate',
  '/owner-logs',
  // 2026-05-23 — Voice coverage log. Lists transcripts of voice commands
  // that didn't match a wired handler. Owner-only.
  '/voice-misses',
  // 2026-05-24 — Swing-analysis telemetry. Compares client frames-sent
  // vs server image-blocks-saw from the last /api/swing-analysis call.
  // Owner-only verification surface for the BUG #1 fix.
  '/swing-analysis-debug',
  // 2026-05-23 — Native module health diagnostic. Lists which native
  // bridges loaded successfully at boot (Meta Wearables, MediaPipe).
  // Owner-only; surfaces "X loaded vs Y missing" without needing
  // adb logcat. Wired in via the centralized DEBUG_ROUTES gate.
  '/native-modules-debug',
]);

function AppNavigator() {
  const { colors } = useTheme();
  // 2026-05-27 — Fix EA: read screenshot-mode flag once at the root so
  // the StatusBar hidden binding is single-source. Selector keeps the
  // re-render scope to the boolean.
  const screenshotMode = useScreenshotModeStore(s => s.enabled);

  // 2026-05-20 — Day 1 / Fix 3: central gate for *-debug + dev test
  // routes. Watches pathname; any non-owner (and not __DEV__) hitting
  // a gated route gets redirected to the caddie home tab. One gate
  // covers all 11 routes — no per-screen check required.
  const pathname = usePathname();
  const ownerEmail = usePlayerProfileStore(s => s.email);
  useEffect(() => {
    if (!pathname) return;
    if (!DEBUG_ROUTES.has(pathname)) return;
    if (__DEV__ || isOwnerEmail(ownerEmail)) return;
    try { router.replace('/(tabs)/caddie' as never); } catch (e) {
      console.log('[debug-gate] redirect failed', e);
    }
  }, [pathname, ownerEmail]);

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
        devLog('[updates] background fetch complete — applies on next launch');
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

    // 2026-05-21 — Fix Q (Path B): an accepted handoff is the user's
    // EXPLICIT opt-in to switch personas. It now switches the GLOBAL
    // caddiePersonality — which in turn resets every pillar so the
    // user's new selection propagates everywhere. Previously this only
    // set a per-pillar override and relied on the deleted
    // `syncFromAssignmentChange` subscriber to lift it to global, AND
    // it auto-reverted when the user crossed surfaces — both behaviors
    // contradicted the "explicit user action only" rule. No magic
    // auto-revert; if the user wants to switch back, they switch back.
    const unsubAccept = useTeamIntelligenceStore.subscribe((s, prev) => {
      if (s.acceptedHandoffs.length <= prev.acceptedHandoffs.length) return;
      const acceptedId = s.acceptedHandoffs[s.acceptedHandoffs.length - 1];
      if (!acceptedId) return;
      const accepted = prev.pendingSuggestion;
      if (!accepted || accepted.id !== acceptedId) return;

      // Global switch — fires setCaddiePersonality's own intro line
      // (the "Tank stepping in" / "Serena here" speak). That intro is
      // the user-initiated handoff announcement; no separate handoff
      // line needed. Suppression honors caddieSuggestions mode below.
      const settings = useSettingsStore.getState();
      if (settings.caddieSuggestions === 'off') return;
      useSettingsStore.getState().setCaddiePersonality(accepted.toPersona);
    });

    return () => { unsubAccept(); };
  }, []);

  // 2026-05-24 — Feel-capture init (owner-only). Subscribes to cage
  // store changes and transcribes each shot's clip audio via Whisper
  // when (a) settings.feelCaptureEnabled AND (b) isOwnerEmail. No-op
  // when either gate fails; cheap on every other user.
  useEffect(() => {
    const teardown = initFeelCapture();
    return () => { teardown(); };
  }, []);

  // 2026-05-25 — Fix AJ Phase 2: Whisper-transcribe spoken commentary
  // from every captured/uploaded swing clip's audio track. Persists to
  // shot.commentary_transcript so the brain has spoken context when
  // the user asks about a specific swing ("what was that putt I just
  // hit"). Default-on for beta; subscribe-once, fire-and-forget.
  useEffect(() => {
    startSwingCommentarySubscription();
  }, []);

  // 2026-05-24 v1.2.1 — Glasses Mode boot-time audio config. When
  // settingsStore.glassesMode is persisted true, pre-configure the
  // audio session for background Bluetooth so TTS routes to Ray-Ban
  // Meta or similar BT headset glasses on launch (not waiting for the
  // first speak() to fire configureAudioForSpeech). Uses the existing
  // queued helper to avoid racing the voice stack's audio mode writes.
  //
  // 2026-05-28 — Fix FS: subscribe to settingsStore.hasHydrated so the
  // read fires AFTER persist rehydration. Previously this useEffect ran
  // once on mount with [] deps, reading glassesMode while it was still
  // the default false even if the user had it persisted true — silently
  // skipping the BT pre-config and forcing the first speak() to pay
  // the audio-mode cost on the slow path.
  const settingsHydrated = useSettingsStore(s => s.hasHydrated);
  useEffect(() => {
    if (!settingsHydrated) return;
    if (!useSettingsStore.getState().glassesMode) return;
    (async () => {
      try {
        const voice = await import('../services/voiceService');
        await voice.configureAudioForSpeech();
      } catch (e) {
        console.log('[glassesMode boot] audio config failed (non-fatal):', e);
      }
    })();
  }, [settingsHydrated]);

  // 2026-05-24 — Keep i18n in sync with settingsStore.language. Voice
  // "switch to Spanish" / Settings picker both write to settings; this
  // subscription mirrors the change into i18n.changeLanguage so UI
  // text + Tank rule lookups follow the same source of truth as voice
  // + TTS. i18n imported above for the side-effect of initialization.
  useEffect(() => {
    void i18n;
    // 2026-05-26 — Fix BC: include 'zh' in the target map. Was 'es'
    // or 'en' only — Chinese setting silently mapped to English even
    // though zh resources are now loaded. Lockstep with the zh.json
    // addition + the multilingual TTS default fix in /api/voice and
    // /api/kevin.
    const apply = (lng: 'en' | 'es' | 'zh') => {
      const target: 'en' | 'es' | 'zh' =
        lng === 'es' ? 'es' :
        lng === 'zh' ? 'zh' :
        'en';
      if (i18n.language !== target) {
        void i18n.changeLanguage(target);
      }
    };
    apply(useSettingsStore.getState().language);
    const unsub = useSettingsStore.subscribe((s) => apply(s.language));
    return () => { unsub(); };
  }, []);

  // Phase O — boot earbud listening session bus, honoring user setting
  useEffect(() => {
    initListeningSession();
    // 2026-05-22 — Hands-Free orchestrator runs alongside the legacy
    // listeningSession.toggle() subscription. It adds pattern-aware
    // dispatch (single/double/triple/long-press) + watch-bridge tap
    // routing + voice-replay. Single-tap behavior stays identical
    // to before (legacy subscriber inside listeningSession still
    // calls toggle on every tap), so no regression for users without
    // pattern-driven habits.
    startHandsFreeOrchestrator();
    // 2026-05-24 — Hydrate surveyed green-truth cache from AsyncStorage
    // so the sync resolveGreenCoords chain can short-circuit to TRUTH
    // when present. Fire-and-forget; failures fall through to existing
    // API sources.
    void hydrateCourseTruthCache();
    // 2026-05-24 — Native BT media-button bridge. Funnels through
    // notifyEarbudTap() so it shares the existing earbudControl
    // pattern (no orchestrator change). Native BluetoothMediaButton
    // module is absent in Expo Go — JS wiring gracefully no-ops in
    // that case.
    // 2026-06-03 — voice-assistant launch heuristic removed (was
    // killing splash mp3 on every cold launch).
    const teardownVoiceTriggers = initVoiceTriggers();
    const unsub = useSettingsStore.subscribe((s) => {
      setEarbudEnabled(s.earbudTapToTalk);
    });
    setEarbudEnabled(useSettingsStore.getState().earbudTapToTalk);
    return () => {
      unsub();
      teardownVoiceTriggers();
    };
  }, []);

  // 2026-05-21 — Fix Q (Path B): the prior `syncFromSurface` and
  // `syncFromAssignmentChange` subscribers used to overwrite
  // caddiePersonality with the active-pillar's caddie every time the user
  // crossed surfaces (Round → Cage → Drills). That was the structural
  // source of the cross-persona bleed: pick Serena in Settings, walk to
  // the round, hear Kevin. Per Tim's Fix Q spec, persona is set ONLY by
  // explicit user action — Settings tap or an accept-handoff. Crossing
  // surfaces no longer changes persona. The per-pillar map (and any user-
  // assigned override via Settings) is still resolved at the fetch sites
  // via getActiveCaddie() / getCaddieForPillar() so a power user who
  // explicitly sets a pillar override still gets that override on its
  // surface — but the auto-handoff intro line is gone, and the global
  // persona is no longer silently rewritten by surface crossings.

  // 2026-05-17 — Audit B P0: phantom-round boot guard. Tim's APK-
  // reinstall workflow leaves AsyncStorage-persisted `isRoundActive:
  // true` from whatever round was in flight when the prior build
  // died. The subscribers below (media session, hole detection,
  // shot detection, orchestrator) all start themselves when they
  // see isRoundActive=true at boot — meaning a stale persisted
  // round wakes up the full GPS + shot-detection stack at launch
  // with no real round behind it. This guard runs FIRST after
  // rehydration and discards any phantom round whose markers look
  // wrong (no currentRoundId, no roundStartTime, no activeCourse,
  // or roundStartTime older than 8 hours). discardRound zeroes all
  // in-round state without writing a RoundRecord.
  useEffect(() => whenRoundStoreHydrated(() => {
    const s = useRoundStore.getState();
    if (!s.isRoundActive) return;
    const stale =
      !s.currentRoundId ||
      !s.activeCourse ||
      !s.roundStartTime ||
      (Date.now() - s.roundStartTime) > 8 * 60 * 60 * 1000;
    if (stale) {
      console.log('[boot-guard] discarding phantom round', {
        currentRoundId: s.currentRoundId,
        activeCourse: s.activeCourse,
        ageHours: s.roundStartTime ? (Date.now() - s.roundStartTime) / 3_600_000 : null,
      });
      try { s.discardRound(); } catch (e) { console.log('[boot-guard] discardRound failed', e); }
    }
  }), []);

  // 2026-06-02 — Fix GN: orphan-analysis cleanup. Audit found that
  // cage / library swings where AI analysis was in-flight at force-
  // close stayed at 'pending' or 'analyzing_*' forever — no auto-
  // cleanup. Library showed "analyzing…" indefinitely. Boot-level
  // sweep flips anything in a non-terminal status >24h old to
  // 'failed' so the new retry badge can surface it.
  // Wrapped in try/catch + dynamic require so a cageStore failure
  // can never crash boot.
  useEffect(() => {
    void (async () => {
      try {
        const mod = await import('../store/cageStore');
        const count = mod.useCageStore.getState().purgeStaleAnalyses();
        if (count > 0) {
          devLog('[boot-guard] purged ' + count + ' orphan analyses');
        }
      } catch (e) {
        console.log('[boot-guard] purgeStaleAnalyses failed (non-fatal):', e);
      }
    })();
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
    // 2026-05-22 — Fix T (TOP PRIORITY after two real Menifee rounds where
    // auto-advance was racing ahead of the player 1→3→4 unprovoked). The
    // subscriber callback is now gated on settings.autoHoleAdvance — default
    // FALSE. When false, holeDetection still polls (cheap) but its emitted
    // transitions never auto-call setCurrentHole; the player drives hole
    // changes via cockpit stepper, DataStrip ◀/▶ arrows, or voice. GPS
    // continues feeding SmartFinder yardages on the player's current
    // hole — yardages are GPS's strong suit, hole-guessing isn't.
    const unsubDetect = subscribeToHoleDetection((nextHole) => {
      if (!useSettingsStore.getState().autoHoleAdvance) return;
      const round = useRoundStore.getState();
      if (round.currentHole !== nextHole) round.setCurrentHole(nextHole);
    });
    // 2026-05-24 (Flow B) — GPS confidence-gated proactive ask
    // orchestrator. Init alongside the toast subscriber. Subscribes
    // to the SAME poor-signal gate and adds a spoken "what hole?"
    // question on top with cooldown + trust-level gates. Idempotent
    // — multiple init calls no-op.
    const unsubGpsAsk = initGpsConfidenceAsk();
    // Caddie reward subscriber — fires on 250+ measured drive or 1-putt.
    // Idempotent init; safe alongside other roundStore subscribers.
    const unsubRewards = initCaddieRewards();
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
      const wasActive = active;
      active = s.isRoundActive;
      if (active) {
        startHoleDetection();
        startOffCourseDetector();
        startMovementModeDetector();
        // Clear last round's reward dedupe so new tee shots / 1-putts
        // can fire again. Fires only on inactive→active transition.
        if (!wasActive) resetCaddieRewardsForRound();
      } else {
        stopHoleDetection();
        stopOffCourseDetector();
        stopMovementModeDetector();
      }
    });
    return () => {
      unsubDetect();
      unsubRound();
      unsubGpsAsk();
      unsubRewards();
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
              devLog(`[mark] shot-location correction applied to shot ${lastShotOnHole.id} (${Math.round(ageMs / 1000)}s old)`);
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
        // 2026-05-22 — Fix T. shotDetectionService now gated on
        // settings.autoShotDetection (default FALSE). When off, GPS
        // still feeds SmartFinder yardages via gpsManager, but no
        // automatic shot-logging fires — the STROKE counter only
        // reflects what the player manually enters via stepper or
        // voice ("I made a 5"). Previous behavior was logging shots
        // on every GPS displacement signature, which on real cart
        // rounds produced phantom strokes that drove the STROKE
        // counter past the actual hole score before the player
        // could input. Manual is the safe default; advanced users
        // can flip Settings → Auto Shot Detection ON if they want
        // the GPS shot-detector running.
        //
        // conversationalLoggingOrchestrator still starts — it
        // handles voice / mic / earbud-tap stuff, not auto-shot
        // detection. Leaving that on keeps voice commands working.
        if (useSettingsStore.getState().autoShotDetection) {
          shotDetectionService.configure({ cartMode: useSettingsStore.getState().cartMode });
          shotDetectionService.start().catch(() => {});
        }
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
      {/* 2026-05-27 — Fix EA: when screenshot mode is on, hide the
          top status bar app-wide so promo / App Store screenshots
          come out clean. `hidden` covers iOS fully and the top bar on
          Android; the Android bottom nav bar needs expo-navigation-bar
          (native dep) and ships in the next EAS Build. */}
      <StatusBar style="auto" hidden={screenshotMode} />
      <BatteryPrompt />
      {/* Auto-update banner — slides in from the top safe area when EAS
          Update has a newer JS bundle fetched and ready. Tap "Update" to
          reload. Suppressed mid-round and during voice interaction so
          the user isn't yanked off mid-hole / mid-conversation. */}
      <UpdateAvailableBanner />
      {/* 2026-05-23 — Native fallback banner. Surfaces when DAT or
          MediaPipe native bridges fail to load at boot, so the player
          knows they're in cloud mode rather than confused by silent
          feature absence. Renders nothing on healthy builds. */}
      <NativeFallbackBanner />
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
      {/* 2026-05-24 (Flow C) — Tap-to-undo affordance for silent
          tee Marks fired by the declare-hole cross-check. Auto-hides
          when the 30-second visibility window expires. */}
      <UndoMarkBanner />
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
        {/* 2026-05-17 — intro / auth / hole-view-3d / smartfinder-camera
            / onboarding stack screens removed alongside their .tsx
            files. None had inbound router.push from the rest of the
            app; the welcome / permissions / index.tsx flow owns first-
            launch routing. */}
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
        {/* 2026-05-23 — Owner-only voice-miss log. Same gating as
            owner-logs; surfaces transcripts of voice commands that
            failed to match a wired handler so Tim can review what
            phrasings need building. */}
        <Stack.Screen name="voice-misses" options={{ headerShown: false }} />
        {/* 2026-05-24 — Owner-only swing-analysis telemetry surface.
            Compares client frames-sent vs server image-blocks for the
            most recent /api/swing-analysis call. PASS/CHECK badge
            proves the multi-frame pipe without dashboards. */}
        <Stack.Screen name="swing-analysis-debug" options={{ headerShown: false }} />
        {/* 2026-05-26 — Owner-only Kevin clip playback test surface.
            Route file existed (app/caddie-clip-test.tsx) and was
            reachable from Settings → Owner Tools → "Caddie Clip Test
            (Kevin)" but missing here meant Expo Router silently
            dropped the navigation. Tim opened Settings, tapped the
            row, and saw nothing happen. */}
        <Stack.Screen name="caddie-clip-test" options={{ headerShown: false }} />
        <Stack.Screen
          name="hole-view"
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="settings"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="cage"
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
          name="swinglab/cage-mode"
          options={{ animation: 'slide_from_bottom', headerShown: false }}
        />
        {/* 2026-05-23 — Coach Mode (Fix #8). Watching-someone wrapper
            built on Fix #7's perspective threading. */}
        <Stack.Screen
          name="swinglab/coach-mode"
          options={{ animation: 'slide_from_right', headerShown: false }}
        />
        {/* 2026-05-24 — Coach Mode player scan (BETA). Two-step
            calibration flow producing a per-player profile keyed by
            player_id. Foundation for downstream per-player metric
            pipeline; does not modify swingMetricsService. */}
        <Stack.Screen
          name="swinglab/scan-student"
          options={{ animation: 'slide_from_right', headerShown: false }}
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
        {/* 2026-05-21 — Day 2 / Fix 9B: smartmotion-quick.tsx deleted.
            All SmartMotion entry points route to the canonical
            /swinglab/smartmotion (Phase 416 two-card + Phase 418
            validation gate). The voice intent + Tools menu now skip
            the NoClipHero by pushing /swinglab/quick-record first
            (Option D speed path). Cage-mode practice/lesson flow
            lives at /swinglab/cage-mode (renamed from cage-drill). */}
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
