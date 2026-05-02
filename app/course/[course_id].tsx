import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import CourseDetailBanner from '../../components/course/CourseDetailBanner';
import CourseHero from '../../components/course/CourseHero';
import CourseStats from '../../components/course/CourseStats';
import CourseAbout from '../../components/course/CourseAbout';
import HolePhotosGrid from '../../components/course/HolePhotosGrid';
import HoleGuide from '../../components/course/HoleGuide';
import { getCourse } from '../../services/golfCourseApi';
import { fetchCourseContent, getCachedContent, type CourseContent } from '../../services/courseContentService';
import { fetchCourseGeometry } from '../../services/courseGeometryService';
import type { Course } from '../../types/course';

/**
 * Phase D-1 — Course Detail screen.
 *
 * Coach-mode preparation surface. Pulls course metadata from golfcourseapi
 * (via getCourse()) and AI-generated About / Caddie Tips / Hole Notes from
 * /api/course-content. Renders the locked top-down structure: banner → hero →
 * stats → about → caddie tips → photos grid → hole guide → dual CTAs.
 *
 * "Start Round Here" navigates back to the Caddie tab with the course
 * pre-selected via a query param the Caddie screen reads on mount.
 */
export default function CourseDetailScreen() {
  const { course_id } = useLocalSearchParams<{ course_id: string }>();
  const router = useRouter();

  const [course, setCourse] = useState<Course | null>(null);
  const [content, setContent] = useState<CourseContent | null>(getCachedContent(course_id ?? ''));
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);

  // Load course metadata + warm courseGeometryService cache so SmartFinder /
  // HoleShotMap don't pay the upstream cost again later in this session
  // (refinement bundle item 4).
  useEffect(() => {
    let cancelled = false;
    if (!course_id) return;
    getCourse(course_id).then(c => {
      if (!cancelled) {
        setCourse(c);
        setLoading(false);
      }
    });
    fetchCourseGeometry(course_id).catch(err => console.log('[course-detail] geometry warm failed:', err));
    return () => { cancelled = true; };
  }, [course_id]);

  // Load AI-generated content once we have metadata
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
      holes: tee.holes.map(h => ({
        hole_number: h.hole_number,
        par: h.par,
        yardage: h.yardage,
      })),
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
    const map = new Map<number, string>();
    (content?.hole_notes ?? []).forEach(n => map.set(n.hole_number, n.note));
    return map;
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

  const handleStartRoundHere = () => {
    if (!course) return;
    // Caddie screen reads `pre_course_id` from search params on mount and opens
    // round setup with that course pre-selected.
    router.push({ pathname: '/(tabs)/caddie', params: { pre_course_id: course.id } } as never);
  };

  const handleBookTeeTime = () => {
    if (!course) return;
    // v1.0 placeholder — open GolfNow search with course name. Tap-through is
    // intuitive; deeper booking integration is a 1.x feature.
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
          <Text style={styles.backText}>← Courses</Text>
        </TouchableOpacity>

        <CourseHero courseName={course.club_name} location={location} imageUrl={null} />

        <CourseStats
          holes={tee.holes.length}
          par={tee.par_total}
          yards={tee.total_yards}
          rating={tee.course_rating}
          slope={tee.slope_rating}
        />

        <View style={styles.divider} />

        <CourseAbout
          about={content?.about ?? null}
          caddieTips={content?.caddie_tips ?? null}
          loading={contentLoading}
        />

        <View style={styles.divider} />

        <Text style={styles.sectionHeading}>HOLE PHOTOS</Text>
        <HolePhotosGrid photos={[]} />

        <View style={styles.divider} />

        <Text style={styles.sectionHeading}>HOLE GUIDE</Text>
        <HoleGuide holes={holeRows} notesLoading={contentLoading && !content} />

        <View style={styles.ctaRow}>
          <TouchableOpacity style={[styles.cta, styles.ctaBook]} onPress={handleBookTeeTime}>
            <Text style={styles.ctaBookText}>Book Tee Time</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.cta, styles.ctaStart]} onPress={handleStartRoundHere}>
            <Text style={styles.ctaStartText}>Start Round Here</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#6b7280', fontSize: 14 },
  scroll: { paddingBottom: 24 },
  back: { paddingHorizontal: 16, paddingVertical: 8 },
  backText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#1e3a28', marginHorizontal: 16, marginVertical: 14 },
  sectionHeading: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 24,
  },
  cta: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaBook: {
    backgroundColor: '#3a2a08',
    borderWidth: 1,
    borderColor: '#F5A623',
  },
  ctaBookText: { color: '#F5A623', fontSize: 14, fontWeight: '800' },
  ctaStart: {
    backgroundColor: '#003d20',
    borderWidth: 1,
    borderColor: '#00C896',
  },
  ctaStartText: { color: '#00C896', fontSize: 14, fontWeight: '800' },
});
