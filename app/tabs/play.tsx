/**
 * play.tsx — Course Discovery Screen
 *
 * Play now focuses on discovery and scouting:
 *   - Local course quick-pick
 *   - GolfCourse API search (courses or range/practice queries)
 *
 * Round setup and round start are owned by the Caddie setup card.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';
import { DS, Palette, Space, Type, Radius } from '../../constants/theme';
import { useLayout } from '../../hooks/use-layout';
import {
  View, Text, TextInput, ScrollView, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform, Image, ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useRoundStore } from '@/store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUserStore } from '../../store/userStore';
import BrandHeader from '../../components/BrandHeader';
import { COURSE_DB, type Course } from '../../data/courses';
import { searchCourse, getCourse } from '../../services/golfCourseApi';
import * as Location from 'expo-location';

const ICON_RANGEFINDER = require('../../assets/images/icon-rangefinder.png');

type SearchMode = 'courses' | 'facilities';

type GolfSearchItem = {
  id?: string | number;
  course_id?: string | number;
  course_name?: string;
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: string;
};

const haversineMiles = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const la1 = toRad(aLat);
  const la2 = toRad(bLat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
};

const courseCenter = (course: Course) => {
  const points = (course.holes ?? [])
    .map((h) => h.middle)
    .filter((m): m is { lat: number; lng: number } => !!m && typeof m.lat === 'number' && typeof m.lng === 'number');
  if (!points.length) return null;
  const sums = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sums.lat / points.length, lng: sums.lng / points.length };
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PlaySetupScreen() {
  const layout = useLayout();
  const storeSelectedCourseIdx  = useRoundStore((s: any) => s.selectedCourseIdx);
  const storeSetCourseIdx       = useRoundStore((s: any) => s.setSelectedCourseIdx);
  const storeSetActiveCourse    = useRoundStore((s: any) => s.setActiveCourse);
  const setIsRoundActive        = useRoundStore((s: any) => s.setIsRoundActive);
  const clearRound              = useRoundStore((s: any) => s.clearRound);
  const setCurrentHole          = useRoundStore((s: any) => s.setCurrentHole);
  const router = useRouter();
  const setIsGuest = useUserStore((s) => s.setIsGuest);
  const voiceEnabled   = useSettingsStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useSettingsStore((s) => s.setVoiceEnabled);
  const voiceStyle     = useSettingsStore((s) => s.voiceStyle);
  const setVoiceStyle  = useSettingsStore((s) => s.setVoiceStyle);
  const voiceGender    = useSettingsStore((s) => s.voiceGender);
  const setVoiceGender = useSettingsStore((s) => s.setVoiceGender);
  const highContrast    = useSettingsStore((s) => s.highContrast);
  const setHighContrast = useSettingsStore((s) => s.setHighContrast);
  const brightMode      = useSettingsStore((s) => s.brightMode);
  const setBrightMode   = useSettingsStore((s) => s.setBrightMode);

  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('courses');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<GolfSearchItem[]>([]);
  const [closestCourses, setClosestCourses] = useState<Course[]>(COURSE_DB.slice(0, 4));
  const [apiCourseDetail, setApiCourseDetail] = useState<GolfSearchItem | null>(null);
  const [apiCourseLoading, setApiCourseLoading] = useState(false);
  const searchReqRef = useRef(0);

  const handleLogout = async () => {
    setShowToolsMenu(false);
    try { await signOut(auth); } catch {}
    setIsGuest(false);
    router.replace('/auth');
  };

  const getResultName = (item: GolfSearchItem) => item.course_name ?? item.name ?? 'Unknown';

  const getResultLocation = (item: GolfSearchItem) => {
    const cityState = [item.city, item.state].filter(Boolean).join(', ');
    return cityState || item.location || item.country || 'Location unavailable';
  };

  const handleSearch = async (qRaw?: string) => {
    const q = (qRaw ?? searchQuery).trim();
    if (!q) {
      setSearchError(null);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const reqId = ++searchReqRef.current;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const apiQuery = searchMode === 'facilities' ? `${q} driving range practice facility` : q;
      const results = await searchCourse(apiQuery);
      if (reqId !== searchReqRef.current) return;
      const normalized = Array.isArray(results) ? results : [];
      setSearchResults(normalized);
      if (normalized.length === 0) {
        setSearchError('No matches found. Try a nearby city or shorter query.');
      }
    } catch {
      if (reqId !== searchReqRef.current) return;
      setSearchError('Search failed. Check API key/network and try again.');
      setSearchResults([]);
    } finally {
      if (reqId === searchReqRef.current) setSearchLoading(false);
    }
  };

  const applyDiscoveryResultToCaddie = (item: GolfSearchItem) => {
    const resultName = getResultName(item);
    storeSetActiveCourse(resultName);
    const localIdx = COURSE_DB.findIndex((c) => c.name.toLowerCase() === resultName.toLowerCase());
    if (localIdx >= 0) {
      storeSetCourseIdx(localIdx);
    }
    setApiCourseDetail(item);
    router.push('/tabs/caddie');
  };

  // Fetch API details for selected local course on mount / course change
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!selectedLocalCourse) return;
      setApiCourseLoading(true);
      try {
        const results = await searchCourse(selectedLocalCourse.name);
        if (!alive) return;
        const match = Array.isArray(results)
          ? results.find((r: GolfSearchItem) => {
              const n = getResultName(r).toLowerCase();
              return n.includes(selectedLocalCourse.name.toLowerCase().split(' ')[0]);
            }) ?? results[0]
          : null;
        setApiCourseDetail(match ?? null);
      } catch {
        if (alive) setApiCourseDetail(null);
      } finally {
        if (alive) setApiCourseLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [storeSelectedCourseIdx]);

  const selectedLocalCourse = useMemo(
    () => COURSE_DB[storeSelectedCourseIdx] ?? COURSE_DB[0],
    [storeSelectedCourseIdx]
  );

  useEffect(() => {
    let alive = true;
    const loadClosest = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!alive) return;
        if (permission.status !== 'granted') {
          setClosestCourses(COURSE_DB.slice(0, 4));
          return;
        }
        const pos =
          (await Location.getLastKnownPositionAsync()) ||
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (!alive || !pos?.coords) {
          setClosestCourses(COURSE_DB.slice(0, 4));
          return;
        }
        const { latitude, longitude } = pos.coords;
        const sorted = [...COURSE_DB]
          .map((course) => {
            const center = courseCenter(course);
            const distance = center ? haversineMiles(latitude, longitude, center.lat, center.lng) : Number.MAX_VALUE;
            return { course, distance };
          })
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 4)
          .map((entry) => entry.course);
        setClosestCourses(sorted.length ? sorted : COURSE_DB.slice(0, 4));
      } catch {
        if (alive) setClosestCourses(COURSE_DB.slice(0, 4));
      }
    };
    void loadClosest();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchLoading(false);
      setSearchError(null);
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void handleSearch(q);
    }, 420);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMode]);

  useEffect(() => {
    if (searchQuery.trim()) return;
    const seedQuery = searchMode === 'facilities'
      ? `${selectedLocalCourse.location} driving range`
      : selectedLocalCourse.location;
    void handleSearch(seedQuery);
  }, [searchMode, selectedLocalCourse]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.brand }} edges={['top', 'left', 'right']}>
      <BrandHeader rightSlot={
        <Pressable
          onPress={() => setShowToolsMenu((v) => !v)}
          style={[s.toolsPill, showToolsMenu && s.toolsPillActive]}
        >
          {[0,1,2].map((i) => (
            <View key={i} style={[s.dot, showToolsMenu && s.dotActive]} />
          ))}
        </Pressable>
      } />

      {/* ── Header bar ── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Course Discovery</Text>
          <Text style={s.headerSub}>Search here. Start rounds from Caddie setup.</Text>
        </View>
        {/* Rangefinder shortcut */}
        <Pressable
          onPress={() => router.push('/rangefinder')}
          style={s.rfBtn}
        >
          <Image source={ICON_RANGEFINDER} style={{ width: 20, height: 20, tintColor: Palette.accent }} resizeMode="contain" />
        </Pressable>
      </View>

      {/* Tools backdrop */}
      {showToolsMenu && (
        <Pressable
          onPress={() => setShowToolsMenu(false)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
        />
      )}

      {/* Tools dropdown */}
      {showToolsMenu && (
        <ScrollView
          style={s.toolsMenu}
          contentContainerStyle={{ padding: 10, gap: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={() => setVoiceEnabled(!voiceEnabled)} style={[s.menuItem, !voiceEnabled && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name={voiceEnabled ? 'volume-high' : 'volume-off'} size={16} color={voiceEnabled ? Palette.muted : '#527a64'} />
            <Text style={s.menuItemText}>{voiceEnabled ? 'Voice On' : 'Voice Off'}</Text>
          </Pressable>
          <Pressable onPress={() => setVoiceStyle(voiceStyle === 'calm' ? 'aggressive' : 'calm')} style={s.menuItem}>
            <MCIcon name={voiceStyle === 'aggressive' ? 'bullhorn-outline' : 'meditation'} size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceStyle === 'aggressive' ? 'Aggressive' : 'Calm'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => setVoiceGender(voiceGender === 'male' ? 'female' : 'male')} style={s.menuItem}>
            <MCIcon name="account-voice" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{voiceGender === 'male' ? 'Male' : 'Female'} Voice</Text>
          </Pressable>
          <Pressable onPress={() => setHighContrast(!highContrast)} style={[s.menuItem, highContrast && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name="contrast-circle" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>{highContrast ? 'High Contrast' : 'Normal'}</Text>
          </Pressable>
          <Pressable onPress={() => setBrightMode(!brightMode)} style={[s.menuItem, brightMode && { backgroundColor: '#0e1a12', borderColor: '#1a3326' }]}>
            <MCIcon name="white-balance-sunny" size={16} color={brightMode ? Palette.positiveFaint : Palette.muted} />
            <Text style={[s.menuItemText, brightMode && { color: Palette.positiveFaint }]}>Bright Mode {brightMode ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/rangefinder'); }} style={[s.menuItem, { borderColor: Palette.accent }]}>
            <Image source={ICON_RANGEFINDER} style={{ width: 18, height: 18, tintColor: Palette.accent }} resizeMode="contain" />
            <Text style={[s.menuItemText, { color: '#FFE600' }]}>AR Rangefinder</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/profile-setup'); }} style={s.menuItem}>
            <MCIcon name="account-circle-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Profile</Text>
          </Pressable>
          <Pressable onPress={() => { setShowToolsMenu(false); router.push('/settings' as any); }} style={s.menuItem}>
            <MCIcon name="cog-outline" size={16} color={Palette.muted} />
            <Text style={s.menuItemText}>Settings</Text>
          </Pressable>
          <Pressable onPress={() => { void handleLogout(); }} style={[s.menuItem, { borderColor: '#6b2020', backgroundColor: '#1a0c0c' }]}>
            <MCIcon name="logout" size={16} color="#e8a0a0" />
            <Text style={[s.menuItemText, { color: '#e8a0a0' }]}>Sign Out</Text>
          </Pressable>
        </ScrollView>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingHorizontal: layout.hPad }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* Closest local courses */}
        <View style={s.section}>
          <Text style={s.label}>Closest Local Courses</Text>
          {closestCourses.map((c) => {
            const idx = COURSE_DB.findIndex((course) => course.id === c.id);
            const active = idx === storeSelectedCourseIdx;
            return (
              <View
                key={c.id}
                style={[coursePickerStyles.row, active && coursePickerStyles.rowActive]}
              >
                <Pressable
                  onPress={() => {
                    storeSetCourseIdx(idx);
                    storeSetActiveCourse(c.name);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                >
                  <Image
                    source={c.thumbnail as ImageSourcePropType}
                    style={{ width: 44, height: 44, borderRadius: 8, marginRight: 12 }}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1 }}>
                  <Text style={[coursePickerStyles.name, active && coursePickerStyles.nameActive]}>
                    {c.name}
                  </Text>
                  <Text style={coursePickerStyles.loc}>{c.location} · Rating {c.rating} · Slope {c.slope}</Text>
                </View>
                {active && <Text style={{ color: Palette.positive, fontSize: 14, fontWeight: '700', marginRight: 8 }}>✓</Text>}
                </Pressable>
                <Pressable
                  onPress={() => router.push({ pathname: '/course-detail', params: { courseId: c.id } })}
                  hitSlop={10}
                  style={{ padding: 6 }}
                >
                  <MCIcon name="information-outline" size={20} color="rgba(46,204,113,0.7)" />
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={s.section}>
          <Text style={s.label}>GolfCourse API Search</Text>
          <View style={s.chipRow}>
            <Pressable
              onPress={() => setSearchMode('courses')}
              style={[s.chip, searchMode === 'courses' && s.chipActive]}
            >
              <Text style={[s.chipLabel, searchMode === 'courses' && s.chipLabelActive]}>Courses</Text>
            </Pressable>
            <Pressable
              onPress={() => setSearchMode('facilities')}
              style={[s.chip, searchMode === 'facilities' && s.chipActive]}
            >
              <Text style={[s.chipLabel, searchMode === 'facilities' && s.chipLabelActive]}>Range + Practice</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <TextInput
              style={[s.input, { marginTop: 10, flex: 1 }]}
              placeholder={searchMode === 'courses' ? 'Search course or city' : 'Search city or facility name'}
              placeholderTextColor="#4a7c5e"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="words"
            />
            <Pressable
              onPress={() => handleSearch()}
              style={{
                marginTop: 10,
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: Palette.positive,
                borderRadius: 6,
                justifyContent: 'center',
                alignItems: 'center',
              }}
              disabled={!searchQuery || searchLoading}
            >
              <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>Search</Text>
            </Pressable>
          </View>
          <Text style={{ color: Palette.textSub, marginTop: 8, fontSize: 12 }}>
            {searchLoading ? 'Searching...' : 'Enter search term and press button to find courses or facilities.'}
          </Text>

          {searchError ? <Text style={{ color: Palette.warn, marginTop: 10, fontSize: 12 }}>{searchError}</Text> : null}

          {searchResults.map((item, idx) => {
            const name = getResultName(item);
            const loc = getResultLocation(item);
            const key = String(item.id ?? item.course_id ?? `${name}-${idx}`);
            const localCourse = COURSE_DB.find((c) => c.id === String(item.course_id ?? item.id ?? '') || c.name.toLowerCase() === name.toLowerCase());
            return (
              <View key={key} style={[coursePickerStyles.row, { marginTop: 8, paddingRight: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={coursePickerStyles.name}>{name}</Text>
                  <Text style={coursePickerStyles.loc}>{loc}</Text>
                </View>
                {localCourse ? (
                  <Pressable
                    onPress={() => router.push({ pathname: '/course-detail', params: { courseId: localCourse.id } })}
                    hitSlop={10}
                    style={{ padding: 6, marginRight: 6 }}
                  >
                    <MCIcon name="information-outline" size={18} color="rgba(46,204,113,0.7)" />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => applyDiscoveryResultToCaddie(item)}
                  style={{ paddingVertical: 7, paddingHorizontal: 10, borderRadius: Radius.pill, borderWidth: 1, borderColor: Palette.borderActive, backgroundColor: Palette.bgActive }}
                >
                  <Text style={{ color: Palette.positiveFaint, fontSize: 11, fontWeight: '700' }}>Use in Caddie</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* ── Selected Course Info Card ── */}
        <View style={s.section}>
          <Text style={s.label}>Selected Course</Text>
          <View style={[coursePickerStyles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 0 }]}>
            {/* Course header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              {selectedLocalCourse.thumbnail ? (
                <Image
                  source={selectedLocalCourse.thumbnail as ImageSourcePropType}
                  style={{ width: 52, height: 52, borderRadius: 10 }}
                  resizeMode="cover"
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={[coursePickerStyles.name, { fontSize: 15 }]}>{selectedLocalCourse.name}</Text>
                <Text style={coursePickerStyles.loc}>{selectedLocalCourse.location}</Text>
                <Text style={[coursePickerStyles.loc, { marginTop: 2 }]}>
                  {selectedLocalCourse.holes?.length ?? 18} holes · Par {(selectedLocalCourse as any).par ?? 72} · Rating {selectedLocalCourse.rating} · Slope {selectedLocalCourse.slope}
                </Text>
              </View>
            </View>

            {/* API details (booking link, extra info) */}
            {apiCourseLoading ? (
              <Text style={{ color: Palette.textSub, fontSize: 12, marginBottom: 8 }}>Loading course details…</Text>
            ) : apiCourseDetail ? (
              <View style={{ marginBottom: 10, gap: 4 }}>
                {apiCourseDetail.city || apiCourseDetail.state ? (
                  <Text style={{ color: Palette.textSub, fontSize: 12 }}>
                    📍 {[apiCourseDetail.city, apiCourseDetail.state, apiCourseDetail.country].filter(Boolean).join(', ')}
                  </Text>
                ) : null}
                {(apiCourseDetail as any).website ? (
                  <Text style={{ color: Palette.positive, fontSize: 12, fontWeight: '600' }}>
                    🌐 {(apiCourseDetail as any).website}
                  </Text>
                ) : null}
                {(apiCourseDetail as any).phone ? (
                  <Text style={{ color: Palette.textSub, fontSize: 12 }}>
                    📞 {(apiCourseDetail as any).phone}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Quick-action icon row */}
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Pressable
                onPress={() => {
                  // Reset prior round state before starting a new one so scores,
                  // putts, penalties, and shots from the previous round don't leak.
                  clearRound();
                  setCurrentHole(1);
                  setIsRoundActive(true);
                  // tabs/_layout's phase-driven nav routes to /tabs/caddie when
                  // isRoundActive flips false → true, so no manual router.push needed.
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.positive, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 }}
              >
                <MCIcon name="flag-checkered" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Start Round</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/course-detail', params: { courseId: selectedLocalCourse.id } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.bgActive, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Palette.borderActive }}
              >
                <MCIcon name="map-outline" size={16} color={Palette.positiveFaint} />
                <Text style={{ color: Palette.positiveFaint, fontWeight: '600', fontSize: 13 }}>Hole Map</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/rangebook')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Palette.bgActive, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Palette.borderActive }}
              >
                <MCIcon name="book-open-outline" size={16} color={Palette.positiveFaint} />
                <Text style={{ color: Palette.positiveFaint, fontWeight: '600', fontSize: 13 }}>Range Book</Text>
              </Pressable>
            </View>
          </View>
        </View>

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  // Header
  header:          DS.header,
  headerTitle:     DS.headerTitle,
  headerSub:       DS.headerSub,
  rfBtn:           DS.rfBtn,
  toolsPill:       DS.toolsPill,
  toolsPillActive: DS.toolsPillActive,
  dot:             DS.dot,
  dotActive:       DS.dotActive,
  toolsMenu:   { ...DS.toolsMenu, top: 72 },
  menuItem:    DS.menuItem,
  menuItemIcon: DS.menuItemIcon,
  menuItemText: DS.menuItemText,
  scroll: {
    padding: Space.xl,
    paddingTop: Space.section,
    paddingBottom: 48,
  },
  title: {
    fontSize: Type.h1,
    fontWeight: Type.bold,
    color: Palette.positiveFaint,
    marginBottom: Space.xs,
  },
  subtitle: {
    fontSize: Type.md,
    color: Palette.textSub,
    marginBottom: Space.section,
  },
  section: {
    marginBottom: Space.section,
  },
  label: DS.label as any,
  input: DS.input,
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
  },
  chip: DS.chip,
  chipActive: {
    backgroundColor: Palette.bgActive,
    borderColor: Palette.borderActive,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Palette.muted,
  },
  chipLabelActive: {
    color: Palette.textPrimary,
  },
  chipSub: {
    fontSize: 12,
    color: Palette.textSub,
    marginTop: 2,
    textAlign: 'center',
  },
  chipSubActive: {
    color: Palette.textSub,
  },
  cta: {
    backgroundColor: Palette.positive,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#071E16',
    letterSpacing: 0.3,
  },
});

const coursePickerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.cardBg,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 12,
    paddingVertical: 8,
    paddingLeft: 13,
    paddingRight: 4,
    marginBottom: 7,
  },
  rowActive: {
    borderColor: Palette.borderActive,
    backgroundColor: Palette.bgActive,
  },
  name: {
    color: Palette.textSub,
    fontWeight: '600',
    fontSize: 14,
    marginBottom: 2,
  },
  nameActive: {
    color: Palette.textPrimary,
  },
  loc: {
    color: Palette.textSub,
    fontSize: 12,
  },
});

