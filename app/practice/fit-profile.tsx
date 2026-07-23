/**
 * 2026-06-15 (Tim — AI club fitting, honest v1) — FIT PROFILE screen.
 *
 * The honest first piece of club fitting: your distance ladder from REAL tracked
 * shots, with the GAPS (holes to fill) and OVERLAPS (redundant clubs) called out.
 * Each club flagged measured vs inferred; a clear "starting point, not a
 * launch-monitor spec" disclaimer. ([[ai-club-fitting]])
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useClubStatsStore, CLUB_ORDER, type ClubName } from '../../store/clubStatsStore';
import { composeFitProfile, recommendFlex, type FitClubInput } from '../../services/practice/fitProfile';
import { recommendBall } from '../../services/ballFitting';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { safeBack } from '../../services/safeBack';
import { useRouter } from 'expo-router';

export default function FitProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const stats = useClubStatsStore((s) => s.stats);
  const handicap = usePlayerProfileStore((s) => s.handicap);
  // 2026-06-24 — extra readable signals for the honest Ball Fit (directional).
  const handicapIndex = usePlayerProfileStore((s) => s.handicap_index);
  const missType = usePlayerProfileStore((s) => s.missType);
  const goal = usePlayerProfileStore((s) => s.goal);

  const manual = useClubStatsStore((s) => s.manual);
  const reps = useClubStatsStore((s) => s.reps);
  const [editingClub, setEditingClub] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // 2026-06-16 (Tim — credit for swinging clubs in practice) — per-club rep volume
  // (Smart Motion / drills). HONEST: volume only, never a measured carry.
  const repList = useMemo(
    () => CLUB_ORDER.filter((c) => c !== 'Putter' && (reps[c] ?? 0) > 0).map((c) => ({ club: c, n: reps[c]! })).sort((a, b) => b.n - a.n),
    [reps],
  );

  const openEdit = (club: string) => {
    const st = useClubStatsStore.getState();
    setEditingClub(club);
    setDraft(st.hasDistance(club as ClubName) ? String(Math.round(st.distanceFor(club as ClubName))) : '');
  };
  const saveEdit = (club: string) => {
    const y = parseInt(draft, 10);
    if (Number.isFinite(y) && y > 0) useClubStatsStore.getState().setManual(club as ClubName, y);
    setEditingClub(null);
  };
  const clearEdit = (club: string) => {
    useClubStatsStore.getState().clearManual(club as ClubName);
    setEditingClub(null);
  };

  const profile = useMemo(() => {
    const st = useClubStatsStore.getState();
    const clubs: FitClubInput[] = CLUB_ORDER
      .filter((c) => c !== 'Putter')
      .map((c) => ({ club: c, yards: st.distanceFor(c), measured: st.hasSamples(c), stated: st.hasManual(c) }));
    return composeFitProfile(clubs);
    // recompute when tracked stats OR the stated bag change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, manual]);

  // FLEX (honest: only off a MEASURED driver carry) + the honest, DIRECTIONAL
  // Ball Fit (recommendBall — speed tier from carry, handicap tier, short-game/
  // feel emphasis). Both starting points, never launch-monitor specs.
  const { flex, ball } = useMemo(() => {
    const st = useClubStatsStore.getState();
    const driverMeasured = st.hasSamples('Driver');
    // Prefer the player's REAL driver carry: tracked avg, else a stated (My Bag)
    // number. Never feed the standard chart as if it were the player's own speed.
    const driverCarry = st.hasDistance('Driver')
      ? st.distanceFor('Driver')
      : null;
    // Wedge-work proxy for short-game / greenside-feel priority (tracked samples).
    const wedgeSamples =
      (st.stats.PW?.samples ?? 0) + (st.stats.GW?.samples ?? 0) +
      (st.stats.SW?.samples ?? 0) + (st.stats.LW?.samples ?? 0);
    const hcp = typeof handicapIndex === 'number' ? handicapIndex
      : typeof handicap === 'number' ? handicap : null;
    return {
      flex: recommendFlex(st.avgFor('Driver'), driverMeasured),
      ball: recommendBall({
        handicap: hcp,
        driverCarryYards: driverCarry,
        goal,
        missType,
        wedgeSamples,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, manual, handicap, handicapIndex, missType, goal]);

  const gapSet = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of profile.gaps) m.set(g.upper, g.gapYards); // gap sits below the longer club
    return m;
  }, [profile.gaps]);
  const overlapSet = useMemo(() => new Set(profile.overlaps.map((o) => o.longer)), [profile.overlaps]);

  const confColor = profile.confidence === 'high' ? '#3FB950' : profile.confidence === 'medium' ? '#f5a623' : '#9ca3af';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Fit Profile</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        <Text style={[styles.headline, { color: colors.text_primary }]}>{profile.headline}</Text>
        <View style={styles.confRow}>
          <View style={[styles.confDot, { backgroundColor: confColor }]} />
          <Text style={[styles.confText, { color: colors.text_muted }]}>
            {profile.measuredCount} tracked · {profile.statedCount} you set · of {profile.totalCount} clubs · {profile.confidence} confidence
          </Text>
        </View>

        {/* 2026-07-23 (Tim — Bag Vision) — populate the bag by video instead of typing each club. */}
        <TouchableOpacity
          onPress={() => router.push('/bag-scan' as never)}
          style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Scan my bag with video to populate clubs"
        >
          <Ionicons name="videocam-outline" size={18} color={colors.accent} />
          <Text style={[styles.scanBagText, { color: colors.accent }]}>Scan my bag with video</Text>
        </TouchableOpacity>

        {/* GAPS */}
        {profile.gaps.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#f5a623' }]}>
            <Text style={[styles.cardLabel, { color: '#f5a623' }]}>GAPS TO FILL</Text>
            {profile.gaps.map((g, i) => (
              <Text key={i} style={[styles.gapText, { color: colors.text_primary }]}>
                {g.gapYards} yd between your {g.upper} and {g.lower} — a club-and-a-half hole around {g.centerYards} yds.
              </Text>
            ))}
          </View>
        )}

        {/* OVERLAPS */}
        {profile.overlaps.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.text_muted }]}>DOING THE SAME JOB</Text>
            {profile.overlaps.map((o, i) => (
              <Text key={i} style={[styles.gapText, { color: colors.text_primary }]}>
                {o.longer} and {o.shorter} carry within {o.gapYards} yds — one may be redundant.
              </Text>
            ))}
          </View>
        )}

        {/* FLEX + BALL — honest directional layers (starting points). */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: '#22d3ee' }]}>SHAFT FLEX</Text>
          {flex ? (
            <>
              <Text style={[styles.fitValue, { color: colors.text_primary }]}>{flex.flex}</Text>
              <Text style={[styles.gapText, { color: colors.text_muted }]}>{flex.note}</Text>
            </>
          ) : (
            <Text style={[styles.gapText, { color: colors.text_muted }]}>Track a few driver shots and I&apos;ll give you an honest flex starting point (from your real carry, not a guess).</Text>
          )}
        </View>

        {/* RECOMMENDED BALL — honest, DIRECTIONAL fit from readable game data. */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent_sky }]}>
          <Text style={[styles.cardLabel, { color: colors.accent_sky }]}>RECOMMENDED BALL</Text>
          {ball.lowInfo ? (
            <>
              <Text style={[styles.fitValue, { color: colors.text_primary }]}>{ball.headline}</Text>
              {ball.reasons.map((r, i) => (
                <View key={i} style={styles.reasonRow}>
                  <Ionicons name="ellipse" size={5} color={colors.text_muted} style={{ marginTop: 7 }} />
                  <Text style={[styles.gapText, { color: colors.text_muted, marginTop: 0 }]}>{r}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={styles.ballHeadRow}>
                <Text style={[styles.profileTag, { color: '#0a1410', backgroundColor: colors.accent_sky }]}>{ball.profileLabel}</Text>
              </View>
              <Text style={[styles.fitValue, { color: colors.text_primary, marginTop: 8 }]}>{ball.headline}</Text>

              {ball.reasons.map((r, i) => (
                <View key={i} style={styles.reasonRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.accent_sky} style={{ marginTop: 3 }} />
                  <Text style={[styles.gapText, { color: colors.text_secondary, marginTop: 0, flex: 1 }]}>{r}</Text>
                </View>
              ))}

              {/* Characteristics — '—' where we have no honest read (never fabricated). */}
              <View style={styles.charRow}>
                <View style={styles.charCell}>
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>SPIN</Text>
                  <Text style={[styles.charValue, { color: colors.text_primary }]}>{ball.characteristics.spin}</Text>
                </View>
                <View style={styles.charCell}>
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>FEEL</Text>
                  <Text style={[styles.charValue, { color: colors.text_primary }]}>{ball.characteristics.feel}</Text>
                </View>
                <View style={[styles.charCell, { flex: 1.4 }]}>
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>COVER</Text>
                  <Text style={[styles.charValue, { color: colors.text_primary }]}>{ball.characteristics.cover}</Text>
                </View>
              </View>

              {/* Generic categories — NOT branded balls asserted as fact. */}
              {ball.exampleCategories.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {ball.exampleCategories.map((c) => (
                    <View key={c} style={[styles.catPill, { borderColor: colors.border }]}>
                      <Text style={[styles.catPillText, { color: colors.text_secondary }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
          {/* Standing honesty line — always shown. */}
          <Text style={[styles.honesty, { color: colors.text_muted }]}>{ball.honestyLine}</Text>
        </View>

        {/* PRACTICE VOLUME — honest rep credit per club (not a measured carry). */}
        {repList.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.accent }]}>PRACTICE VOLUME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {repList.map((r) => (
                <View key={r.club} style={[styles.repPill, { borderColor: colors.border }]}>
                  <Text style={[styles.repClub, { color: colors.text_primary }]}>{r.club}</Text>
                  <Text style={[styles.repN, { color: colors.text_muted }]}> {r.n}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.gapText, { color: colors.text_muted }]}>Reps you&apos;ve logged in practice — work credited per club. Volume, not a measured carry.</Text>
          </View>
        )}

        {/* LADDER — your bag. Tap any non-tracked club to set your carry. */}
        <Text style={[styles.cardLabel, { color: colors.text_muted, marginTop: 16, marginBottom: 8, marginLeft: 4 }]}>YOUR BAG · TAP A CLUB TO SET ITS CARRY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 4 }]}>
          {profile.ladder.map((c) => {
            if (editingClub === c.club) {
              return (
                <View key={c.club} style={styles.ladderRow}>
                  <Text style={[styles.ladderClub, { color: colors.text_primary }]}>{c.club}</Text>
                  <View style={styles.ladderRight}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      keyboardType="number-pad"
                      autoFocus
                      placeholder="yds"
                      placeholderTextColor={colors.text_muted}
                      maxLength={3}
                      onSubmitEditing={() => saveEdit(c.club)}
                      style={[styles.editInput, { color: colors.text_primary, borderColor: colors.accent }]}
                      accessibilityLabel={`Carry distance for ${c.club} in yards`}
                    />
                    <TouchableOpacity onPress={() => saveEdit(c.club)} style={styles.editBtn} accessibilityRole="button" accessibilityLabel="Save">
                      <Ionicons name="checkmark" size={20} color="#3FB950" />
                    </TouchableOpacity>
                    {c.stated ? (
                      <TouchableOpacity onPress={() => clearEdit(c.club)} style={styles.editBtn} accessibilityRole="button" accessibilityLabel="Remove">
                        <Ionicons name="trash-outline" size={16} color={colors.text_muted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            }
            const editable = !c.measured; // tracked carries win; don't let a stated value masquerade as tracked
            const inner = (
              <>
                <Text style={[styles.ladderClub, { color: colors.text_primary }]}>{c.club}</Text>
                <View style={styles.ladderRight}>
                  <Text style={[styles.ladderYards, { color: c.measured || c.stated ? colors.text_primary : colors.text_muted }]}>{Math.round(c.yards)}<Text style={styles.ladderUnit}> yd</Text></Text>
                  <View style={[styles.measuredDot, { backgroundColor: c.measured ? '#3FB950' : c.stated ? '#22d3ee' : 'transparent', borderColor: c.measured ? '#3FB950' : c.stated ? '#22d3ee' : colors.text_muted }]} />
                  {gapSet.has(c.club) ? <Ionicons name="alert-circle" size={14} color="#f5a623" style={{ marginLeft: 4 }} /> : null}
                  {overlapSet.has(c.club) ? <Ionicons name="copy-outline" size={13} color={colors.text_muted} style={{ marginLeft: 4 }} /> : null}
                  {editable ? <Ionicons name="pencil" size={12} color={colors.text_muted} style={{ marginLeft: 6 }} /> : null}
                </View>
              </>
            );
            return editable ? (
              <TouchableOpacity
                key={c.club}
                style={styles.ladderRow}
                onPress={() => openEdit(c.club)}
                accessibilityRole="button"
                accessibilityLabel={`Set carry for ${c.club}`}
              >
                {inner}
              </TouchableOpacity>
            ) : (
              <View key={c.club} style={styles.ladderRow}>{inner}</View>
            );
          })}
          <Text style={[styles.legend, { color: colors.text_muted }]}>
            ● tracked from your shots · ◆ you set it · ○ estimate — tap a club to set your carry
          </Text>
        </View>

        <Text style={[styles.disclaimer, { color: colors.text_muted }]}>{profile.disclaimer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headline: { fontSize: 16, fontWeight: '800', lineHeight: 22, marginTop: 4 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, marginBottom: 12 },
  scanBagBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginBottom: 14 },
  scanBagText: { fontSize: 15, fontWeight: '800' },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  confText: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  cardLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginBottom: 8 },
  gapText: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  fitValue: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  ladderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.18)' },
  ladderClub: { fontSize: 14, fontWeight: '700' },
  ladderRight: { flexDirection: 'row', alignItems: 'center' },
  ladderYards: { fontSize: 14, fontWeight: '800' },
  ladderUnit: { fontSize: 11, fontWeight: '600' },
  measuredDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, marginLeft: 10 },
  editInput: { minWidth: 56, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  editBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  repPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  repClub: { fontSize: 12, fontWeight: '800' },
  repN: { fontSize: 12, fontWeight: '600' },
  legend: { fontSize: 10, lineHeight: 15, paddingHorizontal: 10, paddingVertical: 8 },
  disclaimer: { fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 16 },
  // Recommended Ball card.
  ballHeadRow: { flexDirection: 'row', alignItems: 'center' },
  profileTag: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 6 },
  charRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  charCell: { flex: 1 },
  charLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  charValue: { fontSize: 14, fontWeight: '800', marginTop: 2, textTransform: 'capitalize' },
  catPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  catPillText: { fontSize: 11, fontWeight: '700' },
  honesty: { fontSize: 10, lineHeight: 15, marginTop: 12, fontStyle: 'italic' },
});
