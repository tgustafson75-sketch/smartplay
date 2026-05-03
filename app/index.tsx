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
  const [hydrated, setHydrated] = useState(
    () => usePlayerProfileStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (hydrated) return;
    return usePlayerProfileStore.persist.onFinishHydration(() => setHydrated(true));
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
