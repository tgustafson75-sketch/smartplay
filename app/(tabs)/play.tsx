/**
 * Play tab — Course Discovery (legacy-style).
 *
 * Top to bottom:
 *   • SmartPlay banner
 *   • "Course Discovery" header + scope reticle (open SmartFinder later)
 *   • CLOSEST LOCAL COURSES — recent + curated near-by courses with (i) icons
 *   • GOLFCOURSE API SEARCH — toggle (Courses / Range + Practice) + search input
 *   • SELECTED COURSE — thumbnail + stats + 3 buttons (Start Round / Hole Map / Range Book)
 *
 * Bottom nav: Caddie / Play / Score / SwingLab / Stats.
 *
 * Tied to golfcourseapi.searchCourses for live search and getCourse for the
 * selected-course detail card. Local courses (Palms today) live alongside
 * API results in the closest-local section so Tim's home course is one tap.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { pickTeeSet } from '../../services/teeSelection';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, Alert, type ImageSourcePropType,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import * as Location from 'expo-location';
// Phase 407 — distance helper for course-locator GPS sort
import { haversineYards } from '../../utils/geoDistance';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
// 2026-05-26 — Fix CA: Play tab was hardcoded dark palette while the
// rest of the app respected useTheme/light mode. Importing here so
// the StyleSheet can be themed via makeStyles(colors) at the bottom.
import { useTheme } from '../../contexts/ThemeContext';
import WhatsNewHeroCard from '../../components/WhatsNewHeroCard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { pushCourseGuarded } from '../../utils/courseNav';
import { useTranslation } from 'react-i18next';
import { useRoundStore } from '../../store/roundStore';
import { useDownloadedCoursesStore } from '../../store/downloadedCoursesStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { canAccess } from '../../services/featureAccess';
import { triggerPaywall } from '../../services/paywallGuard';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-05-24 — Quick-launch Tournament Mode from a course card. Sets
// tournamentStore.courseName before navigating so the user lands on
// /tournament with the course pre-filled (saves the free-text typing).
import { type RoundMode, ROUND_MODE_CARDS } from '../../types/patterns';
import { searchCourses, getCourse, aiSearchCourse, type AiCourseResult } from '../../services/golfCourseApi';
import { locateNearbyCourses } from '../../services/courseDownloadEngine';
import { getBundledHoles, getBundledCourseCentroid } from '../../data/courses';
import { useCustomCourseStore } from '../../store/customCourseStore';
import { useGeometryStatusStore } from '../../store/geometryStatusStore';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { lookupCoursePlaces } from '../../services/coursePlaces';
import { prefetchCourseImagery } from '../../services/roundPrefetch';
import { getCourseImageryUrl, getCenteredImageryUrl } from '../../services/mapboxImagery';
import { isValidGolfCoord } from '../../utils/coordGuard';
import { getCachedGeometry } from '../../services/courseGeometryService';
import PALMS_IMAGES from '../../data/palmsImages';
import {
  CRYSTAL_SPRINGS_HOLE_IMAGES,
  MARINERS_POINT_HOLE_IMAGES,
  LAKES_HOLE_IMAGES,
  RANCHO_CALIFORNIA_HOLE_IMAGES,
  SAN_JOSE_MUNI_HOLE_IMAGES,
  SUNNYVALE_HOLE_IMAGES,
  WESTLAKE_CC_NJ_HOLE_IMAGES,
  ECHO_HILLS_HOLE_IMAGES,
  GREENHILL_HOLE_IMAGES,
  SPESSARD_HOLLAND_HOLE_IMAGES,
  WEBSTER_DUDLEY_HOLE_IMAGES,
  PEMBROKE_PINES_HOLE_IMAGES,
  getLocalHoleImageById,
} from '../../data/localCourseImages';
import AppIcon from '../../components/AppIcon';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import { QuickTutorial } from '../../components/QuickTutorial';
import { SCREEN_HELP } from '../../services/screenHelp';
import type { Course } from '../../types/course';
import { getApiBaseUrl } from '../../services/apiBase';
import { prewarmBriefing } from '../../services/briefingGenerator';
import { prewarmVoice } from '../../services/voiceWarmup';

type CourseSummary = {
  id: string;
  club_name: string;
  location: string;
  rating: number | null;
  slope: number | null;
  isLocal?: boolean;
  thumbnail?: ImageSourcePropType | { uri: string } | null;
  // Phase 407 — approximate course-centroid coordinates used for the
  // GPS-distance default sort. Courses without lat/lng fall to the end
  // of the sorted list (alphabetical among themselves). Local catalog
  // entries get hardcoded values; API search results enrich
  // opportunistically when course.location.gps is available.
  lat?: number;
  lng?: number;
};

// Curated local courses (Tim's playtest set). These render in the closest-local
// section even when the API hasn't been called yet. Rating/slope mirror
// data/courses.ts COURSES — the simulator's source of truth for these
// courses' geometry + walks.
// How many nearby courses to show before the "Show all" toggle. 5 per Tim's
// spec (2026-07-22): closest 5 by default, everything else one tap away.
const NEARBY_COLLAPSED = 5;

// 2026-07-23 (Tim) — bundled courses built from screenshots have no bundled photo, but
// a blank placeholder is off-brand next to the courses that do. Generate a real Mapbox
// satellite thumbnail centered on the course (H1 tee) so every card carries live imagery.
// Pure URL builder (hardcoded public token fallback → always renders over OTA); zoom 15
// frames the course nicely at 56px. Returns null only if the token is ever empty.
const satelliteThumb = (lat: number, lng: number): { uri: string } | null => {
  const uri = getCenteredImageryUrl({ lat, lng, zoom: 15, width: 160, height: 160 });
  return uri ? { uri } : null;
};

/** A thumbnail satelliteThumb() produced — safe to re-derive when the centroid moves. */
const isSatelliteThumb = (t: CourseSummary['thumbnail']): boolean =>
  !!t && typeof t === 'object' && 'uri' in t && typeof t.uri === 'string' && t.uri.includes('mapbox');

/**
 * 2026-08-10 (Tim — "make sure my thumbnails in the Play tab ALWAYS work and populate when we add a
 * new course, and that you get CORRECT thumbnails").
 *
 * ROOT CAUSE of the blank cards: `thumbnail` was a HAND-AUTHORED field on the bundled LOCAL_COURSES
 * literals only. Every dynamically-sourced course — the GPS "Courses near you" rows, golfcourseapi
 * search results, scorecard-photo customs, recents — had no such field, so those rows rendered the
 * generic golf-outline placeholder no matter how good their coordinates were. The hero card had
 * already grown a private lat/lng fallback inline; the four other surfaces never got it.
 *
 * This is that fallback, promoted to the ONE resolver every thumbnail surface calls, so a course
 * added tomorrow is covered by construction instead of by remembering to touch five call sites.
 *
 * CORRECTNESS over coverage: the coords go through isValidGolfCoord first. Several records carry
 * 0,0 placeholders, and centering a satellite tile on 0°,0° is what produced the ocean/parking-lot
 * thumbnails before ([[mapboxImagery]] carries the same guard). An unverifiable coord returns null
 * and keeps the honest placeholder — a WRONG picture of someone else's course is worse than none.
 */
const courseThumb = (c: { id?: string; thumbnail?: ImageSourcePropType | { uri: string } | null; lat?: number | null; lng?: number | null } | null | undefined):
  ImageSourcePropType | { uri: string } | null => {
  if (!c) return null;
  if (c.thumbnail) return c.thumbnail;
  if (c.lat != null && c.lng != null && isValidGolfCoord(c.lat, c.lng)) return satelliteThumb(c.lat, c.lng);
  /**
   * 2026-08-11 (Tim — "no thumbnail in the Play tab" on Connecticut National).
   *
   * A SEARCHED course carries no coordinates: verified against the live API, the search payload
   * returns only address/city/state — normalizeSearchResult isn't dropping them, they were never
   * there. So the coord path above can't fire and every searched course rendered the generic
   * placeholder.
   *
   * But by the time a row is on screen we often DO know where the course is, from the geometry we
   * fetched for it. Reading that here costs nothing (a synchronous cache read) and gives a real
   * aerial to exactly the courses that had none.
   */
  if (c.id) {
    try {
      const geo = getCachedGeometry(c.id);
      const h = geo?.holes?.find(x => x.green) ?? null;
      if (h?.green && isValidGolfCoord(h.green.lat, h.green.lng)) {
        return satelliteThumb(h.green.lat, h.green.lng);
      }
    } catch { /* cache miss — fall through to the honest placeholder */ }
  }
  return null;
};

const LOCAL_COURSES_RAW: CourseSummary[] = [
  // 2026-07-28 (Tim) — Coyote Creek G.C. (Morgan Hill, CA) two 18s + Pruneridge (Santa Clara, CA)
  // 9-hole par-30. OSM-built geometry (point-in-polygon split for Coyote's interleaved courses).
  // 2026-08-07 (Tim — playing it in an hour). Berlin Country Club (Berlin, MA) 9-hole par 33.
  // OSM golf=hole geometry (9/9 real, no estimated pars) → local:berlin-cc resolves to BERLIN_CC_HOLES.
  {
    id: 'local:berlin-cc',
    club_name: 'Berlin Country Club',
    location: 'Berlin, MA',
    // 2026-08-08 — rating/slope from the OFFICIAL card Tim photographed (men's 9-hole).
    rating: 62.4, slope: 98, isLocal: true, thumbnail: satelliteThumb(42.4078, -71.6290),
    lat: 42.4078, lng: -71.6290,
  },
  {
    id: 'local:coyote-creek-tournament',
    club_name: 'Coyote Creek (Tournament)',
    location: 'Morgan Hill, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(37.194526, -121.699698),
    lat: 37.194526, lng: -121.699698,
  },
  {
    id: 'local:coyote-creek-valley',
    club_name: 'Coyote Creek (Valley)',
    location: 'Morgan Hill, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(37.198117, -121.710450),
    lat: 37.198117, lng: -121.710450,
  },
  {
    id: 'local:pruneridge',
    club_name: 'Pruneridge G.C.',
    location: 'Santa Clara, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(37.332490, -121.965502),
    lat: 37.332490, lng: -121.965502,
  },
  // 2026-07-29 (Tim — new tester Jay Scott, Bay Area). Wente + Yocha Dehe bundled with real OSM
  // geometry; Shadow Lakes (his home course) rides the golfcourseapi search — it's in that DB.
  {
    id: 'local:wente-vineyards',
    club_name: 'Wente Vineyards',
    location: 'Livermore, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(37.630166, -121.753313),
    lat: 37.630166, lng: -121.753313,
  },
  {
    id: 'local:yocha-dehe',
    club_name: 'Yocha Dehe G.C.',
    location: 'Brooks, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(38.739773, -122.131517),
    lat: 38.739773, lng: -122.131517,
  },
  {
    // Jay's HOME course — scorecard-only (real golfcourseapi card, par 71); no OSM geometry, so the
    // per-hole flyover derives live on-course. The card + satellite thumbnail use the same imagery engine.
    id: 'local:shadow-lakes',
    club_name: 'Shadow Lakes G.C.',
    location: 'Brentwood, CA',
    rating: 71.8, slope: 133, isLocal: true, thumbnail: satelliteThumb(37.929130, -121.752225),
    lat: 37.929130, lng: -121.752225,
  },
  // 2026-07-29 (Tim — Gabe's Brevard County FL courses).
  {
    id: 'local:crane-creek',
    club_name: 'Crane Creek Reserve',
    location: 'Melbourne, FL',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(28.075233, -80.630249),
    lat: 28.075233, lng: -80.630249,
  },
  {
    id: 'local:manatee-cove',
    club_name: 'Manatee Cove G.C.',
    location: 'Patrick SFB, FL',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(28.219306, -80.608414),
    lat: 28.219306, lng: -80.608414,
  },
  // 2026-07-22 (Tim) — beta courses built from screenshots + OSM (data/courses.ts). No thumbnail
  // (golfcourseapi has no images); cards render from the data we have. rating/slope unknown → null.
  {
    id: 'local:highland-links',
    club_name: 'Highland Links',
    location: 'Truro, MA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(42.0366308, -70.0589550),
    lat: 42.0366308, lng: -70.0589550,
  },
  {
    id: 'local:miccosukee',
    club_name: 'Miccosukee G&CC',
    location: 'Miami, FL',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(25.7113237, -80.4219701),
    lat: 25.7113237, lng: -80.4219701,
  },
  {
    id: 'local:killian-greens',
    club_name: 'Killian Greens',
    location: 'Miami, FL',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(25.6747540, -80.3600897),
    lat: 25.6747540, lng: -80.3600897,
  },
  {
    id: 'local:redlands-cc',
    club_name: 'Redlands Country Club',
    location: 'Redlands, CA',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(34.0250333, -117.1514339),
    lat: 34.0250333, lng: -117.1514339,
  },
  // 2026-07-24/25 (Tim) — tester home courses. Built OSM-first into data/courses.ts; MUST also be
  // registered HERE so they surface in the Play picker (this catalog is what the picker lists, not
  // data/courses.ts). Coords = the course centroids.
  {
    id: 'local:mines-gc',
    club_name: 'Mines Golf Club',
    location: 'Grand Rapids, MI',
    rating: null, slope: 143, isLocal: true, thumbnail: satelliteThumb(42.9595803, -85.7140174),
    lat: 42.9595803, lng: -85.7140174,
  },
  {
    id: 'local:dale-hollow',
    club_name: 'Dale Hollow Lake State Resort Park',
    location: 'Burkesville, KY',
    rating: 71.0, slope: 131, isLocal: true, thumbnail: satelliteThumb(36.6624323, -85.2906308),
    lat: 36.6624323, lng: -85.2906308,
  },
  {
    id: 'local:old-fort',
    club_name: 'Old Fort Golf Club',
    location: 'Murfreesboro, TN',
    rating: 72.8, slope: 125, isLocal: true, thumbnail: satelliteThumb(35.8523026, -86.4181595),
    lat: 35.8523026, lng: -86.4181595,
  },
  {
    id: 'local:nashboro',
    club_name: 'Nashboro Golf Club',
    location: 'Nashville, TN',
    rating: 74.0, slope: 132, isLocal: true, thumbnail: satelliteThumb(36.0888711, -86.6363585),
    lat: 36.0888711, lng: -86.6363585,
  },
  {
    id: 'local:hermitage-pr',
    club_name: "Hermitage — President's Reserve",
    location: 'Old Hickory, TN',
    rating: 74.2, slope: 134, isLocal: true, thumbnail: satelliteThumb(36.2298354, -86.6409463),
    lat: 36.2298354, lng: -86.6409463,
  },
  {
    // Legacy is SCORECARD-ONLY (not in OSM). Approx Springfield coords for the card thumbnail +
    // proximity sort only; the holes carry no coords (F/M/B degrades to scorecard until marked).
    id: 'local:legacy-springfield',
    club_name: 'The Legacy',
    location: 'Springfield, TN',
    rating: 73.3, slope: 131, isLocal: true, thumbnail: satelliteThumb(36.484065, -86.840790),
    lat: 36.484065, lng: -86.840790,
  },
  {
    // Gleneagles is scorecard-only (no hole geometry to derive a centroid from), so the literal is
    // load-bearing. 2026-08-11: the old "approx Plano coords" were 5.1km off — geocoding the club
    // itself puts it on Campbell Road, which is what the engine needs to find any holes at all.
    // Kings and Queens share one 36-hole property, so they share a centroid.
    id: 'local:gleneagles-kings',
    club_name: "Gleneagles — King's",
    location: 'Plano, TX',
    rating: 74.7, slope: 143, isLocal: true, thumbnail: satelliteThumb(33.028737, -96.809567),
    lat: 33.028737, lng: -96.809567,
  },
  {
    id: 'local:gleneagles-queens',
    club_name: "Gleneagles — Queen's",
    location: 'Plano, TX',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(33.028737, -96.809567),
    lat: 33.028737, lng: -96.809567,
  },
  {
    // Querencia scorecard-only; approx Los Cabos coords for the card + proximity only.
    id: 'local:querencia',
    club_name: 'Querencia — Campo Bajo',
    location: 'Los Cabos, MX',
    rating: null, slope: null, isLocal: true, thumbnail: satelliteThumb(23.0300, -109.7200),
    lat: 23.0300, lng: -109.7200,
  },
  {
    id: 'local:palms',
    club_name: 'Menifee Lakes — Palms',
    location: 'Menifee, CA',
    rating: 69.6,
    slope: 119,
    isLocal: true,
    thumbnail: PALMS_IMAGES[1] as ImageSourcePropType,
    // Phase 407 — coords from data/courses.ts PALMS_HOLES[0] tee
    lat: 33.6953922,
    lng: -117.1504551,
  },
  {
    id: 'local:lakes',
    club_name: 'Menifee Lakes — Lakes',
    location: 'Menifee, CA',
    rating: 69.3,
    slope: 119,
    isLocal: true,
    thumbnail: (LAKES_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // Phase 407 — coords from data/courses.ts LAKES_HOLES[0] tee
    lat: 33.6913348,
    lng: -117.1573364,
  },
  {
    id: 'local:rancho-california',
    club_name: 'Rancho California',
    location: 'Temecula, CA',
    rating: 70.9,
    slope: 127,
    isLocal: true,
    thumbnail: (RANCHO_CALIFORNIA_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-08-11 — the old "approximate clubhouse centroid, any error <500m is invisible" was 7.96km
    // out and in the WRONG TOWN: the course is The Golf Club at Rancho California in MURRIETA
    // (39500 Robert Trent Jones Pkwy), not Temecula. That error is far from invisible — the geometry
    // engine searches ~1.5km around this point, which is why Rancho reported "OSM unavailable".
    // OSM's golf_course polygon and the US Census geocode of the street address agree to 170m.
    lat: 33.560927,
    lng: -117.144702,
  },
  {
    id: 'local:crystal-springs',
    club_name: 'Crystal Springs',
    location: 'Burlingame, CA',
    rating: 70.4,
    slope: 128,
    isLocal: true,
    thumbnail: (CRYSTAL_SPRINGS_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-05-17 — corrected from OSM golf_course centroid (was 5 km off)
    lat: 37.5560947,
    lng: -122.3829982,
  },
  {
    id: 'local:mariners-point',
    club_name: 'Mariners Point',
    location: 'Foster City, CA',
    rating: 53.0,
    slope: 74,
    isLocal: true,
    thumbnail: (MARINERS_POINT_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-05-17 — corrected from OSM golf_course centroid (was 2.8 km off)
    lat: 37.5731586,
    lng: -122.2823681,
  },
  // Added 2026-05-14 — Tim is in the San Jose area for the next 3-6
  // months and asked to test against his local muni. All 18 hole photos
  // bundled from his IMG_6426-6443 set. Rating/slope are public-record
  // course estimates; refine when official numbers are confirmed.
  {
    id: 'local:san-jose-muni',
    club_name: 'San Jose Municipal',
    location: 'San Jose, CA',
    rating: 70.2,
    slope: 122,
    isLocal: true,
    // 2026-05-16 — cropped Golfshot screenshot (chrome removed via PIL).
    // 2026-05-17 — thumbnail field was dropped during a prior centroid
    // edit, leaving Play tab to render the generic icon. Restored.
    thumbnail: (SAN_JOSE_MUNI_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-05-17 — corrected from OSM golf_course centroid (was 4.5 km
    // off, in the wrong neighborhood entirely)
    lat: 37.3771789,
    lng: -121.8881051,
  },
  // Added 2026-05-16 — Sunnyvale Golf Course (Sunnyvale, CA). Tim is
  // playing it tomorrow. All 18 hole photos bundled from his Golfshot
  // screenshot set. Rating/slope are public-record estimates; refine
  // when official numbers are confirmed.
  {
    id: 'local:sunnyvale',
    club_name: 'Sunnyvale Golf Course',
    location: 'Sunnyvale, CA',
    rating: 69.8,
    slope: 117,
    isLocal: true,
    // 2026-05-16 — cropped Golfshot screenshot (chrome removed via PIL).
    thumbnail: (SUNNYVALE_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-05-17 — corrected from OSM golf_course centroid (was 2.4 km off)
    lat: 37.3983857,
    lng: -122.0417245,
  },
  // 2026-05-24 — Hayes Open courses (Memorial Day weekend trip).
  // 2026-06-04 — Maplewood + Pembroke Pines removed pending IP-clean
  // re-bundle of their UI-chrome'd screenshots. Centroids in
  // data/localCourseImages.ts also removed; both fall through to
  // golfcourseapi search when the user types them.
  // 2026-06-04 — Echo Hills, Hemet CA (9-hole executive par 35).
  // Tim's local rotation.
  {
    id: 'local:echo-hills',
    club_name: 'Echo Hills Golf Course',
    location: 'Hemet, CA',
    rating: null,
    slope: null,
    isLocal: true,
    thumbnail: (ECHO_HILLS_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    lat: 33.7475,
    lng: -116.9719,
  },
  // 2026-05-28 — Westlake Country Club, Jackson NJ. First East Coast
  // course Tim has personally captured (full 18 Green Maps screenshots,
  // cropped to Palms aesthetic). Geometry comes from golfcourseapi at
  // runtime; bundled images only.
  {
    id: 'local:westlake-cc-nj',
    club_name: 'Westlake Country Club',
    location: 'Jackson, NJ',
    rating: null,
    slope: null,
    isLocal: true,
    thumbnail: (WESTLAKE_CC_NJ_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    lat: 40.0828,
    lng: -74.3196,
  },
  // 2026-06-21 — Greenhill Golf Course, Worcester MA.
  {
    id: 'local:greenhill',
    club_name: 'Greenhill Golf Course',
    location: 'Worcester, MA',
    rating: null,
    slope: null,
    isLocal: true,
    thumbnail: (GREENHILL_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    lat: 42.2677,
    lng: -71.8562,
  },
  // 2026-07-06 — Spessard Holland GC, Melbourne Beach FL (Tim's Florida course).
  // It was fully built into data/courses.ts + localCourseImages.ts this session but
  // never added here, so it was invisible in the Play list. Coords are approximate
  // course-center (the hole GPS in data/courses.ts is estimated 0,0 — refine when
  // real tee coords land); enough for the list + a rough "you're here" detect.
  {
    id: 'local:spessard-holland',
    club_name: 'Spessard Holland GC',
    location: 'Melbourne Beach, FL',
    rating: 62.2,
    slope: 113,
    isLocal: true,
    thumbnail: (SPESSARD_HOLLAND_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-07-24 (final QA) — reconciled to the LOCAL_COURSE_CENTROIDS value (~1.3mi apart before;
    // the two registries are documented to mirror each other). This is the OSM/golfcourseapi-matched
    // centroid; the prior value drifted.
    lat: 28.04947,
    lng: -80.55063,
  },
  // 2026-07-06 — Webster/Dudley (MA) 9-hole, from Tim's Golf Pad hole-view shots.
  // Approx town-center coords (hole GPS isn't in the screenshots); enough for the
  // list + a rough "you're here" detect. Real front/center/back yardages per hole.
  {
    id: 'local:webster-dudley',
    club_name: 'Webster Dudley',
    location: 'Dudley, MA',
    rating: null,
    slope: null,
    isLocal: true,
    thumbnail: (WEBSTER_DUDLEY_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    // 2026-08-11 — was an "approx town-center" placeholder (its own comment said so), 1.66km from
    // the course. OSM has the real thing: "Dudley Hill Golf Club at Nichols College".
    lat: 42.047568,
    lng: -71.924881,
  },
  
  // 2026-07-18 — Pembroke Lakes CC, Pembroke Pines FL. 18 cropped aerials + real par/yardage
  // (golfcourseapi id 29669).
  {
    id: 'local:pembroke-pines',
    club_name: 'Pembroke Lakes CC',
    location: 'Pembroke Pines, FL',
    rating: 72.9,
    slope: 139,
    isLocal: true,
    thumbnail: (PEMBROKE_PINES_HOLE_IMAGES[1] ?? null) as ImageSourcePropType | null,
    lat: 26.019337,
    lng: -80.2868,
  },
];

/**
 * 2026-08-11 — real hole geometry outranks a hand-typed centroid.
 *
 * Three of these literals were wrong, one by 6.8km (it pointed at a different golf course), which
 * broke the engine build, the distance sort AND the satellite thumbnail for those courses. Rather
 * than correcting three numbers and waiting for the next one to be mistyped, the centroid is derived
 * from each course's own tee/green coordinates and the literal is kept only where there is no
 * geometry to derive from — the four scorecard-only courses. See getBundledCourseCentroid.
 *
 * The thumbnail is rebuilt from the derived point too. A course whose centroid was wrong was showing
 * an aerial of the wrong place, and fixing the coordinate without the image would leave that behind.
 */
const LOCAL_COURSES: CourseSummary[] = LOCAL_COURSES_RAW.map(c => {
  const derived = getBundledCourseCentroid(c.id);
  if (!derived) return c;
  const moved = c.lat == null || c.lng == null ||
    Math.abs(derived.lat - c.lat) > 0.002 || Math.abs(derived.lng - c.lng) > 0.002;
  return {
    ...c,
    lat: derived.lat,
    lng: derived.lng,
    // Only re-derive a thumbnail that was BUILT from the stale point. Courses with real bundled
    // hole photography keep theirs — those are pictures of the course, not of a coordinate.
    thumbnail: moved && isSatelliteThumb(c.thumbnail) ? satelliteThumb(derived.lat, derived.lng) : c.thumbnail,
  };
});


// 2026-06-02 — Fix GO: HAYES_OPEN_COURSE_IDS removed alongside the pinned card
// (courses remain reachable via normal discovery).
// 2026-07-04 (elite-clean audit) — TOURNAMENT_QUICK_LAUNCH_IDS (an empty set since
// 2026-06-04) + its trophy button + launchTournamentForCourse were DEAD code and
// have been deleted. Tournament Mode stays reachable from the format chip row.

export default function PlayTab() {
  const router = useRouter();
  const { t } = useTranslation();
  // 2026-05-26 — Fix CA: theme-aware styles. Without this the Play
  // tab stayed dark even when the app was in light mode (every other
  // tab respected useTheme). makeStyles() is defined at the bottom
  // of the file and re-runs on theme change.
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 2026-05-24 — beta-minimal responsive: constrain content to a
  // centered max-width on wide surfaces (fold-open, tablet, landscape).
  // Phone portrait + fold-closed render unchanged.
  const { isWide } = useDeviceLayout();
  const recentCourseIds = useRoundStore(s => s.recentCourseIds);
  const roundHistory = useRoundStore(s => s.roundHistory);
  const previewCourseId = useRoundStore(s => s.previewCourseId);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const endRound = useRoundStore(s => s.endRound);
  const discardRound = useRoundStore(s => s.discardRound);
  const homeCourse = usePlayerProfileStore(s => s.homeCourse);

  /**
   * 2026-08-13 — courseThumb() falls back to reading the geometry cache (getCachedGeometry) to give a
   * SEARCHED course a real aerial: those records carry no coordinates of their own, so the cache is
   * the only place a thumbnail can come from. But it is a module-level cache read during RENDER, so
   * when the geometry for a course actually arrived, nothing re-rendered this tab and every one of
   * those rows kept the generic placeholder — the same shape as the STATIC-yardage defect.
   *
   * Resolved through a callback keyed on `completions` rather than a bare subscription, so the
   * dependency is visible at all six call sites instead of being an invisible re-render that the next
   * person deletes as unused.
   */
  const geometryCompletions = useGeometryStatusStore(st => st.completions);
  const thumbFor = useCallback(
    (c: Parameters<typeof courseThumb>[0]) => courseThumb(c),
    // completions is a real input to the RESULT (it says the cache courseThumb reads has changed),
    // even though it is not an argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryCompletions],
  );

  // Pre-beta — legacy round factors restored to the Play tab so the user
  // picks strategy + mental + format BEFORE the round fires. The Play tab
  // hands these to roundStore via setPendingStartFactors; Caddie reads
  // them when consuming the pendingStartCourseId signal.
  const [setupMode, setSetupMode] = useState<RoundMode>('free_play');
  const [setupNineHole, setSetupNineHole] = useState(false);
  const [setupCompetition, setSetupCompetition] = useState(false);
  const [setupMental, setSetupMental] = useState<'fresh' | 'neutral' | 'tense'>('neutral');
  const [setupNotes, setSetupNotes] = useState('');
  // 2026-05-17 — voice dictation for the pre-round notes field. Without
  // a mic and explicit "done" affordance, Tim reported typed notes
  // "just sit there" — easy to leave the screen with unsaved text. The
  // mic appends transcribed speech to the existing notes; the check
  // button dismisses the keyboard cleanly.
  const [notesDictating, setNotesDictating] = useState(false);
  const notesInputRef = React.useRef<TextInput>(null);
  const apiUrlForNotes = getApiBaseUrl();
  const notesLanguage = useSettingsStore(s => s.language);
  const handleDictateNotes = React.useCallback(async () => {
    if (notesDictating) return;
    setNotesDictating(true);
    try {
      const { captureUtterance } = await import('../../services/voiceService');
      // 2026-06-08 (audit #2) — hard outer timeout so a native voice-service
      // hang can never strand the mic in "listening" forever.
      const transcript = await Promise.race([
        captureUtterance(15_000, apiUrlForNotes, notesLanguage),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('dictation timeout')), 20_000)),
      ]);
      if (transcript && transcript.trim()) {
        setSetupNotes(prev => (prev ? prev.trim() + ' ' : '') + transcript.trim());
      }
    } catch (e) {
      console.log('[play] notes dictation failed', e);
    } finally {
      setNotesDictating(false);
    }
  }, [notesDictating, apiUrlForNotes, notesLanguage]);
  // Phase 405 wave 3 — tee box color selection. 'unspecified' until the
  // user picks. Survives the Play tab lifetime so navigating away and
  // back doesn't lose the selection.
  const setupTee = useRoundStore(s => s.selectedTee);
  const setSetupTee = useRoundStore(s => s.setSelectedTee);
  // 2026-06-13 (Tim) — walking vs cart for this round.
  const setupTransport = useRoundStore(s => s.transportMode);
  const setSetupTransport = useRoundStore(s => s.setTransportMode);

  const [query, setQuery] = useState('');
  // 2026-07-23 (Tim) — golfcourseapi has no city/state fields; a location hint appended to the
  // query markedly improves match quality (e.g. two "Highland" clubs in different states). Kept
  // in a ref too so runSearch can read it without re-creating the callback on every keystroke.
  const [locationQuery, setLocationQuery] = useState('');
  const locationQueryRef = useRef('');
  // 2026-07-22 (Tim) — nearby list shows the 5 CLOSEST by default; the rest
  // (incl. beta-tester courses far from the player, e.g. Highland in MA) are
  // one tap away via "Show all". Collapsible back down so the screen stays clean.
  const [showAllCourses, setShowAllCourses] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CourseSummary[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Distinguish "haven't searched yet" from "searched and got zero results".
  const [hasSearched, setHasSearched] = useState(false);
  // 2026-06-30 — AI course-search fallback (Tim's Gemini search). When the course DB
  // has no match, we ask the AI to identify the course so the user isn't dead-ended
  // with "not in the database." Honest: an AI result has NO hole geometry, so it's
  // shown as info + booking, not a playable round.
  const [aiResult, setAiResult] = useState<AiCourseResult | null>(null);
  const lastQueryRef = useRef<string>('');
  // Audit — monotonic request ID. setResults / setSearchError only fire
  // when the response's seq matches the current latest seq, so a stale
  // first response can't overwrite a fresher second one mid-typing.
  const searchSeqRef = useRef<number>(0);

  const [recentCourses, setRecentCourses] = useState<CourseSummary[]>([]);
  const recentCourseMeta = useRoundStore(s => s.recentCourseMeta);
  const rememberRecentCourseMeta = useRoundStore(s => s.rememberRecentCourseMeta);
  // The player's Preferred Tee — recents should quote the same tee set the course screen will.
  const preferredTee = usePlayerProfileStore(s => s.preferredTee);
  const [selected, setSelected] = useState<Course | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  // 2026-07-27 (tester UX) — opening a searched/API course can fail (network) or return null. The
  // load spinner lives inside the {selected && …} card, so a fresh tap that fails showed NOTHING —
  // the row just did nothing. This surfaces an "opening…" state + a retry hint instead of a dead-end.
  const [selectError, setSelectError] = useState<string | null>(null);
  const [selectedHero, setSelectedHero] = useState<string | null>(null);
  // DP-3 — resolve the selected LOCAL course's real bundled thumbnail
  // (hole-1 image) from its `local:<slug>` id via the canonical
  // courseId-keyed resolver — the same registry the closest-local rows
  // draw their thumbnails from. Returns null for API/non-local courses
  // and for local slugs without bundled imagery (genuine placeholder).
  const selectedLocalThumb = useMemo(
    () => getLocalHoleImageById(selected?.id ?? null, 1),
    [selected?.id],
  );
  // Phase 407 — GPS position for course-locator default sort.
  // One-shot Balanced-accuracy fix at mount; refreshed when the tab
  // regains focus. Null when permission denied or fix unavailable —
  // course list falls back to catalog order in that case.
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  // 2026-08-07 (Tim — "no GPS auto-detect location with the golfcourseapi section of the Play tab; this
  // needs to be part of all this logic"). GPS → nearby courses from the course engine (/api/course-locate,
  // Google Places golf courses), so ANY course near you auto-surfaces in the search section — not just the
  // bundled catalog. Each resolves through the same selectSummary → golfcourseapi path when tapped.
  const [nearbyApiCourses, setNearbyApiCourses] = useState<CourseSummary[]>([]);
  // 2026-08-09 — arrival auto-download dedupe (per app session).
  const autoDownloadFiredRef = useRef<Set<string>>(new Set());
  const downloadToastFiredRef = useRef<Set<string>>(new Set());

  // Pre-beta — clear stale search error on every entry to the tab so a
  // failed search from a prior visit doesn't keep "Course search unavailable"
  // pinned at the bottom forever.
  useFocusEffect(
    useCallback(() => {
      setSearchError(null);
    }, []),
  );

  // 2026-06-11 (lazy-load) — GPS is NO LONGER auto-pulled on Play-tab focus.
  // Per "load resources only when needed," the default course is the user's
  // last pick (instant — no GPS, no permission prompt on every visit). Tapping
  // the floating "refresh nearby" button runs this one-shot Balanced fix to
  // re-sort courses by proximity. Permission denial / failure leaves
  // userPosition null and the list falls back to last-pick → home → catalog.
  // (Replaces the Phase 407 focus-effect that fired GPS on every Play visit.)
  const [locating, setLocating] = useState(false);
  const refreshLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
      console.log('[play] manual location refresh failed:', e);
    } finally {
      setLocating(false);
    }
  }, []);

  // M1 — GPS auto-select on first launch. If neither a persisted
  // previewCourseId nor an active round gives us a default, request
  // location permission and kick the nearest-course sort so the first
  // mount lands on the closest course rather than the static catalog top.
  // Runs once; the closestLocal/userPosition chain in the seeding effect
  // (below) handles the actual selectSummary() call once userPosition is set.
  const hasAutoLocatedRef = useRef(false);
  useEffect(() => {
    if (hasAutoLocatedRef.current) return;
    if (previewCourseId || isRoundActive) return;
    hasAutoLocatedRef.current = true;
    void refreshLocation();
    // refreshLocation is stable (useCallback with no deps that change) —
    // intentionally not in deps to run exactly once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate recent courses from store
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: CourseSummary[] = [];
      for (const id of recentCourseIds.slice(0, 4)) {
        // B3 — local: IDs return null from the external API. Resolve them
        // from the bundled LOCAL_COURSES catalog instead; skip the network call.
        if (id.startsWith('local:')) {
          const local = LOCAL_COURSES.find(l => l.id === id);
          if (local) out.push(local);
          continue;
        }
        const c = await getCourse(id);
        if (cancelled) return;
        if (c) {
          const tee = pickTeeSet(c.tees, preferredTee);
          const location = [c.location.city, c.location.state].filter(Boolean).join(', ');
          out.push({
            id: c.id,
            club_name: c.club_name,
            location,
            rating: tee?.course_rating ?? null,
            slope: tee?.slope_rating ?? null,
          });
          // Remember the name so this course can be listed with no network next time.
          rememberRecentCourseMeta(c.id, { club_name: c.club_name, location });
        } else {
          /**
           * 2026-08-12 (Tim — "where the hell did Wachusett go? It's not even on my list anymore")
           *
           * THE BUG: a failed lookup used to silently drop the course. This effect runs at MOUNT,
           * which is exactly when the network is busiest (and exactly when today's warmup
           * connection-starvation bug was choking these calls), so one blip erased a real course he
           * was about to play — while its id sat untouched in recentCourseIds.
           *
           * A course you played does not stop existing because a fetch timed out. Fall back to the
           * cached name; it stays listed and selectable, and selecting it re-fetches the detail.
           */
          const cached = recentCourseMeta[id];
          if (cached) {
            out.push({ id, club_name: cached.club_name, location: cached.location, rating: null, slope: null });
          }
        }
      }
      if (!cancelled) setRecentCourses(out);
    })();
    return () => { cancelled = true; };
  }, [recentCourseIds, recentCourseMeta, preferredTee]);

  // Phase 407 — GPS-driven default sort. When userPosition is known,
  // sort the combined catalog ascending by distance from the player.
  // Courses without lat/lng fall to the end (alphabetical among
  // themselves). When userPosition is null (no permission / no fix
  // yet), the previous catalog-then-recent insertion order is kept
  // exactly, so the behavior is no-regression at first paint.
  // 2026-07-01 (Tim) — courses the player added from a scorecard photo (customCourseStore) show
  // in the picker alongside local + API courses. isLocal so selection/start take the local branch,
  // where getBundledHoles resolves their holes.
  const customCoursesMap = useCustomCourseStore(s => s.courses);
  const customSummaries: CourseSummary[] = useMemo(
    () => Object.values(customCoursesMap).map(c => ({
      id: c.id,
      club_name: c.name,
      location: c.location ?? 'Added from scorecard',
      rating: null,
      slope: null,
      isLocal: true,
    })),
    [customCoursesMap],
  );

  // 2026-08-07 (Tim) — GPS auto-detect for the golfcourseapi/search section: when we have a fix, pull the
  // golf courses physically near the player from the course engine and drop any that are already in the
  // bundled/custom catalog (those show in "Courses near you" above). Best-effort; silent on failure/offline.
  /**
   * 2026-08-19 (Tim, from a round: "course discovery, it didn't load, and that's bullshit… root cause
   * only"). THIS EFFECT ONLY RE-RAN WHEN THE POSITION CHANGED. A player standing at the course — the
   * exact moment discovery matters most — has a position that barely moves, so a single failed lookup
   * was FINAL for the whole visit. Combined with the service returning a bare [] on every failure
   * (indistinguishable from "no courses nearby"), the section just never appeared and nothing
   * anywhere recorded why.
   *
   * The service now says WHY it failed and retries a transient once. This adds the other half: when
   * it still fails, try again on a timer instead of waiting for the player to walk somewhere. Bounded
   * (3 attempts, backing off) so a genuinely offline round doesn't poll forever, and cancelled on
   * unmount / position change like everything else here.
   */
  useEffect(() => {
    if (!userPosition) return;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const run = async (): Promise<void> => {
      attempt += 1;
      try {
        const res = await locateNearbyCourses(userPosition.lat, userPosition.lng, { limit: 8 });
        if (cancelled) return;
        const near = res.courses;
        if (res.failure) {
          // We do NOT know what is nearby — that is different from knowing there is nothing. Leave any
          // previously-found list untouched and come back to it rather than rendering a confident empty.
          if (attempt < 3) {
            retryTimer = setTimeout(() => { void run(); }, attempt * 8000);
          } else {
            console.log('[play] course discovery gave up after', attempt, 'attempts —', res.failure);
          }
          return;
        }
        if (!near.length) return;
        const bundledNames = new Set([
          ...LOCAL_COURSES.map(c => c.club_name.toLowerCase()),
          ...customSummaries.map(c => c.club_name.toLowerCase()),
        ]);
        const mapped: CourseSummary[] = near
          .filter(n => n.name && !bundledNames.has(n.name.toLowerCase()))
          .map(n => ({
            id: n.place_id ? `place:${n.place_id}` : `near:${n.name}`,
            club_name: n.name,
            location: n.vicinity ?? '',
            rating: null,
            slope: null,
            isLocal: false,
            lat: n.lat,
            lng: n.lng,
          }));
        if (!cancelled) setNearbyApiCourses(mapped);
        // 2026-08-09 (Tim — the download engine was half-wired: locate live, downloadCourse ZERO
        // callers). The engine's whole point is the Arccos flow: ARRIVE at a course → its full data
        // (geometry/content/intelligence/imagery) downloads itself so play is instant + offline with
        // zero taps. Auto-download the nearest located course when the player is physically AT it
        // (≤1.5km). Idempotent + fire-and-forget; toast only on a FRESH download (isCourseDownloaded
        // flips), once per session per course.
        const nearest = near[0];
        // 2026-08-09 (stores audit P2) — don't fire the arrival download until downloadedCoursesStore has
        // rehydrated; otherwise isDownloaded() reads false on a cold boot and re-prefetches an owned course.
        const dcHydrated = (() => { try { return useDownloadedCoursesStore.persist?.hasHydrated?.() ?? true; } catch { return true; } })();
        if (dcHydrated && nearest && nearest.distance_m <= 1500 && !autoDownloadFiredRef.current.has(nearest.name)) {
          autoDownloadFiredRef.current.add(nearest.name);
          void (async () => {
            try {
              const eng = await import('../../services/courseDownloadEngine');
              const r = await eng.downloadCourse({ name: nearest.name, lat: nearest.lat, lng: nearest.lng });
              // 2026-08-09 (stores audit P2) — toast ONLY on a genuinely fresh download (r.fresh),
              // never for a course already owned (was claiming 'downloaded' for weeks-old courses).
              if (r.ok && r.fresh && r.courseId && !downloadToastFiredRef.current.has(r.courseId)) {
                downloadToastFiredRef.current.add(r.courseId);
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                (require('../../store/toastStore') as typeof import('../../store/toastStore')).useToastStore.getState()
                  .show(`${nearest.name} is ready — full course data downloaded.`);
              }
            } catch { /* best-effort — arrival download never surfaces an error */ }
          })();
        }
      } catch { /* best-effort — offline / no key just shows the manual search */ }
    };
    void run();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [userPosition, customSummaries]);

  const closestLocal: CourseSummary[] = useMemo(() => {
    const combined: CourseSummary[] = [
      ...customSummaries,
      ...LOCAL_COURSES,
      ...recentCourses.filter(r => !LOCAL_COURSES.some(l => l.id === r.id) && !customSummaries.some(cs => cs.id === r.id)),
    ];
    if (!userPosition) return combined;
    const YARDS_PER_MILE = 1760;
    type Annotated = { course: CourseSummary; miles: number | null };
    const annotated: Annotated[] = combined.map(c => {
      if (c.lat == null || c.lng == null) return { course: c, miles: null };
      const yds = haversineYards(userPosition, { lat: c.lat, lng: c.lng });
      return { course: c, miles: yds / YARDS_PER_MILE };
    });
    annotated.sort((a, b) => {
      // Courses without coords sink to the bottom, then alphabetical.
      if (a.miles == null && b.miles == null) return a.course.club_name.localeCompare(b.course.club_name);
      if (a.miles == null) return 1;
      if (b.miles == null) return -1;
      return a.miles - b.miles;
    });
    return annotated.map(a => a.course);
  }, [recentCourses, userPosition, customSummaries]);

  // Phase 407 — per-course distance label keyed by id. Computed once
  // alongside the sort so the row renderer just looks up.
  const distanceLabelById: Record<string, string | null> = useMemo(() => {
    if (!userPosition) return {};
    const YARDS_PER_MILE = 1760;
    const out: Record<string, string | null> = {};
    for (const c of closestLocal) {
      if (c.lat == null || c.lng == null) { out[c.id] = null; continue; }
      const miles = haversineYards(userPosition, { lat: c.lat, lng: c.lng }) / YARDS_PER_MILE;
      out[c.id] = miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
    }
    return out;
  }, [closestLocal, userPosition]);

  // Phase 405 wave 3 — course auto-detect prompt. When the player is
  // within ~550 yards (0.3 mi, half a typical golf hole) of a known
  // course's centroid, surface a small "You're at X" banner above the
  // list. Distinct from the implicit auto-select that already runs in
  // closestLocal[0]: the banner is a visible confirmation that GPS
  // recognized the player's location. Player can tap the banner's
  // "Use it" to confirm and load that course's data. Null when no
  // course is close enough or GPS isn't available yet.
  const atCourse: { course: CourseSummary; yards: number; sibling: CourseSummary | null } | null = useMemo(() => {
    if (!userPosition) return null;
    const within: { course: CourseSummary; yards: number }[] = [];
    for (const c of closestLocal) {
      if (c.lat == null || c.lng == null) continue;
      const yds = haversineYards(userPosition, { lat: c.lat, lng: c.lng });
      if (yds <= 550) within.push({ course: c, yards: yds });
    }
    if (within.length === 0) return null;
    within.sort((a, b) => a.yards - b.yards);
    const best = within[0];
    // 2026-07-24 (final QA) — co-located sibling ambiguity. Menifee Lakes is one club with two
    // courses (Palms + Lakes) ~854yd apart sharing one clubhouse, so at the parking lot both are
    // within threshold and nearest-centroid is a coin flip. They have DIFFERENT par (72 vs 71) +
    // yardages, so one-tap-starting a guess launches the wrong nine. Detect a second within-threshold
    // course at the SAME location whose name shares the club family (before the "— <course>" suffix),
    // and offer BOTH rather than silently pick.
    const family = (name: string) => name.split(/\s[—-]\s/)[0].trim().toLowerCase();
    const sibling = within.slice(1).find(o =>
      o.course.id !== best.course.id &&
      o.course.location === best.course.location &&
      family(o.course.club_name).length > 0 &&
      family(o.course.club_name) === family(best.course.club_name),
    );
    return { course: best.course, yards: best.yards, sibling: sibling?.course ?? null };
  }, [closestLocal, userPosition]);

  // 2026-08-07 (Tim — "the hero card is basic as shit… add course info, description, user history on
  // that course"). The single nearest course + everything we can honestly show about it: a real
  // satellite thumbnail, rating/slope, and the player's OWN record at that course pulled from
  // roundHistory (rounds played, best/last score, best vs-par). Matched by courseId first, then a
  // normalized name compare (imports/local rounds may lack the API id). Null when GPS/round aren't ready.
  const heroCourse: CourseSummary | null = (!isRoundActive && userPosition && !atCourse?.sibling)
    ? (closestLocal[0] ?? null)
    : null;
  const heroStats: {
    rounds: number; bestScore: number | null; lastScore: number | null;
    bestVsPar: number | null; lastVsPar: number | null;
  } | null = useMemo(() => {
    if (!heroCourse) return null;
    const norm = (s: string | null | undefined) =>
      (s ?? '').toLowerCase().replace(/\s[—-]\s.*/, '').replace(/[^a-z0-9]/g, '').trim();
    const heroName = norm(heroCourse.club_name);
    const mine = roundHistory.filter(r =>
      (r.courseId != null && r.courseId === heroCourse.id) ||
      (heroName.length >= 4 && norm(r.courseName) === heroName),
    );
    if (mine.length === 0) return { rounds: 0, bestScore: null, lastScore: null, bestVsPar: null, lastVsPar: null };
    const scored = mine.filter(r => typeof r.totalScore === 'number' && r.totalScore > 0);
    const byDate = [...mine].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    const last = byDate[0];
    const bestScore = scored.length ? Math.min(...scored.map(r => r.totalScore)) : null;
    const withPar = mine.filter(r => typeof r.scoreVsPar === 'number');
    const bestVsPar = withPar.length ? Math.min(...withPar.map(r => r.scoreVsPar as number)) : null;
    return {
      rounds: mine.length,
      bestScore,
      lastScore: last && typeof last.totalScore === 'number' && last.totalScore > 0 ? last.totalScore : null,
      bestVsPar,
      lastVsPar: last && typeof last.scoreVsPar === 'number' ? last.scoreVsPar : null,
    };
  }, [heroCourse, roundHistory]);

  // Default the SELECTED COURSE card to the user's home course on first
  // mount (or Palms — Tim's primary local — if none is set yet). User
  // can still pick anything else from the list above; this just gives
  // the screen a meaningful default rather than an empty selected card.
  // Only seeds once per session: if the user has already picked a
  // course or a round is active, leave it alone.
  useEffect(() => {
    if (selected) return;
    if (isRoundActive && activeCourseId) {
      // Round in progress — surface the active course as selected.
      const match = LOCAL_COURSES.find(l =>
        l.id === activeCourseId ||
        (activeCourse && l.club_name.toLowerCase().includes(activeCourse.toLowerCase()))
      );
      if (match) { void selectSummary(match); return; }
    }
    const homeName = (homeCourse ?? '').toLowerCase();
    const homeMatch = homeName
      ? LOCAL_COURSES.find(l => l.club_name.toLowerCase().includes(homeName) || l.id.toLowerCase().includes(homeName))
      : null;
    // Phase 407 — default to the NEAREST course (closestLocal[0]) when
    // the GPS sort has run. Falls through to the configured home
    // course (if set) and then to the static catalog top when GPS
    // hasn't resolved yet. Honest about which it's using: when
    // userPosition is null, the sort hasn't run so closestLocal[0]
    // still equals LOCAL_COURSES[0] (Palms) — no regression.
    const gpsNearest = userPosition ? closestLocal[0] : null;
    // 2026-06-08 — Fix sticky-Menifee: on tab remount `selected` resets to
    // null and we used to fall straight back to LOCAL_COURSES[0] (Menifee
    // Palms), clobbering the user's actual pick. Restore their last
    // explicit selection (previewCourseId) before the hardcoded default.
    // Priority: live GPS-nearest → last picked → home → catalog top.
    const previewMatch = previewCourseId
      ? LOCAL_COURSES.find(l => l.id === previewCourseId) ?? null
      : null;
    const defaultPick = gpsNearest ?? previewMatch ?? homeMatch ?? LOCAL_COURSES[0];
    if (defaultPick) void selectSummary(defaultPick);
    // selectSummary is intentionally not in deps — it'd retrigger on every
    // closure refresh. We only want this once per mount + once GPS resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeCourse, isRoundActive, activeCourseId, activeCourse, userPosition, previewCourseId]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    /**
     * 2026-08-12 (Tim, an hour before playing — "Where the hell did Wachusett go? It's still not
     * showing") — THE CITY/STATE HINT WAS ERASING REAL COURSES.
     *
     * This used to append the hint to the query: `${name} ${loc}`. The upstream does a literal NAME
     * match, not a fielded search, so the hint doesn't sharpen anything — it makes the name wrong.
     * Measured against the live API:
     *
     *     q="Wachusett"                  → 1 hit
     *     q="Wachusett MA"               → 0 hits
     *     q="Wachusett West Boylston MA" → 0 hits
     *
     * So any player with a location hint set could not find a course that plainly exists. Searching
     * the NAME is the reliable call; the hint is only useful for choosing between several courses
     * with the same name, which is a filter over results, not a change to the question.
     */
    const loc = locationQueryRef.current.trim();
    const effective = trimmed;
    // Skip the network call if this exact query is already in flight or
    // was the last completed search — prevents the debounce from re-firing
    // for trailing whitespace / cursor moves.
    if (lastQueryRef.current === effective && searching) return;
    lastQueryRef.current = effective;
    const mySeq = ++searchSeqRef.current;
    setSearching(true);
    setSearchError(null);
    // 2026-07-24 (final QA) — match BUNDLED courses locally FIRST, so typing a bundled name
    // ("Killian", "Highland", "Miccosukee") always resolves — even offline or on an API error. These
    // show immediately (before/without the network round-trip); API results merge in, deduped by id.
    const ql = trimmed.toLowerCase();
    const localMatches: CourseSummary[] = LOCAL_COURSES.filter(c =>
      c.club_name.toLowerCase().includes(ql) || c.location.toLowerCase().includes(ql),
    );
    setResults(localMatches);
    setAiResult(null);
    setHasSearched(true);
    try {
      const found = await searchCourses(effective);
      // Audit — drop response if a newer request superseded us.
      if (mySeq !== searchSeqRef.current) return;
      const localIds = new Set(localMatches.map(c => c.id));
      const mapped: CourseSummary[] = found
        .filter(r => !r._error && !localIds.has(r.id))
        .map(r => ({
          id: r.id,
          club_name: r.club_name,
          location: r.location,
          rating: null,
          slope: null,
        }));
      /**
       * The hint now RANKS rather than restricts: courses whose location contains it float to the
       * top, and everything else still shows. A hint that matches nothing costs the player nothing,
       * which is the opposite of the old behaviour.
       */
      const locLower = loc.toLowerCase();
      const ranked = locLower
        ? [...mapped].sort((a, b) => {
            const am = a.location.toLowerCase().includes(locLower) ? 0 : 1;
            const bm = b.location.toLowerCase().includes(locLower) ? 0 : 1;
            return am - bm;
          })
        : mapped;
      const merged = [...localMatches, ...ranked];
      setResults(merged);
      const err = found.find(r => r._error);
      // Only surface the connectivity error when we have NOTHING to show — a bundled match makes
      // "check your connection" both wrong and unhelpful (the course is right there).
      if (err && merged.length === 0) setSearchError(err._error ?? 'Search unavailable.');
      // 2026-06-30 — the DB responded but had NO match (not a network error): fall back
      // to the AI identifier so a real course off the DB still resolves. Keeps the main
      // spinner up while it runs (~2-4s) so there's no empty-state flicker. Skip when a bundled
      // course already matched.
      else if (merged.length === 0) {
        // The AI identifier is the one caller that genuinely benefits from the hint — it reasons
        // over context rather than matching a literal string, so "Wachusett, MA" helps it. Only the
        // literal course-DB search must get the bare name.
        const ai = await aiSearchCourse(loc ? `${effective} ${loc}` : effective);
        if (mySeq === searchSeqRef.current) setAiResult(ai);
      }
    } catch (e) {
      if (mySeq !== searchSeqRef.current) return;
      console.warn('[play] search failed:', e);
      // Network failed — keep any bundled matches (they don't need the network); only error if none.
      if (localMatches.length === 0) setSearchError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      // Only clear searching if we're still the latest request, otherwise
      // the newer request owns the spinner state.
      if (mySeq === searchSeqRef.current) setSearching(false);
    }
  }, [searching]);

  // Submit handler: same path as the debounce but bypasses the timer.
  const onSearch = useCallback(() => { void runSearch(query); }, [runSearch, query]);

  // Bug fix — root cause was failure mode (a): no debounced effect, so
  // typing without pressing Enter or tapping the Search button ran no
  // network call at all. The user perceived 'no results' because the
  // request was never made.
  // Debounce 300ms after the last keystroke, only when query is >= 3 chars.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      // Reset results + searched flag so the empty-state copy reverts to the
      // 'type to search' hint instead of 'no courses found for ...'.
      if (hasSearched) {
        setResults([]);
        setAiResult(null);
        setHasSearched(false);
        setSearchError(null);
        lastQueryRef.current = '';
      }
      return;
    }
    const id = setTimeout(() => { void runSearch(trimmed); }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const selectSummary = useCallback(async (s: CourseSummary) => {
    // M2 — auto-toggle 9-Hole chip when the selected course has exactly
    // 9 bundled holes (e.g. Echo Hills, Mariners Point). getBundledHoles
    // returns [] for non-local or unknown ids, so this is a no-op for
    // 18-hole and API-only courses.
    const bundledHoles = getBundledHoles(s.id);
    if (bundledHoles.length === 9) {
      setSetupNineHole(true);
    } else if (bundledHoles.length > 0) {
      // DP-4 — reset the chip for a known non-9-hole course so it can't
      // stick ON after switching from a 9-hole pick. len===0 (unknown /
      // API-only / loading) is left untouched so a manual override survives.
      setSetupNineHole(false);
    }
    if (s.isLocal) {
      // 2026-07-25 (deep audit — S1 fabrication) — was hardcoded `par_total: 72, holes: [], 6527y`
      // for EVERY local course, so the card read "18 holes · Par 72" for Mines (par 70), 9-hole
      // courses, etc. — and contradicted the 9-Hole chip toggled just above. Derive the real par /
      // hole count / yards from the bundled holes we already resolved (bundledHoles). Falls back to
      // the old neutral values only if a local course somehow has no bundled data (shouldn't happen).
      const teeHoles: import('../../types/course').Hole[] = bundledHoles.map((h) => ({
        hole_number: h.hole,
        par: h.par,
        yardage: h.distance ?? 0,
        handicap: null,
        gps: null,
        hazards: [],
      }));
      const realPar = teeHoles.reduce((a, h) => a + (h.par || 0), 0);
      const realYards = teeHoles.reduce((a, h) => a + (h.yardage || 0), 0);
      setSelected({
        id: s.id,
        club_name: s.club_name,
        course_name: s.club_name,
        location: { city: s.location.split(',')[0]?.trim() ?? '', state: s.location.split(',')[1]?.trim() ?? '', country: 'US' },
        tees: [{
          tee_name: 'default',
          total_yards: realYards > 0 ? realYards : 6527,
          course_rating: s.rating, slope_rating: s.slope,
          par_total: realPar > 0 ? realPar : 72,
          holes: teeHoles,
        }],
        cached_at: Date.now(),
      });
      setSelectedHero(null);
      // Mirror the selection into previewCourseId so pre-round surfaces
      // (SmartVision preview, L1HolePreview, hole-view) can resolve the
      // chosen course BEFORE the user taps Start Round. Distinct from
      // pendingStartCourseId — which triggers an auto-launch round when
      // the Caddie tab sees it. previewCourseId is a render-only hint.
      // Bundled courses carry a centroid on the summary — pass it for the same reason.
      useRoundStore.getState().setPreviewCourse(
        s.id,
        s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null,
      );
      // 2026-07-23 (Tim) — build SmartVision hole imagery on selection: warm course
      // geometry + per-hole satellite tiles now so the maps are instant (and offline)
      // before the round starts. Fire-and-forget, once-per-session per course.
      if (bundledHoles.length > 0) {
        void prefetchCourseImagery({
          courseId: s.id,
          courseName: s.club_name,
          courseLocation: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null,
          holes: bundledHoles,
        });
      }
      return;
    }
    setSelectedLoading(true);
    setSelectError(null);
    try {
      // 2026-08-08 (2-week audit O3 — GPS-nearby cards were a PERMANENT dead end). The nearby list mints
      // synthetic ids (place:<google_place_id> / near:<name>) that the course API can't resolve — tapping
      // one 404'd forever ("tap to retry" could never succeed). Resolve them by NAME first (the same
      // pattern the (i) button uses), then load the real API id.
      let resolveId = s.id;
      if (String(s.id).startsWith('place:') || String(s.id).startsWith('near:')) {
        const found = await searchCourses(s.club_name ?? '');
        const real = found.find(r => !r._error && r.id);
        if (!real) {
          setSelectError(`Couldn't find "${s.club_name}" in the course database — try the search box.`);
          setSelectedLoading(false);
          return;
        }
        resolveId = real.id;
      }
      const c = await getCourse(resolveId);
      if (c) {
        setSelected(c);
        // 2026-08-11 — hand the course's OWN coordinates to the preview surfaces straight away.
        // They previously had to wait on a geometry build to know where the course was, which is
        // why a searched course showed a green screen and a blank thumbnail while (or if) that
        // build completed. The record we just fetched already carries lat/lng.
        const cLat = c.location?.latitude, cLng = c.location?.longitude;
        const cCoords =
          typeof cLat === 'number' && typeof cLng === 'number' &&
          Number.isFinite(cLat) && Number.isFinite(cLng) &&
          Math.abs(cLat) <= 90 && Math.abs(cLng) <= 180 &&
          !(Math.abs(cLat) < 0.001 && Math.abs(cLng) < 0.001)
            ? { lat: cLat, lng: cLng }
            : null;
        useRoundStore.getState().setPreviewCourse(c.id, cCoords);
        try {
          const courseLocation =
            typeof c.location?.latitude === 'number' &&
            typeof c.location?.longitude === 'number' &&
            Number.isFinite(c.location.latitude) &&
            Number.isFinite(c.location.longitude) &&
            Math.abs(c.location.latitude) <= 90 &&
            Math.abs(c.location.longitude) <= 180 &&
            !(Math.abs(c.location.latitude) < 0.001 && Math.abs(c.location.longitude) < 0.001)
              ? { lat: c.location.latitude, lng: c.location.longitude }
              : null;
          // 2026-07-22 (Tim) — booking coverage for ANY searched/opened course: anchor its
          // REAL website + booking URL from Google Places so the tee-time button opens the
          // course's own booking widget (teeTimeLink tier 1) instead of only a Google search.
          // Idempotent (skips if already anchored) + best-effort; fire-and-forget so it never
          // blocks the geometry/hero warm.
          void lookupCoursePlaces({ courseId: c.id, name: c.club_name, lat: courseLocation?.lat ?? null, lng: courseLocation?.lng ?? null });
          // 2026-08-09 — run the download ENGINE on selection too: it orchestrates the full prefetch
          // chain (content + intelligence on top of the geometry/imagery below) and marks the course
          // available offline in downloadedCoursesStore. Idempotent; caches make re-runs cheap.
          void import('../../services/courseDownloadEngine')
            .then((eng) => eng.downloadCourse({ name: c.club_name, courseId: c.id, lat: courseLocation?.lat ?? null, lng: courseLocation?.lng ?? null }))
            .catch(() => undefined);
          await fetchCourseGeometry(c.id, { courseLocation });
          // Build SmartVision hole imagery on selection for searched/API courses too —
          // geometry (just fetched) + per-hole satellite tiles, persisted for offline.
          // 2026-08-12 — the player's Preferred Tee, not just the first set. This is the tee whose
          // HOLES become the round, so taking tees[0] here quoted back-tee yardages to a player who
          // had chosen front. Same fix as the course screen; this surface was missed.
          const teeHoles = pickTeeSet(c.tees, preferredTee)?.holes ?? [];
          if (teeHoles.length > 0) {
            void prefetchCourseImagery({
              courseId: c.id,
              courseName: c.club_name,
              courseLocation,
              holes: teeHoles.map((h, i) => ({ hole: h.hole_number ?? i + 1, par: h.par ?? 4, distance: h.yardage ?? 0 })),
            });
          }
          const tee = pickTeeSet(c.tees, preferredTee);
          if (tee) {
            const url = getCourseImageryUrl({
              courseId: c.id,
              holes: tee.holes.map(h => {
                const g = getHoleGeometry(c.id, h.hole_number);
                return { tee: g?.tee ?? null, green: g?.green ?? null };
              }),
            }, 200, 200);
            setSelectedHero(url);
          }
        } catch (e) { console.log('[play] geometry warm failed:', e); }
      } else {
        // getCourse returned null — the course has no loadable record. Give the tester a next step.
        setSelectError("Couldn't open that course. Tap it again to retry.");
      }
    } catch (e) {
      console.log('[play] selectSummary failed:', e);
      setSelectError('Trouble opening that course — check your connection and tap it again.');
    } finally {
      setSelectedLoading(false);
    }
  }, []);

  // Local courses don't have a real API course_id (their id is the
  // synthetic 'local:palms'). When the user taps (i) on a local row,
  // resolve the course by name via the API search so Course Detail can
  // load real metadata + AI About / Caddie Tips / Hole Notes. If no
  // match, fall back to the local-id route (which renders a quiet
  // "no detailed data" empty state).
  const onTapInfo = useCallback(async (c: CourseSummary) => {
    if (!c.isLocal) {
      pushCourseGuarded(router, c.id);
      return;
    }
    try {
      const found = await searchCourses(c.club_name);
      const real = found.find(r => !r._error);
      if (real) {
        pushCourseGuarded(router, real.id);
        return;
      }
    } catch (e) {
      console.log('[play] local-course info resolve failed:', e);
    }
    pushCourseGuarded(router, c.id);
  }, [router]);

  const handleStartRound = () => {
    if (!selected) return;
    // 2026-06-15 (Tim — pre-round brief fired ~25s late) — warm the brief + TTS
    // Lambdas at round start so the hole-1 handoff isn't the first (cold) hit.
    // Fire-and-forget; both dedupe-throttled internally.
    prewarmBriefing(getApiBaseUrl());
    prewarmVoice();
    // Pre-beta — push the chosen play factors alongside the course id so
    // Caddie's runStartRound launches with the user's strategy / mental /
    // format selection instead of the bare 'free_play' default.
    useRoundStore.getState().setPendingStartFactors({
      mode: setupMode,
      nineHole: setupNineHole,
      isCompetition: setupCompetition,
      mentalState: setupMental,
      notes: setupNotes,
    });
    useRoundStore.getState().setPendingStartCourse(selected.id);
    router.push('/(tabs)/caddie' as never);
  };

  // 2026-07-06 (hands-free / fast-open) — ONE-TAP start from the GPS "you're here"
  // banner. The banner only shows when GPS puts you AT a known course, so the obvious
  // action is "go" — not select → scroll → Start Round → briefing. Start directly with
  // that course id (the same id the banner already resolves via selectSummary→getCourse,
  // and which the Caddie tab's runStartRound resolves), carrying current setup defaults.
  const startRoundAtCourse = (s: CourseSummary) => {
    prewarmBriefing(getApiBaseUrl());
    prewarmVoice();
    void selectSummary(s); // keep the Play-tab UI in sync (fire-and-forget)
    useRoundStore.getState().setPendingStartFactors({
      mode: setupMode,
      nineHole: setupNineHole,
      isCompetition: setupCompetition,
      mentalState: setupMental,
      notes: setupNotes,
    });
    useRoundStore.getState().setPendingStartCourse(s.id);
    router.push('/(tabs)/caddie' as never);
  };

  const handleHoleMap = () => {
    if (!selected) return;
    // 2026-06-12 — the legacy hole-view screen was retired (it was ~90% duplicated by
    // SmartVision). Preview the selected course's hole map in SmartVision, which resolves
    // the course from previewCourseId — set here so it's guaranteed before navigation.
    // 2026-07-04 (elite-clean audit, menu finding #13) — gate like every other
    // SmartVision entry (inert while subscriptions are off; correct when they turn on).
    if (!canAccess('smartvision', usePlayerProfileStore.getState().subscription_status)) {
      void triggerPaywall('smartvision', () => router.push('/paywall' as never));
      return;
    }
    useRoundStore.getState().setPreviewCourse(selected.id);
    router.push('/smartvision' as never);
  };

  const handleRangeBook = async () => {
    if (!selected) return;
    // 2026-07-04 (elite-clean audit, menu finding #7) — "Log" used to push the raw
    // id, so a LOCAL course landed on the synthetic local: route's "no detailed
    // data" empty state while the (i) button on the SAME row resolved the real API
    // id first and got full detail. Resolve local ids the same way (i) does.
    if (String(selected.id).startsWith('local:')) {
      try {
        const found = await searchCourses(selected.club_name ?? selected.course_name ?? '');
        const real = found.find(r => !r._error);
        if (real) { pushCourseGuarded(router, real.id); return; }
      } catch (e) {
        console.log('[play] local-course log resolve failed:', e);
      }
    }
    pushCourseGuarded(router, selected.id);
  };

  // 2026-08-07 (Tim — "get the GolfNow functionality without the stupid ads, really full flow"). Step 1
  // of the booking flow: an HONEST tee-time hand-off. We don't have a tee-time API partnership (GolfNow /
  // TeeOff have no free public booking API), so this opens a tee-time search for THIS course in the
  // browser — surfacing the course's own booking + aggregators without making the player browse the
  // ad-heavy GolfNow app. Deliberately not labeled/claimed as in-app booking (that needs a partnership).
  const handleBookTeeTime = () => {
    if (!selected) return;
    const name = (selected.club_name ?? selected.course_name ?? '').trim();
    if (!name) return;
    const city = selected.location?.city ?? '';
    const state = selected.location?.state ?? '';
    const loc = [city, state].filter(Boolean).join(' ').trim();
    const q = encodeURIComponent(`${name}${loc ? ` ${loc}` : ''} tee times`);
    const url = `https://www.google.com/search?q=${q}`;
    Linking.openURL(url).catch((e) => {
      console.log('[play] tee-time hand-off failed:', e);
    });
  };

  // 2026-07-01 (Tim) — the whole course at a glance (par/yardage per hole, out/in/total). Works
  // for local, API, and custom scorecard courses via the course-layout screen's own resolution.
  const handleCourseLayout = () => {
    if (!selected) return;
    useRoundStore.getState().setPreviewCourse(selected.id);
    router.push(`/course-layout?courseId=${encodeURIComponent(selected.id)}&name=${encodeURIComponent(selected.club_name ?? selected.course_name ?? 'Course')}` as never);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      {/* Shared v3 brand row — logo tap opens the listening session
          (default behavior across every tab). */}
      <BrandHeaderRow />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={isWide ? { alignItems: 'center' } : undefined}
      >
       <View style={isWide ? { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH } : undefined}>
        {/* 2026-08-10 (Tim — what's-new hero) — surfaces new changelog items the player hasn't seen since
            their last load, FIRST, above everything. Dismissible; renders nothing when nothing is new. */}
        <WhatsNewHeroCard />
        {/* 2026-06-16 (Tim — Play mockup) — title + tagline header (look/feel). */}
        <View style={styles.playTitleBlock}>
          <Text style={styles.playTitle}>{t('play.title', { defaultValue: 'PLAY' })}</Text>
          <Text style={styles.playTagline}>{t('play.tagline', { defaultValue: 'Smart guidance. Lower scores.' })}</Text>
        </View>

        {/* 2026-08-07 (Tim — "the hero card is basic as shit… no thumbnail, course info, description, add
            user history on that course. This is a pre-App-Store release"). Rich NEAREST-COURSE hero: live
            satellite thumbnail, distance, rating/slope, and the player's OWN record at that course from
            roundHistory (rounds / best / last). One tap starts the round. Suppressed when co-located
            siblings are ambiguous (the atCourse "which course?" banner handles that). */}
        {heroCourse && (() => {
          // 2026-08-10 — was an inline private fallback; now the shared resolver, so the hero and
          // the rows below it can never disagree about a course's thumbnail.
          const thumb = thumbFor(heroCourse);
          const dist = distanceLabelById[heroCourse.id];
          const vsPar = (n: number | null) => n == null ? null : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
          const info: string[] = [];
          if (heroCourse.rating != null) info.push(`${heroCourse.rating.toFixed(1)}${heroCourse.slope != null ? `/${heroCourse.slope}` : ''}`);
          else if (heroCourse.slope != null) info.push(`Slope ${heroCourse.slope}`);
          if (heroCourse.location) info.push(heroCourse.location);
          const historyLine = heroStats && heroStats.rounds > 0
            ? [
                `Played ${heroStats.rounds}×`,
                heroStats.bestScore != null ? `Best ${heroStats.bestScore}${vsPar(heroStats.bestVsPar) ? ` (${vsPar(heroStats.bestVsPar)})` : ''}` : null,
                heroStats.lastScore != null ? `Last ${heroStats.lastScore}` : null,
              ].filter(Boolean).join('  ·  ')
            : "First time here — I'll learn it with you";
          return (
            <TouchableOpacity
              style={styles.heroCard}
              activeOpacity={0.9}
              onPress={() => startRoundAtCourse(heroCourse)}
              accessibilityRole="button"
              accessibilityLabel={`Start a round at ${heroCourse.club_name}`}
            >
              <View style={styles.heroImageWrap}>
                {thumb
                  ? <Image source={thumb} style={styles.heroImage} resizeMode="cover" />
                  : <View style={[styles.heroImage, styles.heroImagePlaceholder]}><AppIcon name="golf" size={30} color="#00C896" /></View>}
                <View style={styles.heroKickerBadge}>
                  <AppIcon name="location" size={11} color="#001b12" />
                  <Text style={styles.heroKickerBadgeText}>{dist ? `NEAREST · ${dist}` : 'NEAREST'}</Text>
                </View>
              </View>
              <View style={styles.heroBody}>
                <Text style={styles.heroCourseName} numberOfLines={1}>{heroCourse.club_name}</Text>
                {info.length > 0 && <Text style={styles.heroMeta} numberOfLines={1}>{info.join('  ·  ')}</Text>}
                <View style={styles.heroHistoryRow}>
                  <AppIcon name={heroStats && heroStats.rounds > 0 ? 'stats-chart' : 'sparkles'} size={13} color="#00C896" />
                  <Text style={styles.heroHistoryText} numberOfLines={1}>{historyLine}</Text>
                </View>
                <View style={styles.heroStartBtn}>
                  <Text style={styles.heroStartBtnText}>Start round</Text>
                  <AppIcon name="arrow-forward" size={15} color="#001b12" />
                </View>
              </View>
            </TouchableOpacity>
          );
        })()}

        {/* 2026-06-10 — Tournament Mode moved into the round-setup FORMAT row
            (next to 9-Hole / Competition) so it lives with the other format
            choices instead of as a standalone card pinned to the top of the tab. */}

        {/* 2026-06-02 — Fix GO (Tim req): removed the 2026 Hayes Open
            card. 2026-06-04 — Maplewood + Pembroke Pines bundles also
            removed pending IP-clean re-bundle of their UI-chrome'd
            screenshots; HAYES_OPEN_COURSE_IDS + TOURNAMENT_QUICK_LAUNCH_IDS
            were emptied in the same pass. */}

        {/* Active-round banner — End Round lives here so the user doesn't
            have to dig into the Tools menu. Confirms before tearing down
            the round to avoid an accidental tap during course browsing. */}
        {isRoundActive && (
          <View style={styles.activeRoundBanner}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.activeRoundLabel}>{t('play.active_round')}</Text>
              <Text style={styles.activeRoundCourse} numberOfLines={1}>
                {activeCourse ?? 'In progress'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.endRoundBtn}
              onPress={() => {
                Alert.alert(
                  t('play.end_round_title'),
                  t('play.end_round_body'),
                  [
                    { text: t('play.keep_playing'), style: 'cancel' },
                    {
                      text: t('play.save_end'),
                      onPress: () => {
                        const roundId = endRound();
                        try { router.push(`/recap/${roundId}` as never); }
                        catch (e) { console.log('[play] recap nav failed', e); }
                      },
                    },
                    {
                      text: t('play.discard'),
                      style: 'destructive',
                      onPress: () => {
                        // 2026-05-17 — confirm-twice on destructive so a
                        // misfire doesn't nuke a round in progress.
                        Alert.alert(
                          t('play.discard_title'),
                          t('play.discard_body'),
                          [
                            { text: t('play.cancel'), style: 'cancel' },
                            { text: t('play.discard_everything'), style: 'destructive', onPress: () => { discardRound(); } },
                          ],
                        );
                      },
                    },
                  ],
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="End round"
            >
              <Text style={styles.endRoundBtnText}>{t('play.end_round')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>{t('play.course_discovery')}</Text>
            <Text style={styles.h1Sub}>{t('play.course_discovery_sub')}</Text>
          </View>
          {/* 2026-06-11 — one-tap GPS refresh: re-sort courses by proximity.
              Replaces the SmartFinder shortcut that lived here — this header slot
              was always meant to be the GPS/location action (SmartFinder stays
              reachable from the Caddie tab + /smartfinder). GPS fires only on
              tap; no auto-pull on focus. */}
          <TouchableOpacity
            style={styles.scopeBtn}
            onPress={() => void refreshLocation()}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby courses from your current location"
          >
            <AppIcon name={locating ? 'sync' : 'locate-outline'} size={20} color="#00C896" />
          </TouchableOpacity>
        </View>

        {/* Closest Local */}
        <Text style={styles.sectionLabel}>{t('play.closest_courses')}</Text>
        {/* Phase 405 wave 3 — auto-detect banner. Only renders when GPS
            puts the player within ~550y of a known course, so most users
            never see it (no pollution); when it fires, it's strongly
            indicative the player is on-site and should use that course.
            Tap to load. */}
        {atCourse && !isRoundActive && atCourse.sibling && (
          // 2026-07-24 (final QA) — co-located courses (Menifee Palms/Lakes): GPS can't tell which
          // nine you're on, so ASK instead of one-tap-starting the wrong par/yardages.
          // 2026-07-30 (audit #1 — DATA LOSS) — hidden while a round is ACTIVE; startRound wipes the
          // in-progress round, so a one-tap "start a round" mid-round must not be offered.
          <View style={styles.atCourseBanner}>
            <AppIcon name="golf" size={14} color="#00C896" />
            <Text style={styles.atCourseBannerText} numberOfLines={2}>
              You&apos;re at{' '}
              <Text style={styles.atCourseBannerStrong}>{atCourse.course.club_name.split(/\s[—-]\s/)[0]}</Text> · which course?
            </Text>
            {[atCourse.course, atCourse.sibling].map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.atCourseChoiceBtn}
                onPress={() => startRoundAtCourse(c)}
                accessibilityRole="button"
                accessibilityLabel={`Start a round at ${c.club_name}`}
              >
                <Text style={styles.atCourseChoiceText}>{c.club_name.split(/\s[—-]\s/).pop()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {atCourse && !isRoundActive && !atCourse.sibling && selected?.id !== atCourse.course.id && (
          <TouchableOpacity
            style={styles.atCourseBanner}
            onPress={() => startRoundAtCourse(atCourse.course)}
            accessibilityRole="button"
            accessibilityLabel={`Start a round at ${atCourse.course.club_name}`}
          >
            <AppIcon name="golf" size={14} color="#00C896" />
            <Text style={styles.atCourseBannerText} numberOfLines={2}>
              You&apos;re at <Text style={styles.atCourseBannerStrong}>{atCourse.course.club_name}</Text> · tap to start your round
            </Text>
            <AppIcon name="chevron-forward" size={14} color="#00C896" />
          </TouchableOpacity>
        )}
        <View style={styles.localList}>
          {/* 2026-07-23 (Tim — "Dad didn't see Highland Links when he played") — collapsing to the
              5 GPS-closest only makes sense WITH a GPS fix. Without one (clubhouse, cold start, or the
              app opened before arriving) "closest" is meaningless and was BURYING a course the player
              needed behind "Show all". So: no fix → show every course; fix present → keep the tidy
              5-closest with the expand toggle. Voice ("pull up Highland Links") is the direct path. */}
          {((showAllCourses || !userPosition) ? closestLocal : closestLocal.slice(0, NEARBY_COLLAPSED)).map(c => {
            const isActive = selected?.id === c.id || activeCourseId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.localRow, isActive && styles.localRowActive]}
                onPress={() => selectSummary(c)}
                activeOpacity={0.85}
              >
                <View style={styles.localThumb}>
                  {thumbFor(c) ? (
                    <Image source={thumbFor(c) as ImageSourcePropType} style={styles.localThumbImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.localThumbImg, styles.thumbPlaceholder]}>
                      <AppIcon name="golf-outline" size={20} color="#00C896" />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.localName} numberOfLines={1}>{c.club_name}</Text>
                  <Text style={styles.localMeta} numberOfLines={1}>
                    {c.location}
                    {c.rating != null && ` · Rating ${c.rating.toFixed(1)}`}
                    {c.slope != null && ` · Slope ${c.slope}`}
                  </Text>
                </View>
                {/* Phase 407 — distance-from-player chip. Only renders
                    when the GPS sort has computed a value for this
                    course. Courses missing coords show no chip. */}
                {distanceLabelById[c.id] && (
                  <View style={styles.distancePill}>
                    <Text style={styles.distancePillText}>{distanceLabelById[c.id]}</Text>
                  </View>
                )}
                {isActive && <AppIcon name="checkmark" size={18} color="#00C896" />}
                <TouchableOpacity
                  onPress={() => onTapInfo(c)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.infoBtn}
                >
                  <AppIcon name="information-circle-outline" size={20} color="#00C896" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
          {/* Show-all / minimize toggle — only when GPS gave a proximity order AND there's more than
              the collapsed count. With no GPS fix every course is already shown (above), so no toggle. */}
          {userPosition && closestLocal.length > NEARBY_COLLAPSED && (
            <TouchableOpacity
              style={styles.showAllRow}
              onPress={() => setShowAllCourses(v => !v)}
              accessibilityRole="button"
              accessibilityLabel={showAllCourses ? 'Show fewer courses' : `Show all ${closestLocal.length} courses`}
            >
              <Text style={styles.showAllText}>
                {showAllCourses ? 'Show less' : `Show all ${closestLocal.length} courses`}
              </Text>
              <AppIcon name={showAllCourses ? 'chevron-up' : 'chevron-down'} size={16} color="#00C896" />
            </TouchableOpacity>
          )}
        </View>

        {/* Course search — golfcourseapi-backed lookup for non-local courses. */}
        {/* 2026-07-01 (re-audit) — removed the "Courses / Range + Practice" toggle:
            searchKind was never read by runSearch (always searchCourses), so the
            pill was a visibly-dead control. Re-add wired if range search ships. */}
        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>{t('play.search_courses')}</Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('play.search_placeholder')}
            placeholderTextColor="#3a5a40"
            onSubmitEditing={onSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={onSearch}>
            <Text style={styles.searchBtnText}>{searching ? '…' : 'Search'}</Text>
          </TouchableOpacity>
        </View>

        {/* 2026-07-23 (Tim) — optional City/State to sharpen the match (golfcourseapi has no
            location fields, so we fold this into the query). */}
        <TextInput
          style={[styles.searchInput, { marginTop: 8 }]}
          value={locationQuery}
          onChangeText={(v) => { setLocationQuery(v); locationQueryRef.current = v; }}
          placeholder="City, State (optional) — narrows the search"
          placeholderTextColor="#3a5a40"
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />

        {/* 2026-07-01 (Tim) — add a course that isn't in the database from a scorecard photo. */}
        <TouchableOpacity
          style={styles.addFromPhotoBtn}
          onPress={() => router.push('/add-course' as never)}
          accessibilityRole="button"
          accessibilityLabel="Add a course from a scorecard photo"
        >
          <Text style={styles.addFromPhotoText}>＋  Course not listed? Add from a scorecard photo</Text>
        </TouchableOpacity>

        {/* 2026-08-07 (Tim) — GPS auto-detected nearby courses (course engine → Google Places), shown when
            the player hasn't typed a manual search. Each taps through selectSummary → golfcourseapi, same as
            a typed result. Makes the search section location-aware instead of type-only. */}
        {!hasSearched && !searching && nearbyApiCourses.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Courses near you</Text>
            {nearbyApiCourses.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[styles.localRow, { marginHorizontal: 16, marginTop: 6 }]}
                onPress={() => void selectSummary(r)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${r.club_name}`}
              >
                {/* 2026-08-10 — these GPS-located rows always carry real coords from the locator,
                    so they get a true satellite thumbnail instead of the old pin placeholder. */}
                <View style={styles.localThumb}>
                  {thumbFor(r) ? (
                    <Image source={thumbFor(r) as ImageSourcePropType} style={styles.localThumbImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.localThumbImg, styles.thumbPlaceholder]}>
                      <AppIcon name="location-outline" size={20} color="#00C896" />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.localName} numberOfLines={1}>{r.club_name}</Text>
                  <Text style={styles.localMeta} numberOfLines={1}>{r.location || 'Near you'}</Text>
                </View>
                <AppIcon name="chevron-forward" size={18} color="#00C896" />
              </TouchableOpacity>
            ))}
          </>
        )}

        {searching && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#00C896" size="small" />
            <Text style={styles.statusText}>Searching…</Text>
          </View>
        )}
        {!searching && searchError && <Text style={styles.statusErr}>{searchError}</Text>}
        {/* Min-length hint — fires only when the user has started typing
            but hasn't reached the 3-char threshold the API requires. */}
        {!searching && !searchError && query.length > 0 && query.trim().length < 3 && (
          <Text style={styles.statusText}>Type at least 3 letters to search.</Text>
        )}
        {/* Pre-search hint — only when input is genuinely empty. */}
        {!searching && !searchError && results.length === 0 && query.length === 0 && !hasSearched && (
          <Text style={styles.statusText}>Type a course or city name to search.</Text>
        )}
        {/* Post-search empty results — distinct from the pre-search hint
            so the user knows the request actually ran. */}
        {!searching && !searchError && hasSearched && results.length === 0 && query.trim().length >= 3 && (
          aiResult ? (
            /* 2026-06-30 — AI fallback hit: a real course the DB didn't have. Shown as
               an info card, NOT a tappable playable row (no hole geometry / GPS overlay
               yet). Offers a tee-time search + the caddie already knows about it. */
            <View style={styles.aiCourseCard}>
              <View style={styles.aiCourseHeader}>
                <AppIcon name="sparkles-outline" size={16} color="#00C896" />
                <Text style={styles.aiCourseBadge}>AI-identified · no GPS overlay yet</Text>
              </View>
              <Text style={styles.aiCourseName} numberOfLines={2}>{aiResult.club_name || aiResult.name}</Text>
              {!!aiResult.location && <Text style={styles.aiCourseMeta}>{aiResult.location}</Text>}
              {!!aiResult.description && <Text style={styles.aiCourseDesc}>{aiResult.description}</Text>}
              <View style={styles.aiCourseBtnRow}>
                <TouchableOpacity
                  style={styles.aiCourseBtn}
                  onPress={() => {
                    const url = aiResult.website
                      ?? `https://www.google.com/search?q=${encodeURIComponent(`${aiResult.name} ${aiResult.location} tee times`)}`;
                    Linking.openURL(url).catch(() => {});
                  }}
                >
                  <AppIcon name="calendar-outline" size={16} color="#0d1a0d" />
                  <Text style={styles.aiCourseBtnText}>{aiResult.website ? 'Visit / book' : 'Search tee times'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.aiCourseNote}>
                Not in our course database, so live GPS yardages aren&apos;t available for it yet — but your caddie knows the course and can talk strategy.
              </Text>
              {/* 2026-07-27 (tester UX) — don't dead-end a tester whose home course isn't bundled:
                  offer the scorecard-photo path so they can actually play it with yardages. */}
              <TouchableOpacity
                style={[styles.addFromPhotoBtn, { marginTop: 12 }]}
                onPress={() => router.push('/add-course' as never)}
                accessibilityRole="button"
                accessibilityLabel="Add this course from a scorecard photo to play it"
              >
                <Text style={styles.addFromPhotoText}>＋  Add it from a scorecard photo to play with yardages</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.statusText}>
              No courses found for &quot;{query.trim()}&quot;. Try a different name.
            </Text>
          )
        )}

        {results.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.localRow, selected?.id === r.id && styles.localRowActive, { marginHorizontal: 16, marginTop: 6 }]}
            onPress={() => selectSummary(r)}
          >
            <View style={styles.localThumb}>
              {thumbFor(r) ? (
                <Image source={thumbFor(r) as ImageSourcePropType} style={styles.localThumbImg} resizeMode="cover" />
              ) : (
                <View style={[styles.localThumbImg, styles.thumbPlaceholder]}>
                  <AppIcon name="golf-outline" size={20} color="#00C896" />
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.localName} numberOfLines={1}>{r.club_name}</Text>
              <Text style={styles.localMeta} numberOfLines={1}>{r.location}</Text>
            </View>
            <TouchableOpacity
              onPress={() => pushCourseGuarded(router, r.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.infoBtn}
            >
              <AppIcon name="information-circle-outline" size={20} color="#00C896" />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {/* 2026-07-27 — opening a searched course is async; the card's own spinner only shows once
            `selected` is set, so give feedback during the fresh load and a retry hint if it fails. */}
        {selectedLoading && !selected && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#00C896" size="small" />
            <Text style={styles.statusText}>Opening course…</Text>
          </View>
        )}
        {!selectedLoading && selectError && <Text style={styles.statusErr}>{selectError}</Text>}

        {/* Selected course card */}
        {selected && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 22 }]}>{t('play.selected_course')}</Text>
            <View style={styles.selectedCard}>
              <View style={styles.selectedHeader}>
                <View style={styles.selectedThumb}>
                  {/* 2026-08-10 — 4th rung added: bundled hole photo → geometry-framed hero →
                      coordinate satellite tile → placeholder. Before, an API course whose geometry
                      hadn't warmed yet (no hero URL) showed a bare icon even though its own
                      lat/lng were sitting right there in the record. */}
                  {selectedLocalThumb ? (
                    <Image source={selectedLocalThumb as ImageSourcePropType} style={styles.selectedThumbImg} resizeMode="cover" />
                  ) : selectedHero ? (
                    <Image source={{ uri: selectedHero }} style={styles.selectedThumbImg} resizeMode="cover" />
                  ) : thumbFor({ lat: selected.location.latitude ?? null, lng: selected.location.longitude ?? null }) ? (
                    <Image
                      source={thumbFor({ lat: selected.location.latitude ?? null, lng: selected.location.longitude ?? null }) as ImageSourcePropType}
                      style={styles.selectedThumbImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.selectedThumbImg, styles.thumbPlaceholder]}>
                      {selectedLoading ? <ActivityIndicator size="small" color="#00C896" /> : <AppIcon name="golf-outline" size={26} color="#00C896" />}
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.selectedTitle} numberOfLines={2}>{selected.club_name}</Text>
                  <Text style={styles.selectedSub} numberOfLines={1}>
                    {[selected.location.city, selected.location.state].filter(Boolean).join(', ')}
                  </Text>
                  {pickTeeSet(selected.tees, preferredTee) && (
                    <Text style={styles.selectedStats} numberOfLines={1}>
                      {/* 2026-07-26 (deep audit S3) — don't fabricate "18 holes" when a searched tee returns
                          an empty hole list (could be a 9-hole course); show the count only when real. */}
                      {pickTeeSet(selected.tees, preferredTee)!.holes.length ? `${pickTeeSet(selected.tees, preferredTee)!.holes.length} holes · ` : ''}Par {pickTeeSet(selected.tees, preferredTee)!.par_total}
                      {pickTeeSet(selected.tees, preferredTee)!.course_rating != null && ` · Rating ${pickTeeSet(selected.tees, preferredTee)!.course_rating!.toFixed(1)}`}
                      {pickTeeSet(selected.tees, preferredTee)!.slope_rating != null && ` · Slope ${pickTeeSet(selected.tees, preferredTee)!.slope_rating}`}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={handleHoleMap}>
                  <AppIcon name="map-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>{t('play.view')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleRangeBook}>
                  <AppIcon name="book-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>{t('play.log')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleCourseLayout} accessibilityRole="button" accessibilityLabel="Course layout">
                  <AppIcon name="list-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>Layout</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleBookTeeTime} accessibilityRole="button" accessibilityLabel={`Find tee times at ${selected.club_name ?? selected.course_name ?? 'this course'}`}>
                  <AppIcon name="calendar-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>Tee Times</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Pre-beta — legacy round factors. STRATEGY (mode), FORMAT
                (nine-hole + competition), MENTAL state, NOTES. Picked
                BEFORE the round fires so Kevin briefing + caddie brain
                have the player's intent in hand. */}
            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.strategy')}</Text>
            <View style={styles.factorGrid}>
              {(Object.keys(ROUND_MODE_CARDS) as RoundMode[]).map(m => {
                const active = setupMode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.factorCard, active && styles.factorCardActive]}
                    onPress={() => setSetupMode(m)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.factorTitle, active && styles.factorTitleActive]}>{t('play.mode_' + m + '_title')}</Text>
                    <Text style={styles.factorSub} numberOfLines={2}>{t('play.mode_' + m + '_desc')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.mental')}</Text>
            <View style={styles.factorRow}>
              {(['fresh', 'neutral', 'tense'] as const).map(m => {
                const active = setupMental === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setSetupMental(m)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{t('play.mental_' + m)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.format')}</Text>
            <View style={styles.factorRow}>
              <TouchableOpacity
                style={[styles.chip, setupNineHole && styles.chipActive]}
                onPress={() => setSetupNineHole(v => !v)}
              >
                <Text style={[styles.chipText, setupNineHole && styles.chipTextActive]}>{t('play.nine_hole')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, setupCompetition && styles.chipActive]}
                onPress={() => setSetupCompetition(v => !v)}
              >
                <Text style={[styles.chipText, setupCompetition && styles.chipTextActive]}>{t('play.competition')}</Text>
              </TouchableOpacity>
              {/* 2026-06-10 — Tournament: not a toggle — opens the full group-play
                  flow (scramble/skins/match play/etc). Moved here from the old
                  standalone top-of-tab card so it sits with the format choices. */}
              <TouchableOpacity
                style={[styles.chip, { flexDirection: 'row', alignItems: 'center' }]}
                onPress={() => router.push('/tournament' as never)}
                accessibilityRole="button"
                accessibilityLabel="Tournament Mode — group play setup"
              >
                <AppIcon name="trophy" size={13} color="#00C896" />
                <Text style={[styles.chipText, { marginLeft: 5 }]}>{t('play.tournament')}</Text>
              </TouchableOpacity>
              {/* 2026-06-15 (Tim) — round CHALLENGE (break a score from a tee — the
                  Bryson break-50-from-the-reds idea) surfaced on the Play tab where it
                  belongs, instead of buried in Caddie → Tools. Opens the tee-goals flow. */}
              <TouchableOpacity
                style={[styles.chip, { flexDirection: 'row', alignItems: 'center' }]}
                onPress={() => router.push('/tee-goals' as never)}
                accessibilityRole="button"
                accessibilityLabel="Round challenge — break a score from a tee"
              >
                <AppIcon name="flag" size={13} color="#00C896" />
                <Text style={[styles.chipText, { marginLeft: 5 }]}>Challenge</Text>
              </TouchableOpacity>
            </View>

            {/* 2026-06-13 (Tim) — Getting around: walking vs cart. Stored on
                roundStore.transportMode + persisted onto the round record. */}
            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.getting_around', { defaultValue: 'GETTING AROUND' })}</Text>
            <View style={styles.factorRow}>
              <TouchableOpacity
                style={[styles.chip, { flexDirection: 'row', alignItems: 'center' }, setupTransport === 'walking' && styles.chipActive]}
                onPress={() => setSetupTransport('walking')}
                accessibilityRole="button"
                accessibilityLabel="Walking this round"
              >
                <AppIcon name="walk" size={14} color={setupTransport === 'walking' ? '#0a1410' : '#00C896'} />
                <Text style={[styles.chipText, { marginLeft: 5 }, setupTransport === 'walking' && styles.chipTextActive]}>{t('play.walking', { defaultValue: 'Walking' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, { flexDirection: 'row', alignItems: 'center' }, setupTransport === 'cart' && styles.chipActive]}
                onPress={() => setSetupTransport('cart')}
                accessibilityRole="button"
                accessibilityLabel="Riding a cart this round"
              >
                <AppIcon name="car-sport" size={14} color={setupTransport === 'cart' ? '#0a1410' : '#00C896'} />
                <Text style={[styles.chipText, { marginLeft: 5 }, setupTransport === 'cart' && styles.chipTextActive]}>{t('play.cart', { defaultValue: 'Cart' })}</Text>
              </TouchableOpacity>
            </View>

            {/* Phase 405 wave 3 — tee box selection. Standard 4 colors.
                Stored on roundStore.selectedTee + persisted onto the
                round record via startRound. Informational for v1.1
                (per-tee coordinates aren't wired into SmartFinder
                math yet); shows up in recap so the score is contextual. */}
            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.tee_box')}</Text>
            <View style={styles.factorRow}>
              {(['gold', 'blue', 'white', 'red'] as const).map(color => {
                const active = setupTee === color;
                const tint =
                  color === 'gold'  ? '#F5A623' :
                  color === 'blue'  ? '#3b82f6' :
                  color === 'white' ? '#e5e7eb' :
                                      '#ef4444';
                return (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.chip,
                      active && { borderColor: tint, backgroundColor: `${tint}22` },
                    ]}
                    onPress={() => setSetupTee(active ? 'unspecified' : color)}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${color} tees`}
                  >
                    <View style={{
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: tint, marginRight: 6,
                    }} />
                    <Text style={[
                      styles.chipText,
                      active && { color: tint, fontWeight: '800' },
                    ]}>
                      {t('play.tee_' + color)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('play.notes')}</Text>
            <View style={styles.notesRow}>
              <TextInput
                ref={notesInputRef}
                style={[styles.notesInput, styles.notesInputInRow]}
                value={setupNotes}
                onChangeText={setSetupNotes}
                placeholder={t('play.notes_placeholder')}
                placeholderTextColor="#3a5a40"
                multiline
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={() => { notesInputRef.current?.blur(); }}
              />
              <View style={styles.notesActionsCol}>
                <TouchableOpacity
                  style={[styles.notesActionBtn, notesDictating && styles.notesActionBtnActive]}
                  onPress={handleDictateNotes}
                  disabled={notesDictating}
                  accessibilityRole="button"
                  accessibilityLabel={notesDictating ? 'Listening for notes' : 'Dictate notes by voice'}
                >
                  <AppIcon
                    name={notesDictating ? 'mic' : 'mic-outline'}
                    size={18}
                    color={notesDictating ? '#0d1a0d' : '#00C896'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.notesActionBtn}
                  onPress={() => { notesInputRef.current?.blur(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Done editing notes"
                >
                  <AppIcon name="checkmark" size={18} color="#00C896" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.actionBtnPrimary, styles.startBigBtn]}
              onPress={handleStartRound}
              activeOpacity={0.88}
            >
              <AppIcon name="flag" size={16} color="#0d1a0d" />
              <Text style={styles.actionBtnPrimaryText}>{t('play.start_round')}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 30 }} />
       </View>
      </ScrollView>
      </KeyboardAvoidingView>
      {/* 2026-06-13 (Tim) — first-time quick orientation (text + caddie narration),
          copy from the shared SCREEN_HELP source so it matches "how do I use this?". */}
      <QuickTutorial
        slug="play_intro"
        title={SCREEN_HELP.play.title}
        iconName={SCREEN_HELP.play.icon as never}
        lines={SCREEN_HELP.play.lines}
        spokenText={SCREEN_HELP.play.spoken}
      />
    </SafeAreaView>
  );
}

// 2026-05-26 — Fix CA: themed StyleSheet. Hex codes that matched the
// dark-theme tokens are pulled from `c` so light mode renders correctly
// throughout. Semantic colors (Hayes red/blue stripe, error red, warning
// yellow, brand teal accent) are left as literals because they shouldn't
// flip with theme.
function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  // 2026-07-04 (elite-clean audit, menu finding #19) — deleted ~46 lines of
  // orphaned hayes* (Memorial Day 2026 card, removed 2026-06-02) and banner*
  // (old header, replaced) styles: zero JSX references remained.

  activeRoundBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 12, marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: 'rgba(0, 200, 150, 0.10)',
    borderRadius: 12, borderWidth: 1, borderColor: c.accent,
  },
  activeRoundLabel: { color: c.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  activeRoundCourse: { color: '#e8f5e9', fontSize: 14, fontWeight: '700', marginTop: 2 },
  endRoundBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  endRoundBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '800' },

  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  h1: { color: c.text_primary, fontSize: 22, fontWeight: '900' },
  h1Sub: { color: c.text_muted, fontSize: 12, marginTop: 2 },
  scopeBtn: {
    width: 40, height: 40, borderRadius: 8,
    borderWidth: 1.5, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,200,150,0.10)',
  },

  playTitleBlock: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  // 2026-07-25 (deep audit S3) — were hardcoded light hex (#f4f4f4/#9ca3af), so the "PLAY" header was
  // near-invisible in light mode while the rest of the screen themed via makeStyles(c). Use the theme.
  playTitle: { fontSize: 28, fontWeight: '900', color: c.text_primary, letterSpacing: 0.3 },
  playTagline: { fontSize: 13, fontWeight: '500', color: c.text_muted, marginTop: 2 },
  sectionLabel: {
    color: c.text_muted, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.6, paddingHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  factorGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16,
  },
  factorCard: {
    width: '48%', backgroundColor: c.surface,
    borderRadius: 12, borderWidth: 1, borderColor: c.border,
    padding: 12, gap: 4,
  },
  factorCardActive: { borderColor: c.accent, backgroundColor: c.surface_elevated },
  factorTitle: { color: c.text_primary, fontSize: 13, fontWeight: '800' },
  factorTitleActive: { color: c.accent },
  factorSub: { color: c.text_muted, fontSize: 11, lineHeight: 15 },
  factorRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipActive: { borderColor: c.accent, backgroundColor: c.surface_elevated },
  chipText: { color: c.text_muted, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: c.accent },
  notesInput: {
    marginHorizontal: 16, marginTop: 4,
    backgroundColor: c.surface, borderColor: c.border, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    color: c.text_primary, fontSize: 13, minHeight: 56, textAlignVertical: 'top',
  },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginTop: 4,
    gap: 6,
  },
  notesInputInRow: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    minHeight: 72,
  },
  notesActionsCol: {
    gap: 6,
  },
  notesActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesActionBtnActive: {
    backgroundColor: c.accent,
    borderColor: c.accent,
  },
  startBigBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginHorizontal: 16, marginTop: 18,
    paddingVertical: 14, borderRadius: 12,
  },
  localList: { paddingHorizontal: 16, gap: 6 },
  showAllRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, marginTop: 2,
  },
  showAllText: { color: '#00C896', fontSize: 13, fontWeight: '600' },
  localRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.surface, borderRadius: 12,
    borderWidth: 1, borderColor: c.border,
    padding: 8, gap: 10,
  },
  localRowActive: { borderColor: c.accent },
  localThumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', backgroundColor: c.background },
  localThumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  localName: { color: c.text_primary, fontSize: 15, fontWeight: '800' },
  localMeta: { color: c.text_muted, fontSize: 12, marginTop: 2 },
  infoBtn: { padding: 6 },
  // Phase 407 — distance-from-player pill on each course row. Sits
  // between the meta text and the active-state checkmark. Subtle teal
  // border to read as a chip, not a button.
  distancePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.45)',
    backgroundColor: 'rgba(0,200,150,0.08)',
    marginRight: 4,
  },
  distancePillText: {
    color: c.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  // Phase 405 wave 3 — "You're at X" auto-detect banner. Renders above
  // the closest-local list when GPS puts the player within ~550y of a
  // known course. Subtle teal border to read as informational, not as
  // a primary call-to-action.
  // 2026-08-07 (Tim) — rich nearest-course hero card (top of Play tab): thumbnail banner + course
  // info + the player's history at that course + a one-tap Start.
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.40)',
    backgroundColor: 'rgba(0,200,150,0.08)',
    overflow: 'hidden',
  },
  heroImageWrap: {
    width: '100%',
    height: 132,
    backgroundColor: 'rgba(0,200,150,0.10)',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroKickerBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,200,150,0.92)',
  },
  heroKickerBadgeText: {
    color: '#001b12',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  heroBody: {
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 13,
  },
  heroCourseName: {
    color: '#eafff6',
    fontSize: 19,
    fontWeight: '800',
  },
  heroMeta: {
    color: 'rgba(232,245,233,0.62)',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  heroHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  heroHistoryText: {
    flex: 1,
    color: 'rgba(232,245,233,0.9)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  heroStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 13,
    paddingVertical: 11,
    borderRadius: 11,
    backgroundColor: c.accent,
  },
  heroStartBtnText: {
    color: '#001b12',
    fontSize: 15,
    fontWeight: '800',
  },
  atCourseBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.45)',
    backgroundColor: 'rgba(0,200,150,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  atCourseBannerText: {
    flex: 1,
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '600',
  },
  atCourseBannerStrong: {
    color: c.accent,
    fontWeight: '800',
  },
  // 2026-07-24 (final QA) — co-located course chooser buttons (Palms | Lakes).
  atCourseChoiceBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,200,150,0.55)',
    backgroundColor: 'rgba(0,200,150,0.16)',
  },
  atCourseChoiceText: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '800',
  },

  kindRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  kindBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surface, alignItems: 'center',
  },
  kindBtnActive: { borderColor: c.accent, backgroundColor: 'rgba(0,200,150,0.08)' },
  kindText: { color: c.text_muted, fontSize: 14, fontWeight: '700' },
  kindTextActive: { color: c.accent },

  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, alignItems: 'center' },
  addFromPhotoBtn: { paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  addFromPhotoText: { color: '#00C896', fontSize: 13, fontWeight: '600' },
  searchInput: {
    flex: 1, backgroundColor: c.surface, borderColor: c.border,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: c.text_primary, fontSize: 14,
  },
  searchBtn: {
    backgroundColor: c.accent, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 10,
  },
  searchBtnText: { color: c.surface, fontWeight: '900', fontSize: 14 },

  statusText: { color: c.text_muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  statusErr: { color: '#fbbf24', fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  // 2026-06-30 — AI course-search fallback card.
  aiCourseCard: {
    marginHorizontal: 16, marginTop: 10, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(0,200,150,0.08)', borderWidth: 1, borderColor: 'rgba(0,200,150,0.35)',
  },
  aiCourseHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  aiCourseBadge: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  aiCourseName: { color: c.text_primary, fontSize: 17, fontWeight: '900' },
  aiCourseMeta: { color: c.text_muted, fontSize: 13, marginTop: 2 },
  aiCourseDesc: { color: c.text_primary, fontSize: 13, lineHeight: 19, marginTop: 8, opacity: 0.9 },
  aiCourseBtnRow: { flexDirection: 'row', marginTop: 12 },
  aiCourseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#00C896',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
  },
  aiCourseBtnText: { color: '#0d1a0d', fontSize: 13, fontWeight: '900' },
  aiCourseNote: { color: c.text_muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10 },

  selectedCard: {
    marginHorizontal: 16, padding: 12,
    backgroundColor: c.surface, borderRadius: 14,
    borderWidth: 1, borderColor: c.border,
  },
  selectedHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  selectedThumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: c.background },
  selectedThumbImg: { width: '100%', height: '100%' },
  selectedTitle: { color: c.text_primary, fontSize: 17, fontWeight: '900' },
  selectedSub: { color: c.text_muted, fontSize: 12, marginTop: 2 },
  selectedStats: { color: c.text_muted, fontSize: 12, marginTop: 4 },

  // Single-line three-button row — short labels (Start / View / Log) keep
  // the row tight even on Fold-closed (~344px) without wrapping.
  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'nowrap' },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 4,
    backgroundColor: 'transparent', borderColor: c.accent, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 4, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 0,
  },
  actionBtnPrimary: { backgroundColor: c.accent, borderColor: c.accent },
  actionBtnText: { color: c.accent, fontSize: 12, fontWeight: '800' },
  actionBtnPrimaryText: { color: c.surface, fontSize: 12, fontWeight: '900' },
});
}
