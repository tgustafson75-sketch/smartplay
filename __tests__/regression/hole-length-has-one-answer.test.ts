/**
 * 2026-08-30 (Tim: "Yes — it replaces the scorecard number").
 *
 * getAnchoredHoleLengthYards has existed for months with ZERO callers. Its own docstring calls it
 * the payoff of marking both ends: a hole length measured from the tee and green the player actually
 * marked, which beats the scorecard when the card was measured from a different tee box, and beats
 * GPS geometry that may not match the tee being played. It was computed and shown nowhere.
 *
 * The risk in fixing it is not that the number fails to appear — it is that it appears BESIDE the
 * scorecard number. app/smartvision.tsx read the raw `courseHoles...distance` field in three
 * separate places, so a fourth surface showing a measured value would have made "how long is this
 * hole" a question with two answers, which is the defect class this whole baseline exists to catch.
 *
 * So what is pinned is REPLACEMENT and FALLBACK, not merely presence.
 */

import { holeLengthYards } from '../../services/smartFinderService';
import { useRoundStore } from '../../store/roundStore';
import { setTeeOverride } from '../../services/courseTeeOverrides';
import { setGreenOverride } from '../../services/courseGreenOverrides';

const COURSE = 'test-course-anchored';

function setHoles(distance: number) {
  useRoundStore.setState({
    activeCourseId: COURSE,
    courseHoles: [{ hole: 7, par: 4, distance }, { hole: 8, par: 3, distance: 150 }],
  } as never);
}

beforeEach(() => {
  useRoundStore.setState({ activeCourseId: null, pendingStartCourseId: null, previewCourseId: null, courseHoles: [] } as never);
});

describe('with nothing marked, the card still answers', () => {
  it('returns the scorecard distance', () => {
    setHoles(412);
    expect(holeLengthYards(7)).toBe(412);
  });

  it('returns null rather than a zero or a NaN for a hole it has no data for', () => {
    setHoles(412);
    expect(holeLengthYards(99)).toBeNull();
  });

  it('treats a zero-yardage row as unknown, not as a 0-yard hole', () => {
    // A bundled row with distance 0 means "no yardage recorded". Rendering "0 yds" would be a lie
    // that looks like a measurement.
    setHoles(0);
    expect(holeLengthYards(7)).toBeNull();
  });
});

describe('the measurement WINS over the card', () => {
  it('replaces the scorecard number once both ends are marked', async () => {
    // THE ASSERTION THE REST OF THIS FILE CANNOT MAKE. Without it the suite still passes when the
    // anchored read is stubbed out entirely — I checked, by stubbing it, and everything stayed
    // green. A guard that cannot fail on its own claim is not a guard.
    //
    // Two points ~200 yards apart at this latitude; the card says 412. The measurement must win.
    setHoles(412);
    await setTeeOverride(COURSE, 7, { lat: 37.0000, lng: -122.0000 });
    await setGreenOverride(COURSE, 7, { lat: 37.0018, lng: -122.0000 });
    const measured = holeLengthYards(7);
    expect(measured).not.toBeNull();
    expect(measured).not.toBe(412);
    expect(measured as number).toBeGreaterThan(150);
    expect(measured as number).toBeLessThan(260);
  });

  it('falls back to the card when only ONE end is marked', async () => {
    // Half a measurement is not a measurement — a tee with no green cannot produce a length.
    // Hole 8 deliberately: overrides live in a module cache that outlives a test, so reusing hole 7
    // here would have silently inherited the green marked above and proved nothing.
    setHoles(412);
    await setTeeOverride(COURSE, 8, { lat: 37.0000, lng: -122.0000 });
    expect(holeLengthYards(8)).toBe(150);
  });
});

describe('the fallback is per-hole', () => {
  it('answers for an unmarked hole while another hole is marked', () => {
    // A player marks hole 7 and not hole 8. Hole 8 must still answer from the card — no gap, and
    // nothing for the player to configure.
    setHoles(412);
    expect(holeLengthYards(8)).toBe(150);
  });
});

describe('there is exactly one owner', () => {
  it('is the only thing SmartVision asks for a hole length', () => {
    // The three raw reads are what made a second answer possible. This is the assertion that fails
    // if someone reintroduces one — pinned to the expression, not to a comment about it.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../app/smartvision.tsx'), 'utf8');
    const raw = src.match(/courseHoles\.find\(x => x\.hole === holeIndex\)\?\.distance/g) ?? [];
    expect(raw).toHaveLength(0);
    expect(src).toMatch(/holeLengthYards\(holeIndex\)/);
  });

  it('leaves the published course card alone, which is a different question', () => {
    // course-layout renders ANY browsed course's official card. One player's marks must not restate
    // a course's published yardage or shift its front/back/total sums.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../app/course-layout.tsx'), 'utf8');
    expect(src).not.toMatch(/holeLengthYards/);
  });
});
