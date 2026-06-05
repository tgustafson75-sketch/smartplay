import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CourseDetailBanner from '../../components/course/CourseDetailBanner';
import HoleGuide from '../../components/course/HoleGuide';
import HolePhotosGrid from '../../components/course/HolePhotosGrid';
import { getCourse, searchCourses } from '../../services/golfCourseApi';
// 2026-05-16 — pull real hole-by-hole data (par, yardage) from the
// bundled local-courses catalog so the stub built for a local: course
// reflects the actual layout instead of a default 18-hole / par-4 /
// 380y placeholder. Reported: Mariners Point showed 18 holes at 380y
// each, when it's actually 9 par-3 holes maxing at ~160y.
import { getCourse as getLocalCourseData } from '../../data/courses';
import { fetchCourseContent, getCachedContent, type CourseContent } from '../../services/courseContentService';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore, getEffectiveSimpleBriefing } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getHoleThumbnailUrl } from '../../services/mapboxImagery';
import { openTeeTimeSearch } from '../../services/teeTimeLink';
import { getLocalHoleImage } from '../../data/localCourseImages';
import type { Course } from '../../types/course';

/**
 * Course Detail — legacy long-scroll format.
 *
 * Top to bottom (single ScrollView):
 *   < Courses back link
 *   Hero (Mapbox aerial, or Palms bundled image when Palms)
 *   Course name + location overlay on hero
 *   Stats strip (HOLES / PAR / YARDS / RATING / SLOPE)
 *   ABOUT paragraph
 *   CADDIE TIPS bullet list
 *   HOLE PHOTOS — 3-column grid (Mapbox per-hole tiles, or Palms bundled)
 *   HOLE GUIDE — # / Par / Yds / Note table with totals row
 *   Sticky bottom bar: [ Book Tee Time ]  [ Start Round Here ]
 *
 * Tied to golfcourseapi via getCourse(); AI-generated About / Caddie Tips /
 * Hole Notes via /api/course-content; per-hole + course-wide imagery via
 * Mapbox (Palms uses curated bundled screenshots as the override).
 */
export default function CourseDetailScreen() {
  const { course_id } = useLocalSearchParams<{ course_id: string }>();
  const router = useRouter();
  // useWindowDimensions subscribes to device-config changes — Galaxy Z Fold
  // reconfigure (open ↔ closed) re-renders this screen with the new width
  // instead of keeping the stale module-load value.
  // useWindowDimensions kept for the subscribe-on-rotation behavior
  // (Z Fold open/closed reconfigures don't keep stale module-load width)
  // even though the V3 redesign no longer reads the width value here.
  useWindowDimensions();
  // Phase 405b — V3 redesign dropped the collapsible ABOUT / CADDIE
  // TIPS / HOLE PHOTOS sections (no longer needed because the page is
  // shorter overall). The simpleBriefing / aboutOpen / tipsOpen /
  // photosOpen / heroFailed state hooks that supported the collapse
  // pattern are removed in the Phase 500 cleanup; if the personalization
  // branch returns later it lives in roundsTogether + getEffectiveSimpleBriefing.
  void useRelationshipStore; void getEffectiveSimpleBriefing; void useSettingsStore;
  // Bottom CTA bar adapts to active theme so Light mode doesn't show
  // a dark sliver under a dark border under a teal fill (Tim flagged
  // the Start Round button "overlapping borders in lighter modes").
  const { colors } = useTheme();
  // Safe-area insets — bottom CTA bar uses this so the home indicator /
  // gesture nav doesn't clip "Start Round" / "Book Tee Time" buttons.
  const insets = useSafeAreaInsets();

  const [course, setCourse] = useState<Course | null>(null);
  const [content, setContent] = useState<CourseContent | null>(getCachedContent(course_id ?? ''));
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [geometryReady, setGeometryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!course_id) return;
    void (async () => {
      // Local-course shortcut — synthesize a stub Course immediately
      // from bundled metadata so the detail screen renders without
      // waiting on a golfcourseapi search-then-fetch round-trip that
      // can fail when the local-friendly name doesn't match the API's
      // course list (Tim's "stuck on loading aerial photos" complaint).
      // After the stub renders, we still attempt API enrichment in the
      // background; if it succeeds we upgrade the data, but the user
      // never stares at a spinner while we figure it out.
      let realId = course_id;
      if (course_id.startsWith('local:')) {
        const slug = course_id.slice('local:'.length);
        const friendly =
          slug === 'palms' ? 'Menifee Lakes Country Club — Palms' :
          slug === 'lakes' ? 'Menifee Lakes Country Club — Lakes' :
          slug === 'rancho-california' ? 'Rancho California Golf Club' :
          slug === 'crystal-springs' ? 'Crystal Springs Golf Course' :
          slug === 'mariners-point' ? 'Mariners Point Golf Center' :
          slug === 'san-jose-muni' ? 'San Jose Municipal Golf Course' :
          slug === 'sunnyvale' ? 'Sunnyvale Golf Course' :
          slug;
        // 2026-05-16 — Pull real per-hole data from data/courses.ts when
        // we have it. The slug map below resolves the route's local
        // slug to that file's course id (mostly identity, but
        // 'rancho-california' -> 'rancho').
        const dataCourseId =
          slug === 'rancho-california' ? 'rancho' :
          slug === 'palms' ? 'palms' :
          slug === 'lakes' ? 'lakes' :
          slug === 'crystal-springs' ? 'crystal-springs' :
          slug === 'mariners-point' ? 'mariners-point' :
          slug === 'sunnyvale' ? 'sunnyvale' :
          slug === 'san-jose-muni' ? 'san-jose-muni' :
          null;
        const dataCourse = dataCourseId ? getLocalCourseData(dataCourseId) : null;

        // Build the holes array. Prefer the bundled per-hole data (with
        // correct par + yardage per hole) over the legacy generic
        // 18 × par-4 × 380y stub. Falls through to the generic stub
        // ONLY for courses we don't have data for yet (currently
        // Sunnyvale + San Jose Muni until we hand-code or fetch their
        // per-hole records).
        const realHoles: import('../../types/course').Hole[] | null = dataCourse
          ? dataCourse.holes.map(h => ({
              hole_number: h.hole,
              par: h.par,
              yardage: h.distance,
              handicap: null,
              gps: h.teeLat !== 0 && h.teeLng !== 0 ? { lat: h.teeLat, lng: h.teeLng } : null,
              hazards: [],
            }))
          : null;
        const stubHoles = realHoles ?? Array.from(
          { length: 18 },
          (_, i): import('../../types/course').Hole => ({
            hole_number: i + 1,
            par: 4,
            yardage: 380,
            handicap: null,
            gps: null,
            hazards: [],
          }),
        );
        const totalPar = dataCourse?.par ?? 72;
        const totalYards = dataCourse?.totalYards ?? 6840;
        const ratingNumber = dataCourse ? parseFloat(dataCourse.rating) : null;
        const slopeNumber = dataCourse ? parseInt(dataCourse.slope, 10) : null;

        const stubCourse: Course = {
          id: course_id,
          club_name: friendly,
          course_name: friendly,
          location: {
            city:
              slug.startsWith('rancho') ? 'Temecula' :
              slug === 'crystal-springs' ? 'Burlingame' :
              slug === 'mariners-point' ? 'Foster City' :
              slug === 'san-jose-muni' ? 'San Jose' :
              slug === 'sunnyvale' ? 'Sunnyvale' :
              'Menifee',
            state: 'CA',
            country: 'USA',
          },
          tees: [{
            tee_name: 'White',
            total_yards: totalYards,
            course_rating: ratingNumber != null && Number.isFinite(ratingNumber) ? ratingNumber : null,
            slope_rating: slopeNumber != null && Number.isFinite(slopeNumber) ? slopeNumber : null,
            par_total: totalPar,
            holes: stubHoles,
          }],
          cached_at: Date.now(),
        };
        if (!cancelled) {
          setCourse(stubCourse);
          setLoading(false);
          setGeometryReady(true); // bundled images don't need API geometry
        }
        // Background enrichment — don't await, don't block UI on it.
        void searchCourses(friendly).then(found => {
          if (cancelled) return;
          const real = found.find(r => !r._error);
          if (!real?.id) return;
          void getCourse(real.id).then(c => {
            if (!cancelled && c) setCourse(c);
            const courseLocation =
              c &&
              typeof c.location?.latitude === 'number' &&
              typeof c.location?.longitude === 'number' &&
              Number.isFinite(c.location.latitude) &&
              Number.isFinite(c.location.longitude) &&
              Math.abs(c.location.latitude) <= 90 &&
              Math.abs(c.location.longitude) <= 180 &&
              !(Math.abs(c.location.latitude) < 0.001 && Math.abs(c.location.longitude) < 0.001)
                ? { lat: c.location.latitude, lng: c.location.longitude }
                : null;
            void fetchCourseGeometry(real.id, { courseLocation }).catch(() => {});
          }).catch(() => {});
        }).catch(() => {});
        return;
      }
      let fetchedCourseLocation: { lat: number; lng: number } | null = null;
      try {
        const c = await getCourse(realId);
        if (
          c &&
          typeof c.location?.latitude === 'number' &&
          typeof c.location?.longitude === 'number' &&
          Number.isFinite(c.location.latitude) &&
          Number.isFinite(c.location.longitude) &&
          Math.abs(c.location.latitude) <= 90 &&
          Math.abs(c.location.longitude) <= 180 &&
          !(Math.abs(c.location.latitude) < 0.001 && Math.abs(c.location.longitude) < 0.001)
        ) {
          fetchedCourseLocation = { lat: c.location.latitude, lng: c.location.longitude };
        }
        if (!cancelled) {
          setCourse(c);
          setLoading(false);
        }
      } catch (e) {
        console.log('[course-detail] getCourse failed:', e);
        if (!cancelled) setLoading(false);
      }
      try {
        await fetchCourseGeometry(realId, { courseLocation: fetchedCourseLocation });
        if (!cancelled) setGeometryReady(true);
      } catch (e) {
        console.log('[course-detail] geometry warm failed:', e);
        if (!cancelled) setGeometryReady(true); // unblock the hero placeholder
      }
    })();
    return () => { cancelled = true; };
  }, [course_id]);

  useEffect(() => {
    let cancelled = false;
    if (!course) return;
    const tee = course.tees[0];
    if (!tee) {
      setContentLoading(false);
      return;
    }
    // 2026-05-16 — hard timeout so "loading…" can't stick visible
    // forever if the network is slow or the endpoint hangs. After 15s
    // we flip contentLoading false regardless; HoleGuide notes then
    // show "—" instead of "loading…". The actual fetch still resolves
    // when it can and sets `content` once it returns.
    const loadTimeout = setTimeout(() => {
      if (!cancelled) setContentLoading(false);
    }, 15_000);
    fetchCourseContent({
      courseId: course.id,
      courseName: localFriendlyName ?? course.club_name,
      location: [course.location.city, course.location.state].filter(Boolean).join(', '),
      par: tee.par_total,
      yardage: tee.total_yards,
      rating: tee.course_rating,
      slope: tee.slope_rating,
      holes: tee.holes.map(h => ({ hole_number: h.hole_number, par: h.par, yardage: h.yardage })),
    })
      .then(c => {
        clearTimeout(loadTimeout);
        if (!cancelled) {
          setContent(c);
          setContentLoading(false);
        }
      })
      .catch(e => {
        clearTimeout(loadTimeout);
        console.log('[course-detail] content fetch failed:', e);
        if (!cancelled) setContentLoading(false);
      });
    return () => { cancelled = true; clearTimeout(loadTimeout); };
    // localFriendlyName is derived from course_id (route param, stable
    // for the screen lifetime); listing it as a dep would cause an
    // infinite refetch on first render. Course is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  const tee = course?.tees[0] ?? null;
  // Local-curated branding: when the user picked a `local:*` slug we
  // honor that intent for display + bundled-image lookup, even though
  // the API returns the same parent club for both Menifee Lakes layouts.
  // Without this both Palms and Lakes would show as "Menifee Lakes
  // Country Club" with no bundled photos. The slug is the source of
  // truth for which curated experience the user picked.
  const localSlug = course_id?.startsWith('local:') ? course_id.slice('local:'.length) : null;
  const localFriendlyName =
    localSlug === 'palms' ? 'Menifee Lakes — Palms' :
    localSlug === 'lakes' ? 'Menifee Lakes — Lakes' :
    localSlug === 'rancho-california' ? 'Rancho California' :
    localSlug === 'crystal-springs' ? 'Crystal Springs' :
    localSlug === 'mariners-point' ? 'Mariners Point' :
    localSlug === 'san-jose-muni' ? 'San Jose Municipal' :
    localSlug === 'sunnyvale' ? 'Sunnyvale Golf Course' :
    null;
  const displayClubName = localFriendlyName ?? course?.club_name ?? '';
  const noteByHole = useMemo(() => {
    const m = new Map<number, string>();
    (content?.hole_notes ?? []).forEach(n => m.set(n.hole_number, n.note));
    return m;
  }, [content]);

  // 2026-05-28 — Fix FT: map hole_descriptions (longer per-hole previews
  // for first-time players). Carries the description_source marker the
  // HoleGuide row uses to render the "from public data" attribution.
  const descriptionByHole = useMemo(() => {
    const m = new Map<number, { description: string; source: 'public_synthesis' | 'pro_contributed' | 'field_verified' }>();
    (content?.hole_descriptions ?? []).forEach(d =>
      m.set(d.hole_number, { description: d.description, source: d.description_source }),
    );
    return m;
  }, [content]);

  const holeRows = useMemo(() => {
    if (!tee) return [];
    return tee.holes.map(h => {
      const desc = descriptionByHole.get(h.hole_number);
      return {
        hole_number: h.hole_number,
        par: h.par,
        yardage: h.yardage,
        note: noteByHole.get(h.hole_number),
        description: desc?.description,
        description_source: desc?.source,
      };
    });
  }, [tee, noteByHole, descriptionByHole]);

  // Hole photos. Resolution order per hole:
  //   1. Curated bundled image for the named course (Palms, Lakes,
  //      Rancho California, Crystal Springs, Mariners Point — all 5
  //      now have full 18-hole sets).
  //   2. Mapbox per-hole tile (requires green geometry).
  //   3. Skip (returns null and gets filtered).
  // Tim 2026-05-14 hit "aerial unavailable" on Lakes/Rancho because the
  // Palms-only branch was the only bundled path; now every local course
  // routes through getLocalHoleImage which handles all 5.
  const holePhotos = useMemo(() => {
    if (!tee || !course) return [];
    return tee.holes.map(h => {
      const bundled = getLocalHoleImage(displayClubName, h.hole_number);
      if (bundled) {
        // Phase 405b — carry yardage so the grid renders a centered
        // yardage overlay on each tile per the v3 reference.
        return { hole_number: h.hole_number, url: '__bundled__', bundled, yardage: h.yardage };
      }
      const geom = getHoleGeometry(course.id, h.hole_number);
      const url = getHoleThumbnailUrl({
        courseId: course.id,
        holeNumber: h.hole_number,
        par: h.par,
        yardage: h.yardage,
        tee: geom?.tee ?? null,
        green: geom?.green ?? null,
      });
      return url ? { hole_number: h.hole_number, url, bundled: null, yardage: h.yardage } : null;
    }).filter((x): x is { hole_number: number; url: string; bundled: ImageSourcePropType | null; yardage: number } => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tee, course, displayClubName, geometryReady]);

  // Phase 405b — heroSource useMemo + getCourseImageryUrl fallback
  // were removed in the V3-reference redesign. The page no longer
  // renders a hero image at all; the course name leads via titleBlock.

  const handleStartRound = () => {
    if (!course) return;
    // Phase Q.5b — same store-based signal as Play tab. Avoids the
    // tabs-navigator param-propagation issue that broke the loop.
    useRoundStore.getState().setPendingStartCourse(course.id);
    router.push('/(tabs)/caddie' as never);
  };

  const handleBookTeeTime = () => {
    if (!course) return;
    const loc = [course.location.city, course.location.state].filter(Boolean).join(', ');
    void openTeeTimeSearch(displayClubName || course.club_name, loc);
  };

  if (loading || !course) {
    return (
      <View style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.loadingState}>
          <ActivityIndicator color="#00C896" />
        </View>
      </View>
    );
  }

  if (!tee) {
    return (
      <View style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.loadingState}>
          <Text style={styles.emptyText}>This course doesn&apos;t have detailed data yet.</Text>
        </View>
      </View>
    );
  }

  const location = [course.location.city, course.location.state].filter(Boolean).join(', ');

  return (
    <View style={styles.container}>
      <CourseDetailBanner />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 130 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to courses list"
        >
          <Text style={styles.backText}>‹ Courses</Text>
        </TouchableOpacity>

        {/* Phase 405b — V3-reference clean header. The 16:9 hero image
            and stats strip were producing the "giant white area on
            first paint" complaint and adding visual weight without
            useful information (the stats are restated in the HOLE
            GUIDE table's TOTAL row). V3 led with the title + location
            + CADDIE TIPS, which is what the user actually wants to
            read first. */}
        <View style={styles.titleBlock}>
          <Text style={styles.titleText} numberOfLines={2}>{displayClubName || course.club_name}</Text>
          <View style={styles.titleMetaRow}>
            <Text style={styles.titleLocation} numberOfLines={1}>{location}</Text>
            {/* 2026-06-04 — Hole-count badge. Only renders when the
                tee's hole list is definitively 9 or 18 — otherwise
                the count is ambiguous (partial data, custom config)
                and we'd rather show nothing than show a wrong number. */}
            {(tee.holes.length === 9 || tee.holes.length === 18) && (
              <View style={styles.holesBadge}>
                <Text style={styles.holesBadgeText}>{tee.holes.length} Holes</Text>
              </View>
            )}
          </View>
        </View>

        {/* Caddie tips — leads the page. Expanded by default to match
            the V3 reference (no chevron, no collapse). */}
        {content?.caddie_tips && content.caddie_tips.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
            {content.caddie_tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>•</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        ) : contentLoading ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
            <Text style={styles.aboutLoading}>Loading…</Text>
          </View>
        ) : null}

        {/* Hole photos — grid with yardage overlay + circular hole
            badge per the V3 reference. No collapse — always visible
            when photos exist. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOLE PHOTOS</Text>
          <HolePhotosGrid
            photos={holePhotos.map(p => ({
              hole_number: p.hole_number,
              url: p.url === '__bundled__' ? '' : p.url,
              palmsImage: p.bundled ?? undefined,
              yardage: p.yardage,
            }))}
          />
        </View>

        {/* Hole guide */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOLE GUIDE</Text>
          <HoleGuide holes={holeRows} notesLoading={contentLoading && !content} />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Sticky bottom CTAs — bar + Start Round border adapt to theme so
          the teal fill doesn't sit on a hard-coded dark border in light
          mode (visual "overlap" reported in user testing). */}
      <View style={[styles.ctaBar, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: 12 + insets.bottom }]}>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.surface_elevated, borderWidth: 1, borderColor: colors.border }]}
          onPress={handleBookTeeTime}
          accessibilityRole="button"
          accessibilityLabel="Book a tee time at this course"
        >
          <Ionicons name="calendar-outline" size={16} color={colors.text_primary} style={{ marginRight: 6 }} />
          <Text style={[styles.ctaBookText, { color: colors.text_primary }]}>Book Tee Time</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cta, styles.ctaStart]}
          onPress={handleStartRound}
          accessibilityRole="button"
          accessibilityLabel="Start a new round at this course"
        >
          <Ionicons name="flag" size={16} color="#0d1a0d" style={{ marginRight: 6 }} />
          <Text style={styles.ctaStartText}>Start Round Here</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Phase 500 - Stat() component removed alongside the stats strip
// dropped in the V3 redesign. The course's totals are restated in
// the HOLE GUIDE table's TOTAL row.

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#6b7280', fontSize: 14 },
  scroll: { paddingBottom: 100 },
  back: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  backText: { color: '#00C896', fontSize: 14, fontWeight: '700' },

  // Phase 405b — V3-reference clean title block. Lives above any
  // section content. Large bold name, muted location.
  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  titleText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  titleLocation: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 2,
    fontStyle: 'italic',
    flex: 1,
  },
  titleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  holesBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#0d2b1c',
    borderWidth: 1,
    borderColor: '#00C89644',
  },
  holesBadgeText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroWrap: { width: '100%', position: 'relative' },
  // Phase 405 — banner-style hero. maxHeight 320 keeps the hero from
  // consuming half the visible area on Fold-open / tablet widths (the
  // 16:9 aspect at 1768 logical width was ~995 px tall, the source of
  // the "giant white area" complaint). Standard phones still get a
  // proper hero via aspectRatio.
  heroImage: { width: '100%', aspectRatio: 16 / 9, maxHeight: 320, backgroundColor: '#0d1a0d' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  heroPlaceholderText: { color: '#6b7280', fontSize: 13, textAlign: 'center' },
  // Phase 405 — gradient-ish dark tint at the bottom of the hero so
  // the course-name overlay stays legible regardless of how bright the
  // satellite tile happens to be. pointerEvents=none lets taps pass
  // through to anything below (currently nothing — defensive only).
  heroTint: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 120,
    backgroundColor: 'rgba(6,15,9,0.55)',
  },
  heroOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 30, paddingBottom: 12,
    backgroundColor: 'rgba(6,15,9,0.85)',
  },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  heroLocation: { color: '#9ca3af', fontSize: 13 },

  statsStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 14, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 17, fontWeight: '900' },
  statLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

  section: { paddingHorizontal: 16, paddingTop: 18 },
  sectionLabel: {
    color: '#00C896', fontSize: 11, fontWeight: '800',
    letterSpacing: 1.6, marginBottom: 10,
  },
  collapseHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 4, marginBottom: 8,
  },
  collapseChevron: {
    color: '#00C896', fontSize: 14, fontWeight: '700', marginBottom: 6,
  },
  aboutText: { color: '#d1d5db', fontSize: 14, lineHeight: 21 },
  aboutLoading: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },

  tipRow: { flexDirection: 'row', marginBottom: 8 },
  tipBullet: { color: '#00C896', fontSize: 14, marginRight: 8 },
  tipText: { color: '#d1d5db', fontSize: 13, lineHeight: 20, flex: 1 },

  ctaBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24,
    backgroundColor: '#060f09',
    borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  cta: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', overflow: 'hidden' },
  ctaBookText: { fontSize: 14, fontWeight: '800' },
  // Match the Book Tee Time sibling: solid fill + a 1px outline of the
  // same color so the rounded edge stays crisp on light surfaces and the
  // two CTAs visually align. Without the border, the teal fill on a
  // light card edge bled into the surrounding chrome.
  ctaStart: { backgroundColor: '#00C896', borderWidth: 1, borderColor: '#00C896' },
  ctaStartText: { color: '#0d1a0d', fontSize: 14, fontWeight: '800' },
});
