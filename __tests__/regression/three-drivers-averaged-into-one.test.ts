/**
 * 2026-09-12 (Tim) — THREE DRIVERS, DIFFERENT SHAFTS, ONE BLURRED AVERAGE.
 *
 * "Same ball logic to clubs and such. Example, I have 3 drivers, all different shafts — so if I say
 *  I am going to use the TaylorMade X shaft vs Burner 2 stock shaft, that provides some degree of
 *  feedback data."
 *
 * The bag models a club SLOT with one set of numbers. A player testing shafts has several physical
 * clubs in that slot whose numbers genuinely differ — which is the entire reason he is testing. With
 * no way to say which one is in play, every drive averages together and the test can never conclude.
 *
 * WHY THIS IS NOT THE BALL COMPARISON, despite "same logic": a ball is in play for every shot of a
 * round, so comparing ROUNDS by ball is sound. A driver shaft touches the drives only — comparing
 * rounds by shaft would bury a real difference under that day's putting. So the DECLARATION works
 * the same way (say it in passing, it sticks) and the COMPARISON is per-club and shot-level.
 */
import fs from 'fs';
import path from 'path';
import {
  compareClubVariants, bestClubVariantInsight,
  MIN_SHOTS_PER_VARIANT, MEANINGFUL_YARDS, MEANINGFUL_TROUBLE_PCT,
} from '../../services/clubVariantPerformance';
import type { ShotResult } from '../../store/roundStore';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** n shots with a club+variant, `trouble` of them costly, each carrying `yards`. */
const shots = (club: string, variant: string, n: number, opts: { yards?: number; trouble?: number } = {}): ShotResult[] =>
  Array.from({ length: n }, (_, i) => ({
    club, club_variant: variant, hole: 1, timestamp: i,
    feel: null, direction: null, shape: null, acousticContact: null,
    distance_yards: opts.yards ?? null,
    outcome: i < (opts.trouble ?? 0) ? 'penalty' : 'clean',
  } as unknown as ShotResult));

describe('it counts shots, not rounds', () => {
  it('compares shot-level, so a shaft is not judged by the day\'s putting', () => {
    const src = code('services/clubVariantPerformance.ts');
    expect(src).not.toMatch(/scoreVsPar|roundHistory/);
    expect(src).toContain('distance_yards');
  });

  it('only counts shots hit with the club being asked about', () => {
    const mixed = [
      ...shots('Driver', 'TM X', MIN_SHOTS_PER_VARIANT),
      ...shots('7I', 'TM X', 40),
    ];
    const c = compareClubVariants(mixed, 'Driver');
    expect(c.splits.reduce((a, s) => a + s.shots, 0)).toBe(MIN_SHOTS_PER_VARIANT);
  });

  it('matches the club through the normaliser, so "driver" and "Driver" are one slot', () => {
    const s = shots('driver', 'TM X', MIN_SHOTS_PER_VARIANT);
    expect(compareClubVariants(s, 'Driver').splits.length).toBe(1);
  });
});

describe('it refuses to conclude on too little', () => {
  it('says nothing when no variant has been declared', () => {
    const plain = shots('Driver', '', 40).map((s) => ({ ...s, club_variant: null }));
    expect(compareClubVariants(plain, 'Driver').say).toMatch(/not got a .* tracked by model/i);
  });

  it('waits for enough shots with EACH variant', () => {
    const c = compareClubVariants([
      ...shots('Driver', 'TM X', MIN_SHOTS_PER_VARIANT),
      ...shots('Driver', 'Burner', MIN_SHOTS_PER_VARIANT - 1),
    ], 'Driver');
    expect(c.splits.length).toBe(1);
    expect(c.say).toMatch(new RegExp(`about ${MIN_SHOTS_PER_VARIANT} shots`));
  });
});

describe('straighter beats longer — the honest caddie answer', () => {
  it('picks the one that stays out of trouble when the gap is real', () => {
    const c = compareClubVariants([
      ...shots('Driver', 'Burner', 20, { yards: 240, trouble: 1 }),   //  5%
      ...shots('Driver', 'TM X', 20, { yards: 252, trouble: 8 }),     // 40%, and 12 yds longer
    ], 'Driver');
    expect(c.say).toMatch(/^The Burner\./);
    expect(c.say).toMatch(/worth it/);
  });

  it('falls back to distance only when they are equally straight', () => {
    const c = compareClubVariants([
      ...shots('Driver', 'Burner', 20, { yards: 240, trouble: 4 }),
      ...shots('Driver', 'TM X', 20, { yards: 254, trouble: 4 }),
    ], 'Driver');
    expect(c.say).toMatch(/comes down to distance/);
    expect(c.say).toMatch(/TM X/);
  });

  it('says nothing in it rather than inventing a winner', () => {
    const c = compareClubVariants([
      ...shots('Driver', 'Burner', 20, { yards: 246, trouble: 4 }),
      ...shots('Driver', 'TM X', 20, { yards: 248, trouble: 4 }),
    ], 'Driver');
    expect(c.say).toMatch(/nothing in it/i);
  });

  it('the thresholds are real gaps, not decimals', () => {
    expect(MEANINGFUL_YARDS).toBeGreaterThanOrEqual(5);
    expect(MEANINGFUL_TROUBLE_PCT).toBeGreaterThanOrEqual(5);
  });
});

describe('what the caddie is told, unprompted', () => {
  it('a level result is NOT volunteered — right when asked, noise when offered', () => {
    const level = [
      ...shots('Driver', 'Burner', 20, { yards: 246, trouble: 4 }),
      ...shots('Driver', 'TM X', 20, { yards: 248, trouble: 4 }),
    ];
    expect(bestClubVariantInsight(level)).toBeNull();
  });

  it('a real difference is', () => {
    const clear = [
      ...shots('Driver', 'Burner', 20, { yards: 240, trouble: 1 }),
      ...shots('Driver', 'TM X', 20, { yards: 252, trouble: 8 }),
    ];
    expect(bestClubVariantInsight(clear)?.say).toMatch(/Burner/);
  });

  it('and the brain is told to hold it until asked', () => {
    expect(code('api/kevin.ts')).toMatch(/club_variant_insight/);
    expect(code('api/kevin.ts')).toMatch(/Only say it if asked/);
  });
});

describe('the declaration is wired end to end', () => {
  it('the intent is handled, in the classifier enum, AND in its prompt', () => {
    // 2026-09-12: set_ball shipped with the handler wired and the enum forgotten, and two sim
    // guards caught it. A handler nothing can reach is not a feature.
    expect(code('services/intents/index.ts')).toContain('registerHandler(setClubVariantHandler)');
    expect(code('api/voice-intent.ts')).toContain("'set_club_variant'");
    expect(code('api/voice-intent.ts')).toMatch(/15f\. set_club_variant/);
  });

  it('every shot is stamped at the ONE funnel, not at each producer', () => {
    const store = code('store/roundStore.ts');
    expect(store).toMatch(/club_variant\?: string \| null;/);
    // inside logShot's enriched object, and never overwriting a caller-supplied value
    expect(store).toMatch(/club_variant: shot\.club_variant \?\?/);
  });

  it('the variant map is backed up — without it, past labels stop meaning anything', () => {
    expect(code('services/cloudSync/snapshot.ts')).toContain("'club-variant-v1'");
  });

  it('does not whitelist shaft names — the one he is testing is the newest', () => {
    expect(code('services/intents/setClubVariantHandler.ts')).not.toMatch(/KNOWN_SHAFTS|\['Stiff'/);
  });
});
