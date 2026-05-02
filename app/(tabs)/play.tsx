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

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore } from '../../store/roundStore';
import { searchCourses, getCourse } from '../../services/golfCourseApi';
import { fetchCourseGeometry, getHoleGeometry } from '../../services/courseGeometryService';
import { getCourseImageryUrl } from '../../services/mapboxImagery';
import { toggle as toggleListening } from '../../services/listeningSession';
import PALMS_IMAGES from '../../data/palmsImages';
import AppIcon from '../../components/AppIcon';
import type { Course } from '../../types/course';

type CourseSummary = {
  id: string;
  club_name: string;
  location: string;
  rating: number | null;
  slope: number | null;
  isLocal?: boolean;
  thumbnail?: ImageSourcePropType | { uri: string } | null;
};

// Curated local courses (Tim's playtest set). These render in the closest-local
// section even when the API hasn't been called yet.
const LOCAL_COURSES: CourseSummary[] = [
  {
    id: 'local:palms',
    club_name: 'Menifee Lakes — Palms',
    location: 'Menifee, CA',
    rating: 69.8,
    slope: 118,
    isLocal: true,
    thumbnail: PALMS_IMAGES[1] as ImageSourcePropType,
  },
];

type SearchKind = 'courses' | 'range_practice';

export default function PlayTab() {
  const router = useRouter();
  const recentCourseIds = useRoundStore(s => s.recentCourseIds);
  const activeCourseId = useRoundStore(s => s.activeCourseId);

  const [searchKind, setSearchKind] = useState<SearchKind>('courses');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CourseSummary[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [recentCourses, setRecentCourses] = useState<CourseSummary[]>([]);
  const [selected, setSelected] = useState<Course | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedHero, setSelectedHero] = useState<string | null>(null);

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

  const closestLocal: CourseSummary[] = [
    ...LOCAL_COURSES,
    ...recentCourses.filter(r => !LOCAL_COURSES.some(l => l.id === r.id)),
  ];

  const onSearch = useCallback(async () => {
    if (query.trim().length < 3) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const found = await searchCourses(query.trim());
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
      if (err && mapped.length === 0) setSearchError(err._error ?? 'No matches found.');
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
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
      return;
    }
    setSelectedLoading(true);
    const c = await getCourse(s.id);
    if (c) {
      setSelected(c);
      try {
        await fetchCourseGeometry(c.id);
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
    setSelectedLoading(false);
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

  const handleStartRound = () => {
    if (!selected) return;
    router.push({ pathname: '/(tabs)/caddie', params: { pre_course_id: selected.id } } as never);
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
      {/* Banner — logo doubles as Kevin: tap to open listening session */}
      <View style={styles.banner}>
        <TouchableOpacity
          style={styles.bannerLogoWrap}
          onPress={() => { void toggleListening(); }}
          accessibilityRole="button"
          accessibilityLabel="Talk to Kevin"
          activeOpacity={0.85}
        >
          <Image source={require('../../assets/avatars/smartplay_caddie_badge.png')} style={styles.bannerLogo} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>
            <Text style={{ color: '#00C896' }}>SmartPlay</Text>
            <Text style={{ color: '#fff' }}> Caddie</Text>
          </Text>
          <Text style={styles.bannerSub}>REAL-TIME CADDIE INTELLIGE…</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Course Discovery</Text>
            <Text style={styles.h1Sub}>Search here. Start rounds from Caddie setup.</Text>
          </View>
          <TouchableOpacity
            style={styles.scopeBtn}
            onPress={() => router.push('/smartfinder' as never)}
            accessibilityLabel="Open SmartFinder"
          >
            <AppIcon name="locate-outline" size={20} color="#00C896" />
          </TouchableOpacity>
        </View>

        {/* Closest Local */}
        <Text style={styles.sectionLabel}>CLOSEST LOCAL COURSES</Text>
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
        </View>

        {/* GolfCourse API Search */}
        <Text style={[styles.sectionLabel, { marginTop: 22 }]}>GOLFCOURSE API SEARCH</Text>
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
            placeholder="Search course or city"
            placeholderTextColor="#3a5a40"
            onSubmitEditing={onSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={onSearch}>
            <Text style={styles.searchBtnText}>{searching ? '…' : 'Search'}</Text>
          </TouchableOpacity>
        </View>

        {searching && <Text style={styles.statusText}>Searching…</Text>}
        {searchError && <Text style={styles.statusErr}>{searchError}</Text>}
        {!searching && !searchError && results.length === 0 && query.length === 0 && (
          <Text style={styles.statusText}>Enter search term and press button to find courses or facilities.</Text>
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
            <Text style={[styles.sectionLabel, { marginTop: 22 }]}>SELECTED COURSE</Text>
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
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={handleStartRound}>
                  <AppIcon name="flag" size={14} color="#0d1a0d" />
                  <Text style={styles.actionBtnPrimaryText}>Start</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleHoleMap}>
                  <AppIcon name="map-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>View</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleRangeBook}>
                  <AppIcon name="book-outline" size={14} color="#00C896" />
                  <Text style={styles.actionBtnText}>Log</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },

  banner: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#0a0f0c', borderBottomWidth: 1, borderBottomColor: '#1e3a28',
  },
  bannerLogoWrap: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: '#00C896',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    overflow: 'hidden',
  },
  bannerLogo: { width: '100%', height: '100%' },
  bannerTitle: { fontSize: 18, fontWeight: '900' },
  bannerSub: { color: '#6b7d72', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  h1: { color: '#fff', fontSize: 22, fontWeight: '900' },
  h1Sub: { color: '#6b7d72', fontSize: 12, marginTop: 2 },
  scopeBtn: {
    width: 40, height: 40, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#00C896',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,200,150,0.10)',
  },

  sectionLabel: {
    color: '#6b7d72', fontSize: 11, fontWeight: '700',
    letterSpacing: 1.6, paddingHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  localList: { paddingHorizontal: 16, gap: 6 },
  localRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0d1a0d', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 8, gap: 10,
  },
  localRowActive: { borderColor: '#00C896' },
  localThumb: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', backgroundColor: '#060f09' },
  localThumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  localName: { color: '#fff', fontSize: 15, fontWeight: '800' },
  localMeta: { color: '#6b7d72', fontSize: 12, marginTop: 2 },
  infoBtn: { padding: 6 },

  kindRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  kindBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    backgroundColor: '#0d1a0d', alignItems: 'center',
  },
  kindBtnActive: { borderColor: '#00C896', backgroundColor: 'rgba(0,200,150,0.08)' },
  kindText: { color: '#9ca3af', fontSize: 14, fontWeight: '700' },
  kindTextActive: { color: '#00C896' },

  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, alignItems: 'center' },
  searchInput: {
    flex: 1, backgroundColor: '#0d1a0d', borderColor: '#1e3a28',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 14,
  },
  searchBtn: {
    backgroundColor: '#00C896', paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 10,
  },
  searchBtnText: { color: '#0d1a0d', fontWeight: '900', fontSize: 14 },

  statusText: { color: '#6b7d72', fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  statusErr: { color: '#fbbf24', fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },

  selectedCard: {
    marginHorizontal: 16, padding: 12,
    backgroundColor: '#0d1a0d', borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a28',
  },
  selectedHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  selectedThumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: '#060f09' },
  selectedThumbImg: { width: '100%', height: '100%' },
  selectedTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  selectedSub: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  selectedStats: { color: '#6b7d72', fontSize: 12, marginTop: 4 },

  // Single-line three-button row — short labels (Start / View / Log) keep
  // the row tight even on Fold-closed (~344px) without wrapping.
  actionRow: { flexDirection: 'row', gap: 6, flexWrap: 'nowrap' },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 4,
    backgroundColor: 'transparent', borderColor: '#00C896', borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 4, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    minWidth: 0,
  },
  actionBtnPrimary: { backgroundColor: '#00C896', borderColor: '#00C896' },
  actionBtnText: { color: '#00C896', fontSize: 12, fontWeight: '800' },
  actionBtnPrimaryText: { color: '#0d1a0d', fontSize: 12, fontWeight: '900' },
});
