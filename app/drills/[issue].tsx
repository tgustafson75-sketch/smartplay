/**
 * Drill detail — Primary Issue + Common Faults + Drills + Watch
 * (Phase v3-port 3/5).
 *
 * Ported from v3's app/drills/[issue].tsx. Layout matches the v3
 * screenshot exactly:
 *   - Header: < Drills (back to index) + brand badge
 *   - "DRILL" eyebrow + Title + warning-gold miss pattern subtitle
 *   - Big illustration with "Tap to zoom" affordance
 *   - PRIMARY ISSUE outlined box
 *   - COMMON FAULTS bulleted list
 *   - DRILLS section listing named fixes
 *   - WATCH section with YouTube card (instructor + duration)
 *
 * Zoom modal: tapping the illustration opens a Modal that shows the
 * image full-screen with a Close button. Uses RN Modal + Image; no
 * extra image-zoom library required (gesture-based pinch-zoom can
 * come later if needed).
 *
 * Non-developer note: this is a presentation-only screen. Tap to zoom
 * is a Modal pop-over; the WATCH link opens YouTube via Linking.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  Modal,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { getDrillEntry } from '../../data/drillCatalog';
import { getInstructorVideo } from '../../data/instructorVideos';

export default function DrillDetail() {
  const router = useRouter();
  const { colors } = useTheme();
  const { issue } = useLocalSearchParams<{ issue?: string }>();
  const [zoomOpen, setZoomOpen] = useState(false);

  const entry = typeof issue === 'string' ? getDrillEntry(issue) : undefined;

  // Defensive: unknown issue id → show a small "not found" screen with
  // a back link. Shouldn't happen in normal flow because all entries
  // route from DRILL_CATALOG.
  if (!entry) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
            <Text style={[styles.backText, { color: colors.accent }]}>Drills</Text>
          </Pressable>
        </View>
        <View style={styles.notFound}>
          <Text style={[styles.notFoundText, { color: colors.text_muted }]}>
            Drill not found. Pull back to the Drills index.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const video = getInstructorVideo(entry.videoCategory);
  const runtimeLabel = `${Math.round(video.approxRuntimeSec / 60)} min · tap to watch`;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to Drills"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.accent} />
          <Text style={[styles.backText, { color: colors.accent }]}>Drills</Text>
        </Pressable>
        <Image
          source={require('../../assets/avatars/smartplay_caddie_badge.png')}
          style={styles.headerBadge}
          resizeMode="contain"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>DRILL</Text>
        <Text style={[styles.title, { color: colors.text_primary }]}>{entry.title}</Text>
        <Text style={[styles.missLine, { color: '#F0C030' }]}>{entry.missPattern}</Text>

        {/* ILLUSTRATION + "Tap to zoom" badge */}
        {entry.cardImage && (
          <Pressable
            onPress={() => setZoomOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${entry.title} illustration. Tap to zoom.`}
            style={styles.illustrationWrap}
          >
            <Image source={entry.cardImage} style={styles.illustration} resizeMode="contain" />
            <View style={[styles.zoomBadge, { backgroundColor: colors.accent_muted, borderColor: colors.accent }]}>
              <Ionicons name="search" size={14} color={colors.accent} />
              <Text style={[styles.zoomBadgeText, { color: colors.accent }]}>Tap to zoom</Text>
            </View>
          </Pressable>
        )}

        {/* PRIMARY ISSUE box */}
        <Text style={[styles.sectionLabel, { color: colors.accent }]}>PRIMARY ISSUE</Text>
        <View style={[styles.primaryBox, { borderColor: colors.accent, backgroundColor: colors.accent_muted }]}>
          <Text style={[styles.primaryText, { color: colors.text_primary }]}>{entry.primary}</Text>
        </View>

        {/* COMMON FAULTS */}
        <Text style={[styles.sectionLabel, { color: colors.accent }]}>COMMON FAULTS</Text>
        <View style={styles.faultsList}>
          {entry.commonFaults.map((fault) => (
            <View key={fault} style={styles.faultItem}>
              <Text style={[styles.faultBullet, { color: '#F0C030' }]}>•</Text>
              <Text style={[styles.faultText, { color: colors.text_primary }]}>{fault}</Text>
            </View>
          ))}
        </View>

        {/* DRILLS */}
        <Text style={[styles.sectionLabel, { color: colors.accent }]}>DRILLS</Text>
        <View style={styles.drillsList}>
          {entry.drills.map((drill) => (
            <View
              key={drill.name}
              style={[styles.drillCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
            >
              <Text style={[styles.drillName, { color: colors.text_primary }]}>{drill.name}</Text>
              <Text style={[styles.drillSteps, { color: colors.text_muted }]}>{drill.steps}</Text>
            </View>
          ))}
        </View>

        {/* WATCH — instructor video card */}
        <Text style={[styles.sectionLabel, { color: colors.accent }]}>WATCH</Text>
        <TouchableOpacity
          onPress={() => { void Linking.openURL(video.url).catch(() => undefined); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Watch ${video.title} by ${video.instructor}`}
          style={[styles.watchCard, { backgroundColor: colors.surface_elevated, borderColor: colors.border }]}
        >
          <View style={[styles.youtubeBadge, { backgroundColor: '#ffffff' }]}>
            <Ionicons name="logo-youtube" size={28} color="#FF0000" />
          </View>
          <View style={styles.watchText}>
            <Text style={[styles.watchTitle, { color: colors.text_primary }]} numberOfLines={2}>
              {video.title}
            </Text>
            <Text style={[styles.watchInstructor, { color: colors.accent }]} numberOfLines={1}>
              {video.instructor}
            </Text>
            <Text style={[styles.watchRuntime, { color: colors.text_muted }]}>{runtimeLabel}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
        </TouchableOpacity>
      </ScrollView>

      {/* ZOOM MODAL */}
      <Modal
        visible={zoomOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setZoomOpen(false)}
      >
        <View style={styles.zoomBackdrop}>
          <View style={styles.zoomHeader}>
            <TouchableOpacity
              onPress={() => setZoomOpen(false)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Close illustration"
              style={styles.zoomCloseBtn}
            >
              <Ionicons name="close" size={28} color="#ffffff" />
            </TouchableOpacity>
          </View>
          {entry.cardImage && (
            <Image source={entry.cardImage} style={styles.zoomImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 4 },
  backText: { fontSize: 17, fontWeight: '700' },
  headerBadge: { width: 40, height: 40, borderRadius: 20 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '900', marginBottom: 6 },
  missLine: { fontSize: 14, fontWeight: '600', fontStyle: 'italic', marginBottom: 16 },
  illustrationWrap: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 10,
    marginBottom: 18,
    minHeight: 220,
    justifyContent: 'center',
    position: 'relative',
  },
  illustration: { width: '100%', height: 220 },
  zoomBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  zoomBadgeText: { fontSize: 12, fontWeight: '700' },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 18,
    marginBottom: 8,
  },
  primaryBox: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryText: { fontSize: 16, lineHeight: 22 },
  faultsList: { gap: 8 },
  faultItem: { flexDirection: 'row', gap: 10 },
  faultBullet: { fontSize: 18, lineHeight: 22, fontWeight: '800' },
  faultText: { flex: 1, fontSize: 14, lineHeight: 20 },
  drillsList: { gap: 10 },
  drillCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  drillName: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  drillSteps: { fontSize: 13, lineHeight: 19 },
  watchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  youtubeBadge: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchText: { flex: 1, minWidth: 0 },
  watchTitle: { fontSize: 15, fontWeight: '700' },
  watchInstructor: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  watchRuntime: { fontSize: 11, marginTop: 2 },
  zoomBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  zoomHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    paddingTop: 56,
  },
  zoomCloseBtn: { padding: 4 },
  zoomImage: { flex: 1, width: '100%' },
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  notFoundText: { fontSize: 14, textAlign: 'center' },
});
