/**
 * 2026-08-11 — Tim: "Make sure the measuring tool lines up on the green and the tee box."
 *
 * A scorecard yardage IS the measuring tool's expected answer, so it makes a free oracle: measure
 * every bundled hole's stored tee→green distance and compare it to the hole's own card. Doing that
 * across the catalog found three courses badly out —
 *
 *   westlake-cc-nj  61% mean error
 *   greenhill       51% mean error   (hole 1 measures 150y against a 374y card)
 *   echo-hills      40% mean error
 *
 * — against 0.1–3% for every other course. The GREENS on those three are fine (each course's
 * derived centroid matched OSM to within 31m); the stored TEES are not, and greedily re-pairing
 * tees to greens by card yardage only takes greenhill from 51% to 28%, so it isn't a pairing bug.
 *
 * The reason this survived is the part worth locking. courseGeometryService decided whether to
 * trust bundled coordinates by COUNTING them — "at least half the holes have a tee and a green".
 * All three courses passed that with 16 of 18. So the app kept serving coordinates that fail their
 * own scorecard on exactly the courses where the engine builds perfectly: Greenhill, from its
 * corrected centroid, returns 18 holes with 18 greens and 18 tees.
 *
 * Presence is not correctness. The trust test now asks whether the geometry reproduces the card.
 */
import fs from 'fs';
import path from 'path';
import { COURSES } from '../../data/courses';

const haversineYards = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x)) * 1.09361;
};

const ok = (la: number, ln: number) => Math.abs(la) > 0.001 && Math.abs(ln) > 0.001;

/** Mean |measured − card| / card over every hole of a course that has both coordinates. */
function meanCardError(courseId: string): { mean: number; holes: number } {
  const holes = (COURSES.find(c => c.id === courseId)?.holes ?? []).filter(
    h => ok(h.teeLat, h.teeLng) && ok(h.middleLat, h.middleLng) && h.distance > 50,
  );
  if (!holes.length) return { mean: 0, holes: 0 };
  const errs = holes.map(h => {
    const measured = haversineYards(
      { lat: h.teeLat, lng: h.teeLng },
      { lat: h.middleLat, lng: h.middleLng },
    );
    return Math.abs(measured - h.distance) / h.distance;
  });
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, holes: holes.length };
}

describe('the measuring tool agrees with the scorecard', () => {
  const measurable = COURSES.map(c => ({ id: c.id, ...meanCardError(c.id) })).filter(c => c.holes >= 3);

  it('covers a real slice of the catalog — not vacuously passing', () => {
    expect(measurable.length).toBeGreaterThanOrEqual(12);
  });

  // The known-bad three are asserted separately below; every other course must be tight.
  const KNOWN_BAD = new Set(['westlake-cc-nj', 'greenhill', 'echo-hills']);

  it.each(measurable.filter(c => !KNOWN_BAD.has(c.id)).map(c => [c.id] as const))(
    '%s — stored tee→green reproduces the card',
    id => {
      // Honest tee-marker variance and green-centre choice sit well under 10%; these run 0.1-3%.
      expect(meanCardError(id).mean).toBeLessThan(0.12);
    },
  );

  it('the three known-bad courses are still detectably bad — the oracle works', () => {
    // If a future data edit silently "fixes" these by deleting coordinates, meanCardError returns
    // 0 holes and this fails, which is the correct alarm.
    for (const id of KNOWN_BAD) {
      const r = meanCardError(id);
      expect(r.holes).toBeGreaterThanOrEqual(3);
      expect(r.mean).toBeGreaterThan(0.25);
    }
  });
});

describe('bad bundled geometry must not outrank the engine', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../services/courseGeometryService.ts'), 'utf8');

  it('trust is judged on accuracy, not on how many coordinates exist', () => {
    // THE bug: `withTee >= half` alone. greenhill passed it with 16/18 while being 51% wrong.
    expect(src).toContain('const measurable = bundled.holes.filter');
    expect(src).toContain('Math.abs(measured - h.yardage!) / h.yardage!');
    expect(src).toContain('return mean <= 0.25;');
  });

  it('still requires the coordinates to be there at all', () => {
    expect(src).toContain("if (withTee < Math.ceil(bundled.holes.length * 0.5)) return false;");
  });

  it('does not demote a course on too little evidence', () => {
    // A 9-hole course with two mapped holes shouldn't be thrown to the engine on a 2-sample mean.
    expect(src).toContain('if (measurable.length < 3) return true;');
  });

  it('keeps the bundled copy as fallback so a failed build never loses data', () => {
    expect(src).toContain('bundledFallback = bundled ?? null;');
    expect(src).toContain("upstreamId = '__osm_only__';");
  });
});

/**
 * 2026-08-12 (Tim) — "Check shot trace, I don't think you actually fixed the guards so it will work,
 * and damn near every golf app and video has post-shot shot trace that shows and approximates ball
 * flight. This probably contributes to missing target/shot maps on analysis cards."
 *
 * He was right on both counts. The guard was `showSkeleton` — the POSE-SKELETON toggle, defaulted
 * OFF in June because interpolating a sparse 5-frame pose over moving video looked laggy. The ball
 * reads were gated on the same flag "so this defaults BOTH overlays off". A rendering decision about
 * the skeleton silently switched off shot trace for everyone who never taps the Motion chip.
 *
 * The overlay that DRAWS the trace never required the flag (it renders on isReview && showResults),
 * so the renderer sat there ready while the producer never ran. And his downstream guess was exact:
 * the persisted shot map stores `trace: ballTrace ? … : null`, so no Motion tap meant no trace AND
 * no shot map on the analysis card.
 */
describe('shot trace computes without the pose-skeleton toggle', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs2 = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path2 = require('path') as typeof import('path');
  const sm = fs2.readFileSync(path2.join(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf8');

  it('the ball-departure read no longer requires showSkeleton', () => {
    expect(sm).not.toContain('if (!showSkeleton || !clipUri || !ballArea) return;');
    expect(sm).toContain('if (!clipUri || !ballArea) return;');
  });

  it('neither ball effect still lists showSkeleton as a dependency', () => {
    // A stale dep would re-run the effect on toggle and reintroduce the coupling by the back door.
    expect(sm).not.toContain('}, [showSkeleton, clipUri, ballArea, segments, selectedSwing]);');
    expect(sm).not.toContain('}, [showSkeleton, clipUri, ballArea, segments, selectedSwing, angle, isPutt]);');
  });

  it('both ball reads survive — departure AND the multi-point path', () => {
    // buildShotTrace needs the path points for the solid measured line; departure alone is one line.
    expect(sm).toContain('void detectBallDeparture(');
    expect(sm).toContain('void detectBallPath(');
  });

  it('the trace still only draws for a DTL, non-putt swing', () => {
    // Decoupling from the skeleton must not start drawing flight on a face-on view or a putt.
    expect(sm).toContain("if (angle !== 'down_the_line' || isPutt) { setBallPathPoints(null); return; }");
    expect(sm).toContain("if (angle !== 'down_the_line' || isPutt) return null;");
  });

  it('the shot map still carries the trace it now actually receives', () => {
    // This is the analysis-card link Tim guessed at: no trace computed → trace: null persisted.
    expect(sm).toContain('trace: ballTrace ? { side: ballTrace.side, divergenceDeg: ballTrace.divergenceDeg } : null');
  });

  it('the overlay that draws it never depended on the toggle', () => {
    expect(sm).toContain("{isReview && showResults && shotTrace && shotTrace.tier !== 'none' ? (");
  });
});
