/**
 * Player Profile Screen
 *
 * Shows a unified view of the player's:
 *   • Stats summary (accuracy, shots logged, rounds played)
 *   • AI-learned tendencies (miss bias, confidence, coach note)
 *   • Performance tags (strength, struggle, coaching style)
 *   • Per-club adjustments
 *   • Top highlights (tap to view highlight reel)
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons as MCIcon } from '@expo/vector-icons';

import { Palette } from '../constants/theme';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useAiProfileStore }     from '../store/aiProfileStore';
import { useRoundStore }         from '../store/roundStore';
import { getHighlights }         from '../features/replay/HighlightEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

function missLabel(m: string | null): string {
  if (m === 'right')    return 'Push Right';
  if (m === 'left')     return 'Pull Left';
  if (m === 'straight') return 'Straight Hitter';
  return '—';
}

function confidenceColor(c: string | null): string {
  if (c === 'high')   return Palette.positive;
  if (c === 'medium') return '#f59e0b';
  return Palette.muted ?? '#9ca3af';
}

function tagLabel(key: string | null): string {
  if (!key) return '—';
  return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Stat Tile ────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={st.tile}>
      <Text style={st.tileValue}>{value}</Text>
      <Text style={st.tileLabel}>{label}</Text>
      {sub ? <Text style={st.tileSub}>{sub}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  tile:       { flex: 1, backgroundColor: '#0E2A21', borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#1C3D2C' },
  tileValue:  { color: Palette.positive, fontSize: 26, fontWeight: '900' },
  tileLabel:  { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  tileSub:    { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
});

// ─── Tag Chip ─────────────────────────────────────────────────────────────────

function TagChip({ label, icon, color = Palette.positive }: { label: string; icon: string; color?: string }) {
  return (
    <View style={[chip.wrap, { borderColor: color + '55' }]}>
      <MCIcon name={icon as any} size={13} color={color} />
      <Text style={[chip.txt, { color }]}>{label}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.04)' },
  txt:  { fontSize: 12, fontWeight: '700' },
});

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlayerProfileScreen() {
  const router = useRouter();

  // Stores
  const pp   = usePlayerProfileStore();
  const ai   = useAiProfileStore();
  const shots = useRoundStore((s) => s.shots);
  const selectedCourseIdx = useRoundStore((s) => s.selectedCourseIdx);

  // Computed stats from logged shots
  const stats = useMemo(() => {
    const total    = shots.length;
    const center   = shots.filter((s) => s.result === 'center').length;
    const misRight = shots.filter((s) => s.result === 'right').length;
    const misLeft  = shots.filter((s) => s.result === 'left').length;
    const avgDist  = total > 0 ? Math.round(shots.reduce((sum, s) => sum + (s.gpsDistance ?? s.distance ?? 0), 0) / total) : 0;
    return { total, center, misRight, misLeft, avgDist };
  }, [shots]);

  // Top highlights
  const highlights = useMemo(() => getHighlights(shots, 3), [shots]);

  // Performance tags
  const tags = useMemo(() => {
    const t: { label: string; icon: string; color?: string }[] = [];
    if (pp.bigStrength)       t.push({ label: tagLabel(pp.bigStrength),   icon: 'star',              color: '#fcd34d' });
    if (pp.biggestStruggle)   t.push({ label: tagLabel(pp.biggestStruggle), icon: 'alert-circle-outline', color: '#f87171' });
    if (pp.coachingStyle)     t.push({ label: tagLabel(pp.coachingStyle), icon: 'account-voice',     color: '#60a5fa' });
    if (pp.physicalLimitation && pp.physicalLimitation !== 'none')
                              t.push({ label: tagLabel(pp.physicalLimitation), icon: 'human',        color: '#a78bfa' });
    if (ai.missBias)          t.push({ label: `Misses ${missLabel(ai.missBias)}`, icon: 'arrow-top-right', color: '#fb923c' });
    return t;
  }, [pp, ai]);

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} hitSlop={12}>
          <MCIcon name="chevron-left" size={26} color={Palette.positive} />
        </Pressable>
        <Text style={s.title}>Player Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Avatar + Name ─────────────────────────────────────────────── */}
        <View style={s.avatarRow}>
          <View style={s.avatarCircle}>
            <MCIcon name="account-circle" size={64} color={Palette.positive} />
          </View>
          <View style={s.avatarInfo}>
            <Text style={s.playerName}>My Profile</Text>
            <Text style={s.playerSub}>{ai.roundsPlayed} round{ai.roundsPlayed !== 1 ? 's' : ''} played</Text>
            {ai.coachNote ? (
              <Text style={s.coachNote}>{ai.coachNote}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <SectionHeader title="THIS ROUND" />
        <View style={s.tileRow}>
          <StatTile label="Shots" value={String(stats.total)} />
          <StatTile label="Accuracy" value={pct(stats.center, stats.total)} sub="center" />
          <StatTile label="Avg Dist" value={stats.avgDist > 0 ? `${stats.avgDist}` : '—'} sub="yards" />
        </View>

        <View style={s.tileRow}>
          <StatTile label="Miss Right" value={String(stats.misRight)} />
          <StatTile label="Miss Left"  value={String(stats.misLeft)} />
          <StatTile
            label="Miss Trend"
            value={ai.missBias ? missLabel(ai.missBias) : '—'}
            sub={ai.confidence ? `${ai.confidence} conf.` : undefined}
          />
        </View>

        {/* ── Performance Tags ───────────────────────────────────────────── */}
        {tags.length > 0 && (
          <>
            <SectionHeader title="PERFORMANCE TAGS" />
            <View style={s.tagRow}>
              {tags.map((t, i) => (
                <TagChip key={i} label={t.label} icon={t.icon} color={t.color} />
              ))}
            </View>
          </>
        )}

        {/* ── AI Coach note ─────────────────────────────────────────────── */}
        {ai.confidence && ai.confidence !== 'low' && ai.coachNote ? (
          <>
            <SectionHeader title="AI COACH NOTE" />
            <View style={s.coachCard}>
              <MCIcon name="robot" size={18} color={confidenceColor(ai.confidence)} />
              <Text style={[s.coachCardTxt, { color: confidenceColor(ai.confidence) }]}>
                {ai.coachNote}
              </Text>
            </View>
          </>
        ) : null}

        {/* ── Per-club adjustments ───────────────────────────────────────── */}
        {Object.keys(ai.clubAdjustments).length > 0 && (
          <>
            <SectionHeader title="CLUB TIPS" />
            <View style={s.clubList}>
              {Object.entries(ai.clubAdjustments).map(([club, tip]) => (
                <View key={club} style={s.clubRow}>
                  <Text style={s.clubName}>{club}</Text>
                  <Text style={s.clubTip}>{tip}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Top Highlights ─────────────────────────────────────────────── */}
        {highlights.length > 0 && (
          <>
            <SectionHeader title="TOP SHOTS" />
            {highlights.map((h, i) => (
              <View key={i} style={s.highlightRow}>
                <View style={s.highlightLeft}>
                  <Text style={s.hl_hole}>Hole {h.hole}</Text>
                  <Text style={s.hl_club}>{h.club}</Text>
                </View>
                <View style={s.highlightMid}>
                  <Text style={s.hl_dist}>{h.gpsDistance ?? h.distance ?? '—'} yds</Text>
                  <Text style={s.hl_result}>{h.result}</Text>
                </View>
                <View style={s.highlightRight}>
                  <Text style={s.hl_score}>★ {h.highlightScore}</Text>
                </View>
              </View>
            ))}
            <Pressable
              style={s.reelBtn}
              onPress={() => void router.push('/highlight-reel')}
            >
              <MCIcon name="play-circle" size={18} color={Palette.positive} />
              <Text style={s.reelBtnTxt}>View Highlight Reel</Text>
            </Pressable>
          </>
        )}

        {/* ── Edit profile shortcut ─────────────────────────────────────── */}
        <Pressable
          style={s.editBtn}
          onPress={() => void router.push('/profile-setup')}
        >
          <MCIcon name="account-edit" size={16} color="rgba(255,255,255,0.7)" />
          <Text style={s.editBtnTxt}>Edit Profile Setup</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#071E16' },

  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back:          { width: 40, alignItems: 'flex-start' },
  title:         { color: '#fff', fontSize: 18, fontWeight: '800' },

  scroll:        { paddingHorizontal: 16, paddingTop: 4 },

  avatarRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  avatarCircle:  { width: 72, height: 72, borderRadius: 36, backgroundColor: '#0E2A21', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Palette.positive },
  avatarInfo:    { flex: 1, gap: 4 },
  playerName:    { color: '#fff', fontSize: 20, fontWeight: '800' },
  playerSub:     { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  coachNote:     { color: Palette.positive, fontSize: 13, fontStyle: 'italic', marginTop: 4 },

  sectionHeader: { color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 20, marginBottom: 10 },

  tileRow:       { flexDirection: 'row', gap: 10, marginBottom: 10 },

  tagRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  coachCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#0E2A21', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#1C3D2C' },
  coachCardTxt:  { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  clubList:      { gap: 8 },
  clubRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0E2A21', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#1C3D2C' },
  clubName:      { color: Palette.positive, fontWeight: '700', fontSize: 14 },
  clubTip:       { color: 'rgba(255,255,255,0.7)', fontSize: 13, flex: 1, textAlign: 'right', marginLeft: 12 },

  highlightRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0E2A21', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1C3D2C' },
  highlightLeft: { flex: 1.2, gap: 3 },
  highlightMid:  { flex: 1, alignItems: 'center', gap: 3 },
  highlightRight:{ flex: 0.7, alignItems: 'flex-end' },
  hl_hole:       { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600' },
  hl_club:       { color: '#fff', fontSize: 15, fontWeight: '700' },
  hl_dist:       { color: Palette.positive, fontSize: 18, fontWeight: '900' },
  hl_result:     { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  hl_score:      { color: '#fcd34d', fontSize: 13, fontWeight: '700' },

  reelBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 12, backgroundColor: 'rgba(46,204,113,0.1)', borderRadius: 12, paddingVertical: 13, borderWidth: 1, borderColor: Palette.positive },
  reelBtnTxt:    { color: Palette.positive, fontWeight: '700', fontSize: 14 },

  editBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 24, paddingVertical: 12 },
  editBtnTxt:    { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
});
