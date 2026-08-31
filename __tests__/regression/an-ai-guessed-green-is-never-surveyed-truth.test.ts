/**
 * 2026-08-31 (OPEN-ITEMS §7 — the unswept code).
 *
 * `services/courseDataOrchestrator.ts` had ZERO test coverage, and what it enforces is one of the
 * app's honesty rules: a green that our own vision brain GUESSED off a satellite tile must never be
 * presented to the player as surveyed truth. [[illustration-data-points]] — real signals or "Coming
 * Soon", never fabricate.
 *
 * The chain is real and was verified by hand: holeGeometryDerivation stamps `estimated: true`,
 * courseGeometryService force-stamps it again on write and keeps derived data in a PHYSICALLY
 * SEPARATE cache key, both consumers prefer real geometry (`getHoleGeometry(...) ?? getDerived...`),
 * and the scorer caps the geometry sub-score. Every link held. None of it was tested, and the file
 * asserted the important part in a COMMENT — "which the confidence scorer below down-weights" —
 * which is the exact shape of claim that has been false repeatedly in this repo.
 *
 * So this pins the OUTCOME, not the mechanism: with an estimated green, "High confidence" must be
 * UNREACHABLE — proven by maximising every other input rather than by sampling one case.
 */
import { scoreConfidence, buildConfidenceLabel } from '../../services/courseDataOrchestrator';

type Src = 'mapbox' | 'centroid_fallback' | 'bundled_screenshot' | 'none';
const SOURCES: Src[] = ['mapbox', 'centroid_fallback', 'bundled_screenshot', 'none'];

describe('an AI-estimated green can never read as surveyed truth', () => {
  it('HIGH CONFIDENCE IS UNREACHABLE with an estimated green — across every other input', () => {
    let worst = 0;
    for (const imagerySource of SOURCES) {
      for (const polygonCount of [0, 1, 2, 3, 4, 5, 12]) {
        for (const hasVision of [true, false]) {
          for (const hasGreenFrontBack of [true, false]) {
            const c = scoreConfidence({
              hasTee: true, hasGreen: true, hasGreenFrontBack,
              polygonCount, landmarkCount: 9, imagerySource, hasVision, estimated: true,
            });
            worst = Math.max(worst, c.overall);
            expect(c.overall).toBeLessThan(80);
            expect(c.geometry).toBeLessThanOrEqual(45);
          }
        }
      }
    }
    // The best an estimated hole can ever claim, with everything else perfect.
    expect(worst).toBeLessThan(80);
    expect(buildConfidenceLabel({ ...scoreConfidence({
      hasTee: true, hasGreen: true, hasGreenFrontBack: true,
      polygonCount: 12, landmarkCount: 9, imagerySource: 'mapbox', hasVision: true, estimated: true,
    }) }, 'mapbox', true, true)).not.toMatch(/High confidence/);
  });

  it('the SAME hole with real geometry CAN reach high confidence — so the cap is the estimate, not a broken scorer', () => {
    const real = scoreConfidence({
      hasTee: true, hasGreen: true, hasGreenFrontBack: true,
      polygonCount: 12, landmarkCount: 9, imagerySource: 'mapbox', hasVision: true, estimated: false,
    });
    expect(real.overall).toBeGreaterThanOrEqual(80);
    expect(real.geometry).toBe(100);
  });

  it('NAMES the estimate in the label, and never claims surveyed Tee/Green coords', () => {
    const c = scoreConfidence({
      hasTee: true, hasGreen: true, hasGreenFrontBack: true,
      polygonCount: 5, landmarkCount: 9, imagerySource: 'mapbox', hasVision: true, estimated: true,
    });
    const label = buildConfidenceLabel(c, 'mapbox', true, true);
    expect(label).toContain('AI-estimated green');
    // The two are mutually exclusive: claiming real coords beside an AI guess is the lie.
    expect(label).not.toContain('Tee/Green coords');
  });

  it('a real hole says Tee/Green coords and never mentions an AI estimate', () => {
    const c = scoreConfidence({
      hasTee: true, hasGreen: true, hasGreenFrontBack: true,
      polygonCount: 5, landmarkCount: 9, imagerySource: 'mapbox', hasVision: true, estimated: false,
    });
    const label = buildConfidenceLabel(c, 'mapbox', true, false);
    expect(label).toContain('Tee/Green coords');
    expect(label).not.toContain('AI-estimated');
  });

  it('missing geometry scores zero rather than inventing a baseline', () => {
    const none = scoreConfidence({
      hasTee: false, hasGreen: false, hasGreenFrontBack: false,
      polygonCount: 0, landmarkCount: 0, imagerySource: 'none', hasVision: false,
    });
    expect(none.geometry).toBe(0);
    expect(buildConfidenceLabel(none, 'none', false, false)).toMatch(/Unverified/);
  });
});
