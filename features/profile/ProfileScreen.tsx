/**
 * ProfileScreen
 *
 * Personal Golf Profile — aggregates player identity, key stats, long-term
 * trends, performance tags, and highlight reel entry point into one clean hub.
 *
 * Data sources (all local, zero network):
 *   • useUserStore       — name, handicap, goal
 *   • useAiProfileStore  — roundHistory
 *   • useRoundStore      — current-round shots (for live highlights)
 *   • analyzeTrends      — cross-round stat sheet
 *   • generateLongTermInsights — coaching bullets
 *   • getHighlights      — top shot moments
 */

import React, { useMemo } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette } from '../../constants/theme';
import { useUserStore }       from '../../store/userStore';
import { useAiProfileStore }  from '../../store/aiProfileStore';
import { useRoundStore }      from '../../store/roundStore';
import { analyzeTrends }      from '../smartCaddie/engine/TrendEngine';
import { generateLongTermInsights } from '../smartCaddie/engine/LongTermInsights';
import { getHighlights }      from '../replay/HighlightEngine';
import type { LongTermInsight } from '../smartCaddie/engine/LongTermInsights';
import type { ScoredShot }    from '../replay/HighlightEngine';

const LOGO = require('../../assets/images/logo-transparent.png') as number;

// ── Performance tag generator ─────────────────────────────────────────────────
interface PerformanceTag { label: string; color: string; bg: string }

function buildTags(
  trends: ReturnType<typeof analyzeTrends>,
  totalRounds: number,
  highlights: ScoredShot[],
): PerformanceTag[] {
  const tags: PerformanceTag[] = [];

  if (totalRounds >= 1) {
    tags.push({ label: 'Active Player', color: Palette.positive, bg: 'rgba(46,204,113,0.13)' });
  }
  if (!trends) return tags;

  if (trends.improvement.direction === 'improving') {
    tags.push({ label: 'On the Rise 📈', color: Palette.positive, bg: 'rgba(46,204,113,0.13)' });
  } else if (trends.improvement.direction === 'declining') {
    tags.push({ label: 'Work In Progress', color: Palette.warn, bg: 'rgba(230,126,34,0.13)' });
  }

  if (trends.dominantMiss === 'right') {
    tags.push({ label: 'Right Miss Tendency', color: Palette.warn, bg: 'rgba(230,126,34,0.13)' });
  } else if (trends.dominantMiss === 'left') {
    tags.push({ label: 'Left Miss Tendency', color: Palette.warn, bg: 'rgba(230,126,34,0.13)' });
  } else if (trends.dominantMiss === 'center') {
    tags.push({ label: 'Consistent Iron Play', color: Palette.positive, bg: 'rgba(46,204,113,0.13)' });
  }

  if (trends.clubBias.direction === 'up') {
    tags.push({ label: 'Clubs Up Often', color: '#60a5fa', bg: 'rgba(96,165,250,0.13)' });
  } else if (trends.clubBias.direction === 'down') {
    tags.push({ label: 'Needs Distance Control', color: '#60a5fa', bg: 'rgba(96,165,250,0.13)' });
  }

  if (trends.consistencyScore >= 75) {
    tags.push({ label: 'Highly Consistent', color: Palette.positive, bg: 'rgba(46,204,113,0.13)' });
  }

  const bestShot = highlights[0];
  if (bestShot && (bestShot.gpsDistance ?? bestShot.distance ?? 0) >= 250) {
    tags.push({ label: 'Long Hitter 💪', color: '#fcd34d', bg: 'rgba(252,211,77,0.12)' });
  }

  return tags.slice(0, 5);
}

// ── Stat row helper ────────────────────────────────────────────────────────────
function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={sp.wrap}>
      <Text style={sp.value}>{value}</Text>
      <Text style={sp.label}>{label}</Text>
      {sub ? <Text style={sp.sub}>{sub}</Text> : null}
    </View>
  );
}
const sp = StyleSheet.create({
  wrap:  { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 3 },
  value: { color: Palette.positive, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  label: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  sub:   { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
});

// ── Insight row ────────────────────────────────────────────────────────────────
function InsightRow({ insight }: { insight: LongTermInsight }) {
  const borderColor = insight.tone === 'positive' ? Palette.positive
                    : insight.tone === 'warning'  ? Palette.warn
                    : '#60a5fa';
  return (
    <View style={[ir.wrap, { borderLeftColor: borderColor }]}>
      <Text style={ir.emoji}>{insight.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={ir.headline}>{insight.headline}</Text>
        <Text style={ir.detail}>{insight.detail}</Text>
      </View>
    </View>
  );
}
const ir = StyleSheet.create({
  wrap:     { flexDirection: 'row', gap: 10, padding: 12, borderLeftWidth: 3, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 8 },
  emoji:    { fontSize: 20, marginTop: 1 },
  headline: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  detail:   { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 18 },
});

// ── Highlight shot tile ────────────────────────────────────────────────────────
function HighlightTile({ shot }: { shot: ScoredShot }) {
  const dist = shot.gpsDistance ?? shot.distance ?? 0;
  return (
    <View style={ht.wrap}>
      <View style={ht.iconWrap}>
        <Text style={ht.icon}>⛳</Text>
      </View>
      <Text style={ht.club}>{shot.club ?? '–'}</Text>
      <Text style={[ht.dist, { color: shot.result === 'center' ? Palette.positive : Palette.warn }]}>{dist}y</Text>
      <Text style={ht.hole}>Hole {shot.hole}</Text>
    </View>
  );
}
const ht = StyleSheet.create({
  wrap:    { width: 90, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 10, marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  iconWrap:{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(46,204,113,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  icon:    { fontSize: 18 },
  club:    { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  dist:    { fontSize: 18, fontWeight: '900', marginVertical: 2 },
  hole:    { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
});

// ── Goal label helper ──────────────────────────────────────────────────────────
function goalLabel(goal: string | null) {
  if (goal === 'break100') return 'Break 100';
  if (goal === 'break90')  return 'Break 90';
  if (goal === 'break80')  return 'Break 80';
  if (goal === 'enjoy')    return 'Enjoy the Game';
  return 'SmartCaddie Player';
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function ProfileScreen({ onClose }: Props) {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();

  // ── Store reads ──────────────────────────────────────────────────────────────
  const displayName = useUserStore((s) => s.displayName || s.name || 'Golfer');
  const handicap    = useUserStore((s) => s.handicap);
  const goal        = useUserStore((s) => s.goal);
  const roundHistory = useAiProfileStore((s) => s.roundHistory);
  const shots        = useRoundStore((s) => s.shots);

  // ── Derived data (all synchronous) ───────────────────────────────────────────
  const trends    = useMemo(() => analyzeTrends(roundHistory), [roundHistory]);
  const insights  = useMemo(() => trends ? generateLongTermInsights(trends) : [], [trends]);
  const highlights = useMemo(() => getHighlights(shots, 5), [shots]);

  // Key stats
  const totalRounds = roundHistory.length;
  const avgShots    = trends?.avgShots ? Math.round(trends.avgShots) : null;
  const topClub     = trends?.topClub ?? (shots.length > 0 ? shots[shots.length - 1].club : null);
  const missLabel   = trends?.dominantMiss
    ? trends.dominantMiss === 'center' ? 'Balanced' : `Tends ${trends.dominantMiss}`
    : '–';

  const tags = useMemo(() => buildTags(trends, totalRounds, highlights), [trends, totalRounds, highlights]);

  const hasEnoughData = totalRounds >= 3;

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Back button ──────────────────────────────────────────────────── */}
      <Pressable onPress={onClose} style={s.backBtn} hitSlop={12}>
        <Text style={s.backTxt}>← Back</Text>
      </Pressable>

      {/* ══ HEADER — player identity ═════════════════════════════════════ */}
      <View style={s.header}>
        <View style={s.avatarWrap}>
          <Image source={LOGO} style={s.avatar} resizeMode="contain" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.playerName}>{displayName}</Text>
          <Text style={s.subTitle}>{goalLabel(goal)}</Text>
          {handicap > 0 && (
            <View style={s.hcapPill}>
              <Text style={s.hcapTxt}>HCP {handicap}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Performance tags ─────────────────────────────────────────────── */}
      {tags.length > 0 && (
        <View style={s.tagRow}>
          {tags.map((t) => (
            <View key={t.label} style={[s.tag, { backgroundColor: t.bg, borderColor: t.color }]}>
              <Text style={[s.tagTxt, { color: t.color }]}>{t.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ══ KEY STATS ════════════════════════════════════════════════════ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Your Numbers</Text>
        <View style={s.statsRow}>
          <StatPill label="Rounds" value={totalRounds > 0 ? String(totalRounds) : '–'} />
          <View style={s.divider} />
          <StatPill label="Avg Shots" value={avgShots ? String(avgShots) : '–'} sub="per round" />
          <View style={s.divider} />
          <StatPill label="Miss" value={missLabel === 'Balanced' ? '✓' : missLabel.split(' ')[1] ?? '–'} sub={missLabel} />
        </View>
        {topClub && (
          <View style={s.topClubRow}>
            <Text style={s.topClubLabel}>Most Used Club</Text>
            <Text style={s.topClubValue}>{topClub}</Text>
          </View>
        )}
      </View>

      {/* ══ TREND INSIGHTS ═══════════════════════════════════════════════ */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Coaching Insights</Text>
        {hasEnoughData && insights.length > 0 ? (
          insights.slice(0, 4).map((ins) => <InsightRow key={ins.id} insight={ins} />)
        ) : (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>
              {totalRounds === 0
                ? 'Play your first round to unlock insights.'
                : `${3 - totalRounds} more round${3 - totalRounds === 1 ? '' : 's'} needed to build your trend profile.`}
            </Text>
          </View>
        )}
      </View>

      {/* ══ HIGHLIGHTS ═══════════════════════════════════════════════════ */}
      {highlights.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Best Shots</Text>
            <Pressable onPress={() => router.push('/highlight-reel' as any)}>
              <Text style={s.seeAll}>Watch Reel ▶</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
            {highlights.map((h, i) => <HighlightTile key={i} shot={h} />)}
            {/* CTA tile */}
            <Pressable
              style={[ht.wrap, { borderColor: Palette.positive, backgroundColor: 'rgba(46,204,113,0.08)', justifyContent: 'center' }]}
              onPress={() => router.push('/highlight-reel' as any)}
            >
              <Text style={{ color: Palette.positive, fontSize: 24, textAlign: 'center' }}>▶</Text>
              <Text style={{ color: Palette.positive, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 4 }}>Full Reel</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {/* ══ QUICK ACTIONS ════════════════════════════════════════════════ */}
      <View style={s.actionsRow}>
        <Pressable style={s.actionBtn} onPress={() => router.push('/round-replay' as any)}>
          <Text style={s.actionIcon}>🎬</Text>
          <Text style={s.actionTxt}>Replay Round</Text>
        </Pressable>
        <Pressable style={s.actionBtn} onPress={() => router.push('/highlight-reel' as any)}>
          <Text style={s.actionIcon}>⭐</Text>
          <Text style={s.actionTxt}>Highlights</Text>
        </Pressable>
        <Pressable style={s.actionBtn} onPress={() => router.replace('/(tabs)/history' as any)}>
          <Text style={s.actionIcon}>📊</Text>
          <Text style={s.actionTxt}>Dashboard</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.brand },
  content:   { paddingHorizontal: 18, gap: 16 },

  backBtn: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 2, marginBottom: 4 },
  backTxt: { color: Palette.positive, fontSize: 14, fontWeight: '600' },

  // Header
  header:     { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  avatarWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(46,204,113,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Palette.positive },
  avatar:     { width: 44, height: 44 },
  playerName: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  subTitle:   { color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  hcapPill:   { alignSelf: 'flex-start', backgroundColor: 'rgba(46,204,113,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: Palette.positive, marginTop: 2 },
  hcapTxt:    { color: Palette.positive, fontSize: 12, fontWeight: '700' },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  tag:    { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  tagTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  // Cards
  card:       { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardTitle:  { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 12, letterSpacing: 0.2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  seeAll:     { color: Palette.positive, fontSize: 12, fontWeight: '700' },

  // Stats
  statsRow:  { flexDirection: 'row', alignItems: 'center' },
  divider:   { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.1)' },
  topClubRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  topClubLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  topClubValue: { color: Palette.positive, fontSize: 14, fontWeight: '700' },

  // Empty state
  emptyBox: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 14 },
  emptyTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 20, textAlign: 'center' },

  // Quick actions
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn:  { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  actionIcon: { fontSize: 22 },
  actionTxt:  { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
