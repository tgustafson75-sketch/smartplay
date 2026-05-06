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

  // Onboarding always wins — first-run users go through the welcome flow,
  // not the greeting. (The greeting is a 'welcome back' moment.)
  if (!isDone) return <Redirect href="/onboarding/welcome" />;

  // Cold-launch greeting hop — happens once per process. Warm starts
  // (Index re-renders) hit the flag and route straight to caddie.
  if (kevinGreetingEnabled && !greetingShownThisProcess) {
    greetingShownThisProcess = true;
    return <Redirect href="/greeting" />;
  }

  return <Redirect href="/(tabs)/caddie" />;
}
