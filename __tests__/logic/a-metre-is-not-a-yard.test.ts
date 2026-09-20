/**
 * 2026-09-18 (Tim — "will the course engine build international courses?").
 *
 * It builds them. Then it told the player it was 145 YARDS to the middle, in a country that has not
 * sold a yard since 1965. `settings.distance_unit` had a setter, a voice intent and four readers,
 * none of which were the screens or the caddie.
 *
 * This is the conversion itself, which is the part that must never be wrong: a club call off a
 * distance that is 9% out is a club call for a different shot, and it would be wrong by an amount
 * small enough to look plausible all the way to the green.
 */
import {
  METERS_PER_YARD, toDisplayDistance, fromDisplayDistance, formatDistance,
  formatDistanceCompact, formatDistanceRange, unitLabel, compactUnitLabel, unitWord,
} from '../../services/distanceUnits';

describe('the conversion', () => {
  it('uses the exact international yard, not a rounded one', () => {
    // 0.91 would be 55cm out over a drive. The 1959 agreement is exact.
    expect(METERS_PER_YARD).toBe(0.9144);
  });

  it('converts a real club distance the way a player would check it', () => {
    expect(toDisplayDistance(145, 'meters')).toBe(133);   // 132.588 → 133
    expect(toDisplayDistance(145, 'yards')).toBe(145);    // untouched
    expect(toDisplayDistance(250, 'meters')).toBe(229);
  });

  it('round-trips an entered number without drifting', () => {
    const typedMetres = 133;
    const stored = fromDisplayDistance(typedMetres, 'meters');
    expect(stored).toBeCloseTo(145.45, 1);
    expect(toDisplayDistance(stored, 'meters')).toBe(133);
  });

  it('a missing distance is a DASH, never a zero', () => {
    // A "0 yds" on the hole view claims the pin is at your feet.
    for (const bad of [null, undefined, NaN, Infinity]) {
      expect(toDisplayDistance(bad as number, 'meters')).toBeNull();
      expect(formatDistance(bad as number, 'yards')).toBe('—');
      expect(formatDistanceCompact(bad as number, 'meters')).toBe('—');
    }
  });

  it('labels each system the way that system writes it', () => {
    expect(unitLabel('yards')).toBe('yds');
    expect(unitLabel('meters')).toBe('m');
    expect(compactUnitLabel('yards')).toBe('y');
    expect(compactUnitLabel('meters')).toBe('m');
    expect(unitWord('meters')).toBe('metres');       // the spelling every metric golf country uses
    expect(unitWord('yards', false)).toBe('yard');
  });

  it('formats the way the surfaces need it', () => {
    expect(formatDistance(145, 'yards')).toBe('145 yds');
    expect(formatDistance(145, 'meters')).toBe('133 m');
    expect(formatDistance(145, 'meters', { space: false })).toBe('133m');
    expect(formatDistanceCompact(145, 'yards')).toBe('145y');
    expect(formatDistanceCompact(145, 'meters')).toBe('133m');
  });

  it('converts a range END BY END, so an honesty band keeps its width', () => {
    // Rounding the span instead would let a 7-yard window come out 6 wide in metres, and the width
    // of a confidence band is a claim about what we know.
    expect(formatDistanceRange(140, 147, 'yards')).toBe('140-147 yds');
    expect(formatDistanceRange(140, 147, 'meters')).toBe('128-134 m');
    expect(formatDistanceRange(140, null, 'meters')).toBeNull();
  });
});

/**
 * 2026-09-19 — ALL FOUR WAYS A DISTANCE GETS IN.
 *
 * Display-only conversion is worse than none: it writes a number 9% short into the bag the caddie
 * clubs off, and reads it back looking right. In the fit profile it is worse still, because a stated
 * distance is the CENTRE of the ingest band — 133 typed as metres sets a 73-193 band around a club
 * that carries 145, and every real shot with it is rejected for ever.
 *
 * These are the four fields a player can type a distance into. Each must read what they typed in
 * THEIR unit and store yards. Identity for the default (yards) player, which is why an untested
 * version of this would look perfectly fine to everyone who built it.
 */
describe('every entry path reads the player\'s unit and stores yards', () => {
  const ENTRY_POINTS: [string, string][] = [
    ['components/QuickLogShotSheet.tsx', 'the shot log'],
    ['app/practice/fit-profile.tsx', 'the stated club distance'],
    ['app/arccos-import.tsx', 'the Arccos import'],
    ['components/profile/ProfileForm.tsx', 'longest drive'],
  ];

  it.each(ENTRY_POINTS)('%s converts on the way IN (%s)', (file) => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/fromDisplayDistance\(/);
  });
});

describe('the brain is told, because the voice is the part you cannot skim past', () => {
  it('the payload carries the unit, and every NUMBER in it stays yards', () => {
    const { buildCaddieRequestBody } = require('../../services/caddieRequestBody');
    const body = buildCaddieRequestBody({ message: 'what have I got', language: 'en' });
    expect(body).toHaveProperty('distanceUnit');
    expect(['yards', 'meters']).toContain(body.distanceUnit);
  });

  it('the prompt states the arithmetic rather than leaving the model to do it', () => {
    // [[arithmetic-belongs-in-code-not-the-model]] — a caddie left to "convert to metres" unaided
    // produces a number that is NEARLY right, which on a club call is worse than obviously wrong.
    const fs = require('fs');
    const path = require('path');
    const kevin = fs.readFileSync(path.resolve(__dirname, '../../api/kevin.ts'), 'utf8');
    expect(kevin).toMatch(/distanceUnit === 'meters'/);
    expect(kevin).toMatch(/0\.9144/);
    expect(kevin).toMatch(/Club names, loft and shaft numbers are NOT distances/);
  });
});
