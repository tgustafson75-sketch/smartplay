/**
 * 2026-05-25 — Fix J: Mark Tee redirect shim.
 *
 * The standalone Mark Tee screen was replaced by the unified Mark
 * screen at /mark-green (renamed MarkPositionScreen internally) with a
 * mode toggle. This route forwards into /mark-green?mode=tee so:
 *   - Existing deep links to /mark-tee still work
 *   - Voice "mark the tee" intent (openToolHandler → /mark-tee) still
 *     lands on the right initial mode
 *   - The user-facing tee-marking UX is the same clean Mark Green
 *     workflow Tim flagged as the one that worked properly
 *
 * Old standalone Mark Tee screen retired (different UX that "didn't
 * work" per Tim's post-round feedback). Single screen, one mental
 * model.
 */

import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

export default function MarkTeeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/mark-green?mode=tee' as never);
  }, [router]);
  return <View />;
}
