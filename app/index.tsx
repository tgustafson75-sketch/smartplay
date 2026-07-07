import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore } from '../store/settingsStore';
import { recordLaunch } from '../services/kevinGreeting';

// Module-level guard so the greeting only runs once per cold launch.
// Warm starts (background → foreground) re-render this Index but the flag
// stays true, so we route straight to caddie and never replay the greeting.
let greetingShownThisProcess = false;

export default function Index() {
  // Wait for AsyncStorage hydration before navigating.
  // Without this gate, isSetupComplete reads as false (the Zustand default)
  // on every cold start, fires <Redirect href="/intro">, then immediately
  // fires again to /(tabs)/caddie once AsyncStorage resolves — the
  // double-redirect destabilises the nav stack and throws java.io.IOException.
  //
  // Block on BOTH stores: profile (for the onboarding-complete check) AND
  // settings (for caddiePersonality). If we route to /greeting before
  // settings hydrates, the greeting screen reads default 'kevin' for the
  // active persona and plays Kevin's recorded mp3 even when the user has
  // Serena/Harry/Tank persisted. Same root cause for the Caddie tab
  // avatar flashing Kevin before swapping to the persisted persona.
  const [profileHydrated, setProfileHydrated] = useState(
    () => usePlayerProfileStore.persist.hasHydrated(),
  );
  const [settingsHydrated, setSettingsHydrated] = useState(
    () => useSettingsStore.persist.hasHydrated(),
  );
  const hydrated = profileHydrated && settingsHydrated;

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    if (!profileHydrated) {
      unsubs.push(usePlayerProfileStore.persist.onFinishHydration(() => setProfileHydrated(true)));
    }
    if (!settingsHydrated) {
      unsubs.push(useSettingsStore.persist.onFinishHydration(() => setSettingsHydrated(true)));
    }
    return () => { unsubs.forEach(u => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSetupComplete = usePlayerProfileStore(s => s.isSetupComplete);
  const has_completed_onboarding = usePlayerProfileStore(s => s.has_completed_onboarding);
  const kevinGreetingEnabled = useSettingsStore(s => s.kevinGreetingEnabled);
  const lastAppOpenAt = useSettingsStore(s => s.lastAppOpenAt);

  // Persist launch markers when we're skipping the greeting screen
  // (greeting disabled OR warm second-render). When the greeting IS shown,
  // it records on its own AFTER reading context — so we don't race the
  // first_launch.mp3 selection by writing too early.
  useEffect(() => {
    if (!hydrated) return;
    if (!(has_completed_onboarding || isSetupComplete)) return;
    if (kevinGreetingEnabled && !greetingShownThisProcess) return;
    void recordLaunch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // 2026-07-06 — stamp this cold-open time so the NEXT open can throttle the
  // greeting (the render below read the PREVIOUS value first). Kills the ~4s
  // hello replaying on every rapid reopen (range/course open-close-open).
  useEffect(() => {
    if (!hydrated) return;
    useSettingsStore.setState({ lastAppOpenAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!hydrated) return null;

  const isDone = has_completed_onboarding || isSetupComplete;

  // First-launch intro video — plays once per install, before the
  // welcome / greeting flow. tutorialsSeen.intro_video flag gates it
  // permanently after the first view (or skip / error). Defensive:
  // any failure inside the intro screen self-routes to the next step,
  // so a corrupt video file or codec issue can never strand the user.
  const tutorialsSeen = useSettingsStore.getState().tutorialsSeen ?? {};
  const introVideoSeen = !!tutorialsSeen['intro_video'];
  if (!introVideoSeen) {
    // expo-router's typed routes are generated from the filesystem at
    // build time; new routes need an `as never` cast until the type
    // regeneration catches up. Same workaround used elsewhere in the
    // codebase for new screens.
    return <Redirect href={'/intro-video' as never} />;
  }

  // One-time core permissions pre-flight — runs after intro, before
  // onboarding. Asks for camera/mic/location in one batch so individual
  // tools never need to prompt again. Defensive: any failure inside
  // the screen exits cleanly with the flag set, so a crash here can't
  // strand the user. Tools fall back to per-call permission UX if the
  // user skipped or denied during pre-flight.
  const corePermsAsked = !!tutorialsSeen['core_permissions_requested'];
  if (!corePermsAsked) {
    return <Redirect href={'/permissions' as never} />;
  }

  // 2026-05-17 — Onboarding subtree removed (was dead per the
  // standing "has_completed_onboarding=true default" rule). The
  // welcome screen below handles the single-screen first-launch
  // capture; if a user somehow lands here without isDone=true,
  // route to /welcome instead.
  if (!isDone) return <Redirect href={'/welcome' as never} />;

  // Phase 410 — first-launch welcome gate. The legacy multi-step
  // onboarding is intentionally bypassed (per Tim's "get rid of that
  // whole stupid onboarding nonsense" rule and the
  // has_completed_onboarding=true default). But fresh installs with no
  // captured profile (no first_opened_at AND no name) are dropped on
  // the Caddie tab with no "welcome to your app" moment — the gap
  // the beta-tester audit flagged. This single-screen welcome closes
  // that gap. The check is intentionally narrow: only routes when
  // BOTH first_opened_at is null AND no name has been set. Returning
  // users skip it. Owner-email override already mirrors email into
  // the profile during _layout.tsx's lifetime grant, so the welcome
  // doesn't pester admins.
  const profileSnap = usePlayerProfileStore.getState();
  const hasOpenedBefore = profileSnap.first_opened_at != null;
  const hasName = (profileSnap.name ?? '').trim().length > 0;
  if (!hasOpenedBefore && !hasName) {
    return <Redirect href={'/welcome' as never} />;
  }

  // Cold-launch greeting hop — happens once per process. Warm starts
  // (Index re-renders) hit the flag and route straight to caddie.
  // 2026-07-06 (hands-free / fast-open) — ALSO throttle by time so a golfer
  // reopening the app repeatedly on the range/course gets IN, not a hello every time.
  // 2026-07-07 (Tim — "8s awkward dead gap when it skips the splash") — the greeting
  // was never ADDING the warmup (that fires at app_init in _layout regardless); it was
  // MASKING the backend cold-start (3-8s to wake the voice Lambdas) with a visible beat.
  // A 4h skip window meant a reopen after the backend had gone cold (idle ~15min+) went
  // straight to a SILENT caddie while the pipeline woke — the funky gap. Tie the skip
  // window to how long the backend plausibly stays warm: a recent reopen (Lambdas still
  // hot) skips the greeting with NO gap; a longer gap (cold backend) shows the greeting,
  // which masks the warmup exactly as before. Best of both — fast reopen + no dead air.
  const GREETING_THROTTLE_MS = 15 * 60 * 1000;
  const recentlyOpened = lastAppOpenAt > 0 && (Date.now() - lastAppOpenAt) < GREETING_THROTTLE_MS;
  if (kevinGreetingEnabled && !greetingShownThisProcess && !recentlyOpened) {
    greetingShownThisProcess = true;
    return <Redirect href="/greeting" />;
  }

  return <Redirect href="/(tabs)/caddie" />;
}
