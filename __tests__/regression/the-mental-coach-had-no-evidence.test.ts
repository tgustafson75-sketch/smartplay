import * as fs from 'fs';
import * as path from 'path';
import { computeMentalPattern, type MentalRoundInput } from '../../services/mentalPatterns';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim — the day-one concept) — "this is where the sports coach, swing coach, caddy,
 * MENTAL GAME coach concept originally came from — to be able to talk to them."
 *
 * The mental coach was the only one of the four with no evidence. `mentalGameBlock()` told him he was
 * a sports psychologist, always-on on AND off the course; he was handed the CURRENT round's last five
 * self-reports, and `endRound` empties that — so off the course he had nothing at all. Every report
 * from the last fifty rounds sat persisted in roundHistory, read by the caddie, by a screen, by
 * nobody. The swing coach got `measuredSwingBlock` the same day; this leg got skipped.
 */
const r = (endedAt: number, log: { state: string; valence?: string; hole?: number }[], simulated = false): MentalRoundInput =>
  ({ endedAt, simulated, emotionalLog: log as never });

const neg = (state: string, hole?: number) => ({ state, valence: 'negative', hole });
const pos = (state: string, hole?: number) => ({ state, valence: 'positive', hole });

describe('the mental coach can see what the player has told him', () => {
  it('says nothing from a single round — one bad afternoon is not a pattern', () => {
    const m = computeMentalPattern({ rounds: [r(1, [neg('frustrated', 4), neg('frustrated', 5), neg('tight', 6), neg('tight', 7), neg('angry', 8), neg('angry', 9)])] });
    expect(m.hasEnough).toBe(false);
  });

  it('says nothing from too few moments even across enough rounds', () => {
    const m = computeMentalPattern({ rounds: [r(1, [neg('tight', 2)]), r(2, [neg('tight', 3)]), r(3, [pos('locked in', 4)])] });
    expect(m.totalReports).toBe(3);
    expect(m.hasEnough).toBe(false);
  });

  /** Simulated rounds are narrated demos — their emotional beats are scripted, not his. */
  it('excludes simulated rounds', () => {
    const real = [r(1, [neg('tight', 2), neg('tight', 3)]), r(2, [neg('tight', 4), pos('good', 5)]), r(3, [neg('tight', 6), pos('good', 7)])];
    const withSim = [...real, r(4, [neg('scripted', 1), neg('scripted', 2), neg('scripted', 3)], true)];
    expect(computeMentalPattern({ rounds: withSim }).totalReports)
      .toBe(computeMentalPattern({ rounds: real }).totalReports);
  });

  it('names the state he reports most often', () => {
    const m = computeMentalPattern({ rounds: [
      r(1, [neg('frustrated', 2), neg('frustrated', 3)]),
      r(2, [neg('frustrated', 4), pos('calm', 5)]),
      r(3, [neg('tight', 6), pos('calm', 7)]),
    ] });
    expect(m.hasEnough).toBe(true);
    expect(m.topState).toEqual({ state: 'frustrated', count: 3 });
  });

  it('locates where the rough moments land', () => {
    const m = computeMentalPattern({ rounds: [
      r(1, [neg('tight', 14), neg('tight', 16)]),
      r(2, [neg('tight', 15), neg('tight', 17)]),
      r(3, [neg('tight', 18), pos('good', 2)]),
    ] });
    expect(m.negBack).toBe(5);
    expect(m.negFront).toBe(0);
  });

  /**
   * A SHARE, NOT A COUNT. A round he talked through ten times and a round he talked through twice
   * would otherwise read as different moods rather than different amounts of conversation.
   */
  it('measures direction as a share so a talkative round does not swamp it', () => {
    const chatty = Array.from({ length: 10 }, (_, i) => pos('good', i + 1));
    const m = computeMentalPattern({ rounds: [
      r(1, [neg('tight', 2), neg('tight', 3), neg('tight', 4)]),
      r(2, [neg('tight', 5), neg('tight', 6), neg('tight', 7)]),
      r(3, chatty),
      r(4, chatty),
    ] });
    expect(m.direction).toBe('settling');
    expect(m.negShareLate).toBeLessThan(m.negShareEarly);
  });

  it('reports tightening when rough moments grow as a share', () => {
    const m = computeMentalPattern({ rounds: [
      r(1, [pos('good', 1), pos('good', 2), pos('good', 3)]),
      r(2, [pos('good', 4), pos('good', 5), pos('good', 6)]),
      r(3, [neg('tight', 7), neg('tight', 8), neg('tight', 9)]),
      r(4, [neg('tight', 10), neg('tight', 11), neg('tight', 12)]),
    ] });
    expect(m.direction).toBe('tightening');
  });

  /** A deadband, so one extra grumble cannot declare a trend. */
  it('holds steady inside the deadband', () => {
    const m = computeMentalPattern({ rounds: [
      r(1, [neg('tight', 1), pos('good', 2)]),
      r(2, [neg('tight', 3), pos('good', 4)]),
      r(3, [neg('tight', 5), pos('good', 6)]),
      r(4, [neg('tight', 7), pos('good', 8)]),
    ] });
    expect(m.direction).toBe('steady');
  });

  it('looks at recent rounds only — an older golfer is a different golfer', () => {
    // Enough recent rounds to FILL the window, so the old ones fall out of it entirely — with only
    // four recent the window still reaches back and should still see the old ones, which is correct.
    const old = Array.from({ length: 12 }, (_, i) => r(i + 1, [neg('ancient', 1), neg('ancient', 2)]));
    const recent = Array.from({ length: 10 }, (_, i) => r(100 + i, [pos('calm', 1), pos('calm', 2)]));
    const m = computeMentalPattern({ rounds: [...old, ...recent] });
    expect(m.roundsWithReports).toBe(10);
    expect(m.topState?.state).toBe('calm');
  });

  it('survives malformed entries rather than dropping the read', () => {
    const m = computeMentalPattern({ rounds: [
      r(1, [neg('tight', 2), { state: '' } as never, null as never]),
      r(2, [neg('tight', 3), neg('tight', 4)]),
      r(3, [neg('tight', 5), pos('good', 6), { valence: 'negative' } as never]),
    ] });
    expect(m.hasEnough).toBe(true);
    expect(m.topState).toEqual({ state: 'tight', count: 4 });
  });

  it('tolerates no rounds at all', () => {
    expect(computeMentalPattern({ rounds: [] }).hasEnough).toBe(false);
  });

  // ---- the wiring: an owner with no caller is the bug this repo keeps finding ----

  it('reaches the caddie through the one payload builder', () => {
    const body = read('services/caddieRequestBody.ts');
    expect(body).toMatch(/mentalPatternBlock: safe\(/);
    expect(body).toMatch(/computeMentalPattern/);
    const block = body.slice(body.indexOf('mentalPatternBlock: safe('));
    // Honest gate: nothing is said until there is enough, and never without a named state.
    expect(block.slice(0, 900)).toMatch(/if \(!m\.hasEnough \|\| !m\.topState\) return null;/);
  });

  it('the brain destructures, caps and injects it', () => {
    const k = read('api/kevin.ts');
    expect(k).toMatch(/mentalPatternBlock = null,/);
    expect(k).toMatch(/capOrNull\(mentalPatternBlock, \d+\)/);
    expect(k).toMatch(/\$\{_mentalPattern \? `\\n\$\{_mentalPattern\}` : ''\}/);
  });

  /**
   * The rule that makes it usable rather than creepy: recognition, not recitation. A model handed
   * counts will read them out unless told not to.
   */
  it('carries the rule that it is for meeting him, not describing him', () => {
    const k = read('api/kevin.ts');
    expect(k).toMatch(/A PATTERN IS FOR MEETING HIM, NOT FOR TELLING HIM ABOUT HIMSELF/);
    expect(k).toMatch(/NEVER RECITE IT/);
    expect(k).toMatch(/NEVER DIAGNOSE/);
    expect(k).toMatch(/Absence of a report is NOT evidence he was fine/);
  });

  /**
   * 2026-09-12 (Tim — "all those coaches have to work together") — THE PANEL RULE. Three measured
   * blocks had landed in the prompt and nothing told the brain they describe the same man, so each
   * coach answered from its own silo. The join is the answer no single coach can reach.
   */
  it('tells the brain the four coaches are vantage points on one player', () => {
    const k = read('api/kevin.ts');
    expect(k).toMatch(/YOU ARE ONE PANEL, NOT FOUR SPECIALISTS/);
    // The join that matters most: practice up, scoring flat, a metric going the wrong way.
    expect(k).toMatch(/he is not failing, he is practising the wrong thing/);
    // Readings in-band + scoring worse must NOT produce a swing fix.
    expect(k).toMatch(/it is not his mechanics/);
    // One voice, no announced hand-off, and no invented consensus.
    expect(k).toMatch(/Never announce the hand-off/);
    expect(k).toMatch(/say that honestly rather than averaging them/);
    /**
     * 2026-09-12 adversarial re-read: the panel rule said joining two was "the single most useful
     * thing you can do" while the LEAD rule said the others "stay quiet" — read together those are
     * contradictory, and a contradicted prompt produces inconsistent answers. A join is now
     * conditional on CHANGING the answer, which is what the lead rule already required.
     */
    expect(k).toMatch(/When none of them does, the lead answers alone/);
    expect(k).not.toMatch(/The single most useful thing you can do is JOIN two of them/);
    // An absent block is not a vantage point — the honesty rule that keeps the panel from guessing.
    expect(k).toMatch(/never infer one coach's read from another's data/);
  });

  /** It is cached, so the ratchet must have been told — deliberately, not by loosening it. */
  it('is registered as a cached interpolation', () => {
    const sim = read('scripts/simulations/run-sim.ts');
    expect(sim).toMatch(/'_mentalPattern'/);
    // The live mid-round signals must stay on the message side.
    const deny = sim.slice(sim.indexOf('const DENY ='), sim.indexOf('const DENY =') + 700);
    for (const live of ['mentalState', 'isSpiralRisk', 'voicedDistress']) expect(deny).toMatch(live);
  });
});
