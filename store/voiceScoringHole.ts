/**
 * 2026-08-09 (on-course audit C1/C2 — "it scored the wrong hole and jumped ahead"). Pure resolvers for
 * which hole a BARE voice score/putts (no hole spoken) targets. Kept in a LEAF module (no store/asset
 * imports) so it's unit-testable; roundStore re-exports both. See voice-scoring-hole.test.ts.
 *
 * Why: a bare entry used to default to the NAV currentHole, but currentHole moves on its own — GPS
 * market-model advances an unscored hole at the next tee, and first-score auto-advance bumps it. So
 * "I got a 5" walking off hole 5 (GPS already on 6) wrote the 5 onto 6 AND auto-advanced to 7, leaving
 * 5 forever unscored. These decouple the reported hole from nav.
 */

/** Mirror of roundStore.LastMutation (type-only; kept local so this stays a leaf). */
export type VoiceLastMutation = { kind: string; hole?: number; at?: number; [k: string]: unknown };

function firstHole(s: { nineHoleMode: boolean; roundStartHole: number }): number {
  return s.nineHoleMode ? Math.max(1, s.roundStartHole || 1) : 1;
}

/** The hole a bare voice SCORE targets: the lowest UNSCORED hole at/behind currentHole (you score holes
 *  in order, so the lowest gap is the one being reported). Falls back to currentHole when all are scored.
 *  When this returns a hole BEHIND currentHole, logScore's `hole===currentHole` auto-advance guard is
 *  false → no double-advance, and the late score lands where it belongs. */
export function voiceScoreHole(s: {
  scores: Record<number, number>;
  currentHole: number;
  nineHoleMode: boolean;
  roundStartHole: number;
}): number {
  const first = firstHole(s);
  for (let h = first; h <= s.currentHole; h++) {
    if (!((s.scores[h] ?? 0) > 0)) return h;
  }
  return s.currentHole;
}

/** The hole a bare voice PUTTS entry targets: putts follow the shot you just scored. If a score was
 *  logged in the last 2 minutes (e.g. the "how many putts?" follow-up after "I made a 5"), use THAT
 *  hole — currentHole may have auto-advanced away from it. Otherwise the current hole. */
export function voicePuttsHole(s: {
  lastMutation: VoiceLastMutation | null;
  currentHole: number;
}): number {
  const m = s.lastMutation;
  if (m && m.kind === 'score' && typeof m.hole === 'number' && typeof m.at === 'number' && Date.now() - m.at < 120_000) {
    return m.hole;
  }
  return s.currentHole;
}
