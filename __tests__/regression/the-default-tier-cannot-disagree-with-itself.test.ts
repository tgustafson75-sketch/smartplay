/**
 * 2026-09-13 (release audit) — TWO OWNERS OF "THE DEFAULT SKILL TIER", ONE ASSERTED AND ONE COMPUTED.
 *
 * `constants/handicapTiers` declares both:
 *
 *     export const DEFAULT_HANDICAP = 18;
 *     export const DEFAULT_TIER: HandicapTier = 'mid';
 *     export function deriveTier(h) { ...falls back to DEFAULT_HANDICAP... }
 *
 * They agree today because 18 lands in the mid band. Nothing makes them agree. Change
 * DEFAULT_HANDICAP to 22 — a plausible edit, since the file's own comment calls 18 "the mid-to-high
 * experience by default" — and `deriveTier(null)` returns 'high' while `DEFAULT_TIER` still says
 * 'mid', so any surface reading the constant disagrees with every surface calling the function.
 *
 * DEFAULT_TIER had no readers at all, which is how it stayed invisible: it was in `constants/`, and
 * the orphan lock did not scan that directory until today. Pinning the agreement is better than
 * either deleting the constant or wiring it somewhere arbitrary — it makes the redundancy SAFE, and
 * a future edit to one number fails here instead of on a screen.
 * [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_HANDICAP,
  DEFAULT_TIER,
  TIER_BANDS,
  TIER_LABEL,
  ANALYSIS_PROMPT_PLAIN_MIN_HCP,
  ANALYSIS_PROMPT_TECHNICAL_MAX_HCP,
  deriveTier,
  tierToComplexity,
  type HandicapTier,
} from '../../constants/handicapTiers';

describe('the asserted default tier matches the computed one', () => {
  it('deriveTier of an unset handicap IS the declared default', () => {
    expect(deriveTier(null)).toBe(DEFAULT_TIER);
    expect(deriveTier(undefined)).toBe(DEFAULT_TIER);
    expect(deriveTier(DEFAULT_HANDICAP)).toBe(DEFAULT_TIER);
  });

  it('junk never crashes and never invents a tier outside the bands', () => {
    for (const h of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Object.keys(TIER_BANDS)).toContain(deriveTier(h as number));
    }
  });
});

describe('the bands themselves are coherent', () => {
  const ORDER: HandicapTier[] = ['elite', 'low', 'mid', 'high'];

  it('every band has a label, and TIER_LABEL covers all four', () => {
    for (const t of ORDER) {
      expect(TIER_BANDS[t].label.length).toBeGreaterThan(0);
      expect(TIER_LABEL[t]).toBe(TIER_BANDS[t].label);
    }
  });

  it('the thresholds ascend, so no handicap falls in two bands', () => {
    const bounds = ORDER.map((t) => TIER_BANDS[t].maxHandicap);
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
    expect(bounds[bounds.length - 1]).toBe(Infinity); // the top band must be open
  });

  it('deriveTier lands each band where its own bound says it should', () => {
    expect(deriveTier(TIER_BANDS.elite.maxHandicap)).toBe('elite');
    expect(deriveTier(TIER_BANDS.elite.maxHandicap + 1)).toBe('low');
    expect(deriveTier(TIER_BANDS.low.maxHandicap)).toBe('low');
    expect(deriveTier(TIER_BANDS.low.maxHandicap + 1)).toBe('mid');
    expect(deriveTier(TIER_BANDS.mid.maxHandicap)).toBe('mid');
    expect(deriveTier(TIER_BANDS.mid.maxHandicap + 1)).toBe('high');
  });

  it('every tier maps to a coaching complexity — no tier falls through', () => {
    for (const t of ORDER) expect(['simple', 'standard', 'advanced']).toContain(tierToComplexity(t));
  });
});

/**
 * 2026-09-13 (release audit) — the same file's LEGACY OPERATIONAL THRESHOLDS section exists to pull
 * scattered magic numbers into one place. Two of them were pulled out of api/swing-analysis's prompt
 * and the prompt kept its own literal 20 and 10, so the constants had zero readers while the real
 * behaviour lived in a template string — a threshold with two owners, one of them invisible to anyone
 * searching for the number. Surfaced only because the orphan lock started scanning constants/ today.
 */
describe('a centralized threshold is the one the code actually uses', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../../api/swing-analysis.ts'), 'utf8');

  it('the analysis prompt interpolates the constants rather than restating them', () => {
    expect(prompt).toContain('(≥${ANALYSIS_PROMPT_PLAIN_MIN_HCP})');
    expect(prompt).toContain('(≤${ANALYSIS_PROMPT_TECHNICAL_MAX_HCP})');
  });

  it('no literal copy of either number survives in that personalization line', () => {
    const line = prompt.split('\n').find((l) => l.includes('- Personalization: when player_context'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/≥\s*\d/);
    expect(line).not.toMatch(/≤\s*\d/);
  });

  it('the thresholds still describe two distinct registers, plain above technical', () => {
    // A plain-language floor at or below the technical ceiling would make the two rules overlap and
    // the prompt self-contradictory for a mid handicap.
    expect(ANALYSIS_PROMPT_PLAIN_MIN_HCP).toBeGreaterThan(ANALYSIS_PROMPT_TECHNICAL_MAX_HCP);
  });
});
