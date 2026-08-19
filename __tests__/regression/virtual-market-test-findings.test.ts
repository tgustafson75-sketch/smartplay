/**
 * Regression locks for the defects found by the 100-player VIRTUAL MARKET TEST
 * (scripts/simulations/user-sim.ts), 2026-08-19.
 *
 * Tim, pre-launch: "we have to start doing some market testing to find bugs, and we're gonna start
 * with virtual." The simulation drives the real modules with a generated population of mid-to-high
 * handicappers and asserts INVARIANTS rather than expected outputs. These three findings came out of
 * that run; the tests below pin the fixes so a later change re-breaks loudly instead of silently.
 *
 * Kept in jest (not only in the sim) because the sim is a sweep — it proves a property holds across a
 * population, while these name the exact case a future reader needs to understand.
 */
import { composeFitProfile } from '../../services/practice/fitProfile';
import { segmentsFromStrikes, segmentsFromVideoSwings } from '../../services/swing/swingSegmentation';
import { classifySession } from '../../services/swingIssueClassifier';

describe('fit ladder — a real bag, not an idealised one', () => {
  it('excludes the putter by IDENTITY, not by it happening to carry 0', () => {
    // The type comment always claimed "Putter excluded", but the only filter was yards > 0. Any player
    // who put a lag distance on their putter had it ranked among their irons.
    const profile = composeFitProfile([
      { club: 'Driver', yards: 230, measured: true },
      { club: '7 Iron', yards: 150, measured: true },
      { club: 'Putter', yards: 30, measured: true },
    ]);
    expect(profile.ladder.map((c) => c.club)).not.toContain('Putter');
    expect(profile.ladder.map((c) => c.club)).toEqual(['Driver', '7 Iron']);
  });

  it('never ranks the same club twice, and prefers its best-evidenced entry', () => {
    // A club can arrive by voice, by scan and by hand. Two rows produced a 0-yard "overlap" between a
    // club and itself — the app telling the player two of their clubs were too close together while
    // looking at one club.
    const profile = composeFitProfile([
      { club: '7 Iron', yards: 145, measured: false },
      { club: '7 Iron', yards: 152, measured: true },
      { club: 'Driver', yards: 235, measured: true },
    ]);
    const sevens = profile.ladder.filter((c) => c.club === '7 Iron');
    expect(sevens).toHaveLength(1);
    expect(sevens[0].yards).toBe(152);       // the measured one wins
    expect(profile.overlaps).toHaveLength(0); // and no self-overlap is invented
  });

  it('keeps the ladder strictly ordered longest → shortest', () => {
    const profile = composeFitProfile([
      { club: '9 Iron', yards: 125, measured: true },
      { club: 'Driver', yards: 240, measured: true },
      { club: '6 Iron', yards: 165, measured: true },
    ]);
    const yards = profile.ladder.map((c) => c.yards);
    expect(yards).toEqual([...yards].sort((a, b) => b - a));
  });
});

describe('swing segmentation — coincident detections are one swing, not two broken ones', () => {
  it('collapses two detections at the same instant into a single healthy window', () => {
    // Two strikes at the same ms put the shared boundary exactly ON the strike, so the first segment
    // ENDED at impact (no follow-through) and the second STARTED at it (no backswing).
    const segs = segmentsFromStrikes(
      [
        { timeMs: 3000, peakDb: -10, attackMs: 5, confidence: 'high' },
        { timeMs: 3000, peakDb: -12, attackMs: 5, confidence: 'low' },
      ],
      20000,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].startMs).toBeLessThan(segs[0].strikeMs);
    expect(segs[0].endMs).toBeGreaterThan(segs[0].strikeMs);
    expect(segs[0].confidence).toBe('high'); // the stronger reading of the same event survives
  });

  it('still keeps two genuinely separate swings apart', () => {
    const segs = segmentsFromStrikes(
      [
        { timeMs: 3000, peakDb: -10, attackMs: 5, confidence: 'high' },
        { timeMs: 6000, peakDb: -11, attackMs: 5, confidence: 'high' },
      ],
      20000,
    );
    expect(segs).toHaveLength(2);
    expect(segs[1].startMs).toBeGreaterThanOrEqual(segs[0].endMs);
  });

  it('guarantees every window has real duration on BOTH sides of impact', () => {
    // Second layer, independent of the collapse above: a window with no backswing or no follow-through
    // is not analysable whatever produced it.
    for (const swings of [
      [{ timeSec: 3, confidence: 'high' as const }, { timeSec: 3, confidence: 'high' as const }],
      [{ timeSec: 0, confidence: 'high' as const }],
      [{ timeSec: 20, confidence: 'high' as const }],
    ]) {
      for (const s of segmentsFromVideoSwings(swings, 20000)) {
        expect(s.endMs).toBeGreaterThan(s.startMs);
        expect(Number.isInteger(s.startMs)).toBe(true);
        expect(Number.isInteger(s.endMs)).toBe(true);
      }
    }
  });
});

describe('issue classifier — a swing saved by an older build cannot take down the screen', () => {
  const legacy = (id: string) => [{
    swing_id: 'legacy-1',
    analysis: {
      primary_fault: 'sway', detected_issue: id, severity: 'moderate',
      confidence: 'medium', observation: 'saved by an earlier build',
    },
  }] as never;

  it('does not throw on an issue id outside the canonical set', () => {
    // ISSUE_COACH_VOICE[id].feel threw — one stored string white-screening the swing review.
    for (const id of ['sway', 'spine_angle_loss', 'casting', '']) {
      expect(() => classifySession(legacy(id))).not.toThrow();
    }
  });

  it('never renders the literal word "undefined" into coaching copy', () => {
    // The quieter half of the same bug: ISSUE_DISPLAY_NAME[id] returned undefined and was formatted
    // straight into a sentence the player reads.
    const out = classifySession(legacy('casting'));
    if (out) {
      const text = JSON.stringify(out);
      expect(text).not.toMatch(/\bundefined\b/);
      expect(out.name).toBeTruthy();
    }
  });

  it('still classifies a known issue exactly as before', () => {
    const out = classifySession(legacy('early_extension'));
    expect(out).not.toBeNull();
    expect(out!.name).toBeTruthy();
    expect(out!.feel_cue).toBeTruthy();
  });
});
