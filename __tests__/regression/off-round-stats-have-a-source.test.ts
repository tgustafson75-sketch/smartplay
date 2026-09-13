import * as fs from 'fs';
import * as path from 'path';
import { girFrom, puttStatsFrom, nineSplitFrom, scoredRoundFromRecord, longestDriveFrom, MAX_REAL_DRIVE } from '../../services/round/scoredRoundStats';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim) — "Longest drive is on the dashboard and GIR is calculated on the scorecard."
 *
 * He was correcting a claim I had relayed from a save-point doc without checking it: that the caddie
 * had NO source for GIR or longest-drive history, so the off-round deflection could not be opened.
 * Both sources exist and are persisted — GIR from score/putts/holePars, which
 * compactHistoryForPersist explicitly keeps, and longest drive from a profile field logShot updates.
 * queryStatusHandler was answering "You're not in a round yet. Want to start one?" to questions it
 * could answer from data already on the phone. [[trust-the-users-lived-reality]]
 */
describe('the stats the screens already show have one owner', () => {
  const rec = {
    scores: { 1: 4, 2: 5, 3: 3, 4: 6 },
    putts: { 1: 2, 2: 3, 3: 1, 4: 2 },
    holePars: { 1: 4, 2: 4, 3: 3, 4: 5 },
  };

  /** The scorecard's own rule: strokes-to-green = score − putts, GIR when that is ≤ par − 2. */
  it('derives GIR the way the scorecard does', () => {
    // h1 4-2=2 <= 2 hit · h2 5-3=2 <= 2 hit · h3 3-1=2 > 1 miss · h4 6-2=4 > 3 miss
    expect(girFrom(scoredRoundFromRecord(rec))).toEqual({ hit: 2, counted: 4 });
  });

  /** A hole with no putts logged cannot be derived — skipped, never guessed. */
  it('skips holes it cannot derive rather than guessing them', () => {
    const partial = { scores: { 1: 4, 2: 5 }, putts: { 1: 2 }, holePars: { 1: 4, 2: 4 } };
    expect(girFrom(scoredRoundFromRecord(partial))).toEqual({ hit: 1, counted: 1 });
  });

  it('never scores a round against another course\'s pars', () => {
    const noPars = { scores: { 1: 4 }, putts: { 1: 2 }, holePars: undefined };
    expect(girFrom(scoredRoundFromRecord(noPars))).toEqual({ hit: 0, counted: 0 });
  });

  it('reads putts off a completed round', () => {
    const ps = puttStatsFrom(scoredRoundFromRecord(rec));
    expect(ps).toMatchObject({ holes: 4, total: 8, threePutts: 1, onePutts: 1 });
    expect(ps.avg).toBe(2);
  });

  it('splits a nine off a completed round', () => {
    const ns = nineSplitFrom(scoredRoundFromRecord(rec), 1, 9);
    expect(ns).toMatchObject({ strokes: 18, parSum: 16, played: 4, vs: 2 });
  });

  /**
   * THE 500-YARD CAP IS A REAL BUG'S SCAR. 2026-06-30 a failed capture leaked the whole course's
   * yardage into a shot and the card showed a ~7000-yard drive.
   */
  it('drops a corrupt capture instead of showing it', () => {
    expect(longestDriveFrom({ rounds: [{ shots: [{ club: 'Driver', carry_distance: 7000 }] }] })).toBeNull();
    expect(MAX_REAL_DRIVE).toBe(500);
  });

  it('takes the best of history and the stored personal best', () => {
    expect(longestDriveFrom({
      rounds: [{ shots: [{ club: 'Driver', carry_distance: 268 }] }],
      profileLongestDrive: 291,
    })).toBe(291);
    expect(longestDriveFrom({
      rounds: [{ shots: [{ club: 'Driver', carry_distance: 301 }] }],
      profileLongestDrive: 280,
    })).toBe(301);
  });

  it('ignores clubs that are not the driver', () => {
    expect(longestDriveFrom({ rounds: [{ shots: [{ club: '3 wood', carry_distance: 240 }] }] })).toBeNull();
  });

  it('says nothing rather than zero when there is no drive', () => {
    expect(longestDriveFrom({ rounds: [], profileLongestDrive: null })).toBeNull();
  });

  /** One owner, two readers — the dashboard card and the caddie cannot disagree. */
  it('the dashboard reads the shared derivation, not its own copy', () => {
    const d = read('app/(tabs)/dashboard.tsx');
    expect(d).toMatch(/longestDriveFrom\(\{ rounds: realRounds, profileLongestDrive: longestDrive \}\)/);
    expect(d).not.toMatch(/const MAX_REAL_DRIVE = 500;/);
  });
});

describe('off the course, a round stat is still answered', () => {
  const h = read('services/intents/queryStatusHandler.ts');

  /**
   * The DEFLECTION gate specifically — anchored backwards from its own message, because the new
   * answering block above it is also an `!round.isRoundActive` branch and does legitimately name
   * these topics. Slicing forward from the first match tested the wrong block and passed while the
   * gate still claimed all four. [[a-guard-can-assert-the-broken-shape]]
   */
  const deflectMsg = "voice_response: 'You\\'re not in a round yet";
  const deflectGate = (() => {
    const end = h.indexOf(deflectMsg);
    expect(end).toBeGreaterThan(-1);
    const start = h.lastIndexOf('if (!round.isRoundActive', end);
    expect(start).toBeGreaterThan(-1);
    return h.slice(start, end);
  })();

  /** The deflection must no longer claim these four. */
  it.each([['putt_stats'], ['gir'], ['nine_split'], ['longest_drive']])('%s is not deflected any more', (topic) => {
    const gate = deflectGate;
    expect(gate).not.toMatch(new RegExp(`topic === '${topic}'`));
  });

  /** What remains deflected is genuinely about a round in progress. */
  it('still deflects what has no honest off-round answer', () => {
    const gate = deflectGate;
    for (const t of ['distance_to_green', 'wind', 'hole', 'holes_left', 'score']) {
      expect(gate).toMatch(new RegExp(`topic === '${t}'`));
    }
  });

  /** Every off-round answer must NAME its round — "11 of 18" with no subject sounds like today. */
  it('names which round it is reading', () => {
    expect(h).toMatch(/Last round at \$\{rec\.courseName\}|whenLabel/);
    expect(h).toMatch(/const whenLabel/);
    expect(h).toMatch(/'Your last round'/);
  });

  it('reads the last COMPLETED, non-simulated round', () => {
    const blk = h.slice(h.indexOf('const lastCompleted'), h.indexOf('const lastCompleted') + 400);
    expect(blk).toMatch(/!r\.simulated/);
    expect(blk).toMatch(/typeof r\.endedAt === 'number'/);
  });

  it('says it has nothing rather than inventing a number', () => {
    expect(h).toMatch(/I don't have a finished round to read that from yet\./);
    expect(h).toMatch(/I haven't got a measured drive for you yet\./);
  });

  /** All-time must not be spoken as "this round" — that is the in-round answer's claim. */
  it('calls the all-time drive all-time, not this round', () => {
    expect(h).toMatch(/Your longest measured drive is \$\{best\} yards\./);
    expect(h).toMatch(/Your longest drive this round is/);
  });

  /** last_round_here needs a course that only the conversation knows — so the brain answers. */
  it('routes last_round_here to the brain off the course', () => {
    expect(h).toMatch(/query:last_round_here:off_round_route_to_brain/);
  });

  /** The live handlers must read the SAME owner, or the two paths drift. */
  it('the live handlers read the shared owner too', () => {
    expect(h).toMatch(/const ps = puttStatsFrom\(liveScored\(\)\)/);
    expect(h).toMatch(/const \{ hit, counted \} = girFrom\(liveScored\(\)\)/);
    expect(h).toMatch(/const ns = nineSplitFrom\(liveScored\(\), lo, hi\)/);
  });
});
