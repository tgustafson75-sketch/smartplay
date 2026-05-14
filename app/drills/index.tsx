/**
 * Drills index — Common Faults grid (Phase v3-port 3/5).
 *
 * Ported from v3's app/drills/index.tsx. 2-column grid of illustrated
 * issue cards. Tapping a card routes to /drills/<issue> for the full
 * detail page.
 *
 * Routed from SwingLab tab's Drills card (LIVE). Replaces Pro's
 * previous SwingLab-embedded drill list as the primary drills surface.
 * Pro's prescriptive drills (Bullseye, Tempo, etc.) are still
 * accessible at /swinglab/drills (the previous SwingLab body that
 * step 1 moved into a dedicated sub-route).
 */

import React from 'react';
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { DRILL_CATALOG, type DrillEntry } from '../../data/drillCatalog';

export default function DrillsIndex() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to SwingLab"
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.accent} />
          <Text style={[styles.backText, { color: colors.accent }]}>SwingLab</Text>
        </Pressable>
        <Image
          source={require('../../assets/avatars/smartplay_caddie_badge.png')}
          style={styles.headerBadge}
          resizeMode="contain"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>DRILLS</Text>
        <Text style={[styles.title, { color: colors.text_primary }]}>Common Faults</Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Each issue has a Primary Issue, Common Faults, 2-3 drills, and pro-instruction
          video links. Tap to dive in.
        </Text>

        {/* 2-COL GRID — render rows of 2 cards from DRILL_CATALOG. */}
        <View style={styles.grid}>
          {DRILL_CATALOG.map((entry) => (
            <DrillCard
              key={entry.id}
              entry={entry}
              colors={colors}
              onPress={() => router.push(`/drills/${entry.id}` as never)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface DrillCardProps {
  entry: DrillEntry;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}

function DrillCard({ entry, colors, onPress }: DrillCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}. ${entry.missPattern}.`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface_elevated,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {entry.cardImage && (
        <View style={styles.cardImageWrap}>
          <Image source={entry.cardImage} style={styles.cardImage} resizeMode="contain" />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, { color: colors.text_primary }]} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={[styles.cardMiss, { color: colors.text_muted }]} numberOfLines={2}>
          {entry.missPattern}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={[styles.cardDrills, { color: colors.accent }]}>
            {entry.drills.length} drill{entry.drills.length === 1 ? '' : 's'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </View>
      </View>
    </Pressable>
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
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 32,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 6,
    marginLeft: 4,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 8,
    marginLeft: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    marginLeft: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '48.5%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardImageWrap: {
    backgroundColor: '#ffffff',
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  cardImage: { width: '100%', height: '100%' },
  cardBody: { padding: 12, gap: 4 },
  cardTitle: { fontSize: 17, fontWeight: '800' },
  cardMiss: { fontSize: 12, lineHeight: 16 },
  cardFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDrills: { fontSize: 13, fontWeight: '700' },
});
