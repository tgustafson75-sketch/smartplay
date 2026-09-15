/**
 * 2026-09-14 (Tim) — "And triple check tempo analysis. I have a feeling it is still giving generic
 * reads."
 *
 * He was right, and it was generic BY CONSTRUCTION. Five findings, all reproduced before fixing:
 *
 * 1. `coaching` was ONE OF FOUR FIXED STRINGS per mode, selected by rating and nothing else. A
 *    1.0:1 swing and a 2.6:1 swing both got "Slow your load slightly — let the club finish the
 *    backswing before you fire." The engine had just measured both to the millisecond and not one
 *    of those numbers appeared in what it said. For the 1.0:1, "slightly" is wrong advice.
 * 2. TWO SETS OF BANDS. `smartTempo` said on-tempo was 2.7–3.3; `swing/poseSwingRead` said 2.6–3.6.
 *    A 2.65:1 was "Rushed" on the Smart Tempo card and "right in the tour range" on the SmartMotion
 *    read; a 3.5:1 was "Slow" on one and "solid" on the other. Same swing, opposite verdicts,
 *    depending which screen you opened. A third copy of the limits (2.1 / 4.1) sat in the fault list.
 * 3. The 'smooth' band was 3.3–3.4 — 0.10 ratio-units wide, against on_tempo's 0.61 and the putt
 *    profile's 0.39. A four-state scale with a state you cannot land in.
 * 4. The rating was computed from the full-precision ratio while the card displayed `toFixed(1)`,
 *    so two swings both showing "3.4:1" could be graded differently with nothing visible to explain it.
 * 5. The measured tempo NEVER REACHED THE CADDIE below a four-week trend. Verified by running the
 *    payload builder with two sessions at 2.1:1: the word "tempo" was in the payload and no tempo
 *    NUMBER was. Ask Kevin how your tempo is and he had nothing to answer from.
 */
import { computeTempo, tempoBandFor, tempoRatingFor } from '../../services/smartTempo';
import { buildPoseSwingRead } from '../../services/swing/poseSwingRead';
import { latestSelfTempoRead } from '../../services/practice/selfSwingReads';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSwingSessionStore } from '../../store/swingSessionStore';

/** A swing at a given ratio, holding the downswing at a realistic quarter second. */
const at = (ratio: number, mode: 'full_swing' | 'putt' = 'full_swing', mine?: number | null) =>
  computeTempo({ backswingStartSec: 0, topSec: 0.25 * ratio, impactSec: 0.25 * ratio + 0.25 }, mode, mine)!;

const poseTempo = (ratio: number) => buildPoseSwingRead(null, {
  ratio, backswingMs: 250 * ratio, downswingMs: 250, topMs: 250 * ratio,
  sequencingScore: null, source: 'video_pose', confidence: 'med',
} as never).dimensions?.find((d) => d.key === 'tempo');

describe('the coaching line is composed from the measurement', () => {
  it('a violently rushed swing and a marginally quick one are not told the same thing', () => {
    const bad = at(1.2).coaching;
    const close = at(2.6).coaching;
    expect(bad).not.toBe(close);
    // The old line said "slightly" to both. It must not say it to the 1.2.
    expect(bad).not.toMatch(/slightly/i);
    expect(close).toMatch(/close/i);
  });

  it('quotes the real durations, so he can check the read', () => {
    const r = at(2.4);                       // backswing 600 ms, downswing 250 ms
    expect(r.coaching).toContain('600 ms');
    expect(r.coaching).toContain('250 ms');
  });

  it('the counterfactual moves the LOAD, and never prescribes a downswing no human makes', () => {
    /**
     * The first fix held the backswing and solved for the downswing: at 1.2:1 that asks for a
     * 100 ms downswing and calls a rushed player "slow through it". Tour Tempo's frame counts
     * (24/8, 21/7, 27/9) all hold the downswing at eight frames and vary the load, which is both
     * the honest variable and the actionable one.
     */
    const rushed = at(1.2);
    expect(rushed.coaching).toMatch(/load is \d+ ms short/);
    expect(rushed.coaching).not.toMatch(/slow through it/);
    const slow = at(4.6);
    expect(slow.coaching).toMatch(/load is \d+ ms long/);
    // 250 ms downswing × 3 = a 750 ms backswing, both sides of the band.
    expect(rushed.coaching).toContain('750 ms backswing');
    expect(slow.coaching).toContain('750 ms backswing');
  });

  it('a high ratio is described as a long LOAD, not as a lagging downswing', () => {
    // The pre-existing 'slow' cue said "your downswing is lagging the load" — that is a LOW ratio.
    // At 4.6:1 the downswing is 250 ms: faster than 3:1 would want, not lagging at all.
    const slow = at(4.6);
    expect(slow.coaching).not.toMatch(/downswing is lagging/i);
    expect(slow.coaching).toMatch(/load|backswing/i);
  });

  it('uses HIS average when there is one, and says nothing about it when there is not', () => {
    expect(at(2.1, 'full_swing', 2.3).coaching).toMatch(/you average 2\.3:1/);
    expect(at(2.1, 'full_swing', 3.0).coaching).toMatch(/Quicker than your usual 3\.0:1/);
    expect(at(2.1).coaching).not.toMatch(/average|usual/);
  });

  it('an on-tempo swing is not given a gap it does not have', () => {
    expect(at(3.0).coaching).not.toMatch(/short|long/);
    expect(at(3.0).coaching).toMatch(/repeat it/i);
  });
});

describe('one set of tempo bands for the whole app', () => {
  it('the Smart Tempo card and the SmartMotion read never disagree about the same swing', () => {
    const agree: Record<string, string[]> = {
      on_tempo: ['strength'], smooth: ['solid'], rushed: ['watch', 'needs_work'], slow: ['watch', 'needs_work'],
    };
    for (let r = 1.0; r <= 6.0; r += 0.05) {
      const ratio = Math.round(r * 100) / 100;
      const rating = tempoRatingFor(ratio)!;
      const verdict = poseTempo(ratio)?.verdict as string;
      expect(agree[rating]).toContain(verdict);
    }
    // The two ratios that used to contradict outright.
    expect(at(2.65).ratingLabel).toBe('On Tempo');
    expect(poseTempo(2.65)?.verdict).toBe('strength');
    expect(at(3.5).ratingLabel).toBe('Smooth');
    expect(poseTempo(3.5)?.verdict).toBe('solid');
  });

  it('poseSwingRead declares no bands of its own', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/swing/poseSwingRead.ts'), 'utf-8')
      // Strip block comments AND trailing // comments — the prose ABOUT the old bands is history,
      // not a second implementation. [[strip-comments-before-a-guard-matches]]
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/tempoBandFor|tempoRatingFor/);
    // the old literals, including the fault thresholds
    expect(src).not.toMatch(/2\.6|3\.6|2\.8|3\.4|4\.1|2\.1/);
  });

  it('the smooth band is a band a swing can actually land in', () => {
    const b = tempoBandFor('full_swing');
    const width = b.smoothHigh - b.onTempoHigh;
    expect(width).toBeGreaterThanOrEqual(0.25);
    expect(at(3.5).rating).toBe('smooth');
    // and the putt profile keeps its own, looser scale
    expect(tempoBandFor('putt').targetRatio).toBe(2);
    expect(at(2.0, 'putt').rating).toBe('on_tempo');
    expect(at(2.0).rating).toBe('rushed');        // the same ratio is NOT on tempo for a full swing
  });
});

describe('the number he is shown is the number he was graded on', () => {
  it('grades the rounded ratio, so one displayed value has one verdict', () => {
    // 3.35 and 3.44 both render "3.4:1". They must not land on opposite sides of a boundary.
    const a = at(3.35), b = at(3.44);
    expect(a.ratioLabel).toBe(b.ratioLabel);
    expect(a.rating).toBe(b.rating);
  });

  it('the SmartMotion read rounds once too', () => {
    // 2.65 displays as "2.6" through toFixed but grades as 2.7.
    expect(poseTempo(2.65)?.display).toBe('2.7 : 1');
  });
});

describe('the measured tempo reaches the caddie', () => {
  it('carries the latest READING even when there is no four-week trend', () => {
    const now = Date.now();
    useSwingSessionStore.setState({ sessionHistory: [
      { id: 'a', date: now - 6 * 86_400_000, player_id: 'self', club: '7I', tempo_result: { ratio: 2.4, ratingLabel: 'Rushed' }, shots: [] },
      { id: 'b', date: now - 86_400_000, player_id: 'self', club: '7I', tempo_result: { ratio: 2.1, ratingLabel: 'Rushed' }, shots: [] },
    ] as never });
    const body = buildCaddieRequestBody({ message: 'how is my tempo?', language: 'en' }) as Record<string, unknown>;
    const block = String(body.measuredSwingBlock ?? '');
    expect(block).toMatch(/HIS MEASURED TEMPO: latest 2\.1:1 \(Rushed\)/);
    expect(block).toMatch(/average 2\.3:1/);
    // Still honest about what one swing is.
    expect(block).toMatch(/READING, not a trend/);
    expect(block).toMatch(/CANNOT CALL A TREND YET/);
  });

  it('says nothing when he has never marked a tempo', () => {
    useSwingSessionStore.setState({ sessionHistory: [] as never });
    const body = buildCaddieRequestBody({ message: 'how is my tempo?', language: 'en' }) as Record<string, unknown>;
    expect(String(body.measuredSwingBlock ?? '')).not.toMatch(/HIS MEASURED TEMPO/);
  });

  it('another golfer\'s tempo is never quoted back as his — the self filter has one owner', () => {
    /**
     * OTHER_PLAYER_ID is the canonical "not me" marker; an UNREGISTERED id deliberately falls
     * through to self in resolvePlayerName, which is the existing app-wide rule and not this
     * function's to reinterpret. What matters is that this reuses that rule rather than writing a
     * second one — my first attempt did write a second one, compared against the wrong sentinel,
     * and silently returned no tempo at all.
     */
    const { OTHER_PLAYER_ID } = require('../../store/swingSessionStore');
    const now = Date.now();
    const rows = [
      { id: 'me', date: now - 2 * 86_400_000, player_id: null, tempo_result: { ratio: 2.9 } },
      { id: 'guest', date: now, player_id: OTHER_PLAYER_ID, tempo_result: { ratio: 1.4 } },
    ];
    const t = latestSelfTempoRead(rows as never);
    expect(t?.ratio).toBe(2.9);      // the newest row is someone else's and must not win
    expect(t?.recentCount).toBe(1);
  });
});

describe('the rating and the severity are derived from the same number', () => {
  it('a read at a band edge is never graded in-band while coached as out of it', () => {
    /**
     * `rating` came from the ROUNDED ratio and the severity stem from the RAW one. At 2.65 that is
     * 'on_tempo' (rounds to 2.7) with a severity computed from 2.65 — inside the band by one
     * measure and outside it by the other, in the same sentence.
     */
    for (const r of [2.65, 2.74, 3.34, 3.64]) {
      const t = at(r);
      const inBand = t.rating === 'on_tempo' || t.rating === 'smooth';
      if (t.rating === 'on_tempo') {
        // An in-band read states no gap at all, so the two can't contradict.
        expect(t.coaching).not.toMatch(/ms (short|long)/);
      }
      expect(inBand || /ms (short|long)/.test(t.coaching)).toBe(true);
    }
  });
});
