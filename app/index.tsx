import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { decideFirstRunRoute } from '../services/firstRunRoute';
import { useSettingsStore } from '../store/settingsStore';
import { recordLaunch } from '../services/kevinGreeting';
import { signalGreetingComplete } from './greeting';

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

  // Persist launch markers when we're skipping the greeting screen
  // (greeting disabled OR warm second-render). When the greeting IS shown,
  // it records on its own AFTER reading context — so we don't race the
  // first_launch.mp3 selection by writing too early.
  useEffect(() => {
    if (!hydrated) return;
    if (!(has_completed_onboarding || isSetupComplete)) return;
    // 2026-07-10 (audit L2) — the greeting screen records the launch itself AFTER reading
    // launch context. It shows exactly when `greetingShownThisProcess` is true (set during
    // this render's redirect just below). So SKIP here in that case; the previous
    // `!greetingShownThisProcess` was inverted → index AND greeting both recorded → the
    // greeting computed daysSinceLastLaunch=0 → wrong "welcome back" variant.
    if (kevinGreetingEnabled && greetingShownThisProcess) return;
    void recordLaunch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // 2026-07-07 (Tim — "a while before it says tap the mic; might be an error") — when
  // the greeting is DISABLED it never plays, so its completion promise never resolves
  // and the caddie's spoken opener sat out its full 10s safety race before "Tap to talk".
  // Resolve it immediately in that case so the opener fires at once. Guarded strictly on
  // kevinGreetingEnabled=false (NOT greetingShownThisProcess, which is already true by the
  // time effects run on a launch that DID show the greeting — signalling there would let
  // the opener talk over the greeting).
  useEffect(() => {
    if (!hydrated) return;
    if (!kevinGreetingEnabled) signalGreetingComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!hydrated) return null;

  /**
   * 2026-09-03 — the `!isDone → /welcome` redirect that used to live here is GONE, and it was
   * genuinely unreachable: both isSetupComplete and has_completed_onboarding default to TRUE and
   * nothing anywhere sets either to false (completeOnboarding only ever sets true). Its own comment
   * said as much — "was dead per the standing has_completed_onboarding=true default rule". The live
   * welcome gate is the consent check inside decideFirstRunRoute, which is anchored on
   * termsAcceptedAt precisely because these two flags cannot express first-run state.
   * [[orphans-are-live-bugs-not-dead-code]]
   */

  /**
   * First-run gates — order lives in services/firstRunRoute so it can be tested.
   *
   * It was a chain of early <Redirect> returns: readable, and impossible to verify. The order IS
   * the behaviour, every new install depends on it, and it was wrong until today — permissions were
   * requested before the consent screen. See that file for the reasoning behind each step.
   */
  const tutorialsSeen = useSettingsStore.getState().tutorialsSeen ?? {};
  const profileSnap = usePlayerProfileStore.getState();
  const firstRun = decideFirstRunRoute({
    introVideoSeen: !!tutorialsSeen['intro_video'],
    corePermissionsAsked: !!tutorialsSeen['core_permissions_requested'],
    termsAccepted: profileSnap.termsAcceptedAt != null,
    hasName: (profileSnap.name ?? '').trim().length > 0,
  });
  // 2026-08-19 (critical-path audit) — PATH 1 instrumentation. The seven [path1:onboard] markers
  // docs/critical-paths.md promised were on a subtree deleted in May, so the MIN VERIFY (grep
  // logcat for [path1:onboard]) returned nothing on a healthy run AND on a broken one. This traces
  // the flow that actually exists.
  console.log(`[path1:onboard] route_decision intro=${!!tutorialsSeen['intro_video']} terms=${profileSnap.termsAcceptedAt != null} name=${(profileSnap.name ?? '').trim().length > 0} perms=${!!tutorialsSeen['core_permissions_requested']} -> ${firstRun ?? 'app'}`);
  // expo-router's typed routes are generated from the filesystem at build time; new routes need an
  // `as never` cast until the type regeneration catches up.
  if (firstRun) return <Redirect href={firstRun as never} />;

  // Cold-launch greeting hop — happens once per process. Warm starts (Index
  // re-renders) hit the flag and route straight to caddie.
  // 2026-07-07 (Tim — "taking the splash away wasn't necessary; there's still a gap
  // before it says tap the mic, the prompting is missing, and it might error") —
  // REVERTED the time-throttle skip. The greeting is not a cosmetic hello: it plays
  // the persona voice, fires prewarmVoice() right before handoff, and MASKS the
  // backend cold-start so the caddie is warm + ready-to-talk when you arrive. Skipping
  // it dropped the user on a cold, silent, prompt-less caddie — and risked a
  // tap-while-cold error. It shows once per cold launch/reload again; the per-process
  // guard (greetingShownThisProcess) still prevents any replay on a warm foreground.
  if (kevinGreetingEnabled && !greetingShownThisProcess) {
    greetingShownThisProcess = true;
    return <Redirect href="/greeting" />;
  }

  return <Redirect href="/(tabs)/caddie" />;
}
