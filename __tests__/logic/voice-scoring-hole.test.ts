/**
 * 2026-08-09 (on-course audit C1/C2 — "it scored the wrong hole and jumped ahead").
 * A bare voice score/putts (no hole spoken) must target the hole the PLAYER means, not the nav
 * currentHole — which GPS market-model advance and first-score auto-advance move independently.
 *   - voiceScoreHole: lowest UNSCORED hole at/behind currentHole (score holes in order).
 *   - voicePuttsHole: the hole just scored (putts follow the score) when a score is fresh.
 */
import { voiceScoreHole, voicePuttsHole } from '../../store/voiceScoringHole';

const base = { nineHoleMode: false, roundStartHole: 1 };

describe('voiceScoreHole — bare score targets the reported hole, not nav currentHole', () => {
  it('normal: current hole unscored → scores the current hole (auto-advance still fires)', () => {
    expect(voiceScoreHole({ ...base, currentHole: 5, scores: { 1: 4, 2: 5, 3: 4, 4: 6 } })).toBe(5);
  });

  it('C2: GPS advanced to 6 but 5 is unscored → the score lands on 5, NOT 6', () => {
    // player walked off 5 (unscored), GPS market-model bumped currentHole to 6; "I got a 5"
    const hole = voiceScoreHole({ ...base, currentHole: 6, scores: { 1: 4, 2: 5, 3: 4, 4: 6, 5: 0 } });
    expect(hole).toBe(5);
  });

  it('C2 no-double-advance: resolved hole (5) !== currentHole (6) so logScore auto-advance guard is false', () => {
    const hole = voiceScoreHole({ ...base, currentHole: 6, scores: { 1: 4, 2: 5, 3: 4, 4: 6 } });
    expect(hole).toBe(5);
    expect(hole === 6).toBe(false); // the `hole === currentHole` advance guard cannot fire
  });

  it('all caught up → falls back to currentHole', () => {
    expect(voiceScoreHole({ ...base, currentHole: 7, scores: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 } })).toBe(7);
  });

  it('back nine (startHole 10) respects the first hole', () => {
    expect(voiceScoreHole({ nineHoleMode: true, roundStartHole: 10, currentHole: 12, scores: { 10: 4, 11: 5 } })).toBe(12);
    expect(voiceScoreHole({ nineHoleMode: true, roundStartHole: 10, currentHole: 12, scores: { 10: 4 } })).toBe(11);
  });
});

describe('voicePuttsHole — putts follow the score just logged', () => {
  it('C1: after scoring 5 (currentHole auto-advanced to 6), putts land on 5', () => {
    const now = Date.now();
    const hole = voicePuttsHole({ currentHole: 6, lastMutation: { kind: 'score', hole: 5, prevScore: 0, prevCurrentHole: 5, at: now } });
    expect(hole).toBe(5);
  });

  it('stale score (>2min) → current hole (independent mid-hole putt entry)', () => {
    const stale = Date.now() - 130_000;
    const hole = voicePuttsHole({ currentHole: 6, lastMutation: { kind: 'score', hole: 5, prevScore: 0, prevCurrentHole: 5, at: stale } });
    expect(hole).toBe(6);
  });

  it('last mutation was a shot, not a score → current hole', () => {
    const hole = voicePuttsHole({ currentHole: 4, lastMutation: { kind: 'shot', shotId: 'x', hole: 3, at: Date.now() } });
    expect(hole).toBe(4);
  });

  it('no mutation → current hole', () => {
    expect(voicePuttsHole({ currentHole: 2, lastMutation: null })).toBe(2);
  });
});
