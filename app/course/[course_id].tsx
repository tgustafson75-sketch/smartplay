import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet,
  Image, useWindowDimensions, type ImageSourcePropType,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CourseDetailBanner from '../../components/course/CourseDetailBanner';
import HoleGuide from '../../components/course/HoleGuide';
import HolePhotosGrid from '../../components/course/HolePhotosGrid';
import { getCourse, searchCourses } from '../../services/golfCourseApi';
import { fetchCourseContent, getCachedContent, type CourseContent } from '../../services/courseContentService';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore, getEffectiveSimpleBriefing } from '../../store/settingsStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCourseImageryUrl, getHoleThumbnailUrl } from '../../services/mapboxImagery';
import { openTeeTimeSearch } from '../../services/teeTimeLink';
import PALMS_IMAGES from '../../data/palmsImages';
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
  const { width: screenW } = useWindowDimensions();
  // Re-sim P1 — when simpleBriefing is on (auto for first 5 rounds OR
  // explicit), collapse the dense ABOUT / CADDIE TIPS / HOLE PHOTOS
  // sections behind expandable headers. Mark + Priya from the gen-pop
  // re-sim asked for this, and Joel from the original HOPE trial got
  // stuck on the same screen.
  const roundsTogether = useRelationshipStore(s => s.roundsTogether);
  const _rawSimple = useSettingsStore(s => s.simpleBriefing);
  const _userTouched = useSettingsStore(s => s.simpleBriefingUserTouched);
  const simpleBriefing = (() => { void _rawSimple; void _userTouched;
    return getEffectiveSimpleBriefing(roundsTogether);
  })();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
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
          slug;
        const stubHoles = Array.from({ length: 18 }, (_, i): import('../../types/course').Hole => ({
          hole_number: i + 1,
          par: 4,
          yardage: 380,
          handicap: null,
          gps: null,
          hazards: [],
        }));
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
              'Menifee',
            state: 'CA',
            country: 'USA',
          },
          tees: [{
            tee_name: 'White',
            total_yards: 6840,
            course_rating: null,
            slope_rating: null,
            par_total: 72,
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
          }).catch(() => {});
          void fetchCourseGeometry(real.id).catch(() => {});
        }).catch(() => {});
        return;
      }
      try {
        const c = await getCourse(realId);
        if (!cancelled) {
          setCourse(c);
          setLoading(false);
        }
      } catch (e) {
        console.log('[course-detail] getCourse failed:', e);
        if (!cancelled) setLoading(false);
      }
      try {
        await fetchCourseGeometry(realId);
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
    fetchCourseContent({
      courseId: course.id,
      // Use the local-friendly name when present so AI-generated About
      // and Caddie Tips reflect the layout the user actually picked.
      courseName: localFriendlyName ?? course.club_name,
      location: [course.location.city, course.location.state].filter(Boolean).join(', '),
      par: tee.par_total,
      yardage: tee.total_yards,
      rating: tee.course_rating,
      slope: tee.slope_rating,
      holes: tee.holes.map(h => ({ hole_number: h.hole_number, par: h.par, yardage: h.yardage })),
    })
      .then(c => {
        if (!cancelled) {
          setContent(c);
          setContentLoading(false);
        }
      })
      .catch(e => {
        console.log('[course-detail] content fetch failed:', e);
        if (!cancelled) setContentLoading(false);
      });
    return () => { cancelled = true; };
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
    null;
  const displayClubName = localFriendlyName ?? course?.club_name ?? '';
  const isPalms = localSlug === 'palms' || displayClubName.toLowerCase().includes('palms');
  const noteByHole = useMemo(() => {
    const m = new Map<number, string>();
    (content?.hole_notes ?? []).forEach(n => m.set(n.hole_number, n.note));
    return m;
  }, [content]);

  const holeRows = useMemo(() => {
    if (!tee) return [];
    return tee.holes.map(h => ({
      hole_number: h.hole_number,
      par: h.par,
      yardage: h.yardage,
      note: noteByHole.get(h.hole_number),
    }));
  }, [tee, noteByHole]);

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
        return { hole_number: h.hole_number, url: '__bundled__', bundled };
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
      return url ? { hole_number: h.hole_number, url, bundled: null } : null;
    }).filter((x): x is { hole_number: number; url: string; bundled: ImageSourcePropType | null } => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tee, course, displayClubName, geometryReady]);

  // Course hero — bundled hole-1 for any curated local course, else
  // Mapbox course-wide aerial. Previously only Palms had a bundled hero
  // path; everything else fell back to Mapbox which fails when
  // geometry is missing → "Aerial unavailable" placeholder. Lakes,
  // Rancho, Crystal Springs, Mariners Point all now show their hole-1
  // photo as the hero.
  const heroSource: ImageSourcePropType | { uri: string } | null = useMemo(() => {
    if (!course) return null;
    const bundledHero = getLocalHoleImage(displayClubName, 1);
    if (bundledHero) return bundledHero;
    if (!tee || !geometryReady) return null;
    const url = getCourseImageryUrl({
      courseId: course.id,
      holes: tee.holes.map(h => {
        const g = getHoleGeometry(course.id, h.hole_number);
        return { tee: g?.tee ?? null, green: g?.green ?? null };
      }),
    }, Math.round(screenW), Math.round(screenW * 0.55));
    return url ? { uri: url } : null;
  }, [course, tee, displayClubName, geometryReady, screenW]);

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

        {/* Hero */}
        <View style={styles.heroWrap}>
          {heroSource ? (
            <Image source={heroSource} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              {!geometryReady ? <ActivityIndicator color="#00C896" /> : (
                <Text style={styles.heroPlaceholderText}>Aerial unavailable for this course</Text>
              )}
            </View>
          )}
          <View style={styles.heroOverlay}>
            <Text style={styles.heroTitle} numberOfLines={2}>{displayClubName || course.club_name}</Text>
            <View style={styles.heroLocRow}>
              <Ionicons name="location-outline" size={14} color="#9ca3af" />
              <Text style={styles.heroLocation} numberOfLines={1}>{location}</Text>
            </View>
          </View>
        </View>

        {/* Stats strip */}
        <View style={styles.statsStrip}>
          <Stat label="HOLES" value={String(tee.holes.length)} />
          <Stat label="PAR" value={String(tee.par_total)} />
          <Stat label="YARDS" value={tee.total_yards.toLocaleString()} />
          {tee.course_rating != null && <Stat label="RATING" value={tee.course_rating.toFixed(1)} />}
          {tee.slope_rating != null && <Stat label="SLOPE" value={String(tee.slope_rating)} />}
        </View>

        {/* About */}
        <View style={styles.section}>
          {simpleBriefing ? (
            <TouchableOpacity
              onPress={() => setAboutOpen(o => !o)}
              accessibilityRole="button"
              accessibilityLabel={`About this course — tap to ${aboutOpen ? 'collapse' : 'expand'}`}
              style={styles.collapseHeader}
            >
              <Text style={styles.sectionLabel}>ABOUT</Text>
              <Text style={styles.collapseChevron}>{aboutOpen ? '▾' : '▸'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.sectionLabel}>ABOUT</Text>
          )}
          {(!simpleBriefing || aboutOpen) && (
            content?.about ? (
              <Text style={styles.aboutText}>{content.about}</Text>
            ) : (
              <Text style={styles.aboutLoading}>{contentLoading ? 'Loading…' : 'No description available.'}</Text>
            )
          )}
        </View>

        {/* Caddie tips */}
        {(content?.caddie_tips && content.caddie_tips.length > 0) && (
          <View style={styles.section}>
            {simpleBriefing ? (
              <TouchableOpacity
                onPress={() => setTipsOpen(o => !o)}
                accessibilityRole="button"
                accessibilityLabel={`Caddie tips — tap to ${tipsOpen ? 'collapse' : 'expand'}`}
                style={styles.collapseHeader}
              >
                <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
                <Text style={styles.collapseChevron}>{tipsOpen ? '▾' : '▸'}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
            )}
            {(!simpleBriefing || tipsOpen) && content.caddie_tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>•</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Hole photos */}
        <View style={styles.section}>
          {simpleBriefing ? (
            <TouchableOpacity
              onPress={() => setPhotosOpen(o => !o)}
              accessibilityRole="button"
              accessibilityLabel={`Hole photos — tap to ${photosOpen ? 'collapse' : 'expand'}`}
              style={styles.collapseHeader}
            >
              <Text style={styles.sectionLabel}>HOLE PHOTOS</Text>
              <Text style={styles.collapseChevron}>{photosOpen ? '▾' : '▸'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.sectionLabel}>HOLE PHOTOS</Text>
          )}
          {(!simpleBriefing || photosOpen) && (
            <HolePhotosGrid
              photos={holePhotos.map(p => ({
                hole_number: p.hole_number,
                url: p.url === '__bundled__' ? '' : p.url,
                // palmsImage prop is named for legacy reasons but accepts
                // ANY bundled ImageSourcePropType — used here for Palms,
                // Lakes, Rancho, Crystal Springs, Mariners Point.
                palmsImage: p.bundled ?? undefined,
              }))}
            />
          )}
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
          style={[styles.cta, styles.ctaBook]}
          onPress={handleBookTeeTime}
          accessibilityRole="button"
          accessibilityLabel="Book a tee time at this course"
        >
          <Ionicons name="calendar-outline" size={16} color="#F5A623" style={{ marginRight: 6 }} />
          <Text style={styles.ctaBookText}>Book Tee Time</Text>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#6b7280', fontSize: 14 },
  scroll: { paddingBottom: 100 },
  back: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  backText: { color: '#00C896', fontSize: 14, fontWeight: '700' },

  heroWrap: { width: '100%', position: 'relative' },
  heroImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#0d1a0d' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroPlaceholderText: { color: '#6b7280', fontSize: 13 },
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
  ctaBook: { backgroundColor: '#3a2a08', borderWidth: 1, borderColor: '#F5A623' },
  ctaBookText: { color: '#F5A623', fontSize: 14, fontWeight: '800' },
  // Match the Book Tee Time sibling: solid fill + a 1px outline of the
  // same color so the rounded edge stays crisp on light surfaces and the
  // two CTAs visually align. Without the border, the teal fill on a
  // light card edge bled into the surrounding chrome.
  ctaStart: { backgroundColor: '#00C896', borderWidth: 1, borderColor: '#00C896' },
  ctaStartText: { color: '#0d1a0d', fontSize: 14, fontWeight: '800' },
});
