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
import { useClubStatsStore, CLUB_ORDER, clubIdToClubName, clubIdToDisplayName, statedCarryFromEntry, statedEntryFromCarry, type ClubName, type StatedUnit } from '../../store/clubStatsStore';
import { composeFitProfile, recommendFlex, type FitClubInput } from '../../services/practice/fitProfile';
// The SAME rollout table the store converts with — imported, never re-stated, or the hint under the
// toggle would drift from the arithmetic it is describing. [[two-owners-is-the-root-cause]]
import { ROLL_YARDS as ROLL_BY_CLUB, STATED_YARDS_MIN, STATED_YARDS_MAX } from '../../services/standardBag';
import { fromDisplayDistance, toDisplayDistance } from '../../services/distanceUnits';
import { useDistanceFormat } from '../../hooks/useDistanceUnit';
import { composeFitGap, type OwnedClub } from '../../services/practice/fitGap';
import { useClubBagStore, carryLimitFor, PUTTER_ID, specsOf } from '../../store/clubBagStore';
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

/**
 * The two evidence colours, named once. The key at the top of the screen, every dot on every row and
 * the "you set 165 total" line all read from these, so a row can never be painted in a colour the
 * legend does not explain. [[two-owners-is-the-root-cause]]
 */
const TRACKED_COLOR = '#3FB950';
const STATED_COLOR = '#22d3ee';

export default function FitProfileScreen() {
  const { unit: distanceUnit, label } = useDistanceFormat();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  // 2026-07-24 (club-logic unification) — re-render trigger; the memos read current carry/total via getState.
  const stats = useClubStatsStore((s) => s.total);
  /**
   * 2026-09-15 — the CARRY ladder was not subscribed, only the total one. Every memo below reads it
   * through getState(), so a screen left open while a carry was recorded kept drawing the old
   * ladder — and as of today a row also prints "tracked 158" from that ladder, which would have gone
   * stale the same way. A memo that reads a store through getState still needs the store to tell the
   * component when to recompute. [[a-stale-header-is-a-source-someone-trusts]]
   */
  const carryLadder = useClubStatsStore((s) => s.carry);
  const handicap = usePlayerProfileStore((s) => s.handicap);
  // 2026-06-24 — extra readable signals for the honest Ball Fit (directional).
  const handicapIndex = usePlayerProfileStore((s) => s.handicap_index);
  const missType = usePlayerProfileStore((s) => s.missType);
  const goal = usePlayerProfileStore((s) => s.goal);

  const manual = useClubStatsStore((s) => s.manual);
  const reps = useClubStatsStore((s) => s.reps);
  const [editingClub, setEditingClub] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /**
   * 2026-09-15 (Tim — "No carry vs total toggle when setting club distances") — WHICH NUMBER IS HE
   * TYPING?
   *
   * Almost every golfer knows their clubs as a TOTAL: "my seven iron goes 150" is where the ball
   * stopped, not where it landed. This screen took that number and filed it as a CARRY, so a player
   * entering the number he actually knows was over-stating his carry by the rollout of every club in
   * the bag — 28 yards of it on the driver — and the caddie was clubbing him over hazards on it.
   *
   * The default is TOTAL, and that is not a coin-toss: the app already decided this question on
   * 2026-09-12 for the spoken path, for a reason that holds just as well here. An over-stated carry
   * tells the caddie the player flies a hazard they do not, which loses a ball; an under-stated one
   * costs a few yards of club and nothing else. When in doubt, err the way that keeps the ball dry.
   */
  const [draftUnit, setDraftUnit] = useState<StatedUnit>('total');
  /** Why the last save was refused, or null. Shown in the row, cleared the moment he edits again. */
  const [draftError, setDraftError] = useState<string | null>(null);

  // 2026-06-16 (Tim — credit for swinging clubs in practice) — per-club rep volume
  // (Smart Motion / drills). HONEST: volume only, never a measured carry.
  const repList = useMemo(
    () => CLUB_ORDER.filter((c) => c !== 'Putter' && (reps[c] ?? 0) > 0).map((c) => ({ club: c, n: reps[c]! })).sort((a, b) => b.n - a.n),
    [reps],
  );

  /**
   * 2026-09-15 (Tim, from the phone — "there is no way to edit club distances especially if tracked")
   *
   * EVERY CLUB OPENS. The row used to be tappable only when `!c.measured`, and `measured` is
   * `hasCarry`, which is true for a number the player TYPED — so the moment he set a club's distance
   * the row went read-only and he could never correct it or clear it again. The trash button three
   * lines below rendered only inside the edit row, which meant it could never be reached for exactly
   * the clubs it existed for. Proved by execution before the change.
   * [[orphans-are-live-bugs-not-dead-code]] [[feedback-reachable-not-just-wired]]
   */
  const openEdit = (club: string) => {
    const st = useClubStatsStore.getState();
    const name = club as ClubName;
    // Open on what he last told us, in the unit he told us in — never a converted number he has to
    // recognise. A club he has never stated opens empty, on the safe default.
    const unit = st.hasManual(name) ? st.statedUnitFor(name) : 'total';
    const entry = st.statedEntryFor(name);
    setDraftUnit(unit);
    setEditingClub(club);
    setDraft(entry != null ? String(toDisplayDistance(entry, distanceUnit)) : '');
    setDraftError(null);
  };
  /** Retype the draft into the other unit as he flips the toggle, so the number keeps its meaning. */
  const switchDraftUnit = (club: string, unit: StatedUnit) => {
    if (unit === draftUnit) return;
    const y = parseInt(draft, 10);
    setDraftUnit(unit);
    if (!Number.isFinite(y) || y <= 0) return;
    // `y` is on screen in his unit; the rollout table works in yards. Convert in, convert back out.
    const yYards = Math.round(fromDisplayDistance(y, distanceUnit) ?? y);
    const asCarry = statedCarryFromEntry(club as ClubName, yYards, draftUnit);
    setDraft(String(toDisplayDistance(statedEntryFromCarry(club as ClubName, asCarry, unit), distanceUnit)));
  };
  /**
   * A refused number keeps the row OPEN with the reason under it. Closing the editor on a write that
   * did not happen is the shape of every "it saved, didn't it?" bug: the row would snap back to the
   * old value with no explanation and he would type it again.
   */
  const saveEdit = (club: string) => {
    const y = parseInt(draft, 10);
    if (!Number.isFinite(y) || y <= 0) { setEditingClub(null); setDraftError(null); return; }
    /**
     * 2026-09-18 — WHAT HE TYPED IS IN HIS UNIT. Everything below this line, and the whole ingest
     * band this number becomes the centre of, is YARDS. A player set to metres typing 133 means 145
     * yards; storing 133 would set a band of 73-193 yards around a club that actually carries 145,
     * so every real shot he hits with it gets rejected at ingest and the club never learns. Same
     * failure the stated-yardage clamp exists to prevent, arriving by a different door.
     * [[two-owners-is-the-root-cause]] [[no-half-fixes-enforce-every-surface]]
     */
    const yInYards = Math.round(fromDisplayDistance(y, distanceUnit) ?? y);
    const ok = useClubStatsStore.getState().setManual(club as ClubName, yInYards, draftUnit);
    if (!ok) {
      setDraftError(t('practice_fit_profile.unit.refused', { min: toDisplayDistance(STATED_YARDS_MIN, distanceUnit), max: toDisplayDistance(STATED_YARDS_MAX, distanceUnit) }));
      return;
    }
    setDraftError(null);
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
        // 2026-09-15 — `measured` is hasTRACKEDCarry, not hasCarry. hasCarry is true for a number the
        // player typed, so this row wore the green "tracked from your shots" dot over his own entry,
        // the header counted it as "1 tracked · 0 you set", and the confidence read climbed towards
        // 'high' on a bag he had simply filled in by hand — which fitProfile's own comment says must
        // never happen. Proved by execution. [[a-stale-header-is-a-source-someone-trusts]]
        club: c, yards: st.carryFor(c), measured: st.hasTrackedCarry(c), stated: st.hasManual(c),
        uses: st.repsFor(c),
      }));
    return composeFitProfile(clubs);
    // recompute when tracked stats OR the stated bag change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, manual, carryLadder]);

  // 2026-07-23 (Tim — Bag Vision Phase 2) — Fit Gap: cross-reference the OWNED bag (clubBagStore,
  // populated by the video scan) against the distance gaps so advice is honest about ownership
  // (dial-in vs buy, fillable vs unfilled, redundant). Recomputes when the bag or stats change.
  const bagClubs = useClubBagStore((s) => s.clubs);
  const fitGap = useMemo(() => {
    const st = useClubStatsStore.getState();
    // 2026-09-14 — specs come from the club IN PLAY, not from a flat field on the slot. A slot can
    // hold three drivers now; the fit gap is about the one he is actually carrying.
    const owned: OwnedClub[] = Object.values(bagClubs).map((c) => {
      const sp = specsOf(c);
      return {
        club_id: c.club_id,
        name: clubIdToClubName(c.club_id),
        brand: sp.brand,
        model: sp.model,
        loft: sp.loft,
      };
    });
    return composeFitGap({
      owned,
      gaps: profile.gaps,
      overlaps: profile.overlaps,
      hasDistance: (name) => st.hasDistance(name as ClubName),
      clubOrder: CLUB_ORDER,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagClubs, profile, stats, manual, carryLadder]);

  // FLEX (honest: only off a MEASURED driver carry) + the honest, DIRECTIONAL
  // Ball Fit (recommendBall — speed tier from carry, handicap tier, short-game/
  // feel emphasis). Both starting points, never launch-monitor specs.
  const { flex, ball } = useMemo(() => {
    const st = useClubStatsStore.getState();
    /**
     * 2026-09-15 — RENAMED, because on this screen `measured` now means TRACKED and this is not that.
     *
     * The flex gate is deliberately hasCarry: a driver carry the player STATED is his own number and
     * is a fair basis for a shaft-flex starting point; what it must never run off is a total-only
     * estimate (a GPS tee→rest figure minus a typical rollout), which is the app's guess. The old
     * name said "measured" and `recommendFlex`'s own header said "isn't measured", so two comments
     * described a gate that had deliberately included stated numbers since 2026-07-27.
     * [[a-stale-header-is-a-source-someone-trusts]]
     */
    const driverCarryIsHis = st.hasCarry('Driver');
    // 2026-07-24 (club-logic unification) — flex + ball fit key off the honest driver CARRY (carryFor:
    // measured → stated → tracked-total−roll), not the old tracked value which was a GPS total (~20y hot).
    const driverCarry = st.hasDistance('Driver') ? st.carryFor('Driver') : null;
    // Wedge-work proxy for short-game / greenside-feel priority (samples in either ladder).
    const wedgeSamples = (['PW', 'GW', 'SW', 'LW'] as const).reduce(
      (a, c) => a + (st.carry[c]?.samples ?? 0) + (st.total[c]?.samples ?? 0), 0);
    const hcp = typeof handicapIndex === 'number' ? handicapIndex
      : typeof handicap === 'number' ? handicap : null;
    return {
      flex: recommendFlex(st.carryFor('Driver'), driverCarryIsHis),
      ball: recommendBall({
        handicap: hcp,
        driverCarryYards: driverCarry,
        goal,
        missType,
        wedgeSamples,
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, manual, carryLadder, handicap, handicapIndex, missType, goal]);

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
  /**
   * 2026-09-14 (Tim) — "a card on the fit profile to compare clubs like a swing bay, that a user can
   * use to decide which club to take of the same class — which one of my drivers works best for me,
   * or do the drivers give different reads."
   *
   * The reasoning shipped on 2026-09-12 (services/clubVariantPerformance) and the way to declare a
   * variant shipped as a voice intent. There was NO screen, so unless you knew to say "driver today
   * is the Burner 2" out loud, none of it existed. Same missing half, third time this week.
   *
   * Uses variantsForClub rather than compareClubVariants for the LIST because the comparison
   * withholds a variant until it clears 12 shots — right for a verdict, wrong for a screen. A player
   * four shots into the new driver should see those four and how far off the bar he is, not a card
   * that looks broken. The VERDICT still comes from the comparison, which keeps its bar.
   */
  const clubCompare = useMemo(() => {
    try {
      const rs = useRoundStore.getState();
      const shots = [...(rs.roundHistory ?? []).flatMap((r) => r.shots ?? []), ...(rs.shots ?? [])].slice(-400);
      const cvp = require('../../services/clubVariantPerformance') as typeof import('../../services/clubVariantPerformance');
      return cvp.clubsWithVariants(shots).map((club) => ({
        club,
        splits: cvp.variantsForClub(shots, club),
        verdict: cvp.compareClubVariants(shots, club).say,
      })).filter((c) => c.splits.length > 0);
    } catch { return []; }
    /**
     * 2026-09-14 — `profile` is the recompute trigger. The shots come from roundStore via
     * getState(), so the linter sees nothing in the body using it; without it the club-variant
     * comparison never refreshes after the ladder changes.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
        /**
         * 2026-09-17 — the DISPLAY name. clubIdToClubName returns null for 'PT' by design, so this
         * used to render the putter as the raw id "PT" with no detail line, and CLUB_ORDER.indexOf
         * ('PT') === -1 sorted it above the driver. It also had to match pack.carry, which spells
         * the putter 'Putter' — so Auto-pack could never map it back to an id and wrote a
         * carriedToday with no putter, which the player cannot undo because the row is disabled.
         */
        const key = clubIdToDisplayName(c.club_id);
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
            ?? (yards != null ? `${toDisplayDistance(yards, distanceUnit)} ${label} carry` : null),
          isPutter: c.club_id === PUTTER_ID,
        };
      })
      .sort((a, b) => CLUB_ORDER.indexOf(a.label as ClubName) - CLUB_ORDER.indexOf(b.label as ClubName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bagClubs, stats, manual]);

  const limit = carryLimitFor(isCompetition);

  /**
   * 2026-09-14 — A SELECTION HELD UNTIL IT IS LEGAL, and this exists because of a defect I shipped
   * into this same session.
   *
   * `carryLimitFor` now returns fourteen for every round, not only competition (Tim: ">14 owned, 14
   * load for the course"). `setCarriedToday` enforces that cap by TRIMMING, which is right at the
   * point a round starts and catastrophic on a per-tap edit: an eighteen-club owner tapping ONE club
   * off handed the store seventeen, and the store silently returned fourteen — keeping the putter
   * and then slicing in bag order, so he lost 9I, PW and SW. He removed one club and four vanished,
   * and the three the app chose were his scoring clubs.
   *
   * So the screen never hands the store a list it would have to trim. An over-limit selection is
   * held here, shown as "remove N", and written the moment it is legal. The store keeps its guard —
   * a voice path or a future surface still cannot start a round with fifteen — but the guard stops
   * being a silent editor of the player's bag. [[trust-the-users-lived-reality]]
   */
  const [packDraft, setPackDraft] = useState<Set<string> | null>(null);
  /** Empty carriedToday means carrying everything — the honest default, never "carrying nothing". */
  const committedSet = useMemo(
    () => (carriedToday.length > 0 ? new Set(carriedToday) : new Set(packRows.map((r) => r.club_id))),
    [carriedToday, packRows],
  );
  const packedSet = packDraft ?? committedSet;
  /** How many must come out before this is a bag you can start a round with. 0 when it already is. */
  const overBy = Math.max(0, packedSet.size - limit);

  const togglePacked = (club_id: string) => {
    const next = new Set(packedSet);
    // The putter never comes out. Nobody plays a round without one, and a tap that removed it would
    // be the app making the worst possible choice on the player's behalf.
    if (club_id === PUTTER_ID) return;
    if (next.has(club_id)) next.delete(club_id); else next.add(club_id);
    if (next.size > limit) { setPackDraft(next); return; }  // hold — never hand the store a trim
    setPackDraft(null);
    useClubBagStore.getState().setCarriedToday([...next], { limit });
  };

  const autoPack = () => {
    const { pack } = liveBagPack();
    if (!pack) return;
    const byLabel = new Map(packRows.map((r) => [r.label, r.club_id]));
    const ids = pack.carry.map((c) => byLabel.get(c)).filter((x): x is NonNullable<typeof x> => !!x);
    setPackDraft(null);
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
  /**
   * 2026-09-13 (Tim) — "Needs to layout more sectionally like you are in a pro shop by sections
   * with Data."
   *
   * Twenty rows in one undifferentiated list is a spreadsheet. A golfer does not think "club 11 of
   * 20" — they think woods, hybrids, irons, wedges, and they read each rack as a set: does this part
   * of my bag cover its range, and is anything in here doing another club's job? Each section
   * carries its own line of data so the answer is right there instead of in a card further down.
   */
  const BAG_SECTIONS: readonly { title: string; clubs: readonly string[] }[] = [
    { title: 'WOODS', clubs: ['Driver', '3W', '5W', '7W'] },
    { title: 'HYBRIDS', clubs: ['2H', '3H', '4H', '5H'] },
    { title: 'IRONS', clubs: ['3I', '4I', '5I', '6I', '7I', '8I', '9I'] },
    { title: 'WEDGES', clubs: ['PW', 'AW', 'GW', 'SW', 'LW'] },
  ];

  /**
   * The dot names the source of THE NUMBER ON THIS ROW, so stated is tested first — that is the
   * order `carryFor` resolves in since 2026-09-15. Tested the other way round, a club he had
   * corrected would show the number he typed under a dot claiming the app had tracked it.
   */
  const dotStyleFor = (measured: boolean | undefined, stated: boolean | undefined) => ({
    backgroundColor: stated ? STATED_COLOR : measured ? TRACKED_COLOR : 'transparent',
    borderColor: stated ? STATED_COLOR : measured ? TRACKED_COLOR : colors.text_muted,
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
          <Text style={[styles.confText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.tracked_you_set_of_clubs', { measuredCount: profile.measuredCount, statedCount: profile.statedCount, confidence: profile.confidence })}</Text>
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
          {/**
            * 2026-09-13 — the amber ! and the overlap glyph appear on rows below and were in NO
            * legend, on a screen that already had two legends disagreeing about the dots. A marker a
            * player cannot decode is noise wearing the costume of information.
            */}
          <View style={styles.keyItem}>
            <Ionicons name="alert-circle" size={13} color="#f5a623" />
            <Text style={[styles.keyText, { color: colors.text_muted }]}>{t('practice_fit_profile.key.gap')}</Text>
          </View>
          <View style={styles.keyItem}>
            <Ionicons name="copy-outline" size={12} color={colors.text_muted} />
            <Text style={[styles.keyText, { color: colors.text_muted }]}>{t('practice_fit_profile.key.overlap')}</Text>
          </View>
        </View>

        {/* LADDER — your bag. Tap ANY club to set its distance, in carry or total; a club he has
            corrected shows the tracked number beside his own so the override is never a trapdoor. */}
        <Text style={[styles.cardLabel, { color: colors.text_muted, marginTop: 16, marginBottom: 8, marginLeft: 4 }]}>{t('practice_fit_profile.fit_profile_screen.your_bag_tap_a_club')}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, paddingVertical: 4 }]}>
          {BAG_SECTIONS.map((section) => {
          const rows = profile.ladder.filter((r) => section.clubs.includes(r.club));
          if (rows.length === 0) return null;
          /** The rack's own data: what it covers, and how much of it is real. */
          const tracked = rows.filter((r) => r.measured).length;
          const hi = Math.max(...rows.map((r) => Math.round(r.yards)));
          const lo = Math.min(...rows.map((r) => Math.round(r.yards)));
          return (
          <View key={section.title}>
            <View style={styles.rackHead}>
              <Text style={[styles.rackTitle, { color: colors.text_primary }]}>{section.title}</Text>
              <Text style={[styles.rackData, { color: colors.text_muted }]}>
                {lo === hi ? `${hi} yd` : `${lo}–${hi} yd`} · {tracked}/{rows.length} tracked
              </Text>
            </View>
          {rows.map((c) => {
            if (editingClub === c.club) {
              return (
                <View key={c.club} style={styles.editBlock}>
                  <View style={styles.ladderRow}>
                    <Text style={[styles.ladderClub, { color: colors.text_primary }]}>{c.club}</Text>
                    <View style={styles.ladderRight}>
                      <TextInput
                        value={draft}
                        onChangeText={(v) => { setDraft(v); if (draftError) setDraftError(null); }}
                        keyboardType="number-pad"
                        autoFocus
                        placeholder={label}
                        placeholderTextColor={colors.text_muted}
                        maxLength={3}
                        onSubmitEditing={() => saveEdit(c.club)}
                        style={[styles.editInput, { color: colors.text_primary, borderColor: colors.accent }]}
                        accessibilityLabel={t('practice_fit_profile.accessibility_label.distance_for_club', { club: c.club, unit: draftUnit === 'total' ? t('practice_fit_profile.unit.total') : t('practice_fit_profile.unit.carry') })}
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
                  {/**
                    * THE TOGGLE. Two words, because the number means two different things and the app
                    * cannot tell which one he typed. Whichever he picks, the store keeps ONE stated
                    * carry per club and converts by this club's rollout — so the ladder above stays a
                    * carry ladder and the gap analysis keeps comparing like with like.
                    */}
                  <View style={styles.unitRow}>
                    {(['carry', 'total'] as const).map((u) => {
                      const active = draftUnit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          onPress={() => switchDraftUnit(c.club, u)}
                          style={[styles.unitChip, { borderColor: active ? colors.accent : colors.border }, active && { backgroundColor: colors.accent_muted }]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={t('practice_fit_profile.unit.' + u)}
                        >
                          <Text style={[styles.unitChipText, { color: active ? colors.accent : colors.text_muted }]}>
                            {t('practice_fit_profile.unit.' + u)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    <Text style={[styles.unitHint, { color: draftError ? '#f5a623' : colors.text_muted }]} numberOfLines={2}>
                      {draftError
                        ? draftError
                        : draftUnit === 'total'
                          ? t('practice_fit_profile.unit.total_hint', { roll: ROLL_BY_CLUB[c.club as ClubName] ?? 0 })
                          : t('practice_fit_profile.unit.carry_hint')}
                    </Text>
                  </View>
                </View>
              );
            }
            /**
             * 2026-09-15 — EVERY CLUB IS EDITABLE. See openEdit: this was `!c.measured`, and
             * `measured` counted a typed number, so setting a distance locked the row against the
             * person who set it. There is no club whose number the player is not allowed to correct.
             */
            const editable = true;
            /**
             * What he told us, and what we tracked — BOTH, whenever they are not the same thing.
             *
             * The stated number wins the row (that is the honest precedence: he knows something the
             * app does not). Printing the tracked carry beside it is what stops that from being a
             * trapdoor — he can see the measurement he overrode and take the override back with the
             * bin in the edit row. And when he stated a TOTAL, the ladder shows the carry it converts
             * to, so his own number is echoed here or he would think the app had lost it.
             */
            const statedNote = (() => {
              if (!c.stated) return null;
              const st = useClubStatsStore.getState();
              const name = c.club as ClubName;
              const unit = st.statedUnitFor(name);
              const entry = st.statedEntryFor(name);
              const trackedY = st.trackedCarryFor(name);
              const parts: string[] = [];
              const overridden = trackedY != null && Math.round(trackedY) !== Math.round(c.yards);
              // A stated TOTAL always says so, because the ladder prints the CARRY it converts to and
              // he would otherwise think the app had lost his number. A stated CARRY only speaks up
              // when there is a tracked number to contrast with — on its own it would just repeat the
              // figure already on the right of the same row.
              if (entry != null && unit === 'total') parts.push(t('practice_fit_profile.row.you_set_total', { yards: toDisplayDistance(entry, distanceUnit) }));
              else if (entry != null && overridden) parts.push(t('practice_fit_profile.row.you_set_carry', { yards: entry }));
              if (overridden) parts.push(t('practice_fit_profile.row.tracked_is', { yards: Math.round(trackedY!) }));
              return parts.length > 0 ? parts.join(' · ') : null;
            })();
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
                  {statedNote ? (
                    <Text style={[styles.ladderTendency, { color: STATED_COLOR }]} numberOfLines={1}>
                      {statedNote}
                    </Text>
                  ) : null}
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
          </View>
          );
          })}
          {/**
            * 2026-09-13 — the SECOND legend is gone. It said "◆ you set it" while the key at the top
            * of the screen draws that state as a filled cyan dot, so one screen explained the same
            * three icons two different ways. The key above is built from dotStyleFor, the same
            * function these rows use, and cannot drift. [[two-owners-is-the-root-cause]]
            */}
        </View>

        <Text style={[styles.sectionHeading, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.fit_findings_heading')}</Text>
        {/* GAPS */}
        {profile.gaps.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: '#f5a623' }]}>
            <Text style={[styles.cardLabel, { color: '#f5a623' }]}>{t('practice_fit_profile.fit_profile_screen.gaps_to_fill')}</Text>
            {profile.gaps.map((g, i) => (
              <Text key={i} style={[styles.gapText, { color: colors.text_primary }]}>
                {t('practice_fit_profile.fit_profile_screen.gap_line', { gapYards: g.gapYards, upper: g.upper, lower: g.lower, centerYards: g.centerYards })}
              </Text>
            ))}
          </View>
        )}

        {/* OVERLAPS */}
        {profile.overlaps.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.doing_the_same_job')}</Text>
            {/**
              * 2026-09-13 — ranked and capped. Nine rows all ending "one may be redundant." is a
              * list, not a finding: the pair that matters is the one with the least daylight between
              * them, and it was buried among eight others in ladder order.
              */}
            {[...profile.overlaps].sort((a, b) => a.gapYards - b.gapYards).slice(0, 4).map((o, i) => (
              <Text key={i} style={[styles.gapText, { color: colors.text_primary }]}>
                {t('practice_fit_profile.fit_profile_screen.overlap_line', { longer: o.longer, shorter: o.shorter, gapYards: o.gapYards })}
              </Text>
            ))}
            {profile.overlaps.length > 4 ? (
              <Text style={[styles.confText, { color: colors.text_muted, marginTop: 6 }]}>
                {t('practice_fit_profile.fit_profile_screen.overlap_more', { n: profile.overlaps.length - 4 })}
              </Text>
            ) : null}
          </View>
        )}

        <Text style={[styles.sectionHeading, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.specs_heading')}</Text>
        {/* FLEX + BALL — honest directional layers (starting points). */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.shaft_flex')}</Text>
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
        {/* 2026-09-13 — was a sky-blue bordered card among a green one, an amber one and a plain
            one. Four accent colours on one screen reads as four unrelated things; the card chrome is
            uniform now and colour is reserved for meaning (amber = a gap). */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.recommended_ball')}</Text>
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
                <Text style={[styles.profileTag, { color: '#0a1410', backgroundColor: colors.accent }]}>{ball.profileLabel}</Text>
              </View>
              <Text style={[styles.fitValue, { color: colors.text_primary, marginTop: 8 }]}>{ball.headline}</Text>

              {ball.reasons.map((r, i) => (
                <View key={i} style={styles.reasonRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.accent} style={{ marginTop: 3 }} />
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

        <Text style={[styles.sectionHeading, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.practice_volume')}</Text>
        {/* PRACTICE VOLUME — honest rep credit per club (not a measured carry). */}
        {repList.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {repList.map((r) => (
                <View key={r.club} style={[styles.repPill, { borderColor: colors.border }]}>
                  <Text style={[styles.repClub, { color: colors.text_primary }]}>{r.club}</Text>
                  <Text style={[styles.repN, { color: colors.text_muted }]}> {r.n}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.gapText, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.practice_volume_purpose')}</Text>
          </View>
        )}

        {/**
          * 2026-09-13 (Tim) — SET UP YOUR BAG, at the BOTTOM.
          *
          * These three used to sit between the headline and any of the analysis it promised, so the
          * screen opened on two import buttons and an empty card. They are setup, not the answer —
          * you come here to see your ladder, and you only scan or import once.
          */}
        <Text style={[styles.sectionHeading, { color: colors.text_muted }]}>{t('practice_fit_profile.fit_profile_screen.set_up_your_bag')}</Text>
        {/* 2026-07-23 (Tim — Bag Vision) — the bag. 2026-09-14: the label and the camcorder icon
            promised a SCANNER, which is what the destination used to be and is no longer. It opens on
            the clubs you own — head, shaft and grip — with scanning as one way to fill it. */}
        <TouchableOpacity
          onPress={() => router.push('/bag-scan' as never)}
          style={[styles.scanBagBtn, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel={t('practice_fit_profile.accessibility_label.open_my_bag')}
        >
          <Ionicons name="golf-outline" size={18} color={colors.accent} />
          <Text style={[styles.scanBagText, { color: colors.accent }]}>{t('practice_fit_profile.fit_profile_screen.open_my_bag')}</Text>
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
        {/**
          * SAME CLUB, DIFFERENT MODELS — the swing-bay question, answered from his own shots.
          *
          * Shown only when he actually owns more than one of something: a card explaining a feature
          * nobody is using is an advert, and this screen already opens on enough of those.
          */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.text_primary }]}>
            {t('practice_fit_profile.compare.title', { defaultValue: 'SAME CLUB, DIFFERENT MODELS' })}
          </Text>
          {clubCompare.length === 0 ? (
            <Text style={[styles.gapText, { color: colors.text_muted }]}>
              {t('practice_fit_profile.compare.empty', {
                defaultValue: 'Own two drivers? Tell me which one is in the bag — say "driver today is the Burner 2" — and I will track them separately instead of averaging them into one blurred driver.',
              })}
            </Text>
          ) : (
            clubCompare.map((c) => (
              <View key={c.club} style={{ marginTop: 10 }}>
                <Text style={[styles.confText, { color: colors.text_primary, fontWeight: '800' }]}>{c.club}</Text>
                {c.splits.map((v) => (
                  <View key={v.variant} style={styles.compareRow}>
                    <Text style={[styles.compareName, { color: colors.text_primary }]} numberOfLines={1}>{v.variant}</Text>
                    <Text style={[styles.compareStat, { color: colors.text_muted }]}>
                      {t('practice_fit_profile.compare.stat', {
                        defaultValue: '{{shots}} shots · {{yards}} · {{trouble}}% trouble',
                        shots: v.shots,
                        yards: v.avgYards != null ? `${v.avgYards}y` : '—',
                        trouble: v.troublePct,
                      })}
                    </Text>
                  </View>
                ))}
                <Text style={[styles.gapText, { color: colors.text_muted, marginTop: 4 }]}>{c.verdict}</Text>
              </View>
            ))
          )}
        </View>

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
              {/**
                * 2026-09-14 — this said "Competition: 14-club cap" whenever a limit existed, and a
                * limit now always exists. On a Saturday that is the app stating a fact about the
                * round that is simply untrue. The CAP is universal; the RULE and its penalty are
                * what competition adds. [[state-what-you-measured-not-what-you-intended]]
                */}
              <Text style={[styles.confText, { color: isCompetition ? '#f5a623' : colors.text_muted, marginBottom: overBy > 0 ? 4 : 8 }]}>
                {isCompetition
                  ? t('practice_fit_profile.fit_profile_screen.competition_14_club_cap')
                  : t('practice_fit_profile.fit_profile_screen.bag_cap', { limit })}
              </Text>
              {/* An over-limit selection is HELD, not trimmed — so the screen must say what it is
                  waiting for, rather than looking like a tap that did nothing. */}
              {overBy > 0 && (
                <Text style={[styles.confText, { color: '#f5a623', marginBottom: 8, fontWeight: '700' }]}>
                  {t('practice_fit_profile.fit_profile_screen.over_by', { count: overBy, selected: packedSet.size })}
                </Text>
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
                  onPress={() => { setPackDraft(null); useClubBagStore.getState().clearCarriedToday(); }}
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

        <Text style={[styles.disclaimer, { color: colors.text_muted }]}>{profile.disclaimer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  compareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  compareName: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  compareStat: { fontSize: 11, fontWeight: '600' },
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
  // 2026-09-15 — the edit row grew a second line (the carry/total toggle), so it is a block now.
  editBlock: { paddingBottom: 10 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginTop: 2 },
  unitChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  unitChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  unitHint: { flex: 1, fontSize: 10, fontWeight: '600', lineHeight: 13 },
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
  sectionHeading: { fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  rackHead: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6,
  },
  rackTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  rackData: { fontSize: 11, fontWeight: '600' },
  honesty: { fontSize: 10, lineHeight: 15, marginTop: 12, fontStyle: 'italic' },
});
