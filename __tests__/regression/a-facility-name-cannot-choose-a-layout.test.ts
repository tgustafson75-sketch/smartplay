/**
 * 2026-09-05 (Tim, field report) — HE PLAYED THE PALMS AND SAW THE LAKES.
 *
 * "Menifee lakes and palms are not correct. I was playing Palms today with correct yardage but
 * Lakes images."
 *
 * Two facts from one round, disagreeing, because they have different owners. Yardages come from the
 * per-layout course record and were right. Hole imagery is resolved from the course NAME by
 * substring match — and golfcourseapi returns the same parent club for both layouts, so the name in
 * hand was "Menifee Lakes Country Club". It contains "lakes", it does not contain "palms", and the
 * matcher answered with photographs of a different golf course while the numbers beside them were
 * correct. On the tee. On his home course.
 *
 * The existing `lakes && !palms` guard was not wrong — it was answering a question the name could
 * not answer. The fix is a gate, not another special case: a facility name cannot identify a
 * layout, so declining is the only honest answer, and the caller falls through to live satellite
 * geometry keyed by the correct course id.
 *
 * Menifee's facility name CONTAINS one of its own layouts, which is what makes it nasty and is not
 * rare — Pembroke Lakes and Shadow Lakes collide on the same token today.
 */
import { resolveComplex, isAmbiguousComplexName, COURSE_COMPLEXES, courseDisplayLabel } from '../../data/courseComplexes';
import { getLocalHoleImage, getLocalCourseSlug } from '../../data/localCourseImages';

describe('a name that identifies only the facility identifies no layout', () => {
  it('THE BUG: the parent club name resolves to no layout', () => {
    // The exact string golfcourseapi returns for BOTH Menifee layouts.
    expect(resolveComplex('Menifee Lakes Country Club').kind).toBe('ambiguous');
    expect(isAmbiguousComplexName('Menifee Lakes Country Club')).toBe(true);
  });

  it('THE BUG, at the surface Tim saw: no hole image for a facility-only name', () => {
    // Before the gate this returned the LAKES aerial for every hole of a Palms round.
    for (const hole of [1, 7, 12, 18]) {
      expect(getLocalHoleImage('Menifee Lakes Country Club', hole)).toBeNull();
    }
    expect(getLocalCourseSlug('Menifee Lakes Country Club')).toBeNull();
  });

  it('a name that DOES say which layout still resolves', () => {
    // The gate must not cost the curated imagery when the name is sufficient.
    const palms = resolveComplex('Menifee Lakes — Palms');
    expect(palms.kind).toBe('layout');
    expect(palms.kind === 'layout' && palms.layout).toBe('palms');

    const lakes = resolveComplex('Menifee Lakes — Lakes');
    expect(lakes.kind).toBe('layout');
    expect(lakes.kind === 'layout' && lakes.layout).toBe('lakes');
  });

  it('the layout token is read from what is left AFTER the facility name', () => {
    // The heart of it. Matching the whole string cannot tell these two apart, because the facility
    // name contains "lakes" itself — which is exactly how the wrong photographs reached the tee.
    expect(resolveComplex('Menifee Lakes').kind).toBe('ambiguous');
    expect(resolveComplex('Menifee Lakes — Lakes').kind).toBe('layout');
  });

  it('the practice ground belongs to the facility, not to a layout', () => {
    const r = resolveComplex('Menifee Lakes Driving Range');
    expect(r.kind).toBe('range');
    // A range session must never be stamped with one layout's identity, and must never pull a
    // layout's hole imagery.
    expect(getLocalHoleImage('Menifee Lakes Driving Range', 1)).toBeNull();
  });

  it('courses that are not complexes are untouched', () => {
    for (const n of ['Crystal Springs', 'Pebble Beach', 'Torrey Pines South', 'Pembroke Lakes']) {
      expect(resolveComplex(n).kind).toBe('not-a-complex');
      expect(isAmbiguousComplexName(n)).toBe(false);
    }
    // ...and still resolve their own imagery.
    expect(getLocalCourseSlug('Pebble Beach')).toBe('pebble-beach');
  });

  it('empty and null names are not complexes', () => {
    for (const n of [null, undefined, '', '   ']) {
      expect(resolveComplex(n as string | null).kind).toBe('not-a-complex');
    }
  });
});

describe('the registry itself', () => {
  it('every complex has at least two layouts — one layout is not a complex', () => {
    for (const c of COURSE_COMPLEXES) {
      expect([c.key, c.layouts.length >= 2]).toEqual([c.key, true]);
    }
  });

  it('no range centroid is invented', () => {
    // A plausible wrong centroid mis-attributes every session near it and nothing looks broken.
    // Null until somebody stands on the range and records it.
    for (const c of COURSE_COMPLEXES) {
      if (c.range.center === null) continue;
      expect(typeof c.range.center.lat).toBe('number');
      expect(Math.abs(c.range.center.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.range.center.lng)).toBeLessThanOrEqual(180);
    }
  });
});

describe('the root cause: the layout must survive round start', () => {
  // The exact rows golfcourseapi returns for Tim's home property, fetched 2026-09-05:
  //   id=cdyssqsz  club_name='Menifee Lakes Country Club'  course_name='Palms'
  //   id=vhazn5kq  club_name='Menifee Lakes Country Club'  course_name='Lakes'
  const PALMS = { club_name: 'Menifee Lakes Country Club', course_name: 'Palms' };
  const LAKES = { club_name: 'Menifee Lakes Country Club', course_name: 'Lakes' };

  it('THE REGRESSION: club_name alone is what broke the round', () => {
    // This is literally what caddie.tsx assigned before the fix. Kept as a test so the shape of the
    // bug is visible: the string the round carried could not name the course it was on.
    expect(isAmbiguousComplexName(PALMS.club_name)).toBe(true);
  });

  it('the label keeps the layout for BOTH siblings', () => {
    expect(courseDisplayLabel(PALMS.club_name, PALMS.course_name)).toBe('Menifee Lakes Country Club — Palms');
    expect(courseDisplayLabel(LAKES.club_name, LAKES.course_name)).toBe('Menifee Lakes Country Club — Lakes');
  });

  it('and those labels resolve to the RIGHT layout, which is the whole point', () => {
    const p = resolveComplex(courseDisplayLabel(PALMS.club_name, PALMS.course_name));
    expect(p.kind === 'layout' && p.layout).toBe('palms');
    const l = resolveComplex(courseDisplayLabel(LAKES.club_name, LAKES.course_name));
    expect(l.kind === 'layout' && l.layout).toBe('lakes');
  });

  it('the Lakes suffix is NOT swallowed as redundant — the trap in the redundancy check', () => {
    // "Menifee Lakes Country Club" CONTAINS "lakes". A naive substring redundancy test would drop
    // the suffix here and rebuild the exact bug on the sister course.
    expect(courseDisplayLabel(LAKES.club_name, LAKES.course_name)).toContain('— Lakes');
  });

  it('genuinely redundant names are not doubled up', () => {
    expect(courseDisplayLabel('Pebble Beach', 'Pebble Beach')).toBe('Pebble Beach');
    expect(courseDisplayLabel('Torrey Pines South', 'South')).toBe('Torrey Pines South');
    expect(courseDisplayLabel('Crystal Springs', null)).toBe('Crystal Springs');
    expect(courseDisplayLabel(null, 'Palms')).toBe('Palms');
  });
});
