/**
 * 2026-08-10 — image-asset stub for the LOGIC test project.
 *
 * React Native resolves `require('…/hole-01.jpg')` to an opaque numeric asset id at bundle time.
 * Plain node has no such resolver, so ts-jest handed the raw JPEG bytes to the TypeScript parser
 * and every module that transitively touched bundled imagery threw "Invalid or unexpected token".
 *
 * That made a large slice of the app UNTESTABLE rather than merely untested: services/
 * courseGeometryService, store/roundStore, services/intents/logScoreHandler and everything
 * importing them. Two of the bugs fixed today (the "par with two putts" eagle, and the cache
 * accepting an empty course over a good one) lived in exactly that shadow — behind an import of an
 * image, in code no test could reach. Stubbing the asset is what lets those regressions be locked.
 *
 * Returns a stable number, matching what the RN asset registry hands back.
 */
module.exports = 1;
