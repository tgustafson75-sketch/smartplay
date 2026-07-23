/**
 * Local course image registration.
 *
 * Curated bundled hole screenshots for courses Tim has playtested. Bundler
 * needs literal require() calls — this file is the registration site.
 *
 * To add a new local course pack:
 *   1. Drop the assets at `assets/courses/<slug>/hole-01.jpg` … `hole-18.jpg`
 *   2. Add a new entry below: `lakes: { 1: require('...'), ... }`
 *   3. Add a name match in `getLocalHoleImage` that recognizes the course
 *
 * Empty maps (Lakes, Rancho California) are placeholders — until Tim drops
 * the JPGs, those courses fall through to Mapbox aerial.
 */

import type { ImageSourcePropType } from 'react-native';

// 2026-05-26 — Fix BJ: all 18 holes refreshed with 18Birdies versions
// (replacing prior Golfshot screenshots). Same caveats as Maplewood —
// baked-in 18B chrome (top stats bar, bottom Hole pill, floating
// yardage bubbles, "Green Maps" icon) needs cropping/masking before
// public release; the white tee→green line is intentionally kept
// as a yellow-dot calibration reference. File registration
// (hole-01.jpg through hole-18.jpg) is unchanged — same paths,
// same keys; the JPGs themselves were swapped at the bytes level.
export const PALMS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/palms/hole-01.jpg'),
  2:  require('../assets/courses/palms/hole-02.jpg'),
  3:  require('../assets/courses/palms/hole-03.jpg'),
  4:  require('../assets/courses/palms/hole-04.jpg'),
  5:  require('../assets/courses/palms/hole-05.jpg'),
  6:  require('../assets/courses/palms/hole-06.jpg'),
  7:  require('../assets/courses/palms/hole-07.jpg'),
  8:  require('../assets/courses/palms/hole-08.jpg'),
  9:  require('../assets/courses/palms/hole-09.jpg'),
  10: require('../assets/courses/palms/hole-10.jpg'),
  11: require('../assets/courses/palms/hole-11.jpg'),
  12: require('../assets/courses/palms/hole-12.jpg'),
  13: require('../assets/courses/palms/hole-13.jpg'),
  14: require('../assets/courses/palms/hole-14.jpg'),
  15: require('../assets/courses/palms/hole-15.jpg'),
  16: require('../assets/courses/palms/hole-16.jpg'),
  17: require('../assets/courses/palms/hole-17.jpg'),
  18: require('../assets/courses/palms/hole-18.jpg'),
};

// Menifee Lakes — Lakes course (Tim's home club's sister course to Palms).
// Imported from V3's menifee-lakes set, renamed lakes-h{n}.jpg → hole-{nn}.jpg.
export const LAKES_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/lakes/hole-01.jpg'),
  2:  require('../assets/courses/lakes/hole-02.jpg'),
  3:  require('../assets/courses/lakes/hole-03.jpg'),
  4:  require('../assets/courses/lakes/hole-04.jpg'),
  5:  require('../assets/courses/lakes/hole-05.jpg'),
  6:  require('../assets/courses/lakes/hole-06.jpg'),
  7:  require('../assets/courses/lakes/hole-07.jpg'),
  8:  require('../assets/courses/lakes/hole-08.jpg'),
  9:  require('../assets/courses/lakes/hole-09.jpg'),
  10: require('../assets/courses/lakes/hole-10.jpg'),
  11: require('../assets/courses/lakes/hole-11.jpg'),
  12: require('../assets/courses/lakes/hole-12.jpg'),
  13: require('../assets/courses/lakes/hole-13.jpg'),
  14: require('../assets/courses/lakes/hole-14.jpg'),
  15: require('../assets/courses/lakes/hole-15.jpg'),
  16: require('../assets/courses/lakes/hole-16.jpg'),
  17: require('../assets/courses/lakes/hole-17.jpg'),
  18: require('../assets/courses/lakes/hole-18.jpg'),
};

// Rancho California — imported from V3, renamed rancho-h{n}.jpg → hole-{nn}.jpg.
export const RANCHO_CALIFORNIA_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/rancho-california/hole-01.jpg'),
  2:  require('../assets/courses/rancho-california/hole-02.jpg'),
  3:  require('../assets/courses/rancho-california/hole-03.jpg'),
  4:  require('../assets/courses/rancho-california/hole-04.jpg'),
  5:  require('../assets/courses/rancho-california/hole-05.jpg'),
  6:  require('../assets/courses/rancho-california/hole-06.jpg'),
  7:  require('../assets/courses/rancho-california/hole-07.jpg'),
  8:  require('../assets/courses/rancho-california/hole-08.jpg'),
  9:  require('../assets/courses/rancho-california/hole-09.jpg'),
  10: require('../assets/courses/rancho-california/hole-10.jpg'),
  11: require('../assets/courses/rancho-california/hole-11.jpg'),
  12: require('../assets/courses/rancho-california/hole-12.jpg'),
  13: require('../assets/courses/rancho-california/hole-13.jpg'),
  14: require('../assets/courses/rancho-california/hole-14.jpg'),
  15: require('../assets/courses/rancho-california/hole-15.jpg'),
  16: require('../assets/courses/rancho-california/hole-16.jpg'),
  17: require('../assets/courses/rancho-california/hole-17.jpg'),
  18: require('../assets/courses/rancho-california/hole-18.jpg'),
};

// Phase BL — Crystal Springs Golf Course, Burlingame CA (18 holes).
export const CRYSTAL_SPRINGS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/crystal-springs/hole-01.jpg'),
  2:  require('../assets/courses/crystal-springs/hole-02.jpg'),
  3:  require('../assets/courses/crystal-springs/hole-03.jpg'),
  4:  require('../assets/courses/crystal-springs/hole-04.jpg'),
  5:  require('../assets/courses/crystal-springs/hole-05.jpg'),
  6:  require('../assets/courses/crystal-springs/hole-06.jpg'),
  7:  require('../assets/courses/crystal-springs/hole-07.jpg'),
  8:  require('../assets/courses/crystal-springs/hole-08.jpg'),
  9:  require('../assets/courses/crystal-springs/hole-09.jpg'),
  10: require('../assets/courses/crystal-springs/hole-10.jpg'),
  11: require('../assets/courses/crystal-springs/hole-11.jpg'),
  12: require('../assets/courses/crystal-springs/hole-12.jpg'),
  13: require('../assets/courses/crystal-springs/hole-13.jpg'),
  14: require('../assets/courses/crystal-springs/hole-14.jpg'),
  15: require('../assets/courses/crystal-springs/hole-15.jpg'),
  16: require('../assets/courses/crystal-springs/hole-16.jpg'),
  17: require('../assets/courses/crystal-springs/hole-17.jpg'),
  18: require('../assets/courses/crystal-springs/hole-18.jpg'),
};

// San Jose Municipal Golf Course (Bay Area, CA — Tim's home area while
// he's there over the next 3-6 months). All 18 holes bundled
// 2026-05-14 from Tim's IMG_6426–IMG_6443 photo set, sequentially
// mapped (6426→hole 1, 6443→hole 18).
export const SAN_JOSE_MUNI_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/san-jose-muni/hole-01.jpg'),
  2:  require('../assets/courses/san-jose-muni/hole-02.jpg'),
  3:  require('../assets/courses/san-jose-muni/hole-03.jpg'),
  4:  require('../assets/courses/san-jose-muni/hole-04.jpg'),
  5:  require('../assets/courses/san-jose-muni/hole-05.jpg'),
  6:  require('../assets/courses/san-jose-muni/hole-06.jpg'),
  7:  require('../assets/courses/san-jose-muni/hole-07.jpg'),
  8:  require('../assets/courses/san-jose-muni/hole-08.jpg'),
  9:  require('../assets/courses/san-jose-muni/hole-09.jpg'),
  10: require('../assets/courses/san-jose-muni/hole-10.jpg'),
  11: require('../assets/courses/san-jose-muni/hole-11.jpg'),
  12: require('../assets/courses/san-jose-muni/hole-12.jpg'),
  13: require('../assets/courses/san-jose-muni/hole-13.jpg'),
  14: require('../assets/courses/san-jose-muni/hole-14.jpg'),
  15: require('../assets/courses/san-jose-muni/hole-15.jpg'),
  16: require('../assets/courses/san-jose-muni/hole-16.jpg'),
  17: require('../assets/courses/san-jose-muni/hole-17.jpg'),
  18: require('../assets/courses/san-jose-muni/hole-18.jpg'),
};

// Sunnyvale Golf Course (Bay Area, CA — added 2026-05-16 because Tim
// is playing it tomorrow). All 18 holes bundled from Golfshot-app
// screenshots Tim captured: sequential filename timestamps
// (172038–172307 on 2026-04-18) mapped 1:1 to holes 1–18.
export const SUNNYVALE_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/sunnyvale/hole-01.jpg'),
  2:  require('../assets/courses/sunnyvale/hole-02.jpg'),
  3:  require('../assets/courses/sunnyvale/hole-03.jpg'),
  4:  require('../assets/courses/sunnyvale/hole-04.jpg'),
  5:  require('../assets/courses/sunnyvale/hole-05.jpg'),
  6:  require('../assets/courses/sunnyvale/hole-06.jpg'),
  7:  require('../assets/courses/sunnyvale/hole-07.jpg'),
  8:  require('../assets/courses/sunnyvale/hole-08.jpg'),
  9:  require('../assets/courses/sunnyvale/hole-09.jpg'),
  10: require('../assets/courses/sunnyvale/hole-10.jpg'),
  11: require('../assets/courses/sunnyvale/hole-11.jpg'),
  12: require('../assets/courses/sunnyvale/hole-12.jpg'),
  13: require('../assets/courses/sunnyvale/hole-13.jpg'),
  14: require('../assets/courses/sunnyvale/hole-14.jpg'),
  15: require('../assets/courses/sunnyvale/hole-15.jpg'),
  16: require('../assets/courses/sunnyvale/hole-16.jpg'),
  17: require('../assets/courses/sunnyvale/hole-17.jpg'),
  18: require('../assets/courses/sunnyvale/hole-18.jpg'),
};

// Phase BL — Mariners Point Golf Center, Burlingame CA (9 holes par 3).
export const MARINERS_POINT_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/mariners-point/hole-01.jpg'),
  2: require('../assets/courses/mariners-point/hole-02.jpg'),
  3: require('../assets/courses/mariners-point/hole-03.jpg'),
  4: require('../assets/courses/mariners-point/hole-04.jpg'),
  5: require('../assets/courses/mariners-point/hole-05.jpg'),
  6: require('../assets/courses/mariners-point/hole-06.jpg'),
  7: require('../assets/courses/mariners-point/hole-07.jpg'),
  8: require('../assets/courses/mariners-point/hole-08.jpg'),
  9: require('../assets/courses/mariners-point/hole-09.jpg'),
};

// 2026-06-04 — Maplewood + Pembroke Pines bundles removed. Both had
// raw Golfshot/18Birdies UI chrome that needs an IP-clean replacement
// pass before re-bundling. Until then they fall through to Mapbox
// satellite (same path as journey-at-pechanga).

// 2026-06-04 — Echo Hills Golf Course, Hemet CA (9-hole executive
// par 35). Tim's local rotation. Bundled from raw Golfshot Android
// screenshots (IMG 7635–7643, 1768x1976) via scripts/clean-course-
// images.py — crop (460,170,1768,1750) → 1308x1580. Removes the
// status bar, top ad banner, left "Hole / Back Edge / Green Center
// / Front Edge / Par / Get Pro!" sidebar, and bottom Holes/Preview/
// Track nav. Small residual chrome (info "i" top-right + pencil
// bottom-right corner) — acceptable for beta. Baked-in tee→green
// line + Green Center yardage bubble intentionally kept as
// SmartVision visual reference.
export const ECHO_HILLS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/echo-hills/hole-01.jpg'),
  2: require('../assets/courses/echo-hills/hole-02.jpg'),
  3: require('../assets/courses/echo-hills/hole-03.jpg'),
  4: require('../assets/courses/echo-hills/hole-04.jpg'),
  5: require('../assets/courses/echo-hills/hole-05.jpg'),
  6: require('../assets/courses/echo-hills/hole-06.jpg'),
  7: require('../assets/courses/echo-hills/hole-07.jpg'),
  8: require('../assets/courses/echo-hills/hole-08.jpg'),
  9: require('../assets/courses/echo-hills/hole-09.jpg'),
};

// 2026-05-28 — Westlake Country Club, Jackson NJ. Full 18-hole bundle
// from Tim's Green Maps Android screenshots (IMG 7502-7519 + 7527-7529,
// 1768x2208 / 1768x1976). Cropped to 1768x1450 via ffmpeg to match the
// Palms aesthetic: clean aerial, tee→green measurement line preserved,
// Green Maps "wind & slope" pill kept on the side, device chrome and
// Yds/Par/Handicap header bar removed.
//
// Per-hole quick reference (from the original capture headers):
//   01 par 4 416y    02 par 5 472y    03 par 3 146y
//   04 par 4 380y    05 par 4 432y    06 par 3 170y
//   07 par 4 366y    08 par 4 416y    09 par 4 333y
//   10 par 5 510y    11 par 4 374y    12 par 4 351y
//   13 par 3 198y    14 par 5 500y    15 par 4 379y
//   16 par 4 378y    17 par 3 144y    18 par 4 288y
// Total: par 71, ~6253y from this tee box.
export const GREENHILL_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/greenhill/hole-01.jpg'),
  2:  require('../assets/courses/greenhill/hole-02.jpg'),
  3:  require('../assets/courses/greenhill/hole-03.jpg'),
  4:  require('../assets/courses/greenhill/hole-04.jpg'),
  5:  require('../assets/courses/greenhill/hole-05.jpg'),
  6:  require('../assets/courses/greenhill/hole-06.jpg'),
  7:  require('../assets/courses/greenhill/hole-07.jpg'),
  8:  require('../assets/courses/greenhill/hole-08.jpg'),
  9:  require('../assets/courses/greenhill/hole-09.jpg'),
  10: require('../assets/courses/greenhill/hole-10.jpg'),
  11: require('../assets/courses/greenhill/hole-11.jpg'),
  12: require('../assets/courses/greenhill/hole-12.jpg'),
  13: require('../assets/courses/greenhill/hole-13.jpg'),
  14: require('../assets/courses/greenhill/hole-14.jpg'),
  15: require('../assets/courses/greenhill/hole-15.jpg'),
  16: require('../assets/courses/greenhill/hole-16.jpg'),
  17: require('../assets/courses/greenhill/hole-17.jpg'),
  18: require('../assets/courses/greenhill/hole-18.jpg'),
};

export const WESTLAKE_CC_NJ_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/westlake-cc-nj/hole-01.jpg'),
  2:  require('../assets/courses/westlake-cc-nj/hole-02.jpg'),
  3:  require('../assets/courses/westlake-cc-nj/hole-03.jpg'),
  4:  require('../assets/courses/westlake-cc-nj/hole-04.jpg'),
  5:  require('../assets/courses/westlake-cc-nj/hole-05.jpg'),
  6:  require('../assets/courses/westlake-cc-nj/hole-06.jpg'),
  7:  require('../assets/courses/westlake-cc-nj/hole-07.jpg'),
  8:  require('../assets/courses/westlake-cc-nj/hole-08.jpg'),
  9:  require('../assets/courses/westlake-cc-nj/hole-09.jpg'),
  10: require('../assets/courses/westlake-cc-nj/hole-10.jpg'),
  11: require('../assets/courses/westlake-cc-nj/hole-11.jpg'),
  12: require('../assets/courses/westlake-cc-nj/hole-12.jpg'),
  13: require('../assets/courses/westlake-cc-nj/hole-13.jpg'),
  14: require('../assets/courses/westlake-cc-nj/hole-14.jpg'),
  15: require('../assets/courses/westlake-cc-nj/hole-15.jpg'),
  16: require('../assets/courses/westlake-cc-nj/hole-16.jpg'),
  17: require('../assets/courses/westlake-cc-nj/hole-17.jpg'),
  18: require('../assets/courses/westlake-cc-nj/hole-18.jpg'),
};

export type LocalCourseSlug =
  | 'palms' | 'lakes' | 'rancho-california' | 'crystal-springs'
  | 'mariners-point' | 'san-jose-muni' | 'sunnyvale'
  // 2026-05-26 — Journey at Pechanga (Temecula CA). Randy Chang's home
  // course; testing opportunity if Tim or Randy plays it. Hole geometry
  // is available via golfcourseapi + Mapbox satellite imagery so we
  // skip bundled hole-* images for now (the Partial<Record<>> on
  // LOCAL_COURSE_IMAGES lets a slug exist as a centroid-only entry).
  | 'journey-at-pechanga'
  // 2026-05-28 — Westlake Country Club, Jackson NJ. First East Coast
  // course Tim has personally captured. All 18 holes bundled from
  // Green Maps screenshots; geometry comes from golfcourseapi at
  // runtime (no per-hole tee/green coords baked into data/courses.ts).
  | 'westlake-cc-nj'
  // 2026-06-04 — Echo Hills Golf Course, Hemet CA. 9-hole executive
  // course in Tim's local rotation. All 9 holes bundled.
  | 'echo-hills'
  // 2026-06-21 — Greenhill Golf Course, Worcester MA. Full 18-hole bundle.
  | 'greenhill'
  // 2026-07-06 — Spessard Holland GC, Melbourne Beach FL (Tim's Florida trip).
  | 'spessard-holland'
  // 2026-07-06 — Webster/Dudley (MA) 9-hole, from Tim's Golf Pad hole-views.
  | 'webster-dudley'
  // 2026-07-18 — Trump National Doral (Gold course), Miami FL + Pembroke Lakes CC,
  // Pembroke Pines FL. 18 holes each, cropped from Tim's Golf Pad hole-view captures.
  | 'doral-gold'
  | 'pembroke-pines'
  // 2026-07-23 — Highland Links (Truro MA, Dad's course), Miccosukee G&CC + Killian Greens
  // (Miami FL), Redlands CC (CA). 18 aerials each, cropped from the GPS-app hole-view
  // screenshots that anchored these courses — the SEAMLESS BACKUP when the Mapbox satellite
  // tile doesn't render (so SmartVision never shows a blank green screen).
  | 'highland-links'
  | 'miccosukee'
  | 'killian-greens'
  | 'redlands-cc';

// 2026-07-06 — Spessard Holland GC, Melbourne Beach FL. Tim's Florida testing
// course. 18 cleaned aerials (cropped + inpainted from his hole-view captures).
export const SPESSARD_HOLLAND_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/spessard-holland/hole-01.jpg'),
  2: require('../assets/courses/spessard-holland/hole-02.jpg'),
  3: require('../assets/courses/spessard-holland/hole-03.jpg'),
  4: require('../assets/courses/spessard-holland/hole-04.jpg'),
  5: require('../assets/courses/spessard-holland/hole-05.jpg'),
  6: require('../assets/courses/spessard-holland/hole-06.jpg'),
  7: require('../assets/courses/spessard-holland/hole-07.jpg'),
  8: require('../assets/courses/spessard-holland/hole-08.jpg'),
  9: require('../assets/courses/spessard-holland/hole-09.jpg'),
  10: require('../assets/courses/spessard-holland/hole-10.jpg'),
  11: require('../assets/courses/spessard-holland/hole-11.jpg'),
  12: require('../assets/courses/spessard-holland/hole-12.jpg'),
  13: require('../assets/courses/spessard-holland/hole-13.jpg'),
  14: require('../assets/courses/spessard-holland/hole-14.jpg'),
  15: require('../assets/courses/spessard-holland/hole-15.jpg'),
  16: require('../assets/courses/spessard-holland/hole-16.jpg'),
  17: require('../assets/courses/spessard-holland/hole-17.jpg'),
  18: require('../assets/courses/spessard-holland/hole-18.jpg'),
};

// 2026-07-06 — Webster/Dudley (MA). Cropped aerials from Tim's Golf Pad hole-view
// screenshots (2216-2224 → holes 1-9). 2026-07-07 — reprocessed (tighter crop +
// unfade + vivid color) and extended to 18: the course plays 18 as the NINE TWICE
// (scorecard-confirmed), so holes 10-18 show the same aerials as 1-9.
const WD = {
  1: require('../assets/courses/webster-dudley/hole-01.jpg'),
  2: require('../assets/courses/webster-dudley/hole-02.jpg'),
  3: require('../assets/courses/webster-dudley/hole-03.jpg'),
  4: require('../assets/courses/webster-dudley/hole-04.jpg'),
  5: require('../assets/courses/webster-dudley/hole-05.jpg'),
  6: require('../assets/courses/webster-dudley/hole-06.jpg'),
  7: require('../assets/courses/webster-dudley/hole-07.jpg'),
  8: require('../assets/courses/webster-dudley/hole-08.jpg'),
  9: require('../assets/courses/webster-dudley/hole-09.jpg'),
} as Record<number, ImageSourcePropType>;
export const WEBSTER_DUDLEY_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  ...WD,
  10: WD[1], 11: WD[2], 12: WD[3], 13: WD[4], 14: WD[5],
  15: WD[6], 16: WD[7], 17: WD[8], 18: WD[9],
};

// 2026-07-18 — Trump National Doral, GOLD course (Miami FL). 18 holes, cropped from Tim's
// Golf Pad hole-view captures (aerial + flight line + green distance).
export const DORAL_GOLD_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/doral-gold/hole-01.jpg'),
  2:  require('../assets/courses/doral-gold/hole-02.jpg'),
  3:  require('../assets/courses/doral-gold/hole-03.jpg'),
  4:  require('../assets/courses/doral-gold/hole-04.jpg'),
  5:  require('../assets/courses/doral-gold/hole-05.jpg'),
  6:  require('../assets/courses/doral-gold/hole-06.jpg'),
  7:  require('../assets/courses/doral-gold/hole-07.jpg'),
  8:  require('../assets/courses/doral-gold/hole-08.jpg'),
  9:  require('../assets/courses/doral-gold/hole-09.jpg'),
  10: require('../assets/courses/doral-gold/hole-10.jpg'),
  11: require('../assets/courses/doral-gold/hole-11.jpg'),
  12: require('../assets/courses/doral-gold/hole-12.jpg'),
  13: require('../assets/courses/doral-gold/hole-13.jpg'),
  14: require('../assets/courses/doral-gold/hole-14.jpg'),
  15: require('../assets/courses/doral-gold/hole-15.jpg'),
  16: require('../assets/courses/doral-gold/hole-16.jpg'),
  17: require('../assets/courses/doral-gold/hole-17.jpg'),
  18: require('../assets/courses/doral-gold/hole-18.jpg'),
};

// 2026-07-18 — Pembroke Lakes Country Club (Pembroke Pines FL). 18 holes, same capture source.
export const PEMBROKE_PINES_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/pembroke-pines/hole-01.jpg'),
  2:  require('../assets/courses/pembroke-pines/hole-02.jpg'),
  3:  require('../assets/courses/pembroke-pines/hole-03.jpg'),
  4:  require('../assets/courses/pembroke-pines/hole-04.jpg'),
  5:  require('../assets/courses/pembroke-pines/hole-05.jpg'),
  6:  require('../assets/courses/pembroke-pines/hole-06.jpg'),
  7:  require('../assets/courses/pembroke-pines/hole-07.jpg'),
  8:  require('../assets/courses/pembroke-pines/hole-08.jpg'),
  9:  require('../assets/courses/pembroke-pines/hole-09.jpg'),
  10: require('../assets/courses/pembroke-pines/hole-10.jpg'),
  11: require('../assets/courses/pembroke-pines/hole-11.jpg'),
  12: require('../assets/courses/pembroke-pines/hole-12.jpg'),
  13: require('../assets/courses/pembroke-pines/hole-13.jpg'),
  14: require('../assets/courses/pembroke-pines/hole-14.jpg'),
  15: require('../assets/courses/pembroke-pines/hole-15.jpg'),
  16: require('../assets/courses/pembroke-pines/hole-16.jpg'),
  17: require('../assets/courses/pembroke-pines/hole-17.jpg'),
  18: require('../assets/courses/pembroke-pines/hole-18.jpg'),
};

// 2026-07-23 — Highland / Miccosukee / Killian / Redlands: 18 cropped aerials each (chrome-free,
// from the GPS-app hole-view screenshots). Bundled as the seamless backup so SmartVision always
// has an image even when the Mapbox satellite tile fails.
export const HIGHLAND_LINKS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/highland-links/hole-01.jpg'),
  2: require('../assets/courses/highland-links/hole-02.jpg'),
  3: require('../assets/courses/highland-links/hole-03.jpg'),
  4: require('../assets/courses/highland-links/hole-04.jpg'),
  5: require('../assets/courses/highland-links/hole-05.jpg'),
  6: require('../assets/courses/highland-links/hole-06.jpg'),
  7: require('../assets/courses/highland-links/hole-07.jpg'),
  8: require('../assets/courses/highland-links/hole-08.jpg'),
  9: require('../assets/courses/highland-links/hole-09.jpg'),
  10: require('../assets/courses/highland-links/hole-10.jpg'),
  11: require('../assets/courses/highland-links/hole-11.jpg'),
  12: require('../assets/courses/highland-links/hole-12.jpg'),
  13: require('../assets/courses/highland-links/hole-13.jpg'),
  14: require('../assets/courses/highland-links/hole-14.jpg'),
  15: require('../assets/courses/highland-links/hole-15.jpg'),
  16: require('../assets/courses/highland-links/hole-16.jpg'),
  17: require('../assets/courses/highland-links/hole-17.jpg'),
  18: require('../assets/courses/highland-links/hole-18.jpg'),
};
export const MICCOSUKEE_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/miccosukee/hole-01.jpg'),
  2: require('../assets/courses/miccosukee/hole-02.jpg'),
  3: require('../assets/courses/miccosukee/hole-03.jpg'),
  4: require('../assets/courses/miccosukee/hole-04.jpg'),
  5: require('../assets/courses/miccosukee/hole-05.jpg'),
  6: require('../assets/courses/miccosukee/hole-06.jpg'),
  7: require('../assets/courses/miccosukee/hole-07.jpg'),
  8: require('../assets/courses/miccosukee/hole-08.jpg'),
  9: require('../assets/courses/miccosukee/hole-09.jpg'),
  10: require('../assets/courses/miccosukee/hole-10.jpg'),
  11: require('../assets/courses/miccosukee/hole-11.jpg'),
  12: require('../assets/courses/miccosukee/hole-12.jpg'),
  13: require('../assets/courses/miccosukee/hole-13.jpg'),
  14: require('../assets/courses/miccosukee/hole-14.jpg'),
  15: require('../assets/courses/miccosukee/hole-15.jpg'),
  16: require('../assets/courses/miccosukee/hole-16.jpg'),
  17: require('../assets/courses/miccosukee/hole-17.jpg'),
  18: require('../assets/courses/miccosukee/hole-18.jpg'),
};
export const KILLIAN_GREENS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/killian-greens/hole-01.jpg'),
  2: require('../assets/courses/killian-greens/hole-02.jpg'),
  3: require('../assets/courses/killian-greens/hole-03.jpg'),
  4: require('../assets/courses/killian-greens/hole-04.jpg'),
  5: require('../assets/courses/killian-greens/hole-05.jpg'),
  6: require('../assets/courses/killian-greens/hole-06.jpg'),
  7: require('../assets/courses/killian-greens/hole-07.jpg'),
  8: require('../assets/courses/killian-greens/hole-08.jpg'),
  9: require('../assets/courses/killian-greens/hole-09.jpg'),
  10: require('../assets/courses/killian-greens/hole-10.jpg'),
  11: require('../assets/courses/killian-greens/hole-11.jpg'),
  12: require('../assets/courses/killian-greens/hole-12.jpg'),
  13: require('../assets/courses/killian-greens/hole-13.jpg'),
  14: require('../assets/courses/killian-greens/hole-14.jpg'),
  15: require('../assets/courses/killian-greens/hole-15.jpg'),
  16: require('../assets/courses/killian-greens/hole-16.jpg'),
  17: require('../assets/courses/killian-greens/hole-17.jpg'),
  18: require('../assets/courses/killian-greens/hole-18.jpg'),
};
export const REDLANDS_CC_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('../assets/courses/redlands-cc/hole-01.jpg'),
  2: require('../assets/courses/redlands-cc/hole-02.jpg'),
  3: require('../assets/courses/redlands-cc/hole-03.jpg'),
  4: require('../assets/courses/redlands-cc/hole-04.jpg'),
  5: require('../assets/courses/redlands-cc/hole-05.jpg'),
  6: require('../assets/courses/redlands-cc/hole-06.jpg'),
  7: require('../assets/courses/redlands-cc/hole-07.jpg'),
  8: require('../assets/courses/redlands-cc/hole-08.jpg'),
  9: require('../assets/courses/redlands-cc/hole-09.jpg'),
  10: require('../assets/courses/redlands-cc/hole-10.jpg'),
  11: require('../assets/courses/redlands-cc/hole-11.jpg'),
  12: require('../assets/courses/redlands-cc/hole-12.jpg'),
  13: require('../assets/courses/redlands-cc/hole-13.jpg'),
  14: require('../assets/courses/redlands-cc/hole-14.jpg'),
  15: require('../assets/courses/redlands-cc/hole-15.jpg'),
  16: require('../assets/courses/redlands-cc/hole-16.jpg'),
  17: require('../assets/courses/redlands-cc/hole-17.jpg'),
  18: require('../assets/courses/redlands-cc/hole-18.jpg'),
};

export const LOCAL_COURSE_IMAGES: Partial<Record<LocalCourseSlug, Record<number, ImageSourcePropType>>> = {
  'highland-links': HIGHLAND_LINKS_HOLE_IMAGES,
  'miccosukee': MICCOSUKEE_HOLE_IMAGES,
  'killian-greens': KILLIAN_GREENS_HOLE_IMAGES,
  'redlands-cc': REDLANDS_CC_HOLE_IMAGES,
  'webster-dudley': WEBSTER_DUDLEY_HOLE_IMAGES,
  'doral-gold': DORAL_GOLD_HOLE_IMAGES,
  'pembroke-pines': PEMBROKE_PINES_HOLE_IMAGES,
  'palms': PALMS_HOLE_IMAGES,
  'lakes': LAKES_HOLE_IMAGES,
  'rancho-california': RANCHO_CALIFORNIA_HOLE_IMAGES,
  'crystal-springs': CRYSTAL_SPRINGS_HOLE_IMAGES,
  'mariners-point': MARINERS_POINT_HOLE_IMAGES,
  'san-jose-muni': SAN_JOSE_MUNI_HOLE_IMAGES,
  'sunnyvale': SUNNYVALE_HOLE_IMAGES,
  'westlake-cc-nj': WESTLAKE_CC_NJ_HOLE_IMAGES,
  'echo-hills': ECHO_HILLS_HOLE_IMAGES,
  'greenhill': GREENHILL_HOLE_IMAGES,
  'spessard-holland': SPESSARD_HOLLAND_HOLE_IMAGES,
  // 'journey-at-pechanga' intentionally omitted — hole imagery comes
  // from Mapbox satellite live; getLocalHoleImage() returns null which
  // the SmartVision render path already handles (falls through to the
  // dynamic Mapbox tile).
};

/**
 * 2026-05-16 — Centroid lat/lng for each LOCAL_COURSES entry. Used as
 * the input to the Mapbox centered-imagery fallback for courses that
 * don't have per-hole tee/green geometry. Mirrors the lat/lng values
 * declared in app/(tabs)/play.tsx LOCAL_COURSES so play-tab thumbnails
 * and SmartVision hole previews stay in lockstep.
 */
// 2026-05-17 — Centroids re-derived from OpenStreetMap golf-course
// feature centers (Overpass API). The previous values were copy-pasted
// from rough Google Maps lookups and were off by 2.4–5 km on four of
// the seven courses, which prevented the OSM Overpass green fallback
// from ever finding the right course. Verified each by running an
// `around:1500m, golf=green` query and confirming a non-zero hit
// before committing the coordinate.
//   Sunnyvale:        was (37.3777, -122.0357) → 2.4 km off
//   San Jose Muni:    was (37.3670, -121.9310) → 4.5 km off (wrong city)
//   Mariners Point:   was (37.5480, -122.2750) → 2.8 km off
//   Crystal Springs:  was (37.5120, -122.3580) → 5.0 km off
// Palms, Lakes, Rancho left unchanged — already accurate vs OSM.
export const LOCAL_COURSE_CENTROIDS: Record<LocalCourseSlug, { lat: number; lng: number }> = {
  'highland-links':   { lat: 42.0366308, lng: -70.0589550 },
  'miccosukee':       { lat: 25.7113237, lng: -80.4219701 },
  'killian-greens':   { lat: 25.6747540, lng: -80.3600897 },
  'redlands-cc':      { lat: 34.0250333, lng: -117.1514339 },
  'palms':            { lat: 33.6953922, lng: -117.1504551 },
  'lakes':            { lat: 33.6913348, lng: -117.1573364 },
  'rancho-california':{ lat: 33.4910,    lng: -117.1390 },
  'crystal-springs':  { lat: 37.5560947, lng: -122.3829982 },
  'mariners-point':   { lat: 37.5731586, lng: -122.2823681 },
  'san-jose-muni':    { lat: 37.3771789, lng: -121.8881051 },
  'sunnyvale':        { lat: 37.3983857, lng: -122.0417245 },
  // 2026-06-04 — Echo Hills Golf Course, Hemet CA. Approximate
  // centroid from the Hemet-area property landmark; refine on-site
  // via Mark Location when Tim plays there.
  'echo-hills':       { lat: 33.7475,    lng: -116.9719 },
  // 2026-07-06 — Spessard Holland (golfcourseapi id 30168; matches OSM greens).
  'spessard-holland': { lat: 28.04947,   lng: -80.55063 },
  // 2026-07-06 — Webster/Dudley (MA) 9-hole. Approx town-center; refine on-site
  // via Mark Location (hole GPS wasn't in the screenshots).
  'webster-dudley':   { lat: 42.0479,    lng: -71.9048 },
  // 2026-05-26 — Journey at Pechanga Resort, Temecula CA.
  // Approximate centroid from Pechanga Resort & Casino landmark
  // (45100 Pechanga Pkwy). Refine on-site via Mark Location once
  // Tim or Randy visits — the 800m detect radius is generous enough
  // to catch a parking-lot arrival even with this rough lat/lng.
  'journey-at-pechanga': { lat: 33.4691, lng: -117.0744 },
  // 2026-05-28 — Westlake Country Club, 1 Westlake Blvd, Jackson NJ
  // 08527. Approximate centroid from the property landmark; refine
  // on-site via Mark Location when Tim plays there. The 800m detect
  // radius covers parking-lot + clubhouse arrival.
  'westlake-cc-nj':   { lat: 40.0828,    lng: -74.3196 },
  // 2026-06-21 — Greenhill Golf Course, Worcester MA.
  'greenhill':        { lat: 42.2677,    lng: -71.8562 },
  // 2026-07-18 — Trump National Doral (Gold), Miami FL (golfcourseapi id 29427).
  'doral-gold':       { lat: 25.812008,  lng: -80.3377 },
  // 2026-07-18 — Pembroke Lakes CC, Pembroke Pines FL (golfcourseapi id 29669).
  'pembroke-pines':   { lat: 26.019337,  lng: -80.2868 },
};

/**
 * Resolve a course name to a LOCAL_COURSE_CENTROIDS key. Mirrors the
 * substring-matching logic in getLocalHoleImage so consumers can ask
 * either function from the same `courseName` value.
 */
export function getLocalCourseSlug(courseName: string | null): LocalCourseSlug | null {
  if (!courseName) return null;
  const c = courseName.toLowerCase();
  if (c.includes('crystal') && c.includes('spring')) return 'crystal-springs';
  if (c.includes('mariner')) return 'mariners-point';
  // 2026-07-18 — Doral + Pembroke. Pembroke MUST precede the generic 'lakes' match below,
  // since the course is "Pembroke LAKES" and would otherwise resolve to the Menifee 'lakes'.
  if (c.includes('doral')) return 'doral-gold';
  if (c.includes('pembroke')) return 'pembroke-pines';
  if (c.includes('palms')) return 'palms';
  if (c.includes('lakes') && !c.includes('palms')) return 'lakes';
  if (c.includes('rancho')) return 'rancho-california';
  if (c.includes('san jose')) return 'san-jose-muni';
  if (c.includes('sunnyvale')) return 'sunnyvale';
  // 2026-06-04 — Echo Hills, Hemet CA. Short substring "echo" is
  // distinctive enough for the local courses we bundle.
  if (c.includes('echo')) return 'echo-hills';
  // 2026-05-26 — Journey at Pechanga matches "pechanga", "journey",
  // or "journey at pechanga" so voice ("I'm at Pechanga", "open
  // Journey") and golfcourseapi search results both resolve.
  if (c.includes('pechanga') || (c.includes('journey') && c.includes('pechanga'))) return 'journey-at-pechanga';
  // 2026-05-28 — Westlake CC (Jackson NJ). Substring match on
  // "westlake" alone is too broad — there are multiple Westlake
  // country clubs / golf courses across the US. Disambiguate by
  // requiring either an explicit "jackson" / "nj" hint OR voice
  // "open westlake" while the GPS-derived course context already
  // pegs us to the NJ property.
  if (c.includes('westlake') && (c.includes('jackson') || c.includes('nj') || c.includes('new jersey'))) return 'westlake-cc-nj';
  // Voice/UI lookup: bare "westlake" resolves here too (single bundled
  // Westlake property today; revisit if we add a sibling).
  if (c.includes('westlake')) return 'westlake-cc-nj';
  // 2026-06-21 — Greenhill Golf Course, Worcester MA.
  if (c.includes('greenhill')) return 'greenhill';
  // 2026-07-07 — the two courses added from SmartVision screenshots. Name-lookup
  // parity so voice ("I'm at Spessard", "open Dudley Hill") + homeCourse matching
  // resolve to bundled imagery/centroid, not just the `local:` id path.
  if (c.includes('spessard') || c.includes('holland')) return 'spessard-holland';
  if (c.includes('webster') || c.includes('dudley')) return 'webster-dudley';
  return null;
}

/**
 * Resolve a course name to its bundled hole image, if available.
 *
 * 2026-05-16 update: San Jose Muni + Sunnyvale ARE matched again now
 * that their JPGs were programmatically cropped (Python/PIL) to remove
 * the Golfshot yardage UI, "Get Pro!" banner, Android status bars, and
 * info/edit buttons. What remains is the actual per-hole aerial strip
 * with tee at bottom, green at top, and a baked-in green-center
 * yardage label. Net result: ~24MB asset-bundle reduction PLUS the
 * imagery is finally usable.
 */
export function getLocalHoleImage(courseName: string | null, holeNumber: number): ImageSourcePropType | null {
  if (!courseName) return null;
  const c = courseName.toLowerCase();
  if (c.includes('crystal') && c.includes('spring')) return CRYSTAL_SPRINGS_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('mariner')) return MARINERS_POINT_HOLE_IMAGES[holeNumber] ?? null;
  // 2026-07-18 — Doral + Pembroke. Pembroke precedes the 'lakes' match (course is "Pembroke Lakes").
  if (c.includes('doral')) return DORAL_GOLD_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('pembroke')) return PEMBROKE_PINES_HOLE_IMAGES[holeNumber] ?? null;
  // "palms" check must follow "lakes" handling — Tim's home-course label
  // is often "Menifee Lakes — Palms" which contains both words. Without
  // anchoring on "palms" appearing in the suffix, a Crystal Springs round
  // whose courseName falls through to homeCourse would be substring-
  // matched as palms and render the wrong imagery.
  if (c.includes('lakes') && !c.includes('palms')) return LAKES_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('palms')) return PALMS_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('rancho')) return RANCHO_CALIFORNIA_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('san jose')) return SAN_JOSE_MUNI_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('sunnyvale')) return SUNNYVALE_HOLE_IMAGES[holeNumber] ?? null;
  // 2026-06-04 — Echo Hills, Hemet CA.
  if (c.includes('echo')) return ECHO_HILLS_HOLE_IMAGES[holeNumber] ?? null;
  // 2026-05-28 — Westlake CC, Jackson NJ. Match on "westlake" — single
  // bundled Westlake property today, so the bare substring is enough.
  // Revisit if a sibling Westlake course gets bundled.
  if (c.includes('westlake')) return WESTLAKE_CC_NJ_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('greenhill')) return GREENHILL_HOLE_IMAGES[holeNumber] ?? null;
  return null;
}

/**
 * 2026-05-17 — Canonical courseId-keyed hole image lookup. Preferred
 * over getLocalHoleImage(courseName, ...) wherever the caller knows the
 * `local:<slug>` id, because substring-matching against a free-text
 * courseName is fragile (e.g. a Crystal Springs round whose
 * courseName fell through to the user's "Menifee Lakes — Palms" home
 * course would be matched as Palms and render the wrong hole).
 * Returns null when the slug isn't a known local course or the hole
 * number is out of range.
 */
export function getLocalHoleImageById(
  courseId: string | null | undefined,
  holeNumber: number,
): ImageSourcePropType | null {
  if (!courseId || !courseId.startsWith('local:')) return null;
  const slug = courseId.slice('local:'.length) as LocalCourseSlug;
  const set = LOCAL_COURSE_IMAGES[slug];
  return set?.[holeNumber] ?? null;
}

/**
 * Default preview image used by SmartVision when no round is active and
 * no course context exists yet. Returns null — callers should render
 * an explicit "pick a course" empty state rather than fall back to a
 * specific course's imagery (which previously was Palms hole 1; that
 * leaked Palms screenshots into non-Palms contexts).
 */
export function getDefaultPreviewImage(): ImageSourcePropType | null {
  return null;
}
