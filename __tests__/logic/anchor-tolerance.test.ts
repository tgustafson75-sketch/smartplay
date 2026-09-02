/**
 * 2026-09-01 (Tim) — "a strike confirmation or kind of acoustic pickup can help confirm. It's just a
 * silent, thin confirmation level of that strike point, and you can work around that. Right?" and
 * "on the course, even a low detection is probably accurate because you're not standing close to
 * anyone."
 *
 * Both are right, and together they turn a binary into a usable gradient. A low-confidence transient
 * was being treated as no strike at all, which meant falling back to a FRACTION of the clip — far
 * worse than a roughly-known strike. And the reason a thin transient is distrusted at all (it might
 * be the next bay's ball) simply does not exist alone in a fairway.
 */
import { anchorToleranceMs, impactAnchorMs } from '../../services/swing/clubPathWindow';
import { clubPathSampleOffsets } from '../../services/swing/clubPath';

describe('anchorToleranceMs', () => {
  it('trusts a high-confidence strike exactly, everywhere', () => {
    for (const env of ['course', 'range', 'sim', null] as const) {
      expect(anchorToleranceMs('high', env)).toBe(0);
    }
  });

  it('widens for a thin pickup rather than discarding it', () => {
    // The alternative to a wide window here is a fraction of the clip, which is not a measurement.
    expect(anchorToleranceMs('low', 'range')).toBeGreaterThan(0);
    expect(anchorToleranceMs('low', 'range')).toBeGreaterThan(anchorToleranceMs('medium', 'range'));
  });

  it('trusts a low detection FAR more on the course than in a bay', () => {
    // The neighbouring-bay false positive is the whole reason 'low' is distrusted, and it cannot
    // happen alone in a fairway.
    expect(anchorToleranceMs('low', 'course')).toBeLessThan(anchorToleranceMs('low', 'range'));
    expect(anchorToleranceMs('low', 'course')).toBeLessThan(anchorToleranceMs('low', 'sim'));
    expect(anchorToleranceMs('medium', 'course')).toBeLessThan(anchorToleranceMs('medium', 'range'));
  });

  it('treats an ungraded anchor as the least trustworthy case', () => {
    expect(anchorToleranceMs(null, 'range')).toBe(anchorToleranceMs('low', 'range'));
    expect(anchorToleranceMs(undefined, 'range')).toBe(anchorToleranceMs('low', 'range'));
  });
});

describe('impactAnchorMs refuses a pose label that was never detected', () => {
  const base = { rawStartMs: 0, rawEndMs: 11_640 };

  it('accepts a strike-anchored P6_impact', () => {
    expect(impactAnchorMs({ ...base, poseImpactMs: 7000, poseImpactSource: 'strike' })).toBe(7000);
  });

  it('REFUSES a P6_impact that was placed at a fraction of the clip', () => {
    // 0.65 * duration wearing the name of a measurement — the same fabrication the synthesized
    // detectionOffsetSeconds is refused for. [[a-field-that-is-sometimes-a-placeholder]]
    expect(impactAnchorMs({ ...base, poseImpactMs: 7566, poseImpactSource: 'estimated' })).toBeNull();
  });

  it('a heard strike still outranks everything', () => {
    expect(impactAnchorMs({
      ...base,
      detectionMethod: 'audio_transient',
      detectionOffsetSeconds: 7.0,
      poseImpactMs: 9999,
      poseImpactSource: 'estimated',
    })).toBe(7000);
  });
});

describe('the sampler widens by the tolerance instead of clustering on a time it is unsure of', () => {
  const START = 0, IMPACT = 2500, END = 4000;

  it('starts its dense band EARLIER for a thin anchor — the window absorbs the error', () => {
    const tight = clubPathSampleOffsets(START, END, IMPACT, anchorToleranceMs('high', 'course'));
    const loose = clubPathSampleOffsets(START, END, IMPACT, anchorToleranceMs('low', 'range'));
    // The first sample past the sparse lead-in marks where the dense band begins.
    const bandStart = (o: number[]) => Math.min(...o.filter((t) => t >= 1200));
    expect(bandStart(loose)).toBeLessThan(bandStart(tight));
  });

  it('concentrates LESS tightly on the strike as confidence drops — never more', () => {
    const near = (tol: number) =>
      clubPathSampleOffsets(START, END, IMPACT, tol).filter((t) => t >= IMPACT - 450 && t <= IMPACT + 250).length;
    const [high, medium, low] = [
      near(anchorToleranceMs('high', 'range')),
      near(anchorToleranceMs('medium', 'range')),
      near(anchorToleranceMs('low', 'range')),
    ];
    expect(medium).toBeLessThanOrEqual(high);
    expect(low).toBeLessThanOrEqual(medium);
    expect(low).toBeLessThan(high);   // a thin pickup really is spread out, not nominally
  });

  it('still samples the same NUMBER of frames — it is a spread, not a penalty', () => {
    const tight = clubPathSampleOffsets(START, END, IMPACT, 0);
    const loose = clubPathSampleOffsets(START, END, IMPACT, 240);
    expect(loose.length).toBe(tight.length);
  });

  it('never leaves the window however wide the tolerance', () => {
    for (const tol of [0, 80, 240, 5000]) {
      const off = clubPathSampleOffsets(START, END, IMPACT, tol);
      for (const t of off) {
        expect(t).toBeGreaterThanOrEqual(START);
        expect(t).toBeLessThanOrEqual(END);
      }
    }
  });
});
