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
import { useClubStatsStore, CLUB_ORDER, clubIdToClubName, type ClubName } from '../../store/clubStatsStore';
import { composeFitProfile, recommendFlex, type FitClubInput } from '../../services/practice/fitProfile';
import { composeFitGap, type OwnedClub } from '../../services/practice/fitGap';
import { useClubBagStore, carryLimitFor, PUTTER_ID } from '../../store/clubBagStore';
import { clubWorkStatuses } from '../../services/clubWork';
import { liveBagPack } from '../../services/bagPackLive';
import { useRoundStore } from '../../store/roundStore';
import { clubTendencies } from '../../services/clubTendency';
import { normalizeClub } from '../../services/clubNormalize';
import { recommendBall } from '../../services/ballFitting';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { safeBack } from '../../services/safeBack';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function FitProfileScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  // 2026-07-24 (club-logic unification) — re-render trigger; the memos read current carry/total via getState.
  const stats = useClubStatsStore((s) => s.total);
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
    setDraft(st.hasDistance(club as ClubName) ? String(Math.round(st.carryFor(club as ClubName))) : '');
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
      // 2026-07-24 (club-logic unification) — the Fit Profile ladder is a CARRY ladder ("set your carry"),
      // so read carryFor (honest carry), not the tee→rest total.
      // 2026-07-27 (full-app audit) — "measured" = hasCarry (real/stated CARRY), NOT hasSamples (true for
      // GPS-total-only clubs whose carry is a total−roll ESTIMATE). Matches the dashboard + ball-fit fix;
      // otherwise the whole pre-v2-migration cohort's total-only clubs over-claim "measured" here.
      // 2026-09-11 — uses come from the rep tally every source now writes (round shot, range rep,
      // drill, uploaded video, watch swing). Before today it had ONE writer and this screen could
      // not tell a club he lives on from one that never leaves the bag.
      .map((c) => ({
        club: c, yards: st.carryFor(c), measured: st.hasCarry(c), stated: st.hasManual(c),
        uses: st.repsFor(c),
      }));
    return composeFitProfile(clubs);
    // recompute when tracked stats OR the stated bag change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, manual]);

  // 2026-07-23 (Tim — Bag Vision Phase 2) — Fit Gap: cross-reference the OWNED bag (clubBagStore,
  // populated by the video scan) against the distance gaps so advice is honest about ownership
  // (dial-in vs buy, fillable vs unfilled, redundant). Recomputes when the bag or stats change.
  const bagClubs = useClubBagStore((s) => s.clubs);
  const fitGap = useMemo(() => {
    const st = useClubStatsStore.getState();
    const owned: OwnedClub[] = Object.values(bagClubs).map((c) => ({
      club_id: c.club_id,
      name: clubIdToClubName(c.club_id),
      brand: c.brand,
      model: c.model,
      loft: c.loft,
    }));
    return composeFitGap({
      owned,
      gaps: profile.gaps,
      overlaps: profile.overlaps,
      hasDistance: (name) => st.hasDistance(name as ClubName),
      clubOrder: CLUB_ORDER,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagClubs, profile, stats, manual]);

  // FLEX (honest: only off a MEASURED driver carry) + the honest, DIRECTIONAL
  // Ball Fit (recommendBall — speed tier from carry, handicap tier, short-game/
  // feel emphasis). Both starting points, never launch-monitor specs.
  const { flex, ball } = useMemo(() => {
    const st = useClubStatsStore.getState();
    const driverMeasured = st.hasCarry('Driver'); // 2026-07-27 audit — real/stated carry, not total-only estimate
    // 2026-07-24 (club-logic unification) — flex + ball fit key off the honest driver CARRY (carryFor:
    // measured → stated → tracked-total−roll), not the old tracked value which was a GPS total (~20y hot).
    const driverCarry = st.hasDistance('Driver') ? st.carryFor('Driver') : null;
    // Wedge-work proxy for short-game / greenside-feel priority (samples in either ladder).
    const wedgeSamples = (['PW', 'GW', 'SW', 'LW'] as const).reduce(
      (a, c) => a + (st.carry[c]?.samples ?? 0) + (st.total[c]?.samples ?? 0), 0);
    const hcp = typeof handicapIndex === 'number' ? handicapIndex
      : typeof handicap === 'number' ? handicap : null;
    return {
      flex: recommendFlex(st.carryFor('Driver'), driverMeasured),
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

  /**
   * 2026-08-17 — per-club tendency for the ladder rows. Derived from shots ALREADY logged (current
   * round plus history — a club's character isn't a per-round fact), through the same pure module
   * the caddie reads, so the screen and the brain can never disagree about what a club does.
   * Carry is dropped from the label because the row already shows it; what's left is the shape.
   */
  const tendencyByClub = useMemo(() => {
    const map = new Map<string, string>();
    try {
      const rs = useRoundStore.getState();
      const all = [...(rs.roundHistory ?? []).flatMap((r) => r.shots ?? []), ...(rs.shots ?? [])].slice(-300);
      for (const t of clubTendencies(all, () => null, normalizeClub)) {
        if (!t.shape && !t.miss) continue;
        const of = `${Math.round(t.shapeShare * t.shapeN)} of ${t.shapeN}`;
        map.set(t.club, t.shape
          ? (t.shape === 'straight' ? `dead straight · ${of}` : `${t.shape} · ${of}`)
          : `misses ${t.miss}`);
      }
    } catch { /* tendencies are additive — the ladder renders without them */ }
    return map;
  }, []);

  /**
   * 2026-09-11 (Tim) — PACK YOUR BAG.
   *
   * "User needs to be able to enter, like, eighteen clubs and then set sixteen for the bag with,
   * obviously, the putter defaulted. And then you'd have the, like, one line of data or
   * characteristics for each club, and you pack your bag."
   *
   * It lives HERE and not on a screen of its own — "the bag and clubs are set in the dashboard" —
   * beside the ladder that already knows every club's carry. What you OWN and what you are CARRYING
   * are two different facts and the app has only ever held one of them, which is how the caddie
   * could name a club sitting in the boot of the car.
   *
   * The characteristics line is the club's work status, through services/clubWork, so the row, the
   * caddie and the packer cannot hold three opinions about the same club.
   * [[two-owners-is-the-root-cause]]
   */
  const carriedToday = useClubBagStore((st) => st.carriedToday);
  const isCompetition = useRoundStore((st) => st.isCompetition);
  const packRows = useMemo(() => {
    const st = useClubStatsStore.getState();
    const work = (() => {
      try {
        const rs = useRoundStore.getState();
        const all = [...(rs.roundHistory ?? []).flatMap((r) => r.shots ?? []), ...(rs.shots ?? [])].slice(-400);
        const m = new Map<string, string>();
        for (const w of clubWorkStatuses({ shots: all as never, normalize: normalizeClub })) {
          if (w.status !== 'unproven') m.set(w.club, w.line);
        }
        return m;
      } catch { return new Map<string, string>(); }
    })();
    return Object.values(bagClubs)
      .map((c) => {
        const name = clubIdToClubName(c.club_id);
        const key = (name ?? c.club_id) as string;
        const yards = name && st.hasDistance(name as ClubName) ? Math.round(st.carryFor(name as ClubName)) : null;
        return {
          club_id: c.club_id,
          label: key,
          yards,
          /**
           * One line, and it prefers the WORK status over the yardage, because a number he already
           * knows is not a characteristic. Falls back to the carry, then to silence — never to a
           * sentence assembled out of nothing. [[illustration-data-points]]
           */
          detail: work.get(key)
            ?? (yards != null ? `${yards} yd carry` : null),
          isPutter: c.club_id === PUTTER_ID,
        };
      })
      .sort((a, b) => CLUB_ORDER.indexOf(a.label as ClubName) - CLUB_ORDER.indexOf(b.label as ClubName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagClubs, stats, manual]);

  /** Empty carriedToday means carrying everything — the honest default, never "carrying nothing". */
  const packedSet = useMemo(
    () => (carriedToday.length > 0 ? new Set(carriedToday) : new Set(packRows.map((r) => r.club_id))),
    [carriedToday, packRows],
  );
  const limit = carryLimitFor(isCompetition);

  const togglePacked = (club_id: string) => {
    const next = new Set(packedSet);
    // The putter never comes out. Nobody plays a round without one, and a tap that removed it would
    // be the app making the worst possible choice on the player's behalf.
    if (club_id === PUTTER_ID) return;
    if (next.has(club_id)) next.delete(club_id); else next.add(club_id);
    useClubBagStore.getState().setCarriedToday([...next], { limit });
  };

  const autoPack = () => {
    const { pack } = liveBagPack();
    if (!pack) return;
    const byLabel = new Map(packRows.map((r) => [r.label, r.club_id]));
    const ids = pack.carry.map((c) => byLabel.get(c)).filter((x): x is NonNullable<typeof x> => !!x);
    if (ids.length > 0) useClubBagStore.getState().setCarriedToday(ids, { limit });
  };

  const confColor = profile.confidence === 'high' ? '#3FB950' : profile.confidence === 'medium' ? '#f5a623' : '#9ca3af';

  /**
   * 2026-09-12 (Tim — "it has a key but the key shows grey dots, not the yellow and green in the bag
   * setup") — ONE OWNER FOR WHAT A DOT MEANS.
   *
   * There was no legend. The confidence line above LOOKED like one — it uses the exact words
   * "tracked" and "you set" that describe these dots — but its single dot is coloured by CONFIDENCE
   * (green / amber / grey), a different axis entirely. So on a low-confidence bag it showed a grey
   * dot while the list below showed green and cyan, and appeared to explain something it contradicts.
   *
   * The legend now takes its swatches from THIS function, the same one the list rows use, so the two
   * cannot drift. A legend maintained separately from the thing it explains is how you get a legend
   * that lies. [[two-owners-is-the-root-cause]]
   */
  const dotStyleFor = (measured: boolean | undefined, stated: boolean | undefined) => ({
    backgroundColor: measured ? '#3FB950' : stated ? '#22d3ee' : 'transparent',
    borderColor: measured ? '#3FB950' : stated ? '#22d3ee' : colors.text_muted,
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>{t('practice_fit_profile.fit_profile_screen.fit_profile')}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        <Text style={[styles.headline, { color: colors.text_primary }]}>{profile.headline}</Text>
        <View style={styles.confRow}>
          <View style={[styles.confDot, { backgroundColor: confColor }]} />
          <Text style={[styles.confText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.tracked_you_set_of_clubs', { measuredCount: profile.measuredCount, statedCount: profile.statedCount, totalCount: profile.totalCount, confidence: profile.confidence })}</Text>
        </View>

        {/**
          * THE KEY. Three states, three appearances, stated once — swatches come from dotStyleFor,
          * the same function the rows below use, so they can never drift apart.
          */}
        <View style={styles.keyRow}>
          {([
            [true, false, t('practice_fit_profile.key.tracked')],
            [false, true, t('practice_fit_profile.key.you_set')],
            [false, false, t('practice_fit_profile.key.estimated')],
          ] as const).map(([m, st, label]) => (
            <View key={label} style={styles.keyItem}>
              <View style={[styles.measuredDot, dotStyleFor(m, st), { marginLeft: 0 }]} />
              <Text style={[styles.keyText, { color: colors.text_muted }]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* 2026-07-23 (Tim — Bag Vision) — populate the bag by video instead of typing each club. */}
        <TouchableOpacity
          onPress={() => router.push('/bag-scan' as never)}
          style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel={t('practice_fit_profile.accessibility_label.scan_my_bag_with_video')}
        >
          <Ionicons name="videocam-outline" size={18} color={colors.accent} />
          <Text style={[styles.scanBagText, { color: colors.accent }]}>{t('practice_fit_profile.fit_profile_screen.scan_my_bag_with_video')}</Text>
        </TouchableOpacity>

        {/* 2026-07-29 (Tim — Arccos Air trial) — seed the distance ladder from an Arccos club-averages
            screenshot (their numbers are already outlier-stripped). Sibling of the bag video scan. */}
        <TouchableOpacity
          onPress={() => router.push('/arccos-import' as never)}
          style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.accent_sky, marginTop: -4 }]}
          accessibilityRole="button"
          accessibilityLabel={t('practice_fit_profile.accessibility_label.import_my_club_distances_from')}
        >
          <Ionicons name="cloud-download-outline" size={18} color={colors.accent_sky} />
          <Text style={[styles.scanBagText, { color: colors.accent_sky }]}>{t('practice_fit_profile.fit_profile_screen.import_distances_from_arccos')}</Text>
        </TouchableOpacity>

        {/* 2026-07-23 (Tim — Bag Vision Phase 2) — FIT GAP: your owned bag vs your data. */}
        {fitGap.ownedCount > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
            <Text style={[styles.cardLabel, { color: colors.accent }]}>{t('practice_fit_profile.fit_profile_screen.fit_gap_your_bag_vs')}</Text>
            <Text style={[styles.confText, { color: colors.text_muted, marginBottom: 8 }]}>{t('practice_fit_profile.fit_profile_screen.clubs_in_your_bag_with', { ownedCount: fitGap.ownedCount, dialedCount: fitGap.dialedCount })}</Text>
            {fitGap.findings.length === 0 ? (
              <Text style={[styles.gapText, { color: colors.text_primary }]}>{t('practice_fit_profile.fit_profile_screen.your_bag_matches_your_distances')}</Text>
            ) : (
              fitGap.findings.map((f, i) => {
                const icon = f.kind === 'undialed' ? 'create-outline'
                  : f.kind === 'fillable_gap' ? 'checkmark-circle-outline'
                  : f.kind === 'unfilled_gap' ? 'alert-circle-outline'
                  : 'swap-horizontal-outline';
                const tint = f.kind === 'fillable_gap' ? colors.accent : f.kind === 'unfilled_gap' ? '#f5a623' : colors.text_muted;
                return (
                  <View key={`${f.kind}-${i}`} style={styles.fitGapRow}>
                    <Ionicons name={icon} size={16} color={tint} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fitGapTitle, { color: colors.text_primary }]}>{f.title}</Text>
                      <Text style={[styles.fitGapDetail, { color: colors.text_muted }]}>{f.detail}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/**
          * 2026-09-11 (Tim) — PACK YOUR BAG. "Enter eighteen clubs and then set sixteen for the bag
          * with the putter defaulted… one line of data or characteristics for each club, and you
          * pack your bag." Plus the auto-pack: "Course engine could have a chip that you could auto
          * spool your bag for that course."
          */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.text_primary }]}>{t('practice_fit_profile.fit_profile_screen.pack_your_bag')}</Text>
          {packRows.length === 0 ? (
            <Text style={[styles.gapText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.no_clubs_in_your_bag_yet')}</Text>
          ) : (
            <>
              <Text style={[styles.confText, { color: colors.text_muted, marginBottom: 4 }]}>
                {carriedToday.length > 0
                  ? t('practice_fit_profile.fit_profile_screen.packed_of_owned', { packed: packedSet.size, owned: packRows.length })
                  : t('practice_fit_profile.fit_profile_screen.carrying_everything_you_own')}
              </Text>
              {limit != null && (
                <Text style={[styles.confText, { color: '#f5a623', marginBottom: 8 }]}>{t('practice_fit_profile.fit_profile_screen.competition_14_club_cap')}</Text>
              )}
              <View style={styles.packChips}>
                <TouchableOpacity
                  style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.accent, flex: 1, marginTop: 0 }]}
                  onPress={autoPack}
                  accessibilityRole="button"
                  accessibilityLabel={t('practice_fit_profile.fit_profile_screen.auto_pack_for_this_course')}
                >
                  <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
                  <Text style={[styles.scanBagText, { color: colors.accent }]}>{t('practice_fit_profile.fit_profile_screen.auto_pack_for_this_course')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.border, flex: 1, marginTop: 0 }]}
                  onPress={() => useClubBagStore.getState().clearCarriedToday()}
                  accessibilityRole="button"
                  accessibilityLabel={t('practice_fit_profile.fit_profile_screen.carry_everything')}
                >
                  <Ionicons name="refresh-outline" size={16} color={colors.text_muted} />
                  <Text style={[styles.scanBagText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.carry_everything')}</Text>
                </TouchableOpacity>
              </View>
              {packRows.map((r) => {
                const packed = packedSet.has(r.club_id);
                return (
                  <TouchableOpacity
                    key={r.club_id}
                    style={styles.packRow}
                    onPress={() => togglePacked(r.club_id)}
                    disabled={r.isPutter}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: packed, disabled: r.isPutter }}
                    accessibilityLabel={packed
                      ? t('practice_fit_profile.accessibility_label.leave_this_club_at_home')
                      : t('practice_fit_profile.accessibility_label.pack_this_club_for_the_round')}
                  >
                    <Ionicons
                      name={packed ? 'checkbox' : 'square-outline'}
                      size={19}
                      color={r.isPutter ? colors.text_muted : packed ? colors.accent : colors.border}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fitGapTitle, { color: packed ? colors.text_primary : colors.text_muted }]}>{r.label}</Text>
                      {r.detail ? (
                        <Text style={[styles.fitGapDetail, { color: colors.text_muted }]}>{r.detail}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>

        {/* GAPS */}
        {profile.gaps.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#f5a623' }]}>
            <Text style={[styles.cardLabel, { color: '#f5a623' }]}>{t('practice_fit_profile.fit_profile_screen.gaps_to_fill')}</Text>
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
            <Text style={[styles.cardLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.doing_the_same_job')}</Text>
            {profile.overlaps.map((o, i) => (
              <Text key={i} style={[styles.gapText, { color: colors.text_primary }]}>
                {o.longer} and {o.shorter} carry within {o.gapYards} yds — one may be redundant.
              </Text>
            ))}
          </View>
        )}

        {/* FLEX + BALL — honest directional layers (starting points). */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: '#22d3ee' }]}>{t('practice_fit_profile.fit_profile_screen.shaft_flex')}</Text>
          {flex ? (
            <>
              <Text style={[styles.fitValue, { color: colors.text_primary }]}>{flex.flex}</Text>
              <Text style={[styles.gapText, { color: colors.text_muted }]}>{flex.note}</Text>
            </>
          ) : (
            <Text style={[styles.gapText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.track_a_few_driver_shots')}</Text>
          )}
        </View>

        {/* RECOMMENDED BALL — honest, DIRECTIONAL fit from readable game data. */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent_sky }]}>
          <Text style={[styles.cardLabel, { color: colors.accent_sky }]}>{t('practice_fit_profile.fit_profile_screen.recommended_ball')}</Text>
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
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.spin')}</Text>
                  <Text style={[styles.charValue, { color: colors.text_primary }]}>{ball.characteristics.spin}</Text>
                </View>
                <View style={styles.charCell}>
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.feel')}</Text>
                  <Text style={[styles.charValue, { color: colors.text_primary }]}>{ball.characteristics.feel}</Text>
                </View>
                <View style={[styles.charCell, { flex: 1.4 }]}>
                  <Text style={[styles.charLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.cover')}</Text>
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
            <Text style={[styles.cardLabel, { color: colors.accent }]}>{t('practice_fit_profile.fit_profile_screen.practice_volume')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {repList.map((r) => (
                <View key={r.club} style={[styles.repPill, { borderColor: colors.border }]}>
                  <Text style={[styles.repClub, { color: colors.text_primary }]}>{r.club}</Text>
                  <Text style={[styles.repN, { color: colors.text_muted }]}> {r.n}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.gapText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.reps_you_ve_logged_in')}</Text>
          </View>
        )}

        {/* LADDER — your bag. Tap any non-tracked club to set your carry. */}
        <Text style={[styles.cardLabel, { color: colors.text_muted, marginTop: 16, marginBottom: 8, marginLeft: 4 }]}>{t('practice_fit_profile.fit_profile_screen.your_bag_tap_a_club')}</Text>
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
                    <TouchableOpacity onPress={() => saveEdit(c.club)} style={styles.editBtn} accessibilityRole="button" accessibilityLabel={t('practice_fit_profile.accessibility_label.save')}>
                      <Ionicons name="checkmark" size={20} color="#3FB950" />
                    </TouchableOpacity>
                    {c.stated ? (
                      <TouchableOpacity onPress={() => clearEdit(c.club)} style={styles.editBtn} accessibilityRole="button" accessibilityLabel={t('practice_fit_profile.accessibility_label.remove')}>
                        <Ionicons name="trash-outline" size={16} color={colors.text_muted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            }
            const editable = !c.measured; // tracked carries win; don't let a stated value masquerade as tracked
            /**
             * 2026-08-17 (Tim — "this driving iron gets 215 yards and a baby fade every single time,
             * and I'd like to see that before even looking, in the bag tendency or club properties").
             *
             * The ladder already answers HOW FAR. This answers WHAT IT DOES — the thing a golfer
             * knows about their own clubs before they know their handicap. Only clubs with an
             * established tendency show a line (services/clubTendency owns the evidence bars), so
             * the column stays empty rather than filling with guesses about clubs barely hit.
             * Carry is deliberately omitted here: it is already the number on the right.
             */
            const tendency = tendencyByClub.get(c.club) ?? null;
            const inner = (
              <>
                <View style={styles.ladderLeft}>
                  <Text style={[styles.ladderClub, { color: colors.text_primary }]}>{c.club}</Text>
                  {tendency ? (
                    <Text style={[styles.ladderTendency, { color: colors.text_muted }]} numberOfLines={1}>
                      {tendency}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.ladderRight}>
                  <Text style={[styles.ladderYards, { color: c.measured || c.stated ? colors.text_primary : colors.text_muted }]}>{Math.round(c.yards)}<Text style={styles.ladderUnit}> yd</Text></Text>
                  <View style={[styles.measuredDot, dotStyleFor(c.measured, c.stated)]} />
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
            {t('practice_fit_profile.fit_profile_screen.tracked_from_your_shots_you')}
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
  fitGapRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  packChips: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  packRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  fitGapTitle: { fontSize: 14, fontWeight: '700' },
  fitGapDetail: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  keyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyText: { fontSize: 11, fontWeight: '600' },
  confText: { fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  cardLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginBottom: 8 },
  gapText: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  fitValue: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  ladderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.18)' },
  // 2026-08-17 — the club name and its learned tendency stack on the left. flexShrink so a long
  // tendency can never push the yardage off the right edge on a narrow phone.
  ladderLeft: { flexShrink: 1, paddingRight: 8 },
  ladderTendency: { fontSize: 11, fontWeight: '600', marginTop: 1 },
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
