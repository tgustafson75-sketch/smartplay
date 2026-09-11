/**
 * 2026-09-11 — THE "RECEIVED" HALF OF A CLUB'S CHARACTER REACHED ONE BADGE AND NO DECISION.
 *
 * Tim: "Clubs have different tendencies for users — sometimes logical, sometimes feel for the lie or
 * situation or comfort level. Each club in the bag essentially has characteristics real and
 * received."
 *
 * relationshipStore.confidenceByClub has held a real measured number since 2026-07-09: the
 * clean-strike rate over a player's recent RATED swings with that club, written by
 * services/clubConfidence from cage and uploaded-video contact reads, and gated at three rated
 * swings so it is never a guess. Its only reader was a badge on the practice-session screen.
 *
 * It now breaks a DEAD HEAT in the club pick — and nothing more than that.
 */
import { composeShotRead } from '../../services/cnsShotRead';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Two clubs a yard apart — a genuine dead heat at 150. */
const TIED = { '7 Iron': 150, '6 Iron': 151 };
const read = (over: Record<string, unknown> = {}) => composeShotRead({
  rawYards: 150, weather: null, shotBearingDeg: null, bag: TIED, ...over,
} as never)!;

describe('comfort decides only when nothing else does', () => {
  it('picks the club he actually strikes when the numbers dead-heat', () => {
    const r = read({ confidenceFor: (c: string) => (c === '6 Iron' ? 0.8 : 0.4) });
    expect(r.club).toBe('6 Iron');
  });

  it('and the other way round, so it is the signal deciding and not an accident', () => {
    const r = read({ confidenceFor: (c: string) => (c === '7 Iron' ? 0.8 : 0.4) });
    expect(r.club).toBe('7 Iron');
  });

  it('a couple of points is NOISE and must not pick a club', () => {
    const a = read({ confidenceFor: (c: string) => (c === '6 Iron' ? 0.52 : 0.48) });
    const b = read();
    expect(a.club).toBe(b.club);
  });

  it('says nothing when there are not enough rated swings', () => {
    const a = read({ confidenceFor: () => null });
    const b = read();
    expect(a.club).toBe(b.club);
  });

  it('one club rated and the other not is not a comparison', () => {
    const a = read({ confidenceFor: (c: string) => (c === '6 Iron' ? 0.9 : null) });
    expect(a.club).toBe(read().club);
  });
});

describe('it never overrules something that actually matters', () => {
  it('DISTANCE wins — a comfortable club that does not fit the shot is the wrong club', () => {
    const bag = { '7 Iron': 150, PW: 105 };
    const r = composeShotRead({
      rawYards: 150, weather: null, shotBearingDeg: null, bag,
      confidenceFor: (c: string) => (c === 'PW' ? 0.99 : 0.2),
    } as never)!;
    expect(r.club).toBe('7 Iron');
  });

  it('POSTURE wins — a stance the player chose outranks a measured tendency', () => {
    // safe posture prefers the club that COVERS the number; comfort pulls the other way.
    const r = read({ risk: 'safe', confidenceFor: (c: string) => (c === '7 Iron' ? 0.9 : 0.3) });
    expect(r.club).toBe('6 Iron');
  });

  it('the LIE wins — comfort cannot put a wood back in deep rough', () => {
    const bag = { '5 Wood': 185, '5 Iron': 178 };
    const r = composeShotRead({
      rawYards: 182, weather: null, shotBearingDeg: null, bag, lie: 'heavy_rough',
      confidenceFor: (c: string) => (c === '5 Wood' ? 0.95 : 0.2),
    } as never)!;
    expect(r.club).not.toBe('5 Wood');
  });
});

describe('the signal is real, and the vocabularies are translated at the boundary', () => {
  it('the store keeps a measured rate, gated so it is never a guess', () => {
    const cc = code('services/clubConfidence.ts');
    expect(cc).toMatch(/MIN_RATED = 3/);
    expect(cc).toMatch(/clean \/ contacts\.length/);
    expect(cc).toMatch(/if \(contacts\.length < MIN_RATED\) return;/);
  });

  /**
   * The trap this codebase keeps falling into, twice today alone: the store is keyed by whatever a
   * swing session called the club, and cnsShotRead's ladder is LABELLED ('7 Iron'). Handing the raw
   * map across is exactly how the lie offer silently never fired.
   */
  it('the live composer translates store keys onto ladder labels', () => {
    const live = code('services/shotReadLive.ts');
    expect(live).toMatch(/confidenceFor: safe\(/);
    expect(live).toMatch(/normalizeClub\(k\)/);
    expect(live).toMatch(/CLUB_LABEL as Record<string, string>\)\[canon\]/);
  });

  it('the engine takes a FUNCTION, not a map, so the caller owns the translation', () => {
    expect(code('services/cnsShotRead.ts'))
      .toMatch(/confidenceFor\?: \(ladderLabel: string\) => number \| null/);
  });

  it('and comfort sits BELOW posture in the tie-break chain', () => {
    const src = code('services/cnsShotRead.ts');
    const posture = src.indexOf('postureBreak !== null ? postureBreak');
    const conf = src.indexOf('confidenceBreak !== null ? confidenceBreak');
    expect(posture).toBeGreaterThan(-1);
    expect(conf).toBeGreaterThan(posture);
  });
});
