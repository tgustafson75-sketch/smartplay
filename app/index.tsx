import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { usePlayerProfileStore } from '../store/playerProfileStore';

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
  }, []);

  const isSetupComplete = usePlayerProfileStore(s => s.isSetupComplete);

  if (!hydrated) return null;

  return (
    <Redirect href={isSetupComplete ? '/(tabs)/caddie' : '/intro'} />
  );
}
