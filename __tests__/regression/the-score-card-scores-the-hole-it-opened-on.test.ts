/**
 * 2026-10-15 (review G3a) — the caddie tab's shot/score card, and two of the tab's guards.
 *
 * Finding 1 (HIGH). handleLogHole wrote logScore(currentHole…) / logPutts(currentHole…) to whatever
 * hole was current WHEN LOG SCORE WAS PRESSED, then ended the round on `currentHole >= maxHole`. The
 * stepper is filled in while the card is open, and GPS can advance the hole meanwhile: the score landed
 * on the next hole, the auto-advance jumped another one, or the round ended on the wrong number. The
 * strip and cockpit stamp the hole at tap time; the card now stamps it when it opens (scoreCardHole).
 *
 * Finding 2. The spoken score word ("Birdie." / "Bogey.") was judged against getCurrentPar() read
 * AFTER logScore — and logScore's first score auto-advances the round synchronously, so the par was
 * the NEXT hole's. The first test below proves that premise on the real store; the structural ones pin
 * that the card reads the logged hole's par before writing.
 *
 * Finding 4. The tab's `log_score` tool case had no round-active check (the service dispatcher has
 * had one since 08-09). Finding 5. The risk-ease line checked voiceChannelBusy() but not the tab's own
 * turn, so it overwrote 'thinking' with 'proactive'.
 *
 * STRUCTURAL for the component half, said plainly (the same call the putts guard made): caddie.tsx is
 * ~5,500 lines over a dozen stores; these pin the exact distinctions the bugs turned on.
 */
import fs from 'fs';
import path from 'path';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';

const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
const slice = (from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`slice not found: ${from} → ${to}`);
  return src.slice(a, b);
};

describe('the premise: a first score moves the round before the caddie speaks', () => {
  it('after logScore on the current hole, getCurrentPar answers for the NEXT hole', () => {
    useSettingsStore.setState({ autoHoleAdvance: true } as never);
    const holes = [
      { hole: 1, par: 3 }, { hole: 2, par: 5 }, { hole: 3, par: 4 },
    ].map((h) => ({ ...h, distance: 300, front: 0, back: 0, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,
      frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: false }));
    useRoundStore.getState().startRound('Test GC', holes as never, {} as never);
    expect(useRoundStore.getState().getCurrentPar()).toBe(3);
    useRoundStore.getState().logScore(1, 2); // a birdie on the par 3
    expect(useRoundStore.getState().currentHole).toBe(2);
    expect(useRoundStore.getState().getCurrentPar()).toBe(5); // a 2 judged against par 5 is no longer a birdie
  });
});

describe('handleLogHole scores the hole the card opened on', () => {
  const fn = slice('const handleLogHole = async () => {', '// ── Mid-round mode change');

  it('the card stamps its hole when it opens and clears it when it closes', () => {
    const prefill = slice('// Auto-prefill score when shot card opens', '}, [showShotCard]);');
    expect(prefill).toMatch(/if \(!showShotCard\) \{ setScoreCardHole\(null\); return; \}/);
    expect(prefill).toMatch(/setScoreCardHole\(currentHole\)/);
  });

  it('writes, ghosts and ends the round on the stamped hole, never the live one', () => {
    expect(fn).toMatch(/const loggedHole = scoreCardHole \?\? currentHole;/);
    expect(fn).toMatch(/logScore\(loggedHole, holeScore\)/);
    expect(fn).toMatch(/if \(puttsTouched\) useRoundStore\.getState\(\)\.logScoreWithPutts\(loggedHole, holeScore, holePutts\);/);
    expect(fn).toMatch(/updateHole\(loggedHole, holeScore\)/);
    expect(fn).toMatch(/if \(loggedHole >= maxHole\)/);
    expect(fn).not.toMatch(/logScore\(currentHole|logPutts\(currentHole|updateHole\(currentHole|currentHole >= maxHole/);
  });

  it("judges the score word against the logged hole's par, read BEFORE logScore", () => {
    const parAt = fn.indexOf('const par = parForHole(useRoundStore.getState().courseHoles, loggedHole);');
    const logAt = fn.indexOf('logScoreWithPutts(loggedHole');
    expect(parAt).toBeGreaterThan(0);
    expect(parAt).toBeLessThan(logAt);
    expect(fn).not.toMatch(/= getCurrentPar\(\)/);
  });
});

describe('the tab guards', () => {
  it('log_score does nothing without an active round (finding 4)', () => {
    const c = slice("case 'log_score': {", "case 'log_shot': {");
    const guardAt = c.indexOf('if (!useRoundStore.getState().isRoundActive) break;');
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(c.indexOf('logScore('));
  });

  it('a spoken hole maps through roundHoleForSpoken (twice-around: "hole 3" on round hole 12 is 12)', () => {
    const c = slice("case 'log_score': {", "case 'log_shot': {");
    expect(c).toMatch(/roundHoleForSpoken\(useRoundStore\.getState\(\), Math\.round\(askedHole\)\)/);
    expect(c).not.toMatch(/\.hole \?\? voiceScoreHole/);
    // and the mapping itself, on the real helper
    const { roundHoleForSpoken } = require('../../store/roundStore') as typeof import('../../store/roundStore');
    expect(roundHoleForSpoken({ twiceAround: true, currentHole: 12 }, 3)).toBe(12);
    expect(roundHoleForSpoken({ twiceAround: false, currentHole: 12 }, 3)).toBe(3);
  });

  it("the risk-ease line stands down while the tab's own turn is thinking/listening (finding 5)", () => {
    const e = slice('const announcedEaseRef = useRef', '}, [riskEasedAt, isRoundActive, apiUrl]);');
    expect(e).toMatch(/if \(ve && !voiceChannelBusy\(\) && !tabTurnActive\(voiceStateRef\.current\)\) \{/);
  });
});
