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
import { View, Image, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useSegments } from 'expo-router';
import { CaddieMicBadge } from './caddie/CaddieMicBadge';
import { setRouteLabel } from '../services/screenContext';
import { useListeningSessionStore } from '../store/listeningSessionStore';

// 2026-07-19 (Tim — "when the mic activates on any screen the main caddie should VISIBLY wake up").
// The brand voice-state icon shown beside the universal badge so tapping the mic anywhere reads as
// the SAME caddie coming alive (matches the Caddie-tab avatar). Same neon brand art.
const STATE_ICONS = {
  listening: require('../assets/icons/caddie/listening.png'),
  speaking: require('../assets/icons/caddie/speaking.png'),
  thinking: require('../assets/icons/caddie/thinking.png'),
} as const;

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
// 2026-07-01 (re-audit) — dropped '/swinglab/cage-mode' (Cage Mode was merged into
// SmartMotion; no such route exists) — it was dead config suppressing nothing.
const SUPPRESS_PATH_PREFIXES = ['/swinglab/smartmotion'];
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

  return (
    // 2026-07-01 (whole-app audit) — sits BELOW the header row, not at the very top-left corner,
    // so the 44px badge never overlaps / intercepts a screen's back/close button (which owns the
    // top-left on settings, smartvision, smartfinder, recap, mark-*, messages, etc.). Still the
    // upper-left region Tim asked for, just clear of the back chevron.
    // NOTE: hooks above must run every render (route-label sync), so we gate the RENDER here, not
    // with an early return before the hooks.
    (suppressed || hidden) ? null : (
      <View style={[styles.wrap, { top: insets.top + 52 }]} pointerEvents="box-none">
        <CaddieMicBadge size={40} />
        <CaddieStateCue />
      </View>
    )
  );
}

// The brand voice-state cue (icon + label) shown under the universal badge when a listening
// session is active anywhere — so the caddie visibly "wakes up" on any screen. pointerEvents none.
function CaddieStateCue() {
  const state = useListeningSessionStore((s) => s.state);
  const icon =
    state === 'listening' ? STATE_ICONS.listening :
    (state === 'thinking' || state === 'responding') ? STATE_ICONS.thinking :
    state === 'opening' ? STATE_ICONS.listening : null;
  const label =
    state === 'listening' ? 'Listening' :
    state === 'thinking' ? 'Thinking' :
    state === 'responding' ? 'Speaking' :
    state === 'opening' ? 'Listening' : '';
  if (!icon) return null;
  return (
    <View style={styles.cue} pointerEvents="none">
      <Image source={icon} style={styles.cueIcon} resizeMode="contain" />
      <Text style={styles.cueLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    zIndex: 9000,
    elevation: 9000,
    alignItems: 'center',
  },
  cue: { alignItems: 'center', marginTop: 6, gap: 2 },
  cueIcon: { width: 40, height: 40 },
  cueLabel: {
    color: '#88F700',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
});

export default GlobalCaddieMic;
