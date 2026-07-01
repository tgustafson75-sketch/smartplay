/**
 * 2026-07-01 (Tim — "make sure there's a caddy mic always on the upper left of everything. That's
 * the universal way to talk to the unified caddie. It needs context of where the user is within
 * the app. Everything in this app ties together to everything.")
 *
 * The UNIVERSAL caddie mic. Mounted ONCE in the root layout so a tap-to-talk badge rides the upper
 * left of every screen — the single, always-there way to talk to the unified caddie, no matter
 * where you are. It's the SAME listeningSession pipeline as the tab header badge / earbud tap
 * (CaddieMicBadge), so there's one voice brain, not two.
 *
 * It also keeps the brain's "where am I" context in sync: on every navigation it maps the route to
 * a human label and calls setRouteLabel(), so the caddie always knows which screen you're on (e.g.
 * "the SmartVision hole view") even on screens that don't set their own richer screenContext. That
 * baseline runs on EVERY route (including tabs); only the visible badge is suppressed on screens
 * that already render a prominent caddie mic (the tabs' header badge, Smart Motion / Cage Mode,
 * which own the camera+mic) so we never double up.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useSegments } from 'expo-router';
import { CaddieMicBadge } from './caddie/CaddieMicBadge';
import { setRouteLabel } from '../services/screenContext';

// Route prefix → human label for the caddie's "where am I" baseline. Longest/most-specific first.
const ROUTE_LABELS: { prefix: string; label: string }[] = [
  { prefix: '/swinglab/smartmotion', label: 'Smart Motion (recording + analyzing swings)' },
  { prefix: '/swinglab/coach-mode', label: 'Coach Mode' },
  { prefix: '/swinglab/library', label: 'the Swing Library' },
  { prefix: '/swinglab/upload', label: 'PuttingLab / swing upload' },
  { prefix: '/swinglab', label: 'SwingLab' },
  { prefix: '/smartvision', label: 'the SmartVision hole view (aerial map + front/middle/back yardages)' },
  { prefix: '/smartfinder', label: 'SmartFinder (the camera rangefinder + scene read)' },
  { prefix: '/lie-analysis', label: 'TightLie (the camera lie analysis)' },
  { prefix: '/recap', label: 'the round recap' },
  { prefix: '/settings', label: 'Settings' },
  { prefix: '/messages', label: 'Messages' },
  { prefix: '/mark-green', label: 'Mark Green' },
  { prefix: '/mark-tee', label: 'Mark Tee' },
  { prefix: '/caddie', label: 'the Caddie screen' },
  { prefix: '/dashboard', label: 'the Dashboard' },
  { prefix: '/scorecard', label: 'the Scorecard' },
  { prefix: '/play', label: 'the Play / start-round screen' },
];

// Screens that ALREADY render a prominent caddie mic (tab header badge, or own top-left mic +
// own the camera/mic) — suppress the global badge there to avoid a double mic. Detected by
// route segment / pathname prefix.
const SUPPRESS_PATH_PREFIXES = ['/swinglab/smartmotion', '/swinglab/cage-mode'];
// Boot / full-screen flows where a floating mic would be wrong.
const HIDE_PATH_PREFIXES = ['/intro-video', '/permissions', '/greeting', '/welcome'];

function labelForPath(path: string): string | null {
  const hit = ROUTE_LABELS.find((r) => path.startsWith(r.prefix));
  return hit ? hit.label : null;
}

export function GlobalCaddieMic() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const segments = useSegments();
  const path = pathname ?? '';

  // Keep the caddie's "where am I" baseline in sync with the route — runs on EVERY screen,
  // including tabs, so the brain always has context even where the badge itself is hidden.
  useEffect(() => {
    setRouteLabel(labelForPath(path));
  }, [path]);

  // Tabs render the header CaddieMicBadge; Smart Motion / Cage Mode own the camera+mic.
  const onTab = segments[0] === '(tabs)';
  const suppressed = onTab || SUPPRESS_PATH_PREFIXES.some((p) => path.startsWith(p));
  const hidden = HIDE_PATH_PREFIXES.some((p) => path.startsWith(p));
  if (suppressed || hidden) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <CaddieMicBadge size={44} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    zIndex: 9000,
    elevation: 9000,
  },
});

export default GlobalCaddieMic;
