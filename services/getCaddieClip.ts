/**
 * 2026-05-25 — Caddie clip lookup.
 *
 * 2026-08-24 (Tim's call, orphan sweep) — TRIMMED FROM 12 SLOTS TO THE 2 THAT PLAY.
 *
 * The module shipped a 12-slot round-arc set (tee, fairway, yardage, wind, club, hazard, chip,
 * putt_read, putt_line, celebrate) and described itself as "a standalone draft you can wire into
 * useCaddieVoice / round-flow triggers when ready". Three months on, exactly TWO call sites existed
 * and both pass a literal slot: app/greeting.tsx plays 'intro', app/(tabs)/caddie.tsx plays
 * 'bestround'. The other ten bundled 8.3 MB of D-ID PLACEHOLDER video that never played once.
 *
 * The placeholder note below is why they went rather than got wired: the clip set was always
 * temporary content for beta, only Kevin has any, and wiring ten placeholder clips would have made
 * the feature look broken for the three caddies that have none.
 *
 * The slot names and directory layout remain the durable contract and are written up in
 * docs/TODO-CADDIE-EMOTIONAL-ART.md, so a real clip set is a fresh start rather than a resurrection
 * of placeholder footage. getCaddieClipPath() / hasCaddieClip() / ALL_CADDIE_SLOTS went with them —
 * all three had zero callers.
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
 * Slot semantics — the two moments the caddie actually appears on video:
 *   intro     — the greeting screen opener (app/greeting.tsx)
 *   bestround — the player just posted their best round ever (app/(tabs)/caddie.tsx)
 *
 * (2026-08-24 — the ten round-arc slots that used to be listed here — tee, fairway, yardage, wind,
 * club, hazard, chip, putt_read, putt_line, celebrate — were removed with their files. They had no
 * caller in three months and bundled 8.3 MB of placeholder video that never played. The paragraph
 * this replaces claimed "every slot above... has a bundled clip; no D-ID TODOs remain", which was
 * true when written and false the moment they went — a comment describing the file rather than the
 * program. The full slot spec survives in docs/TODO-CADDIE-EMOTIONAL-ART.md.)
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
  // 2026-05-25 — Personal-best moment. Fires when the user just posted their best round score ever.
  // Trigger logic lives outside this helper; the helper just makes the asset available.
  | 'bestround';

/** The slots that are actually played. */
const ALL_CADDIE_SLOTS: readonly CaddieSlot[] = ['intro', 'bestround'] as const;

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
  bestround: require('../assets/caddie/kevin/bestround.mp4'),
};

const ALL_CLIP_MAPS: Record<Caddie, Record<CaddieSlot, number | null>> = {
  kevin: KEVIN_CLIPS,
};

/**
 * Resolve a (caddie, slot) pair to its bundled clip asset module.
 *
 * Returns the Metro-bundled require() module (typed as number — RN's
 * Image / Video source types accept this). Every remaining slot has a clip, so null is now
 * unreachable in practice; the signature keeps it so a future caddie added without a full set
 * degrades to "clip coming soon" rather than crashing.
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


