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

import React, { useMemo } from 'react';
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useDeviceLayout } from '../../hooks/useDeviceLayout';
import { DRILL_CATALOG, type DrillEntry } from '../../data/drillCatalog';
import { QuickTutorial } from '../../components/QuickTutorial';
import { SCREEN_HELP } from '../../services/screenHelp';

// 2026-05-27 — Fix EF: pin Tank's drill first, Randy's drill second.
// Tank's first video covers early extension (the most common diagnosis
// in the AI swing analyzer's output today), so it's the logical lead
// drill. Randy's chip card follows for the short-game lane. Rest of
// the catalog renders in its existing order behind them. Keeping the
// pin set as a local constant — easy to expand if more featured drills
// land later.
const PINNED_DRILL_ORDER: readonly string[] = ['tank_caddie_practice', 'chipping_inconsistent'];

export default function DrillsIndex() {
  const router = useRouter();
  const { colors } = useTheme();
  // 2026-05-26 — Fix DE: ScrollView paddingBottom was a hardcoded
  // 32px, didn't account for safe-area / gesture bar (~30+px on
  // modern phones), so the LAST row of drill cards clipped behind
  // system UI. New chipping + tank_caddie cards (rows 5-6) hit this
  // hardest. Add insets.bottom + 32 so the floor scales with device.
  const insets = useSafeAreaInsets();
  // 2026-06-11 — Fix: on a narrow cover screen (Galaxy Z Fold closed, ~348dp,
  // and small phones) two 48.5% cards render too small to read. Drop to a
  // single full-width column under 380dp; mainstream phones keep the 2-col grid.
  const { width } = useDeviceLayout();
  const oneCol = width < 380;

  // 2026-05-27 — Fix EF: render pinned drills first (Tank → Randy →
  // rest in catalog order). Memoized so the sort only runs on catalog
  // changes (effectively module-load) — the catalog is `readonly` so
  // the reference is stable in practice.
  const orderedEntries = useMemo(() => {
    const pinnedSet = new Set(PINNED_DRILL_ORDER);
    const pinned = PINNED_DRILL_ORDER
      .map(id => DRILL_CATALOG.find(e => e.id === id))
      .filter((e): e is DrillEntry => !!e);
    const rest = DRILL_CATALOG.filter(e => !pinnedSet.has(e.id));
    return [...pinned, ...rest];
  }, []);

  // 2026-06-13 (Tim) — Tank gets his own FULL-WIDTH hero card at the top, pulled
  // out of the grid. That keeps the 2-col grid below in clean pairs (removing
  // Tank, +adding the new Tempo card nets even) and gives Tank top billing.
  const tankEntry = orderedEntries.find(e => e.id === 'tank_caddie_practice');
  const gridEntries = orderedEntries.filter(e => e.id !== 'tank_caddie_practice');

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

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.accent }]}>DRILLS</Text>
        <Text style={[styles.title, { color: colors.text_primary }]}>Common Faults</Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Each issue has a Primary Issue, Common Faults, 2-3 drills, and pro-instruction
          video links. Tap to dive in.
        </Text>

        {/* TANK HERO — full-width card at the top (Tim: "Tank gets his own
            full-size card"), so the grid below stays in clean twos. */}
        {tankEntry && (
          <DrillCard
            key={tankEntry.id}
            entry={tankEntry}
            colors={colors}
            oneCol={true}
            onPress={() => router.push(`/drills/${tankEntry.id}` as never)}
          />
        )}

        {/* 2-COL GRID — the rest of the catalog in pairs (Randy → faults →
            Tempo). Tank is the hero above; even count keeps clean rows. */}
        <View style={styles.grid}>
          {gridEntries.map((entry) => (
            <DrillCard
              key={entry.id}
              entry={entry}
              colors={colors}
              oneCol={oneCol}
              onPress={() => router.push(`/drills/${entry.id}` as never)}
            />
          ))}
        </View>
      </ScrollView>
      {/* 2026-06-13 (Tim) — first-time drill orientation (text + caddie narration). */}
      <QuickTutorial
        slug="drills_intro"
        title={SCREEN_HELP.drills.title}
        iconName={SCREEN_HELP.drills.icon as never}
        lines={SCREEN_HELP.drills.lines}
        spokenText={SCREEN_HELP.drills.spoken}
      />
    </SafeAreaView>
  );
}

interface DrillCardProps {
  entry: DrillEntry;
  colors: ReturnType<typeof useTheme>['colors'];
  oneCol: boolean;
  onPress: () => void;
}

function DrillCard({ entry, colors, oneCol, onPress }: DrillCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}. ${entry.missPattern}.`}
      style={({ pressed }) => [
        styles.card,
        { width: oneCol ? '100%' : '48.5%' },
        {
          backgroundColor: colors.surface_elevated,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* 2026-05-26 — Fix DE: render the image area UNCONDITIONALLY so
          all cards in the grid have uniform height. Cards without a
          bundled cardImage (chipping_inconsistent, tank_caddie) get
          the SmartPlay logo as a fallback rather than collapsing the
          header — keeps rows visually even. */}
      <View style={[styles.cardImageWrap, !entry.cardImage && { backgroundColor: colors.surface_elevated }]}>
        {entry.cardImage ? (
          <Image source={entry.cardImage} style={styles.cardImage} resizeMode="contain" />
        ) : (
          <Image
            source={require('../../assets/avatars/smartplay_caddie_badge.png')}
            style={[styles.cardImage, { width: '60%', height: '60%' }]}
            resizeMode="contain"
          />
        )}
      </View>
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
