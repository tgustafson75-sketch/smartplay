/**
 * Phase 413 requested four Health Connect permissions in May 2026, wrote the readings onto every
 * round record, shipped them to Supabase inside the round-store backup — and never read one back.
 * `hasWatchData` lived in exactly one file: the code that wrote it.
 *
 * These pin the reader that closes that loop, and the honesty rules that keep it from becoming a
 * card full of zeroes on the many rounds played without a watch. A regression here means we are
 * back to collecting heart rate for nobody, which is both a dead feature and the hardest kind of
 * permission to defend at Play review.
 */
import { describeRoundEffort, formatDuration } from '../../services/roundEffort';
import type { RoundRecord } from '../../store/roundStore';

type Health = NonNullable<RoundRecord['health']>;

const health = (over: Partial<Health> = {}): Health => ({
  totalSteps: 13_400,
  distanceMeters: 9978, // ~6.2 miles
  heartRateAvg: 104,
  heartRateMax: 148,
  activeCalories: 720,
  durationMin: 250,
  hasWatchData: true,
  ...over,
});

describe('describeRoundEffort', () => {
  it('reports the walk when a watch actually measured it', () => {
    const e = describeRoundEffort(health());
    expect(e).not.toBeNull();
    expect(e!.distanceMiles).toBe(6.2);
    expect(e!.steps).toBe(13_400);
    expect(e!.heartRateAvg).toBe(104);
    expect(e!.activeCalories).toBe(720);
    expect(e!.headline).toBe(
      "You walked 6.2 miles and 13,400 steps over 4h 10m, averaging 104 bpm. That's about 720 active calories.",
    );
  });

  it('is null when there was no watch — the common case, and not a zeroed card', () => {
    expect(describeRoundEffort(undefined)).toBeNull();
    expect(describeRoundEffort(health({ hasWatchData: false }))).toBeNull();
  });

  it('is null when a sample landed but carried nothing', () => {
    // A grant revoked mid-round satisfies hasWatchData with every field at zero. "0 steps, 0 miles"
    // reads as a measurement of a round the player knows they walked — worse than showing nothing.
    expect(
      describeRoundEffort(
        health({ totalSteps: 0, distanceMeters: 0, activeCalories: 0, heartRateAvg: null, heartRateMax: null }),
      ),
    ).toBeNull();
  });

  it('treats a zero heart rate as absent, not as a reading', () => {
    const e = describeRoundEffort(health({ heartRateAvg: 0, heartRateMax: 0 }));
    expect(e!.heartRateAvg).toBeNull();
    expect(e!.heartRateMax).toBeNull();
    expect(e!.headline).not.toContain('bpm');
  });

  it('shrinks the sentence around missing metrics instead of padding them', () => {
    const e = describeRoundEffort(
      health({ distanceMeters: 0, activeCalories: 0, heartRateAvg: null, heartRateMax: null }),
    );
    // Not "You 13,400 steps over 4h 10m." — the verb is picked for the shape that survived.
    expect(e!.headline).toBe('You took 13,400 steps over 4h 10m.');
    expect(e!.headline).not.toContain('miles');
    expect(e!.headline).not.toContain('calories');
  });

  it('still speaks when only a duration survives', () => {
    const e = describeRoundEffort(
      health({ totalSteps: 0, distanceMeters: 0, activeCalories: 0, heartRateAvg: 96, heartRateMax: null }),
    );
    expect(e!.headline).toBe('You were out there 4h 10m, averaging 96 bpm.');
  });

  it('rounds distance to one decimal — the pedometer does not justify two', () => {
    expect(describeRoundEffort(health({ distanceMeters: 9978 }))!.distanceMiles).toBe(6.2);
    expect(describeRoundEffort(health({ distanceMeters: 1609.344 }))!.distanceMiles).toBe(1);
  });

  it('never lets a negative or absent field through as a number', () => {
    const e = describeRoundEffort(health({ totalSteps: -5, activeCalories: -20 }));
    expect(e!.steps).toBe(0);
    expect(e!.activeCalories).toBe(0);
  });
});

describe('formatDuration', () => {
  it('reads the way a person says it', () => {
    expect(formatDuration(47)).toBe('47m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(250)).toBe('4h 10m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-3)).toBe('0m');
  });
});
