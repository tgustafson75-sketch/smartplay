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
  const scored = (h: number) => (s.scores[h] ?? 0) > 0;
  // 2026-08-09 (pass-2 refinement P2) — target the lowest hole of the CONTIGUOUS unscored run that
  // ENDS at currentHole. This is the hole(s) the player just walked through: GPS advances currentHole
  // over an unscored hole at the next tee, so "I got a 5" fills the run's start. The old "lowest
  // unscored ≤ current" grabbed a hole SKIPPED/picked-up long ago (e.g. never scored hole 3 → every
  // later bare score landed on 3). A non-contiguous gap is left alone; use an explicit "on hole N".
  if (scored(s.currentHole)) return s.currentHole; // current already scored → re-score/edit here
  const first = firstHole(s);
  let h = s.currentHole;
  while (h - 1 >= first && !scored(h - 1)) h--;
  return h;
}

/** The hole a bare voice PUTTS entry targets: putts follow the shot you just scored. If a score was
 *  logged in the last 2 minutes (e.g. the "how many putts?" follow-up after "I made a 5"), use THAT
 *  hole — currentHole may have auto-advanced away from it. Otherwise the current hole. */
export function voicePuttsHole(s: {
  lastMutation: VoiceLastMutation | null;
  currentHole: number;
}): number {
  const m = s.lastMutation;
  // Putts follow the score just logged (the "how many putts?" auto-advance follow-up). 2026-08-09
  // (pass-2 refinement P3) — ONLY when that score is the current hole or the one just auto-advanced
  // FROM (currentHole-1); otherwise a voice EDIT of an old hole ("put me down for a 5 on hole 3")
  // would misdirect an unrelated "2 putts" to hole 3. Non-adjacent recent score → current hole.
  if (m && m.kind === 'score' && typeof m.hole === 'number' && typeof m.at === 'number'
      && Date.now() - m.at < 120_000
      && (m.hole === s.currentHole || m.hole === s.currentHole - 1)) {
    return m.hole;
  }
  return s.currentHole;
}
