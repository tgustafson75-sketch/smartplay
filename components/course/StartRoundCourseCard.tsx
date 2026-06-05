/**
 * Start Round preview card — compact legacy-style course card shown
 * inside the Start Round modal sheet once a course is selected.
 *
 * Layout: hero thumbnail (Palms bundled images for Palms; Mapbox aerial
 * otherwise) + course name + (i) info icon + stats strip. Tapping the
 * (i) opens the full CourseDetailModal with hole-by-hole detail.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, type ImageSourcePropType } from 'react-native';
import AppIcon from '../AppIcon';
import CourseDetailModal, { type ModalHole } from './CourseDetailModal';
import { getCourse } from '../../services/golfCourseApi';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { fetchCourseContent } from '../../services/courseContentService';
import { getCourseImageryUrl } from '../../services/mapboxImagery';
import PALMS_IMAGES from '../../data/palmsImages';
import type { Course } from '../../types/course';

type Props = {
  /** Course id (golfcourseapi). Pass null for local-only manual courses. */
  courseId: string | null;
  /** Course display name used by the legacy bundled-image lookup. */
  courseName: string;
};

export default function StartRoundCourseCard({ courseId, courseName }: Props) {
  const [course, setCourse] = useState<Course | null>(null);
  const [holesForModal, setHolesForModal] = useState<ModalHole[]>([]);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const isPalms = courseName.toLowerCase().includes('palms');

  useEffect(() => {
    let cancelled = false;
    if (!courseId) {
      setCourse(null);
      setHolesForModal([]);
      return;
    }
    void (async () => {
      const c = await getCourse(courseId);
      if (cancelled) return;
      setCourse(c);
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
      try { await fetchCourseGeometry(courseId, { courseLocation }); } catch {}
      try {
        const tee = c?.tees[0];
        if (c && tee) {
          await fetchCourseContent({
            courseId, courseName: c.club_name,
            location: [c.location.city, c.location.state].filter(Boolean).join(', '),
            par: tee.par_total, yardage: tee.total_yards,
            rating: tee.course_rating, slope: tee.slope_rating,
            holes: tee.holes.map(h => ({ hole_number: h.hole_number, par: h.par, yardage: h.yardage })),
          });
        }
      } catch {}
      const tee = c?.tees[0];
      if (cancelled || !tee) return;
      const holes: ModalHole[] = tee.holes.map(h => {
        const geom = getHoleGeometry(courseId, h.hole_number);
        return {
          hole_number: h.hole_number,
          par: h.par,
          yardage: h.yardage,
          tee: geom?.tee ?? (h.gps ? { lat: h.gps.lat, lng: h.gps.lng } : null),
          green: geom?.green ?? null,
        };
      });
      setHolesForModal(holes);
      if (!isPalms) {
        const url = getCourseImageryUrl({ courseId, holes }, 800, 450);
        setHeroUrl(url);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, isPalms]);

  const tee = course?.tees[0] ?? null;
  const location = course
    ? [course.location.city, course.location.state].filter(Boolean).join(', ')
    : '';

  return (
    <>
      <View style={styles.card}>
        <View style={styles.heroWrap}>
          {isPalms && PALMS_IMAGES[1] ? (
            <Image source={PALMS_IMAGES[1] as ImageSourcePropType} style={styles.hero} resizeMode="cover" />
          ) : heroUrl ? (
            <Image source={{ uri: heroUrl }} style={styles.hero} resizeMode="cover" />
          ) : (
            <View style={[styles.hero, styles.heroPlaceholder]}>
              <ActivityIndicator color="#00C896" size="small" />
            </View>
          )}
          <View style={styles.heroOverlay}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle} numberOfLines={1}>{course?.club_name ?? courseName}</Text>
              {location ? <Text style={styles.heroLocation} numberOfLines={1}>{location}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={() => setOpen(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.infoBtn}
              accessibilityRole="button"
              accessibilityLabel="Open course details"
            >
              <AppIcon name="information-circle" size={26} color="#00C896" />
            </TouchableOpacity>
          </View>
        </View>

        {tee && (
          <View style={styles.statsStrip}>
            <Stat label="HOLES" value={String(tee.holes.length)} />
            <Stat label="PAR" value={String(tee.par_total)} />
            <Stat label="YARDS" value={tee.total_yards.toLocaleString()} />
            {tee.course_rating != null ? <Stat label="RATING" value={tee.course_rating.toFixed(1)} /> : null}
            {tee.slope_rating != null ? <Stat label="SLOPE" value={String(tee.slope_rating)} /> : null}
          </View>
        )}
      </View>

      <CourseDetailModal
        visible={open}
        onClose={() => setOpen(false)}
        courseName={course?.club_name ?? courseName}
        location={location}
        holes={holesForModal}
      />
    </>
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
  card: {
    marginTop: 8, marginBottom: 14, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1e3a28', backgroundColor: '#0d1a0d',
  },
  heroWrap: { width: '100%', position: 'relative' },
  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#060f09' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 14, paddingTop: 24, paddingBottom: 10,
    backgroundColor: 'rgba(6,15,9,0.85)',
  },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  heroLocation: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  infoBtn: { padding: 4, marginLeft: 10 },
  statsStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 12, paddingHorizontal: 8,
    borderTopWidth: 1, borderTopColor: '#1e3a28',
  },
  stat: { alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '900' },
  statLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
});
