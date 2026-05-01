/**
 * Coach role — recap-time, past-tense, reflective.
 *
 * The Coach layer operates on rounds and weeks. It diagnoses patterns, dispersion,
 * weak clubs, and course-management leaks. Voice in Coach register is reflective
 * and pattern-grounded.
 *
 * This module re-exports services and surfaces consumed by recap and pattern
 * analysis. Adding a service to the Coach role: re-export it here and tag it
 * under the Coach row of the Pillar × Mode matrix in services/README.md.
 *
 * No functional impact on the running app.
 */

export { generateRecap } from '../recapGenerator';
export { generatePatternInsights } from '../patternDetection';
export { computeRecapHero } from '../recapHero';
export { buildNarrationScript } from '../recapNarration';

// Coach-mode shot map: HoleShotMap is a UI surface (components/recap/HoleShotMap.tsx).
// Re-exporting the geometry service it consumes keeps the Coach surface's data
// dependencies legible from this hub.
export { fetchCourseGeometry, getCachedGeometry, getHoleGeometry } from '../courseGeometryService';
export type { CourseGeometry, HoleGeometry } from '../courseGeometryService';

export const COACH_ROLE_ID = 'coach' as const;
