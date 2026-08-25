/**
 * 2026-08-25 — EMPTIED. These were screenshots taken from 18Birdies / Golfshot, shipped in a
 * commercial app. The registry survives so every importer keeps compiling; an empty map means
 * callers fall through to licensed Mapbox satellite, which is the designed fallback and was already
 * the behaviour for the packs removed in June for this same reason.
 */
const PALMS_IMAGES: Record<number, ReturnType<typeof require>> = {};

export default PALMS_IMAGES;
