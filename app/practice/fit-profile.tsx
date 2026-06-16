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
import { composeFitProfile, recommendFlex, recommendBallCategory, type FitClubInput } from '../../services/practice/fitProfile';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { safeBack } from '../../services/safeBack';

export default function FitProfileScreen() {
  const { colors } = useTheme();
  const stats = useClubStatsStore((s) => s.stats);
  const handicap = usePlayerProfileStore((s) => s.handicap);

  const manual = useClubStatsStore((s) => s.manual);
  const [editingClub, setEditingClub] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

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

  // FLEX (honest: only off a MEASURED driver carry) + BALL category (speed tier +
  // handicap). Both starting points, never launch-monitor specs.
  const { flex, ball } = useMemo(() => {
    const st = useClubStatsStore.getState();
    const driverCarry = st.avgFor('Driver');
    const driverMeasured = st.hasSamples('Driver');
    return {
      flex: recommendFlex(driverCarry, driverMeasured),
      ball: recommendBallCategory(driverMeasured ? driverCarry : 0, typeof handicap === 'number' ? handicap : null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, handicap]);

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

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: '#a78bfa' }]}>BALL CATEGORY</Text>
          <Text style={[styles.fitValue, { color: colors.text_primary }]}>{ball.category}</Text>
          <Text style={[styles.gapText, { color: colors.text_muted }]}>{ball.note}</Text>
        </View>

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
  legend: { fontSize: 10, lineHeight: 15, paddingHorizontal: 10, paddingVertical: 8 },
  disclaimer: { fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 16 },
});
