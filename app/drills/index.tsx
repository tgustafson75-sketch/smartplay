/**
 * Drills index — Common Faults grid (Phase v3-port 3/5).
 *
 * Ported from v3's app/drills/index.tsx. 2-column grid of illustrated
 * issue cards. Tapping a card routes to /drills/<issue> for the full
 * detail page.
 *
 * Routed from SwingLab tab's Drills card (LIVE). Replaces Pro's
 * previous SwingLab-embedded drill list as the primary drills surface.
 *
 * 2026-08-25 — corrected a stale claim. This header said Pro's prescriptive drills were
 * "still accessible at /swinglab/drills". THAT ROUTE DOES NOT EXIST (no app/swinglab/drills.tsx
 * and no directory). Nothing links to it, so no user ever hit a dead end — but a comment that
 * describes a screen the app does not have is the same trap that cost this project weeks
 * elsewhere. Read the tree, not the comment.
 */

import React, { useMemo } from 'react';
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useDeviceLayout } from '../../hooks/useDeviceLayout';
import { DRILL_CATALOG, type DrillEntry } from '../../data/drillCatalog';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import { yourFaultFirst } from '../../services/practice/yourFaultFirst';
import { QuickTutorial } from '../../components/QuickTutorial';
import { SCREEN_HELP } from '../../services/screenHelp';

// 2026-08-06 (Tim — "take out Tank's drill card"; "remove Randy from Chipping"). The Tank placeholder card
// (tank_caddie_practice, no real content) is hidden from the Drills grid. The CHIPPING card STAYS — it's
// just de-branded from Randy Chang into a Caddie chipping lesson (see data/drillCatalog.ts). Hidden, not
// deleted: Tank keeps its knowledge-base/type entry; only the grid card is removed.
const HIDDEN_DRILL_IDS: ReadonlySet<string> = new Set(['tank_caddie_practice']);

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

  // 2026-08-06 (Tim) — the Drills grid in catalog order, with Tank's + Randy's cards filtered out.
  /**
   * 2026-08-25 — THE GRID NOW KNOWS WHO IS LOOKING AT IT.
   *
   * SmartMotion has recorded this player's faults after every analysed swing, and the store already
   * held the most frequent one — while this screen rendered the identical "Common Faults" list for
   * everybody. The app knew; the screen was never told.
   *
   * No mapping is invented: SmartMotion records CanonicalIssue ids, which is exactly the id space
   * the catalog is keyed by, so the dominant fault IS a drill id. Under MIN_FAULTS this returns null
   * and the grid renders exactly as before — it leads with a diagnosis only when it has earned one.
   */
  // Subscribe to the players map (stable reference; changes when a fault is recorded), then resolve
  // through the store's OWN getPlayer so player identity keeps one owner. Picking the first key out
  // of the map would have been a second, wrong answer to "who is this" the moment a family member
  // was added — the exact two-owners shape this codebase keeps paying for.
  const players = useCaddieMemoryStore((st) => st.players);
  const tendencies = useMemo(
    () => useCaddieMemoryStore.getState().getPlayer().tendencies ?? null,
    [players],
  );
  const yours = useMemo(
    () => yourFaultFirst(
      tendencies,
      DRILL_CATALOG.map((e) => e.id),
      (id) => DRILL_CATALOG.find((e) => e.id === id)?.title ?? null,
    ),
    [tendencies],
  );

  const gridEntries = useMemo(
    // The player's own fault leads the grid; everything else keeps catalog order behind it.
    () => DRILL_CATALOG.filter(e => !HIDDEN_DRILL_IDS.has(e.id))
      .sort((a, b) => (a.id === yours?.id ? -1 : b.id === yours?.id ? 1 : 0)),
    [yours],
  );

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
        {/* 2026-07-06 (Tim carry-over #1) — removed the decorative caddie-badge
            Image that sat UPPER-RIGHT here. It was non-tappable branding that
            reused the mic badge art, so it read as a SECOND caddie mic next to
            the global GlobalCaddieMic (upper-left) and blocked the nav/tools.
            One canonical mic everywhere = the global one only. */}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.eyebrow, { color: colors.accent }]}>DRILLS</Text>
        <Text style={[styles.title, { color: colors.text_primary }]}>Common Faults</Text>
        <Text style={[styles.subtitle, { color: yours ? colors.accent : colors.text_muted }]}>
          {yours ? yours.line : null}
        </Text>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Each issue has a Primary Issue, Common Faults, 2-3 drills, and pro-instruction
          video links. Tap to dive in.
        </Text>

        {/* 2-COL GRID — the fault catalog in pairs. Tank's card is hidden (HIDDEN_DRILL_IDS); the chipping
            card STAYS but is de-branded from Randy Chang into the Caddie's own lesson (2026-08-06). */}
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
