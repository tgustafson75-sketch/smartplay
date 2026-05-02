import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet,
  Linking, Image, Dimensions, type ImageSourcePropType,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CourseDetailBanner from '../../components/course/CourseDetailBanner';
import HoleGuide from '../../components/course/HoleGuide';
import HolePhotosGrid from '../../components/course/HolePhotosGrid';
import { getCourse } from '../../services/golfCourseApi';
import { fetchCourseContent, getCachedContent, type CourseContent } from '../../services/courseContentService';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { getCourseImageryUrl, getHoleThumbnailUrl } from '../../services/mapboxImagery';
import PALMS_IMAGES from '../../data/palmsImages';
import type { Course } from '../../types/course';

const SCREEN_W = Dimensions.get('window').width;

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

  const [course, setCourse] = useState<Course | null>(null);
  const [content, setContent] = useState<CourseContent | null>(getCachedContent(course_id ?? ''));
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [geometryReady, setGeometryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!course_id) return;
    getCourse(course_id).then(c => {
      if (!cancelled) {
        setCourse(c);
        setLoading(false);
      }
    });
    fetchCourseGeometry(course_id)
      .then(() => { if (!cancelled) setGeometryReady(true); })
      .catch(err => console.log('[course-detail] geometry warm failed:', err));
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
      courseName: course.club_name,
      location: [course.location.city, course.location.state].filter(Boolean).join(', '),
      par: tee.par_total,
      yardage: tee.total_yards,
      rating: tee.course_rating,
      slope: tee.slope_rating,
      holes: tee.holes.map(h => ({ hole_number: h.hole_number, par: h.par, yardage: h.yardage })),
    }).then(c => {
      if (!cancelled) {
        setContent(c);
        setContentLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [course]);

  const tee = course?.tees[0] ?? null;
  const isPalms = (course?.club_name ?? '').toLowerCase().includes('palms');
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

  // Hole photos: per-hole Mapbox tiles, or Palms bundled images for Palms.
  const holePhotos = useMemo(() => {
    if (!tee || !course) return [];
    return tee.holes.map(h => {
      if (isPalms && PALMS_IMAGES[h.hole_number]) {
        return { hole_number: h.hole_number, url: '__palms__' };
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
      return url ? { hole_number: h.hole_number, url } : null;
    }).filter((x): x is { hole_number: number; url: string } => x !== null);
  }, [tee, course, isPalms, geometryReady]);

  // Course hero — Palms bundled image or Mapbox course-wide aerial.
  const heroSource: ImageSourcePropType | { uri: string } | null = useMemo(() => {
    if (!course) return null;
    if (isPalms && PALMS_IMAGES[1]) return PALMS_IMAGES[1] as ImageSourcePropType;
    if (!tee || !geometryReady) return null;
    const url = getCourseImageryUrl({
      courseId: course.id,
      holes: tee.holes.map(h => {
        const g = getHoleGeometry(course.id, h.hole_number);
        return { tee: g?.tee ?? null, green: g?.green ?? null };
      }),
    }, Math.round(SCREEN_W), Math.round(SCREEN_W * 0.55));
    return url ? { uri: url } : null;
  }, [course, tee, isPalms, geometryReady]);

  const handleStartRound = () => {
    if (!course) return;
    router.push({ pathname: '/(tabs)/caddie', params: { pre_course_id: course.id } } as never);
  };

  const handleBookTeeTime = () => {
    if (!course) return;
    const q = encodeURIComponent(course.club_name);
    Linking.openURL(`https://www.golfnow.com/tee-times/search?searchText=${q}`).catch(() => {});
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
          <Text style={styles.emptyText}>This course doesn't have detailed data yet.</Text>
        </View>
      </View>
    );
  }

  const location = [course.location.city, course.location.state].filter(Boolean).join(', ');

  return (
    <View style={styles.container}>
      <CourseDetailBanner />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
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
            <Text style={styles.heroTitle} numberOfLines={2}>{course.club_name}</Text>
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
          <Text style={styles.sectionLabel}>ABOUT</Text>
          {content?.about ? (
            <Text style={styles.aboutText}>{content.about}</Text>
          ) : (
            <Text style={styles.aboutLoading}>{contentLoading ? 'Loading…' : 'No description available.'}</Text>
          )}
        </View>

        {/* Caddie tips */}
        {(content?.caddie_tips && content.caddie_tips.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
            {content.caddie_tips.map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>•</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Hole photos */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HOLE PHOTOS</Text>
          <HolePhotosGrid
            photos={holePhotos.map(p => ({
              hole_number: p.hole_number,
              url: p.url === '__palms__' ? '' : p.url,
              palmsImage: p.url === '__palms__' ? PALMS_IMAGES[p.hole_number] as ImageSourcePropType : undefined,
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

      {/* Sticky bottom CTAs */}
      <View style={styles.ctaBar}>
        <TouchableOpacity style={[styles.cta, styles.ctaBook]} onPress={handleBookTeeTime}>
          <Ionicons name="calendar-outline" size={16} color="#F5A623" style={{ marginRight: 6 }} />
          <Text style={styles.ctaBookText}>Book Tee Time</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cta, styles.ctaStart]} onPress={handleStartRound}>
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
  cta: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  ctaBook: { backgroundColor: '#3a2a08', borderWidth: 1, borderColor: '#F5A623' },
  ctaBookText: { color: '#F5A623', fontSize: 14, fontWeight: '800' },
  ctaStart: { backgroundColor: '#00C896' },
  ctaStartText: { color: '#0d1a0d', fontSize: 14, fontWeight: '800' },
});
