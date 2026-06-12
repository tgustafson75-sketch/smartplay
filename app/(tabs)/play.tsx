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
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, Alert, type ImageSourcePropType,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Location from 'expo-location';
// Phase 407 — distance helper for course-locator GPS sort
import { haversineYards } from '../../utils/geoDistance';
import { useDeviceLayout, WIDE_CONTENT_MAX_WIDTH } from '../../hooks/useDeviceLayout';
// 2026-05-26 — Fix CA: Play tab was hardcoded dark palette while the
// rest of the app respected useTheme/light mode. Importing here so
// the StyleSheet can be themed via makeStyles(colors) at the bottom.
import { useTheme } from '../../contexts/ThemeContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
// 2026-05-24 — Quick-launch Tournament Mode from a course card. Sets
// tournamentStore.courseName before navigating so the user lands on
// /tournament with the course pre-filled (saves the free-text typing).
import { useTournamentStore } from '../../store/tournamentStore';
import { type RoundMode, ROUND_MODE_CARDS } from '../../types/patterns';
import { searchCourses, getCourse } from '../../services/golfCourseApi';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { getCourseImageryUrl } from '../../services/mapboxImagery';
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
} from '../../data/localCourseImages';
import AppIcon from '../../components/AppIcon';
import { BrandHeaderRow } from '../../components/brand/BrandHeaderRow';
import type { Course } from '../../types/course';
import { getApiBaseUrl } from '../../services/apiBase';

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
const LOCAL_COURSES: CourseSummary[] = [
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
    // Phase 407 — Rancho lacks hole-1 tee coords in courses.ts; use
    // approximate clubhouse centroid from public records. Good enough
    // for distance-sort (any error <500m is invisible at city scale).
    lat: 33.4910,
    lng: -117.1390,
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
];

// 2026-06-02 — Fix GO: HAYES_OPEN_COURSE_IDS removed alongside the
// pinned card on the play tab. Memorial Day weekend trip passed; the
// courses are still in LOCAL_COURSES + TOURNAMENT_QUICK_LAUNCH_IDS
// so they remain reachable + tournament-mode-enabled via the normal
// course discovery flow.

// 2026-06-04 — Tournament Mode quick-launch set emptied with the
// Maplewood + Pembroke Pines removal. Re-add course IDs here when
// new tournament-eligible local courses get bundled.
const TOURNAMENT_QUICK_LAUNCH_IDS = new Set<string>([]);

type SearchKind = 'courses' | 'range_practice';

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
  const previewCourseId = useRoundStore(s => s.previewCourseId);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const endRound = useRoundStore(s => s.endRound);
  const discardRound = useRoundStore(s => s.discardRound);
  const homeCourse = usePlayerProfileStore(s => s.homeCourse);

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

  const [searchKind, setSearchKind] = useState<SearchKind>('courses');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CourseSummary[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Distinguish "haven't searched yet" from "searched and got zero results".
  const [hasSearched, setHasSearched] = useState(false);
  const lastQueryRef = useRef<string>('');
  // Audit — monotonic request ID. setResults / setSearchError only fire
  // when the response's seq matches the current latest seq, so a stale
  // first response can't overwrite a fresher second one mid-typing.
  const searchSeqRef = useRef<number>(0);

  const [recentCourses, setRecentCourses] = useState<CourseSummary[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedHero, setSelectedHero] = useState<string | null>(null);
  // Phase 407 — GPS position for course-locator default sort.
  // One-shot Balanced-accuracy fix at mount; refreshed when the tab
  // regains focus. Null when permission denied or fix unavailable —
  // course list falls back to catalog order in that case.
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);

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

  // Hydrate recent courses from store
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: CourseSummary[] = [];
      for (const id of recentCourseIds.slice(0, 4)) {
        const c = await getCourse(id);
        if (cancelled) return;
        if (c) {
          const tee = c.tees[0];
          out.push({
            id: c.id,
            club_name: c.club_name,
            location: [c.location.city, c.location.state].filter(Boolean).join(', '),
            rating: tee?.course_rating ?? null,
            slope: tee?.slope_rating ?? null,
          });
        }
      }
      if (!cancelled) setRecentCourses(out);
    })();
    return () => { cancelled = true; };
  }, [recentCourseIds]);

  // Phase 407 — GPS-driven default sort. When userPosition is known,
  // sort the combined catalog ascending by distance from the player.
  // Courses without lat/lng fall to the end (alphabetical among
  // themselves). When userPosition is null (no permission / no fix
  // yet), the previous catalog-then-recent insertion order is kept
  // exactly, so the behavior is no-regression at first paint.
  const closestLocal: CourseSummary[] = useMemo(() => {
    const combined: CourseSummary[] = [
      ...LOCAL_COURSES,
      ...recentCourses.filter(r => !LOCAL_COURSES.some(l => l.id === r.id)),
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
  }, [recentCourses, userPosition]);

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
  const atCourse: { course: CourseSummary; yards: number } | null = useMemo(() => {
    if (!userPosition) return null;
    let best: { course: CourseSummary; yards: number } | null = null;
    for (const c of closestLocal) {
      if (c.lat == null || c.lng == null) continue;
      const yds = haversineYards(userPosition, { lat: c.lat, lng: c.lng });
      if (yds <= 550 && (best == null || yds < best.yards)) {
        best = { course: c, yards: yds };
      }
    }
    return best;
  }, [closestLocal, userPosition]);

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
    // Skip the network call if this exact query is already in flight or
    // was the last completed search — prevents the debounce from re-firing
    // for trailing whitespace / cursor moves.
    if (lastQueryRef.current === trimmed && searching) return;
    lastQueryRef.current = trimmed;
    const mySeq = ++searchSeqRef.current;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setHasSearched(true);
    try {
      const found = await searchCourses(trimmed);
      // Audit — drop response if a newer request superseded us.
      if (mySeq !== searchSeqRef.current) return;
      const mapped: CourseSummary[] = found
        .filter(r => !r._error)
        .map(r => ({
          id: r.id,
          club_name: r.club_name,
          location: r.location,
          rating: null,
          slope: null,
        }));
      setResults(mapped);
      const err = found.find(r => r._error);
      if (err && mapped.length === 0) setSearchError(err._error ?? 'Search unavailable.');
    } catch (e) {
      if (mySeq !== searchSeqRef.current) return;
      console.warn('[play] search failed:', e);
      setSearchError(e instanceof Error ? e.message : 'Search failed.');
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
    if (s.isLocal) {
      // Local courses — synthesize a minimal Course object for display.
      setSelected({
        id: s.id,
        club_name: s.club_name,
        course_name: s.club_name,
        location: { city: s.location.split(',')[0]?.trim() ?? '', state: s.location.split(',')[1]?.trim() ?? '', country: 'US' },
        tees: [{
          tee_name: 'default', total_yards: 6527, course_rating: s.rating, slope_rating: s.slope,
          par_total: 72, holes: [],
        }],
        cached_at: Date.now(),
      });
      setSelectedHero(null);
      // Mirror the selection into previewCourseId so pre-round surfaces
      // (SmartVision preview, L1HolePreview, hole-view) can resolve the
      // chosen course BEFORE the user taps Start Round. Distinct from
      // pendingStartCourseId — which triggers an auto-launch round when
      // the Caddie tab sees it. previewCourseId is a render-only hint.
      useRoundStore.getState().setPreviewCourse(s.id);
      return;
    }
    setSelectedLoading(true);
    try {
      const c = await getCourse(s.id);
      if (c) {
        setSelected(c);
        useRoundStore.getState().setPreviewCourse(c.id);
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
          await fetchCourseGeometry(c.id, { courseLocation });
          const tee = c.tees[0];
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
      }
    } catch (e) {
      console.log('[play] selectSummary failed:', e);
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
      router.push(`/course/${c.id}` as never);
      return;
    }
    try {
      const found = await searchCourses(c.club_name);
      const real = found.find(r => !r._error);
      if (real) {
        router.push(`/course/${real.id}` as never);
        return;
      }
    } catch (e) {
      console.log('[play] local-course info resolve failed:', e);
    }
    router.push(`/course/${c.id}` as never);
  }, [router]);

  // 2026-05-24 — One-tap Tournament Mode launch with course pre-filled.
  // Sets tournamentStore.courseName BEFORE navigating so /tournament
  // mounts with the course populated — saves the user typing the same
  // course they just selected. Idempotent: if a tournament is already
  // in progress on a different course, the user sees their existing
  // setup with the courseName updated (they can tap reset on the
  // tournament screen if they want a fresh slate).
  const launchTournamentForCourse = useCallback((courseName: string) => {
    try {
      useTournamentStore.getState().setCourseName(courseName);
    } catch (e) {
      console.log('[play] launchTournamentForCourse setCourseName failed (non-fatal):', e);
    }
    router.push('/tournament' as never);
  }, [router]);

  const handleStartRound = () => {
    if (!selected) return;
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

  const handleHoleMap = () => {
    if (!selected) return;
    const tee = selected.tees[0];
    const h1 = tee?.holes[0];
    const geom = h1 ? getHoleGeometry(selected.id, 1) : null;
    router.push({
      pathname: '/hole-view',
      params: {
        hole: '1',
        par: String(h1?.par ?? 4),
        distance: String(h1?.yardage ?? 0),
        courseName: selected.club_name,
        // Phase AG followup — courseId enables anchor-capture override.
        courseId: String(selected.id ?? ''),
        teeLat: String(geom?.tee?.lat ?? 0),
        teeLng: String(geom?.tee?.lng ?? 0),
        middleLat: String(geom?.green?.lat ?? 0),
        middleLng: String(geom?.green?.lng ?? 0),
        front: '0', back: '0',
      },
    } as never);
  };

  const handleRangeBook = () => {
    if (!selected) return;
    router.push(`/course/${selected.id}` as never);
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
          {/* 2026-06-11 (lazy-load) — one-tap GPS refresh to re-sort courses by
              proximity. Replaces the auto-pull-on-focus; GPS only fires when the
              user actually wants nearby courses. */}
          <TouchableOpacity
            style={styles.scopeBtn}
            onPress={() => void refreshLocation()}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Refresh nearby courses from your current location"
          >
            <AppIcon name={locating ? 'sync' : 'navigate-circle-outline'} size={20} color="#00C896" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.scopeBtn}
            onPress={() => router.push('/smartfinder' as never)}
            accessibilityLabel="Open SmartFinder"
          >
            <AppIcon name="locate-outline" size={20} color="#00C896" />
          </TouchableOpacity>
        </View>

        {/* Closest Local */}
        <Text style={styles.sectionLabel}>{t('play.closest_courses')}</Text>
        {/* Phase 405 wave 3 — auto-detect banner. Only renders when GPS
            puts the player within ~550y of a known course, so most users
            never see it (no pollution); when it fires, it's strongly
            indicative the player is on-site and should use that course.
            Tap to load. */}
        {atCourse && selected?.id !== atCourse.course.id && (
          <TouchableOpacity
            style={styles.atCourseBanner}
            onPress={() => selectSummary(atCourse.course)}
            accessibilityRole="button"
            accessibilityLabel={`Confirm you are at ${atCourse.course.club_name}`}
          >
            <AppIcon name="location" size={14} color="#00C896" />
            <Text style={styles.atCourseBannerText} numberOfLines={2}>
              You&apos;re at <Text style={styles.atCourseBannerStrong}>{atCourse.course.club_name}</Text> · tap to use
            </Text>
            <AppIcon name="chevron-forward" size={14} color="#00C896" />
          </TouchableOpacity>
        )}
        <View style={styles.localList}>
          {closestLocal.map(c => {
            const isActive = selected?.id === c.id || activeCourseId === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.localRow, isActive && styles.localRowActive]}
                onPress={() => selectSummary(c)}
                activeOpacity={0.85}
              >
                <View style={styles.localThumb}>
                  {c.thumbnail ? (
                    <Image source={c.thumbnail as ImageSourcePropType} style={styles.localThumbImg} resizeMode="cover" />
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
                {TOURNAMENT_QUICK_LAUNCH_IDS.has(c.id) && (
                  <TouchableOpacity
                    onPress={() => launchTournamentForCourse(c.club_name)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.infoBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Start Tournament Mode at ${c.club_name}`}
                  >
                    <AppIcon name="trophy" size={18} color="#fbbf24" />
                  </TouchableOpacity>
                )}
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
        </View>

        {/* Course search — golfcourseapi-backed lookup for non-local courses. */}
        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>{t('play.search_courses')}</Text>
        <View style={styles.kindRow}>
          {(['courses', 'range_practice'] as SearchKind[]).map(k => (
            <TouchableOpacity
              key={k}
              style={[styles.kindBtn, searchKind === k && styles.kindBtnActive]}
              onPress={() => setSearchKind(k)}
            >
              <Text style={[styles.kindText, searchKind === k && styles.kindTextActive]}>
                {k === 'courses' ? 'Courses' : 'Range + Practice'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

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
          <Text style={styles.statusText}>
            No courses found for &quot;{query.trim()}&quot;. Try a different name.
          </Text>
        )}

        {results.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.localRow, selected?.id === r.id && styles.localRowActive, { marginHorizontal: 16, marginTop: 6 }]}
            onPress={() => selectSummary(r)}
          >
            <View style={[styles.localThumb, styles.thumbPlaceholder]}>
              <AppIcon name="golf-outline" size={20} color="#00C896" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.localName} numberOfLines={1}>{r.club_name}</Text>
              <Text style={styles.localMeta} numberOfLines={1}>{r.location}</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push(`/course/${r.id}` as never)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.infoBtn}
            >
              <AppIcon name="information-circle-outline" size={20} color="#00C896" />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {/* Selected course card */}
        {selected && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 22 }]}>{t('play.selected_course')}</Text>
            <View style={styles.selectedCard}>
              <View style={styles.selectedHeader}>
                <View style={styles.selectedThumb}>
                  {selected.club_name.toLowerCase().includes('palms') && PALMS_IMAGES[1] ? (
                    <Image source={PALMS_IMAGES[1] as ImageSourcePropType} style={styles.selectedThumbImg} resizeMode="cover" />
                  ) : selectedHero ? (
                    <Image source={{ uri: selectedHero }} style={styles.selectedThumbImg} resizeMode="cover" />
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
                  {selected.tees[0] && (
                    <Text style={styles.selectedStats} numberOfLines={1}>
                      {selected.tees[0].holes.length || 18} holes · Par {selected.tees[0].par_total}
                      {selected.tees[0].course_rating != null && ` · Rating ${selected.tees[0].course_rating.toFixed(1)}`}
                      {selected.tees[0].slope_rating != null && ` · Slope ${selected.tees[0].slope_rating}`}
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

  // 2026-05-24 — Hayes Open card (Memorial Day weekend skin). Subtle
  // red/blue stripe motif (USA flag colors) without going overboard;
  // matches the dark-green Play tab palette in the body.
  hayesCard: {
    marginHorizontal: 12, marginTop: 10,
    backgroundColor: '#0d1830',
    borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a5a',
    overflow: 'hidden',
  },
  hayesStripeTop:    { height: 4, backgroundColor: '#b91c1c' },
  hayesStripeBottom: { height: 4, backgroundColor: '#1d4ed8' },
  hayesHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: 12, paddingHorizontal: 14,
    gap: 8,
  },
  hayesStar:       { color: '#fbbf24', fontSize: 16, fontWeight: '900' },
  hayesTitle:      { color: '#f8fafc', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  hayesDedication: { color: '#cbd5e1', fontSize: 11, fontStyle: 'italic', textAlign: 'center', marginTop: 4, paddingHorizontal: 14 },
  hayesDates:      { color: '#94a3b8', fontSize: 10, textAlign: 'center', marginTop: 2, marginBottom: 10, paddingHorizontal: 14 },
  hayesRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#0a132b',
    borderTopWidth: 1, borderTopColor: '#1e3a5a',
  },
  hayesRowTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  hayesRowSub:   { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  hayesTrophyBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6,
    alignItems: 'center', justifyContent: 'center',
  },

  banner: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: c.background, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  bannerLogoWrap: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    overflow: 'hidden',
  },
  bannerLogo: { width: '100%', height: '100%' },
  bannerTitle: { fontSize: 18, fontWeight: '900' },
  bannerSub: { color: c.text_muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

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
