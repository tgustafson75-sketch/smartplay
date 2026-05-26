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

// 2026-05-24 — Maplewood Golf Club, Lunenburg MA (9 holes). Bundled for
// the 2026 Hayes Open. Tim playing Friday + Saturday of Memorial Day
// weekend — day-to-day GPS + functionality validation opportunity.
// Cropped from Golfshot Android screenshots (IMG 7274–7282, 1768x2208)
// via sips: 820,300 → 640x1500. Removes status bar, ad strip, left
// stats column, "Get Pro!" bar, and bottom Holes/Preview/Track nav so
// only the hole map remains (Lakes/Palms aesthetic).
// 2026-05-26 — Fix BH: Maplewood Golf Club is an 18-hole course in
// Bethlehem, NH (also known locally as "Settlers Crossing Golf Course"
// per Tim's brother DJ). Course has a unique hole 16 par 6. Holes
// 1-4 + 6-18 sourced from 18Birdies screenshots (1768x2208 portrait,
// ~2MB each) for beta validation — IP-clean replacement required
// before public release. Hole 5 pending; missing entries fall
// through to Mapbox aerial fallback automatically.
//
// NOTE: 18B screenshots carry baked-in UI chrome (top stats bar,
// bottom Hole/Enter Score pill, floating yardage bubbles, "Green
// Maps" icon) that should be cropped/masked before public release.
// The white tee→green line baked into each image is intentionally
// kept — it's a perfect visual reference for where SmartVision's
// interactive measuring tool (yellow target dot + F/M/B yardage)
// should sit on each hole.
export const MAPLEWOOD_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
  1:  require('../assets/courses/maplewood/hole-01.jpg'),
  2:  require('../assets/courses/maplewood/hole-02.jpg'),
  3:  require('../assets/courses/maplewood/hole-03.jpg'),
  4:  require('../assets/courses/maplewood/hole-04.jpg'),
  5:  require('../assets/courses/maplewood/hole-05.jpg'),
  6:  require('../assets/courses/maplewood/hole-06.jpg'),
  7:  require('../assets/courses/maplewood/hole-07.jpg'),
  8:  require('../assets/courses/maplewood/hole-08.jpg'),
  9:  require('../assets/courses/maplewood/hole-09.jpg'),
  10: require('../assets/courses/maplewood/hole-10.jpg'),
  11: require('../assets/courses/maplewood/hole-11.jpg'),
  12: require('../assets/courses/maplewood/hole-12.jpg'),
  13: require('../assets/courses/maplewood/hole-13.jpg'),
  14: require('../assets/courses/maplewood/hole-14.jpg'),
  15: require('../assets/courses/maplewood/hole-15.jpg'),
  16: require('../assets/courses/maplewood/hole-16.jpg'),
  17: require('../assets/courses/maplewood/hole-17.jpg'),
  18: require('../assets/courses/maplewood/hole-18.jpg'),
};

// 2026-05-24 — Pembroke Pines Country Club, Pembroke NH (18 holes).
// Bundled for the 2026 Hayes Open. Tim playing Sunday before Memorial
// Day. Cropped from Golfshot Android screenshots (IMG 7283–7300,
// 1768x2208) via sips with same params as Maplewood.
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

export type LocalCourseSlug = 'palms' | 'lakes' | 'rancho-california' | 'crystal-springs' | 'mariners-point' | 'san-jose-muni' | 'sunnyvale' | 'maplewood' | 'pembroke-pines';

export const LOCAL_COURSE_IMAGES: Record<LocalCourseSlug, Record<number, ImageSourcePropType>> = {
  'palms': PALMS_HOLE_IMAGES,
  'lakes': LAKES_HOLE_IMAGES,
  'rancho-california': RANCHO_CALIFORNIA_HOLE_IMAGES,
  'crystal-springs': CRYSTAL_SPRINGS_HOLE_IMAGES,
  'mariners-point': MARINERS_POINT_HOLE_IMAGES,
  'san-jose-muni': SAN_JOSE_MUNI_HOLE_IMAGES,
  'sunnyvale': SUNNYVALE_HOLE_IMAGES,
  'maplewood': MAPLEWOOD_HOLE_IMAGES,
  'pembroke-pines': PEMBROKE_PINES_HOLE_IMAGES,
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
  'palms':            { lat: 33.6953922, lng: -117.1504551 },
  'lakes':            { lat: 33.6913348, lng: -117.1573364 },
  'rancho-california':{ lat: 33.4910,    lng: -117.1390 },
  'crystal-springs':  { lat: 37.5560947, lng: -122.3829982 },
  'mariners-point':   { lat: 37.5731586, lng: -122.2823681 },
  'san-jose-muni':    { lat: 37.3771789, lng: -121.8881051 },
  'sunnyvale':        { lat: 37.3983857, lng: -122.0417245 },
  // 2026-05-24 — Hayes Open courses. Approximate centroids from
  // public records; refine on-site via OSM Overpass once Tim has
  // walked the property (same correction the other 4 courses got).
  // 2026-05-26 — Fix BG: Maplewood Golf Club is in Bethlehem, NH
  // (NOT Maplewood, MA — Tim's correction). Centroid bumped from
  // (42.5965, -71.7253) to Bethlehem-area (~44.282, -71.683). Will
  // refine to true property centroid via OSM Overpass when verified
  // on-site.
  'maplewood':        { lat: 44.282,     lng: -71.683 },
  'pembroke-pines':   { lat: 43.1417,    lng: -71.4544 },
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
  if (c.includes('palms')) return 'palms';
  if (c.includes('lakes') && !c.includes('palms')) return 'lakes';
  if (c.includes('rancho')) return 'rancho-california';
  if (c.includes('san jose')) return 'san-jose-muni';
  if (c.includes('sunnyvale')) return 'sunnyvale';
  if (c.includes('pembroke')) return 'pembroke-pines';
  // 2026-05-26 — Fix BH: "Settlers Crossing Golf Course" is the
  // local-vernacular name (per Tim's brother DJ) for the same
  // Maplewood Golf Club in Bethlehem NH. Both names route to the
  // same bundled images.
  if (c.includes('maplewood')) return 'maplewood';
  if (c.includes('settlers crossing') || c.includes("settler's crossing")) return 'maplewood';
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
  if (c.includes('pembroke')) return PEMBROKE_PINES_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('maplewood')) return MAPLEWOOD_HOLE_IMAGES[holeNumber] ?? null;
  // 2026-05-26 — Fix BH: "Settlers Crossing" alias for Maplewood.
  if (c.includes('settlers crossing') || c.includes("settler's crossing")) {
    return MAPLEWOOD_HOLE_IMAGES[holeNumber] ?? null;
  }
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
