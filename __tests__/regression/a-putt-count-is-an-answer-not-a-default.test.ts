/**
 * 2026-09-17 — the caddie card logged putts UNCONDITIONALLY from a stepper that starts at 0 and
 * resets to 0 after every hole. A player who scores from that card and never touches it had
 * putts[1..18] = 0 written and persisted: Total putts 0, Avg 0.0, GIR ~0% (score − 0 ≤ par − 2 is
 * false for every par, so routine pars read as missed greens), frozen into holeStats at endRound.
 * The "add putts" invitation never appeared either, because 0 counts as recorded — no way back.
 *
 * AND THE FIRST FIX FOR IT WAS ALSO WRONG, which is the more useful half of this file. Guarding on
 * `holePutts > 0` looks equivalent and is not: ZERO IS A REAL ANSWER. A hole-out from off the green
 * is genuinely zero putts, and isGirHole treats 0 as data while treating null as "skip this hole".
 * Guarding on the value would have traded a wrong number for a missing one on every chip-in.
 *
 * So the recorded thing is whether the player ANSWERED, not what the answer was.
 */

import { isGirHole, girFrom, puttStatsFrom } from '../../services/round/scoredRoundStats';

describe('zero putts and no putts are different facts', () => {
  it('a recorded 0 is data — it must not be read as "unknown"', () => {
    // score 5, par 4, holed out from off the green in 5: reached the green-ish in 5, not a GIR,
    // but it IS an answer and the tally must count the hole.
    expect(isGirHole(5, 0, 4)).toBe(false);
    // and a genuine hole-out that DID reach in regulation counts as hit.
    expect(isGirHole(2, 0, 4)).toBe(true);
  });

  it('an unrecorded putt count is skipped, not counted as zero', () => {
    expect(isGirHole(4, null, 4)).toBeNull();
    expect(isGirHole(4, undefined, 4)).toBeNull();
  });

  it('THE BUG: defaulting an unanswered hole to 0 turns pars into missed greens', () => {
    // This is exactly what shipped. A par with two putts, recorded as 0, reads as a miss.
    expect(isGirHole(4, 2, 4)).toBe(true);   // the truth
    expect(isGirHole(4, 0, 4)).toBe(false);  // what the card wrote instead
  });

  it('a round of unanswered holes reports no GIR sample rather than 0%', () => {
    // ScoredRound takes parOf(hole), not a holePars map — read from the real interface rather
    // than assumed, after the first draft of this test invented a shape.
    const pars: Record<number, number> = { 1: 4, 2: 5, 3: 4 };
    const g = girFrom({ scores: { 1: 4, 2: 5, 3: 4 }, putts: {}, parOf: (h) => pars[h] ?? null });
    // counted 0 — "we did not ask" — not hit:0/counted:3, which would be a lie about the player.
    expect(g.counted).toBe(0);
    expect(g.hit).toBe(0);
  });

  it('and the putt averages have nothing to average rather than averaging zeros', () => {
    const pars2: Record<number, number> = { 1: 4, 2: 5 };
    const p = puttStatsFrom({ scores: { 1: 4, 2: 5 }, putts: {}, parOf: (h) => pars2[h] ?? null });
    // `holes` is the sample size, and avg is NULL rather than 0 — the module's own doctrine that a
    // missing answer is not a zero, which is exactly what the caddie card was violating.
    expect(p.holes).toBe(0);
    expect(p.avg).toBeNull();
  });
});

describe('the caddie card only logs a putt count the player supplied', () => {
  it('logPutts is guarded on the stepper having been touched, not on the value', () => {
    /**
     * STRUCTURAL, and said plainly: app/(tabs)/caddie.tsx is ~4,600 lines over a dozen stores, so a
     * render test for this one line is not a proportionate gate. What this pins is the distinction
     * the bug turned on — that the guard reads an INTENT flag and never the magnitude. A future
     * `holePutts > 0` fails here, which is the mistake actually worth catching.
     */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    expect(src).toMatch(/if \(puttsTouched\) logPutts\(/);
    expect(src).not.toMatch(/if \(holePutts > 0\) logPutts\(/);
    // and the flag must be cleared per hole, or hole 2 inherits hole 1's answer
    expect(src).toMatch(/setPuttsTouched\(false\)/);
  });
});
