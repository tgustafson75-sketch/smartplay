/**
 * Local (surveyed) course registry: slugs, verified centroids, and the name → slug resolver.
 *
 * 2026-09-23 — this file used to register the bundled hole screenshots too (`*_HOLE_IMAGES`,
 * `getLocalHoleImage*`). Every table had been empty since 2026-08-25 and every hole image is now the
 * Mapbox tile drawn cached-first (services/mapboxImagery.holeTile), so that half is gone.
 */

import { isAmbiguousComplexName } from './courseComplexes';

export type LocalCourseSlug =
  // 2026-08-25 — MARQUEE SET. Bundled with NO image pack on purpose: hole imagery comes from Mapbox
  // satellite at runtime, which is licensed. That is what makes these cost bytes instead of
  // megabytes, and it is the model replacing the 27 screenshot packs.
  | 'torrey-pines-south' | 'pebble-beach' | 'streamsong-black'
  | 'palms' | 'lakes' | 'rancho-california' | 'crystal-springs'
  | 'mariners-point' | 'san-jose-muni' | 'sunnyvale'
  // 2026-07-24 (final QA) — 'journey-at-pechanga' REMOVED. It was a phantom: a name hook +
  // centroid + voice aliases but NO bundled imagery, NO COURSES entry, and NO Play-list card,
  // so it was neither searchable, voice-openable, nor playable — it only half-responded. Removed
  // the leftovers (Tim's call). Re-add as a full course (COURSES + Play list + hole data) if it
  // becomes a priority.
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
  // 2026-07-18 — Pembroke Lakes CC,
  // Pembroke Pines FL. 18 holes each, cropped from Tim's Golf Pad hole-view captures.
  | 'pembroke-pines'
  // 2026-07-23 — Highland Links (Truro MA, Dad's course), Miccosukee G&CC + Killian Greens
  // (Miami FL), Redlands CC (CA). 18 aerials each, cropped from the GPS-app hole-view
  // screenshots that anchored these courses — the SEAMLESS BACKUP when the Mapbox satellite
  // tile doesn't render (so SmartVision never shows a blank green screen).
  | 'highland-links'
  | 'berlin-cc'
  | 'miccosukee'
  | 'killian-greens'
  | 'redlands-cc'
  // 2026-07-24 — tester home courses (OSM-built, no bundled imagery → live Mapbox). Centroids
  // registered below so GPS auto-arrival works for jcsmith233's rotation etc.
  | 'mines-gc' | 'dale-hollow' | 'old-fort' | 'nashboro' | 'hermitage-pr'
  // 2026-07-28 (Tim) — Coyote Creek G.C. (Morgan Hill, CA) two interleaved 18s + Pruneridge G.C.
  // (Santa Clara, CA) 9-hole par-30. OSM-built; engine aerials bundled as the GPS-drop backup.
  | 'coyote-creek-tournament' | 'coyote-creek-valley' | 'pruneridge'
  // 2026-07-29 — Jay Scott's Bay Area courses (OSM-built) + Shadow Lakes (scorecard-only, no geometry).
  | 'wente-vineyards' | 'yocha-dehe' | 'shadow-lakes'
  // 2026-07-29 — Gabe's Brevard County FL courses (OSM-built).
  | 'crane-creek' | 'manatee-cove';

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
/**
 * 2026-08-11 — THIS is the table the geometry engine searches from, and it carried the same
 * hand-typed errors as the Play tab's.
 *
 * Correcting the Play-tab centroids without this one would have been a half-fix of exactly the kind
 * that keeps biting: the map would have looked right while the ENGINE kept searching empty ground,
 * because courseGeometryService reads its `lat`/`lng` from here. Greenhill's literal below sat on
 * Tatnuck Country Club, 6.8km away; Echo Hills was 2.6km out and Westlake 3.3km. All three had been
 * reporting "OSM unavailable" — a ~1.5km search centered on nothing.
 *
 * The raw literals stay (four courses have no hole geometry to derive from), but every course whose
 * real tee/green coordinates we hold now overrides its literal. One source of truth, two consumers.
 * [[no-half-fixes-enforce-every-surface]]
 */
const LOCAL_COURSE_CENTROIDS_RAW: Record<LocalCourseSlug, { lat: number; lng: number }> = {
  // Verified via api/course-locate (Google Places) 2026-08-25 — distances are how far the returned
  // place sat from the seed, i.e. how tightly it is indexed.
  'torrey-pines-south': { lat: 32.9024628, lng: -117.2462734 },   // South (US Open) course
  'pebble-beach':       { lat: 36.5696553, lng: -121.9497555 },   // 117m
  'streamsong-black':   { lat: 27.6699522, lng: -81.9277421 },    // 7m
  'crane-creek':              { lat: 28.075233, lng: -80.630249 },
  'manatee-cove':             { lat: 28.219306, lng: -80.608414 },
  'wente-vineyards':          { lat: 37.630166, lng: -121.753313 },
  'yocha-dehe':               { lat: 38.739773, lng: -122.131517 },
  // Shadow Lakes G.C., Brentwood CA (401 W Country Club Dr). Scorecard-only; centroid for the card
  // thumbnail + GPS auto-arrival — refine on-course via Mark Location.
  'shadow-lakes':             { lat: 37.929130, lng: -121.752225 },
  'coyote-creek-tournament': { lat: 37.194526, lng: -121.699698 },
  'coyote-creek-valley':      { lat: 37.198117, lng: -121.710450 },
  'pruneridge':               { lat: 37.332490, lng: -121.965502 },
  'mines-gc':          { lat: 42.9595803, lng: -85.7140174 },
  'dale-hollow':       { lat: 36.6624323, lng: -85.2906308 },
  'old-fort':          { lat: 35.8523026, lng: -86.4181595 },
  'nashboro':          { lat: 36.0888711, lng: -86.6363585 },
  'hermitage-pr':      { lat: 36.2298354, lng: -86.6409463 },
  'highland-links':   { lat: 42.0366308, lng: -70.0589550 },
  // 2026-08-14 — Berlin CC was BUNDLED with full per-hole coords but missing here, so any path
  // that needs a centroid (the engine fallback) had none and could not build. Computed from its own
  // bundled tee/green coords, so it agrees with the data it is meant to back up.
  'berlin-cc':        { lat: 42.4059000, lng: -71.6291000 },
  'miccosukee':       { lat: 25.7113237, lng: -80.4219701 },
  'killian-greens':   { lat: 25.6747540, lng: -80.3600897 },
  'redlands-cc':      { lat: 34.0250333, lng: -117.1514339 },
  // 2026-09-20 — was 33.6953922,-117.1504551: 663 yards from the mean of its own 36 tee/green
  // coordinates, outside the 550y at-course radius. Found by the retargeted centroid guard on its
  // first run, on a course nobody was looking at — which is the case for the guard.
  'palms':            { lat: 33.6921978, lng: -117.1557696 },
  'lakes':            { lat: 33.6913348, lng: -117.1573364 },
  // 2026-08-11 — was 7.96km out and in the wrong TOWN (Temecula vs Murrieta). OSM's golf_course
  // polygon for "The Golf Club at Rancho California" and the Census geocode of 39500 Robert Trent
  // Jones Pkwy agree to 170m. The old point is why this course reported "OSM unavailable".
  'rancho-california':{ lat: 33.560927,  lng: -117.144702 },
  'crystal-springs':  { lat: 37.5560947, lng: -122.3829982 },
  'mariners-point':   { lat: 37.5731586, lng: -122.2823681 },
  'san-jose-muni':    { lat: 37.3771789, lng: -121.8881051 },
  'sunnyvale':        { lat: 37.3983857, lng: -122.0417245 },
  // 2026-06-04 — Echo Hills Golf Course, Hemet CA. Approximate
  // centroid from the Hemet-area property landmark; refine on-site
  // via Mark Location when Tim plays there.
  // 2026-09-20 — brought into line with the course's own bundled tee/green coordinates.
  //
  // NOT a live bug, and I first wrote it up as one: LOCAL_COURSE_CENTROIDS below is DERIVED
  // (getBundledCourseCentroid(slug) ?? raw), so every consumer — play.tsx, smartvision, the
  // geometry service — already got the right point for any course that ships holes. The 2026-08-11
  // pass did finish the job.
  // What was left was a literal that contradicted the data it backs up, by 2,894 yards. This map is the
  // FALLBACK for courses with no bundled geometry, and it is the thing a person reads when they
  // want to know where a course is — so a number that disagrees with the holes by kilometres is a
  // trap for the next reader even when no code path takes it.
  // [[a-stale-header-is-a-source-someone-trusts]]
  'echo-hills':        { lat: 33.724367,  lng: -116.965174 },
  // 2026-07-06 — Spessard Holland (golfcourseapi id 30168; matches OSM greens).
  'spessard-holland': { lat: 28.04947,   lng: -80.55063 },
  // 2026-07-06 — Webster/Dudley (MA) 9-hole. 2026-08-11: the "approx town-center" placeholder was
  // 1.66km from the course; OSM has it as "Dudley Hill Golf Club at Nichols College".
  'webster-dudley':   { lat: 42.047568,  lng: -71.924881 },
  // 2026-05-28 — Westlake Country Club, 1 Westlake Blvd, Jackson NJ
  // 08527. Approximate centroid from the property landmark; refine
  // on-site via Mark Location when Tim plays there. The 800m detect
  // radius covers parking-lot + clubhouse arrival.
  // 2026-09-20 — brought into line with the course's own bundled tee/green coordinates.
  //
  // NOT a live bug, and I first wrote it up as one: LOCAL_COURSE_CENTROIDS below is DERIVED
  // (getBundledCourseCentroid(slug) ?? raw), so every consumer — play.tsx, smartvision, the
  // geometry service — already got the right point for any course that ships holes. The 2026-08-11
  // pass did finish the job.
  // What was left was a literal that contradicted the data it backs up, by 3,645 yards. This map is the
  // FALLBACK for courses with no bundled geometry, and it is the thing a person reads when they
  // want to know where a course is — so a number that disagrees with the holes by kilometres is a
  // trap for the next reader even when no code path takes it.
  // [[a-stale-header-is-a-source-someone-trusts]]
  'westlake-cc-nj':    { lat: 40.100505,  lng: -74.287979 },
  // 2026-06-21 — Greenhill Golf Course, Worcester MA.
  // 2026-09-20 — brought into line with the course's own bundled tee/green coordinates.
  //
  // NOT a live bug, and I first wrote it up as one: LOCAL_COURSE_CENTROIDS below is DERIVED
  // (getBundledCourseCentroid(slug) ?? raw), so every consumer — play.tsx, smartvision, the
  // geometry service — already got the right point for any course that ships holes. The 2026-08-11
  // pass did finish the job.
  // What was left was a literal that contradicted the data it backs up, by 7,441 yards. This map is the
  // FALLBACK for courses with no bundled geometry, and it is the thing a person reads when they
  // want to know where a course is — so a number that disagrees with the holes by kilometres is a
  // trap for the next reader even when no code path takes it.
  // [[a-stale-header-is-a-source-someone-trusts]]
  'greenhill':         { lat: 42.285886,  lng: -71.777239 },
  // 2026-07-18 — Pembroke Lakes CC, Pembroke Pines FL (golfcourseapi id 29669).
  'pembroke-pines':   { lat: 26.019337,  lng: -80.2868 },
};

/**
 * The hand-typed literals, before the derivation below overrides them. Exported for ONE reason: a
 * guard has to be able to read the fallback itself. Asserting against the derived map below is
 * near-tautological — it is the mean of the very holes you would compare it to — so a test that
 * reads it cannot fail on a stale literal. Nothing in the app should import this; use
 * LOCAL_COURSE_CENTROIDS. [[break-test-every-guard-you-write]]
 */
export const __testing = { LOCAL_COURSE_CENTROIDS_RAW };

export const LOCAL_COURSE_CENTROIDS: Record<LocalCourseSlug, { lat: number; lng: number }> =
  (() => {
    // Lazy require: data/courses.ts is large and does not import this module, so there is no cycle,
    // but keeping it inside the IIFE means the bundle only pays for it when centroids are read.
    const { getBundledCourseCentroid } = require('./courses') as typeof import('./courses');
    const out = {} as Record<LocalCourseSlug, { lat: number; lng: number }>;
    for (const slug of Object.keys(LOCAL_COURSE_CENTROIDS_RAW) as LocalCourseSlug[]) {
      out[slug] = getBundledCourseCentroid(slug) ?? LOCAL_COURSE_CENTROIDS_RAW[slug];
    }
    return out;
  })();

/**
 * Resolve a course name to a LOCAL_COURSE_CENTROIDS key. Mirrors the
 * substring-matching logic in getLocalHoleImage so consumers can ask
 * either function from the same `courseName` value.
 */
export function getLocalCourseSlug(courseName: string | null): LocalCourseSlug | null {
  if (!courseName) return null;
  const c = courseName.toLowerCase();
  /**
   * 2026-09-05 — MULTI-COURSE GATE, BEFORE ANY SUBSTRING MATCH.
   *
   * Tim played the Palms at Menifee Lakes and got the Lakes' hole imagery beside correct Palms
   * yardages. golfcourseapi returns the same parent club for both layouts, so the name in hand was
   * "Menifee Lakes Country Club" — which contains "lakes", does not contain "palms", and sailed
   * straight into the generic match below.
   *
   * The `lakes && !palms` guard further down was not wrong. It was answering a question the name
   * could not answer. A facility name cannot identify a layout, so this declines instead of
   * guessing and the caller falls through to live satellite geometry, which is keyed by the course
   * id and is correct. Mirrored from getLocalHoleImage: this file's header promises both functions resolve identically
   * from the same courseName, and a gate on only one of them is the same bug with a longer fuse. [[two-owners-is-the-root-cause]]
   */
  if (isAmbiguousComplexName(courseName)) return null;
  /**
   * 2026-08-25 — MARQUEE SET FIRST. These are the bundled famous courses; matching them early keeps
   * them clear of the generic substring rules below (e.g. a bare 'lakes' or 'pines' match).
   *
   * This function is the FIFTH registration point for a bundled course, and it is the one that was
   * missed: slug, centroid, Play card and API hint were all added, and Pebble Beach still showed
   * "waiting on your location" forever because the slug is resolved from the course NAME here, so
   * no name match meant no centroid meant no aerial. A course really is only registered when all
   * five agree — which is now what the sim asserts.
   */
  if (c.includes('torrey')) return 'torrey-pines-south';
  if (c.includes('pebble')) return 'pebble-beach';
  if (c.includes('streamsong')) return 'streamsong-black';
  if (c.includes('crystal') && c.includes('spring')) return 'crystal-springs';
  if (c.includes('mariner')) return 'mariners-point';
  // Pembroke MUST precede the generic 'lakes' match below.
  if (c.includes('pembroke')) return 'pembroke-pines';
  // 2026-09-01 — and so MUST Shadow Lakes, for exactly the same reason. It was declared nowhere here,
  // so it fell through to the bare 'lakes' rule and resolved to MENIFEE's Lakes course — Jay's home
  // course rendering another club's aerials, centroid and hole geometry.
  if (c.includes('shadow')) return 'shadow-lakes';
  if (c.includes('palms')) return 'palms';
  if (c.includes('lakes') && !c.includes('palms')) return 'lakes';
  if (c.includes('rancho')) return 'rancho-california';
  if (c.includes('san jose')) return 'san-jose-muni';
  if (c.includes('sunnyvale')) return 'sunnyvale';
  // 2026-06-04 — Echo Hills, Hemet CA. Short substring "echo" is
  // distinctive enough for the local courses we bundle.
  if (c.includes('echo')) return 'echo-hills';
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
  // 2026-07-24 (final QA) — match "green hill" too; the canonical name "Green Hill" (with a space)
  // does not contain "greenhill", so slug resolution (centroid + calibration) failed for it.
  if (c.includes('greenhill') || c.includes('green hill')) return 'greenhill';
  // 2026-07-07 — the two courses added from SmartVision screenshots. Name-lookup
  // parity so voice ("I'm at Spessard", "open Dudley Hill") + homeCourse matching
  // resolve to bundled imagery/centroid, not just the `local:` id path.
  if (c.includes('spessard') || c.includes('holland')) return 'spessard-holland';
  if (c.includes('webster') || c.includes('dudley')) return 'webster-dudley';
  // 2026-07-23 — the 4 screenshot-anchored beta courses. Name parity so voice / homeCourse /
  // name-keyed imagery (app/course/[course_id].tsx grid) resolve the bundled aerials, not just
  // the `local:` id path.
  if (c.includes('highland')) return 'highland-links';
  if (c.includes('miccosukee')) return 'miccosukee';
  if (c.includes('killian')) return 'killian-greens';
  if (c.includes('redlands')) return 'redlands-cc';
  // 2026-07-28 — Coyote Creek (default Tournament unless "valley" named) + Pruneridge.
  if (c.includes('coyote')) return c.includes('valley') ? 'coyote-creek-valley' : 'coyote-creek-tournament';
  if (c.includes('pruneridge')) return 'pruneridge';
  if (c.includes('wente')) return 'wente-vineyards';
  if (c.includes('yocha')) return 'yocha-dehe';
  if (c.includes('crane creek') || c.includes('crane')) return 'crane-creek';
  if (c.includes('manatee')) return 'manatee-cove';
  return null;
}

/**
 * 2026-09-13 — `getDefaultPreviewImage()` was DELETED, and the rule it encoded is kept here because
 * the rule is the valuable part.
 *
 * THERE IS NO DEFAULT PREVIEW IMAGE, deliberately. It once returned Palms hole 1, which leaked Palms
 * screenshots into non-Palms contexts; the fix was to return null, and the function then existed only
 * to return null to nobody — it had zero callers. Its job belongs to the consumer: when there is no
 * course context, SmartVision renders an explicit "pick a course" empty state, which it does (see the
 * empty-state branches in app/smartvision.tsx).
 *
 * So: never add a fallback that guesses a course's art. An empty state that says what it needs beats a
 * picture of the wrong golf course. [[silence-is-not-an-answer]]
 */
