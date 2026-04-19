/**
 * analytics.tsx — Deep Analytics Screen
 *
 * Standalone route (not a tab). Accessible from the Dashboard tools menu.
 * Shows: Dispersion map · Bias % · Session trends · Club breakdown
 */

import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore } from '../store/roundStore';
import { getHistory } from '../services/SessionHistory';
import { analyzeTrends } from '../services/TrendEngine';
import DispersionMap from '../components/DispersionMap';
import type { DispersionShot } from '../components/DispersionMap';
import { DS, Palette, Space, Type, Radius } from '../constants/theme';

// ─── helpers ─────────────────────────────────────────────────────────────────

type TrendResult = {
  longTermMissBias: 'left' | 'right' | 'neutral';
  improvementTrend: 'improving' | 'regressing' | 'stable';
  consistencyScore: number;
  confidenceScore: number;
  dominantShape: string;
  sessionCount: number;
  recentAvgStraight: number;
  olderAvgStraight: number;
  summary: string;
};

type Shot = { result: string; club?: string; target?: string; hole?: number; distance?: number };

function buildBiasBreakdown(shots: Shot[]) {
  const total = shots.length;
  if (total === 0) return null;
  const left     = shots.filter((s) => s.result === 'left').length;
  const straight = shots.filter((s) => s.result === 'straight').length;
  const right    = shots.filter((s) => s.result === 'right').length;
  return {
    left:     Math.round((left / total) * 100),
    straight: Math.round((straight / total) * 100),
    right:    Math.round((right / total) * 100),
    total,
    dominant: left > right && left > straight ? 'left'
      : right > left && right > straight ? 'right'
      : 'straight',
  };
}

function buildClubBreakdown(shots: Shot[]) {
  const map: Record<string, { left: number; straight: number; right: number }> = {};
  for (const s of shots) {
    const c = s.club ?? 'Unknown';
    if (!map[c]) map[c] = { left: 0, straight: 0, right: 0 };
    if (s.result === 'left') map[c].left++;
    else if (s.result === 'right') map[c].right++;
    else map[c].straight++;
  }
  return Object.entries(map)
    .map(([club, counts]) => {
      const total = counts.left + counts.straight + counts.right;
      return { club, total, ...counts, accuracyPct: Math.round((counts.straight / total) * 100) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

function buildHoleTrend(shots: Shot[]) {
  const byHole: Record<number, { left: number; straight: number; right: number }> = {};
  for (const s of shots) {
    if (s.hole == null) continue;
    if (!byHole[s.hole]) byHole[s.hole] = { left: 0, straight: 0, right: 0 };
    if (s.result === 'left') byHole[s.hole].left++;
    else if (s.result === 'right') byHole[s.hole].right++;
    else byHole[s.hole].straight++;
  }
  return Object.entries(byHole).map(([h, c]) => ({ hole: Number(h), ...c })).sort((a, b) => a.hole - b.hole);
}

// ─── component ───────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const router = useRouter();
  const shots = useRoundStore((s) => s.shots ?? []) as Shot[];

  const [trends, setTrends]   = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'dispersion' | 'bias' | 'trends' | 'clubs'>('dispersion');

  useEffect(() => {
    (async () => {
      try {
        const history = await getHistory();
        const result  = analyzeTrends(history);
        setTrends(result as TrendResult);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const bias     = buildBiasBreakdown(shots);
  const clubs    = buildClubBreakdown(shots);
  const holeTrend = buildHoleTrend(shots);

  const dispShots: DispersionShot[] = shots.map((s) => ({
    result: s.result as 'left' | 'straight' | 'right',
    target: (s.target ?? 'center') as 'left' | 'center' | 'right',
    club:   s.club as any,
  }));

  const trendColor = !trends ? '#aaa'
    : trends.improvementTrend === 'improving' ? '#4ade80'
    : trends.improvementTrend === 'regressing' ? '#f87171'
    : '#fbbf24';

  const trendLabel = !trends ? '—'
    : trends.improvementTrend === 'improving' ? '↑ Improving'
    : trends.improvementTrend === 'regressing' ? '↓ Regressing'
    : '→ Stable';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Analytics</Text>
        <View style={{ width: 64 }} />
      </View>

      {/* Summary pills */}
      {bias && (
        <View style={styles.pillRow}>
          <View style={[styles.pill, { borderColor: '#ef4444' }]}>
            <Text style={[styles.pillNum, { color: '#ef4444' }]}>{bias.left}%</Text>
            <Text style={styles.pillLabel}>Left</Text>
          </View>
          <View style={[styles.pill, { borderColor: '#6ee7b7' }]}>
            <Text style={[styles.pillNum, { color: '#6ee7b7' }]}>{bias.straight}%</Text>
            <Text style={styles.pillLabel}>Straight</Text>
          </View>
          <View style={[styles.pill, { borderColor: '#f59e0b' }]}>
            <Text style={[styles.pillNum, { color: '#f59e0b' }]}>{bias.right}%</Text>
            <Text style={styles.pillLabel}>Right</Text>
          </View>
          <View style={[styles.pill, { borderColor: trendColor }]}>
            <Text style={[styles.pillNum, { color: trendColor, fontSize: 13 }]}>{trendLabel}</Text>
            <Text style={styles.pillLabel}>Trend</Text>
          </View>
        </View>
      )}

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['dispersion', 'bias', 'trends', 'clubs'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'dispersion' ? '🎯 Map' : t === 'bias' ? '📊 Bias' : t === 'trends' ? '📈 Trends' : '🏌️ Clubs'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

        {/* ── DISPERSION TAB ── */}
        {tab === 'dispersion' && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            {shots.length === 0 ? (
              <EmptyState label="Start tracking with SmartPlay to unlock insights." />
            ) : (
              <>
                <DispersionMap shots={dispShots} />
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Reading the Map</Text>
                  <Text style={styles.cardBody}>Dots show where each shot landed relative to your aim point. Green = straight, red = left miss, amber = right miss. The cone shows your typical dispersion window.</Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* ── BIAS TAB ── */}
        {tab === 'bias' && (
          <View style={{ gap: 14 }}>
            {!bias ? (
              <EmptyState label="Hit at least 1 shot to see bias data." />
            ) : (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Shot Distribution — {bias.total} shots</Text>
                  {/* Bar chart */}
                  {([
                    { label: '← Left',    pct: bias.left,     color: '#ef4444' },
                    { label: '↑ Straight', pct: bias.straight, color: '#6ee7b7' },
                    { label: 'Right →',   pct: bias.right,    color: '#f59e0b' },
                  ] as const).map((row) => (
                    <View key={row.label} style={{ marginTop: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={{ color: row.color, fontSize: 13, fontWeight: '700' }}>{row.label}</Text>
                        <Text style={{ color: row.color, fontSize: 13, fontWeight: '800' }}>{row.pct}%</Text>
                      </View>
                      <View style={{ height: 10, backgroundColor: '#1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
                        <View style={{ width: `${row.pct}%` as any, height: 10, backgroundColor: row.color, borderRadius: 5 }} />
                      </View>
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Dominant Miss</Text>
                  <Text style={[styles.bigStat, {
                    color: bias.dominant === 'left' ? '#ef4444' : bias.dominant === 'right' ? '#f59e0b' : '#6ee7b7',
                  }]}>
                    {bias.dominant === 'left' ? '← Left' : bias.dominant === 'right' ? 'Right →' : '↑ Straight'}
                  </Text>
                  <Text style={styles.cardBody}>
                    {bias.dominant === 'left'
                      ? 'You tend to miss left. Try aiming slightly right of target and focusing on an inside-out swing path.'
                      : bias.dominant === 'right'
                      ? 'You tend to miss right. Try aiming slightly left of target and checking your grip pressure.'
                      : 'Great ball control — your shots are predominantly on target.'}
                  </Text>
                </View>

                {holeTrend.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Hole-by-Hole</Text>
                    {holeTrend.map((h) => {
                      const total = h.left + h.straight + h.right;
                      return (
                        <View key={h.hole} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                          <Text style={{ color: '#6b7280', fontSize: 12, width: 30 }}>H{h.hole}</Text>
                          <View style={{ flex: 1, height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, flexDirection: 'row', overflow: 'hidden' }}>
                            <View style={{ width: `${(h.left / total) * 100}%` as any, backgroundColor: '#ef4444' }} />
                            <View style={{ width: `${(h.straight / total) * 100}%` as any, backgroundColor: '#6ee7b7' }} />
                            <View style={{ width: `${(h.right / total) * 100}%` as any, backgroundColor: '#f59e0b' }} />
                          </View>
                          <Text style={{ color: '#aaa', fontSize: 11, width: 28, textAlign: 'right' }}>{total}</Text>
                        </View>
                      );
                    })}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                      <Text style={{ color: '#ef4444', fontSize: 11 }}>■ Left</Text>
                      <Text style={{ color: '#6ee7b7', fontSize: 11 }}>■ Straight</Text>
                      <Text style={{ color: '#f59e0b', fontSize: 11 }}>■ Right</Text>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ── TRENDS TAB ── */}
        {tab === 'trends' && (
          <View style={{ gap: 14 }}>
            {loading ? (
              <ActivityIndicator color="#6ee7b7" style={{ marginTop: 40 }} />
            ) : !trends || trends.sessionCount === 0 ? (
              <EmptyState label="Complete a practice session to unlock trend analysis." />
            ) : (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Overall Trend</Text>
                  <Text style={[styles.bigStat, { color: trendColor }]}>{trendLabel}</Text>
                  <Text style={styles.cardBody}>{trends.summary}</Text>
                </View>

                <View style={styles.statsGrid}>
                  <StatTile label="Consistency" value={`${trends.consistencyScore}`} unit="/100" color="#6ee7b7" />
                  <StatTile label="Confidence"  value={`${trends.confidenceScore}`}  unit="/100" color="#a78bfa" />
                  <StatTile label="Sessions"    value={`${trends.sessionCount}`}       unit=""     color="#fbbf24" />
                  <StatTile label="Shape"       value={trends.dominantShape}           unit=""     color="#f9a8d4" small />
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Straight Shot % — Recent vs Earlier</Text>
                  <View style={{ gap: 10, marginTop: 8 }}>
                    <BarRow label="Last 3 sessions" pct={trends.recentAvgStraight} color="#6ee7b7" />
                    <BarRow label="Prior sessions"  pct={trends.olderAvgStraight}  color="#4a7c5e" />
                  </View>
                  {trends.recentAvgStraight > trends.olderAvgStraight ? (
                    <Text style={[styles.cardBody, { color: '#4ade80', marginTop: 8 }]}>
                      ↑ Straight % is up {Math.round(trends.recentAvgStraight - trends.olderAvgStraight)} pts vs prior — keep it going!
                    </Text>
                  ) : trends.recentAvgStraight < trends.olderAvgStraight ? (
                    <Text style={[styles.cardBody, { color: '#f87171', marginTop: 8 }]}>
                      ↓ Straight % is down {Math.round(trends.olderAvgStraight - trends.recentAvgStraight)} pts — revisit your pre-shot routine.
                    </Text>
                  ) : null}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Long-Term Miss Bias</Text>
                  <Text style={[styles.bigStat, {
                    color: trends.longTermMissBias === 'left' ? '#ef4444'
                      : trends.longTermMissBias === 'right' ? '#f59e0b'
                      : '#6ee7b7',
                  }]}>
                    {trends.longTermMissBias === 'left' ? '← Left'
                      : trends.longTermMissBias === 'right' ? 'Right →'
                      : '↑ Neutral'}
                  </Text>
                  <Text style={styles.cardBody}>
                    {trends.longTermMissBias === 'neutral'
                      ? 'No consistent long-term bias detected. Ball flight is balanced.'
                      : `Over ${trends.sessionCount} sessions you consistently miss ${trends.longTermMissBias}. Build a compensating aim routine.`}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* ── CLUBS TAB ── */}
        {tab === 'clubs' && (
          <View style={{ gap: 14 }}>
            {clubs.length === 0 ? (
              <EmptyState label="No club data yet. Log shots with club selected." />
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Club Accuracy</Text>
                <Text style={[styles.cardBody, { marginBottom: 12 }]}>% of straight shots per club (min 1 shot).</Text>
                {clubs.map((c) => (
                  <View key={c.club} style={{ marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={{ color: '#A7F3D0', fontSize: 13, fontWeight: '700' }}>{c.club}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={{ color: '#6b7280', fontSize: 11 }}>{c.total} shots</Text>
                        <Text style={{
                          fontSize: 13, fontWeight: '800',
                          color: c.accuracyPct >= 60 ? '#4ade80' : c.accuracyPct >= 40 ? '#fbbf24' : '#f87171',
                        }}>{c.accuracyPct}%</Text>
                      </View>
                    </View>
                    <View style={{ height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, flexDirection: 'row', overflow: 'hidden' }}>
                      <View style={{ width: `${(c.left / c.total) * 100}%` as any, backgroundColor: '#ef4444' }} />
                      <View style={{ width: `${(c.straight / c.total) * 100}%` as any, backgroundColor: '#6ee7b7' }} />
                      <View style={{ width: `${(c.right / c.total) * 100}%` as any, backgroundColor: '#f59e0b' }} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
      <Text style={{ fontSize: 36 }}>📊</Text>
      <Text style={{ color: '#4a7c5e', fontSize: 14, textAlign: 'center', lineHeight: 21 }}>{label}</Text>
    </View>
  );
}

function StatTile({ label, value, unit, color, small }: { label: string; value: string; unit: string; color: string; small?: boolean }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color, fontSize: small ? 16 : 24 }]}>{value}<Text style={{ fontSize: 11, color: '#6b7280' }}>{unit}</Text></Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BarRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ color: '#aaa', fontSize: 12 }}>{label}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{Math.round(pct)}%</Text>
      </View>
      <View style={{ height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(pct, 100)}%` as any, height: 8, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:           DS.screen,
  header:         { ...DS.header, paddingTop: Space.lg },
  backBtn:        { width: 64 },
  backText:       { color: Palette.positiveDim, fontSize: Type.body, fontWeight: Type.semibold },
  title:          { flex: 1, color: Palette.white, fontSize: Type.lg, fontWeight: Type.black, textAlign: 'center', letterSpacing: 0.5 },
  pillRow:        { flexDirection: 'row', gap: Space.sm, paddingHorizontal: Space.lg, paddingVertical: Space.md },
  pill:           { flex: 1, backgroundColor: Palette.overlayLight, borderRadius: Radius.md, paddingVertical: Space.sm + 2, alignItems: 'center', borderWidth: 1 },
  pillNum:        { fontSize: Type.xl, fontWeight: Type.black },
  pillLabel:      { color: Palette.muted, fontSize: Type.xs, fontWeight: Type.semibold, marginTop: 2 },
  tabBar:         { flexDirection: 'row', paddingHorizontal: Space.lg, gap: Space.sm, marginBottom: Space.xs },
  tabBtn:         { flex: 1, paddingVertical: Space.sm + 2, borderRadius: Radius.md, alignItems: 'center', backgroundColor: Palette.cardBg, borderWidth: 1, borderColor: Palette.border },
  tabBtnActive:   { backgroundColor: Palette.bgActive, borderColor: Palette.borderActive },
  tabLabel:       { color: Palette.muted, fontSize: Type.sm, fontWeight: Type.semibold },
  tabLabelActive: { color: Palette.white },
  body:           { paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: 40 },
  card:           DS.card,
  cardTitle:      DS.sectionTitle,
  cardBody:       DS.bodyText,
  bigStat:        { fontSize: Type.h2, fontWeight: Type.black, marginVertical: Space.sm },
  statsGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  statTile:       { flex: 1, minWidth: '45%', ...DS.card, alignItems: 'center' },
  statValue:      { fontWeight: Type.black, marginBottom: 2 },
  statLabel:      { color: Palette.muted, fontSize: Type.sm, fontWeight: Type.semibold },
});
