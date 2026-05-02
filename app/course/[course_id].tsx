import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet,
  Linking, Image, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CourseDetailBanner from '../../components/course/CourseDetailBanner';
import CourseDetailModal, { type ModalHole } from '../../components/course/CourseDetailModal';
import { getCourse } from '../../services/golfCourseApi';
import { fetchCourseContent, getCachedContent, type CourseContent } from '../../services/courseContentService';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { getCourseImageryUrl } from '../../services/mapboxImagery';
import type { Course } from '../../types/course';

const SCREEN_W = Dimensions.get('window').width;

/**
 * Course Detail — legacy-app compact format.
 *
 * Layout (top to bottom):
 *   • Banner
 *   • Hero thumbnail (Mapbox course-wide aerial) with course name + (i) icon
 *   • Stats row (par / yards / rating / slope)
 *   • About paragraph
 *   • Caddie tips preview (3 bullets)
 *   • [scrollable middle]
 *   • Sticky bottom: [ Find Tee Time ]  [ Start Round ]
 *
 * (i) icon opens CourseDetailModal — course aerial + hole-by-hole list with
 * per-hole Mapbox thumbnails and AI-generated hole notes from /api/course-content.
 *
 * Tied to golfcourseapi via getCourse() for metadata + tee box, and to
 * courseGeometryService for hole-level GPS (powers Mapbox thumbnail bbox).
 */
export default function CourseDetailScreen() {
  const { course_id } = useLocalSearchParams<{ course_id: string }>();
  const router = useRouter();

  const [course, setCourse] = useState<Course | null>(null);
  const [content, setContent] = useState<CourseContent | null>(getCachedContent(course_id ?? ''));
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [geometryReady, setGeometryReady] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Load course metadata + warm courseGeometryService cache
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

  // Load AI-generated content
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
  const noteByHole = useMemo(() => {
    const m = new Map<number, string>();
    (content?.hole_notes ?? []).forEach(n => m.set(n.hole_number, n.note));
    return m;
  }, [content]);

  // Modal hole rows: combine tee data + content notes + geometry GPS
  // (geometry feeds the per-hole Mapbox thumbnail bbox).
  const modalHoles = useMemo<ModalHole[]>(() => {
    if (!tee || !course) return [];
    return tee.holes.map(h => {
      const geom = course.id ? getHoleGeometry(course.id, h.hole_number) : null;
      return {
        hole_number: h.hole_number,
        par: h.par,
        yardage: h.yardage,
        note: noteByHole.get(h.hole_number),
        tee: geom?.tee ?? (h.gps ? { lat: h.gps.lat, lng: h.gps.lng } : null),
        green: geom?.green ?? null,
      };
    });
  }, [tee, course, noteByHole, geometryReady]);

  // Course-wide hero aerial via Mapbox
  const heroUrl = useMemo(() => {
    if (!course || !geometryReady) return null;
    return getCourseImageryUrl(
      { courseId: course.id, holes: modalHoles.map(h => ({ tee: h.tee, green: h.green })) },
      Math.round(SCREEN_W),
      Math.round(SCREEN_W * 0.55),
    );
  }, [course, modalHoles, geometryReady]);

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

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹ Courses</Text>
        </TouchableOpacity>

        {/* Hero thumbnail */}
        <View style={styles.heroWrap}>
          {heroUrl ? (
            <Image source={{ uri: heroUrl }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPlaceholder]}>
              {!geometryReady ? (
                <ActivityIndicator color="#00C896" />
              ) : (
                <Text style={styles.heroPlaceholderText}>Aerial unavailable for this course</Text>
              )}
            </View>
          )}
          <View style={styles.heroOverlay}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle} numberOfLines={2}>{course.club_name}</Text>
              <Text style={styles.heroLocation} numberOfLines={1}>{location}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setDetailOpen(true)}
              style={styles.infoBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Open course details"
            >
              <Ionicons name="information-circle" size={28} color="#00C896" />
            </TouchableOpacity>
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

        {/* About preview */}
        {(content?.about || contentLoading) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ABOUT</Text>
            {content?.about ? (
              <Text style={styles.aboutText}>{content.about}</Text>
            ) : (
              <Text style={styles.aboutLoading}>Loading…</Text>
            )}
          </View>
        )}

        {/* Caddie tips preview (first 3) */}
        {content?.caddie_tips && content.caddie_tips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CADDIE TIPS</Text>
            {content.caddie_tips.slice(0, 3).map((tip, i) => (
              <View key={i} style={styles.tipRow}>
                <Text style={styles.tipBullet}>•</Text>
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
            {content.caddie_tips.length > 3 && (
              <TouchableOpacity onPress={() => setDetailOpen(true)} style={styles.moreLink}>
                <Text style={styles.moreLinkText}>See all in details ›</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Sticky bottom CTAs */}
      <View style={styles.ctaBar}>
        <TouchableOpacity style={[styles.cta, styles.ctaBook]} onPress={handleBookTeeTime}>
          <Text style={styles.ctaBookText}>Find Tee Time</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cta, styles.ctaStart]} onPress={handleStartRound}>
          <Text style={styles.ctaStartText}>Start Round</Text>
        </TouchableOpacity>
      </View>

      <CourseDetailModal
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        courseName={course.club_name}
        location={location}
        holes={modalHoles}
      />
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
  scroll: { paddingBottom: 100 }, // leave room for sticky CTAs
  back: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 },
  backText: { color: '#00C896', fontSize: 14, fontWeight: '700' },

  heroWrap: { width: '100%', position: 'relative' },
  heroImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#0d1a0d' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroPlaceholderText: { color: '#6b7280', fontSize: 13 },
  heroOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 16, paddingTop: 28, paddingBottom: 12,
    backgroundColor: 'rgba(6,15,9,0.85)',
  },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  heroLocation: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  infoBtn: { padding: 4, marginLeft: 12 },

  statsStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 14, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e3a28',
    backgroundColor: '#0d1a0d',
  },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 17, fontWeight: '900' },
  statLabel: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionLabel: {
    color: '#00C896', fontSize: 11, fontWeight: '800',
    letterSpacing: 1.6, marginBottom: 8,
  },
  aboutText: { color: '#d1d5db', fontSize: 14, lineHeight: 21 },
  aboutLoading: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },

  tipRow: { flexDirection: 'row', marginBottom: 6 },
  tipBullet: { color: '#00C896', fontSize: 14, marginRight: 8 },
  tipText: { color: '#d1d5db', fontSize: 13, lineHeight: 19, flex: 1 },
  moreLink: { marginTop: 6 },
  moreLinkText: { color: '#00C896', fontSize: 13, fontWeight: '700' },

  ctaBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24,
    backgroundColor: '#060f09',
    borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  cta: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  ctaBook: { backgroundColor: '#3a2a08', borderWidth: 1, borderColor: '#F5A623' },
  ctaBookText: { color: '#F5A623', fontSize: 14, fontWeight: '800' },
  ctaStart: { backgroundColor: '#003d20', borderWidth: 1, borderColor: '#00C896' },
  ctaStartText: { color: '#00C896', fontSize: 14, fontWeight: '800' },
});
