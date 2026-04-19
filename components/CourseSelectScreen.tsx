/**
 * CourseSelectScreen
 *
 * Standalone course picker. Can be rendered as a full screen (via navigation)
 * or inlined as a modal sheet. Pass `onSelect` to receive the chosen course.
 *
 * Usage:
 *   <CourseSelectScreen
 *     courses={COURSE_DATABASE}
 *     selectedId={selectedCourse.id}
 *     onSelect={(course) => { setSelectedCourse(course); navigation.goBack(); }}
 *   />
 */

import React from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import YardageDisplay from './YardageDisplay';
import type { CourseData } from '../data/courses/courseDatabase';

interface Props {
  courses:    CourseData[];
  selectedId?: string | null;
  onSelect:   (course: CourseData) => void;
  /** Hide the title bar when embedded in another component */
  showHeader?: boolean;
}

export default function CourseSelectScreen({
  courses,
  selectedId,
  onSelect,
  showHeader = true,
}: Props) {
  const renderHoleSummary = (course: CourseData) => {
    const pars = course.holes.map((h) => h.par);
    const total = pars.reduce((a, b) => a + b, 0);
    const par3  = pars.filter((p) => p === 3).length;
    const par4  = pars.filter((p) => p === 4).length;
    const par5  = pars.filter((p) => p === 5).length;
    return `${course.holes.length} holes · Par ${total} (${par3}×3 · ${par4}×4 · ${par5}×5)`;
  };

  const renderHole1Preview = (course: CourseData) => {
    const h1 = course.holes[0];
    if (!h1) return null;
    return (
      <View style={s.holePreview}>
        <Text style={s.holePreviewLabel}>Hole 1 · Par {h1.par}</Text>
        <YardageDisplay
          front={h1.yardages.front}
          middle={h1.yardages.middle}
          back={h1.yardages.back}
          size="small"
        />
      </View>
    );
  };

  return (
    <View style={s.container}>
      {showHeader && (
        <View style={s.header}>
          <Text style={s.headerTitle}>SELECT COURSE</Text>
          <Text style={s.headerSub}>{courses.length} courses available</Text>
        </View>
      )}

      <FlatList
        data={courses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        renderItem={({ item }) => {
          const isSelected = item.id === selectedId;
          return (
            <Pressable
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                s.card,
                isSelected && s.cardSelected,
                pressed && !isSelected && s.cardPressed,
              ]}
            >
              {/* Course name + checkmark */}
              <View style={s.cardRow}>
                <Text style={s.courseIcon}>⛳</Text>
                <View style={s.cardInfo}>
                  <Text style={[s.courseName, isSelected && s.courseNameSelected]}>
                    {item.name}
                  </Text>
                  {item.city ? (
                    <Text style={s.courseCity}>{item.city}{item.state ? `, ${item.state}` : ''}</Text>
                  ) : null}
                  <Text style={s.holeSummary}>{renderHoleSummary(item)}</Text>
                  <Text style={s.courseStats}>Rating {item.rating} · Slope {item.slope}</Text>
                </View>
                {isSelected && (
                  <View style={s.checkBadge}>
                    <Text style={s.checkIcon}>✓</Text>
                  </View>
                )}
              </View>

              {/* Hole 1 yardage preview */}
              {renderHole1Preview(item)}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

// ─── Hole Navigator ───────────────────────────────────────────────────────────

/**
 * HoleNavigator — compact prev/next controls + hole info strip.
 * Drop this anywhere the current hole and yardages need to be shown.
 */
interface HoleNavProps {
  course:           CourseData;
  currentHoleIndex: number;           // 0-based
  onPrev:           () => void;
  onNext:           () => void;
}

export function HoleNavigator({ course, currentHoleIndex, onPrev, onNext }: HoleNavProps) {
  const hole    = course.holes[currentHoleIndex];
  const isFirst = currentHoleIndex === 0;
  const isLast  = currentHoleIndex === course.holes.length - 1;

  if (!hole) return null;

  return (
    <View style={n.container}>
      {/* Prev */}
      <Pressable
        onPress={onPrev}
        disabled={isFirst}
        style={[n.navBtn, isFirst && n.navBtnDisabled]}
      >
        <Text style={[n.navBtnText, isFirst && n.navBtnTextDisabled]}>‹</Text>
      </Pressable>

      {/* Hole info */}
      <View style={n.holeInfo}>
        <Text style={n.holeLabel}>Hole {hole.holeNumber} · Par {hole.par}</Text>
        <YardageDisplay
          front={hole.yardages.front}
          middle={hole.yardages.middle}
          back={hole.yardages.back}
          size="medium"
        />
        {hole.note ? (
          <Text style={n.holeNote}>{hole.note}</Text>
        ) : null}
      </View>

      {/* Next */}
      <Pressable
        onPress={onNext}
        disabled={isLast}
        style={[n.navBtn, isLast && n.navBtnDisabled]}
      >
        <Text style={[n.navBtnText, isLast && n.navBtnTextDisabled]}>›</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerTitle: {
    color: '#A7F3D0',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  headerSub: {
    color: '#4a7c5e',
    fontSize: 12,
    marginTop: 2,
  },
  list: {
    padding: 12,
  },
  separator: {
    height: 8,
  },
  card: {
    backgroundColor: '#121212',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  cardSelected: {
    backgroundColor: '#0d3320',
    borderColor: '#4ade80',
  },
  cardPressed: {
    backgroundColor: '#1a1a1a',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  courseIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  courseName: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '600',
  },
  courseNameSelected: {
    color: '#fff',
    fontWeight: '800',
  },
  courseCity: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
  },
  holeSummary: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
  },
  courseStats: {
    color: '#4a7c5e',
    fontSize: 11,
    marginTop: 1,
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkIcon: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: '900',
  },
  holePreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'flex-start',
    gap: 4,
  },
  holePreviewLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

const n = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1f17',
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a2e20',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d5a3d',
  },
  navBtnDisabled: {
    opacity: 0.3,
  },
  navBtnText: {
    color: '#A7F3D0',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  navBtnTextDisabled: {
    color: '#4a7c5e',
  },
  holeInfo: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  holeLabel: {
    color: '#A7F3D0',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  holeNote: {
    color: '#6b7280',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
});
