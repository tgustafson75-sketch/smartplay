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

import { useEffect } from 'react';
import { usePathname, useSegments } from 'expo-router';

import { setRouteLabel } from '../services/screenContext';
import { MESSAGING_ENABLED } from '../constants/featureFlags';


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
  // 2026-07-21 — messaging is a RELEASE feature; drop it from voice-nav targets in beta so the
  // caddie won't offer to open a hidden, route-guarded screen.
  ...(MESSAGING_ENABLED ? [{ prefix: '/messages', label: 'Messages' }] : []),
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
// 2026-07-24 (Tim — beta screenshot: the floating mic sat ON the SmartVision back chevron). SmartVision
// is a dense full-screen aerial that owns its own top-left navigation + hole switcher; a floating mic
// there overlaps the nav. Suppress it (the route-label baseline below still runs, so the caddie knows
// you're on the hole view). Cleaner-nav pass for the whole mic/text-input surface is tracked separately.

// Boot / full-screen flows where a floating mic would be wrong.

function labelForPath(path: string): string | null {
  const hit = ROUTE_LABELS.find((r) => path.startsWith(r.prefix));
  return hit ? hit.label : null;
}

export function GlobalCaddieMic() {
  const pathname = usePathname();
  const segments = useSegments();
  const path = pathname ?? '';

  // Keep the caddie's "where am I" baseline in sync with the route — runs on EVERY screen,
  // including tabs, so the brain always has context even where the badge itself is hidden.
  useEffect(() => {
    setRouteLabel(labelForPath(path));
  }, [path]);

  // 2026-07-24 (Tim — clean nav + "make the upper-left mic a static logo / bottom bar owns the mic").
  // The floating upper-left mic is RETIRED. The global CaddieBottomBar now owns tap-to-talk on EVERY
  // screen (with its own neon listening glow), so a second floating mic up top was redundant and
  // overlapped screen nav (the SmartVision back chevron, etc.). This component stays mounted ONLY for
  // the caddie's "where am I" route-label baseline (the useEffect above), which the brain relies on
  // everywhere. It renders nothing. The upper-left now shows just the screen's nav + the static brand
  // logo in the header. (CaddieStateCue / styles kept below but unused — the bottom bar is the cue now.)
  void segments;
  return null;
}

/**
 * 2026-09-14 — CaddieStateCue REMOVED.
 *
 * The note above already recorded it: "the bottom bar is the cue now". It was left in place,
 * rendered by nothing, which is the state that makes a superseded component indistinguishable from
 * an unwired one. The bottom bar keeps the behaviour.
 *
 * Removing it took the whole subtree with it: STATE_ICONS, the styles block, and the View / Image /
 * Text / useListeningSessionStore imports had no other consumer in this file. That cascade is the
 * measure of how dead it was — and the reason the single warning was worth pulling on.
 */


export default GlobalCaddieMic;
