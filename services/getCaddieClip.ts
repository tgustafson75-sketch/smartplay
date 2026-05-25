/**
 * 2026-05-25 — Caddie clip lookup (11-slot canonical set).
 *
 * Self-contained slot → bundled-asset helper for the D-ID Kevin video
 * clips under assets/caddie/kevin/. No imports from app services yet —
 * this is a standalone draft you can wire into useCaddieVoice /
 * round-flow triggers when ready.
 *
 * Two exports:
 *   getCaddieClip(caddie, slot)     — returns the Metro-bundled asset
 *                                     module (number) for direct use
 *                                     in <Video source={...}/>. THIS is
 *                                     the function callers actually want
 *                                     in React Native.
 *   getCaddieClipPath(caddie, slot) — returns a relative string path
 *                                     ('assets/caddie/kevin/tee.mp4').
 *                                     Bundler-agnostic; useful for
 *                                     logging, telemetry, or future
 *                                     non-RN consumers.
 *
 * Why two functions: React Native's Metro bundler can't load assets
 * from runtime string paths — it needs literal require() calls at build
 * time. A string-path-only API would compile but silently fail to
 * play any clip on device. Returning the require() module is what
 * actually works for testing.
 *
 * Slot semantics (round-arc moments where the caddie speaks):
 *   intro       — opener at round start
 *   tee         — at the tee box
 *   fairway     — between tee and approach
 *   yardage     — yardage-to-pin readout
 *   wind        — wind read overlay
 *   club        — club selection / recommendation
 *   hazard      — hazard call / penalty-area awareness   (TODO — D-ID pending)
 *   chip        — short-game chip read
 *   putt_read   — green read before the stroke
 *   putt_line   — line commit just before the putt
 *   celebrate   — hole complete / made-it celebration    (TODO — D-ID pending)
 *
 * Test scaffolding note (per Tim 2026-05-25): the current Kevin clip
 * set is placeholder content from D-ID for beta testing. Clean rebuilds
 * for Kevin + Serena + Tank + Harry will land later. Slot names and
 * directory structure are the durable contract; file contents are
 * temporary.
 */

export type Caddie = 'kevin';

export type CaddieSlot =
  | 'intro'
  | 'tee'
  | 'fairway'
  | 'yardage'
  | 'wind'
  | 'club'
  | 'hazard'
  | 'chip'
  | 'putt_read'
  | 'putt_line'
  | 'celebrate';

/** All known slots in canonical round-arc order. */
export const ALL_CADDIE_SLOTS: readonly CaddieSlot[] = [
  'intro', 'tee', 'fairway', 'yardage', 'wind', 'club',
  'hazard', 'chip', 'putt_read', 'putt_line', 'celebrate',
] as const;

const SLOT_SET: ReadonlySet<string> = new Set(ALL_CADDIE_SLOTS);

/**
 * Per-caddie require map. Metro bundler resolves these literal require()
 * calls at build time and bundles the .mp4 files into the app binary.
 * Slots whose D-ID clip hasn't landed yet are explicitly `null` so the
 * runtime can render an honest "clip not ready" state instead of
 * crashing on a missing require path.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const KEVIN_CLIPS: Record<CaddieSlot, number | null> = {
  intro:     require('../assets/caddie/kevin/intro.mp4'),
  tee:       require('../assets/caddie/kevin/tee.mp4'),
  fairway:   require('../assets/caddie/kevin/fairway.mp4'),
  yardage:   require('../assets/caddie/kevin/yardage.mp4'),
  wind:      require('../assets/caddie/kevin/wind.mp4'),
  club:      require('../assets/caddie/kevin/club.mp4'),
  hazard:    null, // TODO — D-ID generation pending
  chip:      require('../assets/caddie/kevin/chip.mp4'),
  putt_read: require('../assets/caddie/kevin/putt_read.mp4'),
  putt_line: require('../assets/caddie/kevin/putt_line.mp4'),
  celebrate: null, // TODO — D-ID generation pending
};

const ALL_CLIP_MAPS: Record<Caddie, Record<CaddieSlot, number | null>> = {
  kevin: KEVIN_CLIPS,
};

/**
 * Resolve a (caddie, slot) pair to its bundled clip asset module.
 *
 * Returns the Metro-bundled require() module (typed as number — RN's
 * Image / Video source types accept this) when the slot is wired.
 * Returns null when the slot is a known TODO (clip not generated yet)
 * so callers can branch: render "clip coming soon" instead of playing.
 *
 * Throws on caddie or slot values that aren't in the type union —
 * defensive against JS callers, dynamic strings from voice-intent
 * classifiers, or stale persisted state. The error names both the
 * bad input and the allowed list so the fix is obvious from the log.
 */
export function getCaddieClip(caddie: Caddie, slot: CaddieSlot): number | null {
  const set = ALL_CLIP_MAPS[caddie];
  if (!set) {
    throw new Error(
      `getCaddieClip: unknown caddie "${String(caddie)}". ` +
      `Allowed: ${Object.keys(ALL_CLIP_MAPS).join(', ')}.`,
    );
  }
  if (!SLOT_SET.has(slot as string)) {
    throw new Error(
      `getCaddieClip: unknown slot "${String(slot)}" for caddie "${caddie}". ` +
      `Allowed: ${ALL_CADDIE_SLOTS.join(', ')}.`,
    );
  }
  return set[slot];
}

/**
 * Relative string path for a (caddie, slot) pair — bundler-agnostic.
 * Use for logging, telemetry, or future non-RN consumers. NOT loadable
 * by <Video source={...}/> on device — use getCaddieClip() for that.
 *
 * Same error semantics as getCaddieClip.
 */
export function getCaddieClipPath(caddie: Caddie, slot: CaddieSlot): string {
  if (!(caddie in ALL_CLIP_MAPS)) {
    throw new Error(
      `getCaddieClipPath: unknown caddie "${String(caddie)}". ` +
      `Allowed: ${Object.keys(ALL_CLIP_MAPS).join(', ')}.`,
    );
  }
  if (!SLOT_SET.has(slot as string)) {
    throw new Error(
      `getCaddieClipPath: unknown slot "${String(slot)}" for caddie "${caddie}". ` +
      `Allowed: ${ALL_CADDIE_SLOTS.join(', ')}.`,
    );
  }
  return `assets/caddie/${caddie}/${slot}.mp4`;
}

/**
 * True if the slot has a bundled clip ready to play. Cheaper than calling
 * getCaddieClip and checking for null — useful in render paths that want
 * to gate a Play button without invoking the lookup machinery.
 */
export function hasCaddieClip(caddie: Caddie, slot: CaddieSlot): boolean {
  const set = ALL_CLIP_MAPS[caddie];
  if (!set) return false;
  return set[slot] != null;
}
