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

export type LocalCourseSlug = 'palms' | 'lakes' | 'rancho-california' | 'crystal-springs' | 'mariners-point' | 'san-jose-muni' | 'sunnyvale';

export const LOCAL_COURSE_IMAGES: Record<LocalCourseSlug, Record<number, ImageSourcePropType>> = {
  'palms': PALMS_HOLE_IMAGES,
  'lakes': LAKES_HOLE_IMAGES,
  'rancho-california': RANCHO_CALIFORNIA_HOLE_IMAGES,
  'crystal-springs': CRYSTAL_SPRINGS_HOLE_IMAGES,
  'mariners-point': MARINERS_POINT_HOLE_IMAGES,
  'san-jose-muni': SAN_JOSE_MUNI_HOLE_IMAGES,
  'sunnyvale': SUNNYVALE_HOLE_IMAGES,
};

/**
 * 2026-05-16 — Centroid lat/lng for each LOCAL_COURSES entry. Used as
 * the input to the Mapbox centered-imagery fallback for courses that
 * don't have per-hole tee/green geometry. Mirrors the lat/lng values
 * declared in app/(tabs)/play.tsx LOCAL_COURSES so play-tab thumbnails
 * and SmartVision hole previews stay in lockstep.
 */
export const LOCAL_COURSE_CENTROIDS: Record<LocalCourseSlug, { lat: number; lng: number }> = {
  'palms':            { lat: 33.6953922, lng: -117.1504551 },
  'lakes':            { lat: 33.6913348, lng: -117.1573364 },
  'rancho-california':{ lat: 33.4910,    lng: -117.1390 },
  'crystal-springs':  { lat: 37.5120,    lng: -122.3580 },
  'mariners-point':   { lat: 37.5480,    lng: -122.2750 },
  'san-jose-muni':    { lat: 37.3670,    lng: -121.9310 },
  'sunnyvale':        { lat: 37.3777,    lng: -122.0357 },
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
  return null;
}

/**
 * Resolve a course name to its bundled hole image, if available.
 * Returns null for Sunnyvale + San Jose Muni — those bundled JPGs are
 * Golfshot screenshots with yardage chrome overlaid and shouldn't be
 * shown as hole imagery. Consumers should fall back to the Mapbox
 * centroid URL (see getLocalCourseSlug + getCenteredImageryUrl).
 */
export function getLocalHoleImage(courseName: string | null, holeNumber: number): ImageSourcePropType | null {
  if (!courseName) return null;
  const c = courseName.toLowerCase();
  if (c.includes('crystal') && c.includes('spring')) return CRYSTAL_SPRINGS_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('mariner')) return MARINERS_POINT_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('palms')) return PALMS_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('lakes') && !c.includes('palms')) return LAKES_HOLE_IMAGES[holeNumber] ?? null;
  if (c.includes('rancho')) return RANCHO_CALIFORNIA_HOLE_IMAGES[holeNumber] ?? null;
  // 2026-05-16 — San Jose Muni + Sunnyvale intentionally fall through.
  // Their bundled JPGs are Golfshot screenshots with the yardage UI
  // overlaid and should NOT be shown as hole imagery. The registries
  // (SAN_JOSE_MUNI_HOLE_IMAGES / SUNNYVALE_HOLE_IMAGES) remain exported
  // so existing code references still compile, but this helper returns
  // null so consumers route through the Mapbox centroid fallback.
  return null;
}

/**
 * Default preview image used by SmartVision when no round is active and
 * no course context exists yet. Palms hole 1 — Tim's home course.
 */
export function getDefaultPreviewImage(): ImageSourcePropType | null {
  return PALMS_HOLE_IMAGES[1] ?? null;
}
