import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import HoleShotMap from '../../../../components/recap/HoleShotMap';
import { useRoundStore } from '../../../../store/roundStore';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../../../../services/courseGeometryService';
import { getLocalHoleImageById, getLocalHoleImage } from '../../../../data/localCourseImages';
import type { ShotResult } from '../../../../store/roundStore';
import { useWatchStore } from '../../../../store/watchStore';
import { groupSwingsByHole, type RoundSwing } from '../../../../services/round/roundSwingRead';
import { confirmShotsWithSwings, confirmationSummary } from '../../../../services/round/shotSwingConfirm';

/**
 * Per-hole shot map screen. Reachable from the recap surface via the "View hole" affordance.
 * Loads shots from the round record (or the live round if it matches), and course geometry
 * from courseGeometryService.
 */
export default function HoleShotMapScreen() {
  const params = useLocalSearchParams<{ round_id: string; hole: string }>();
  const router = useRouter();
  const round_id = params.round_id;
  const hole = parseInt(params.hole ?? '1', 10);

  // 2026-07-07 (audit) — SUBSCRIBE to the store (was a one-time getState() snapshot),
  // so viewing the current hole mid-round updates as new shots are logged instead of
  // freezing to the mount-time snapshot.
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentRoundId = useRoundStore(s => s.currentRoundId);
  const liveShots = useRoundStore(s => s.shots);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const roundHistory = useRoundStore(s => s.roundHistory);
  const isLive = isRoundActive && currentRoundId === round_id;
  const record = useMemo(
    () => roundHistory.find(r => r.id === round_id) ?? null,
    [round_id, roundHistory],
  );

  const courseId = isLive ? activeCourseId : record?.courseId ?? null;
  const allShots: ShotResult[] = isLive ? liveShots : record?.shots ?? [];
  const playedHoles = useMemo(() => {
    const set = new Set<number>();
    for (const s of allShots) set.add(s.hole);
    return Array.from(set).sort((a, b) => a - b);
  }, [allShots]);
  const currentIdx = playedHoles.indexOf(hole);
  const prevHole = currentIdx > 0 ? playedHoles[currentIdx - 1] : null;
  const nextHole = currentIdx >= 0 && currentIdx < playedHoles.length - 1 ? playedHoles[currentIdx + 1] : null;

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [geometryLoaded, setGeometryLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 2026-07-24 (audit) — try/finally so a rejecting geometry fetch (corrupt/failed AsyncStorage
      // cache read inside fetchCourseGeometry) can NEVER strand the loading spinner. Whatever happens,
      // geometryLoaded flips → the screen renders its content or the honest empty state, never a
      // permanent spinner. The static hole image below still shows the hole even with no geometry.
      try {
        if (!courseId) return;
        const cached = getHoleGeometry(courseId, hole);
        if (cached && !cancelled) { setGeometry(cached); return; }
        await fetchCourseGeometry(courseId);
        if (cancelled) return;
        // 2026-08-08 (wave-2 audit — twice-around): resolve via getHoleGeometry (owns the 10-18→1-9
        // wrap) so second-loop recap holes at a 9-hole course still get their real geometry.
        setGeometry(getHoleGeometry(courseId, hole));
      } catch { /* geometry is best-effort — fall through to loaded with whatever we have */ }
      finally { if (!cancelled) setGeometryLoaded(true); }
    }
    load();
    return () => { cancelled = true; };
  }, [courseId, hole]);

  const shotsForHole = allShots.filter(s => s.hole === hole);
  /**
   * 2026-08-14 (Tim — "if you look at the round summary it has 'view this hole', but it doesn't
   * populate… that should capture the shots, and the swings that were captured, the club and the
   * metrics").
   *
   * The swings were already there. watchSwingBridge stamps `hole` on every swing at CAPTURE
   * (services/watchSwingBridge.ts:123) and services/round/roundSwingRead groups them — but the only
   * surface reading any of it was the dashboard tempo flag. The round summary, the scorecard and this
   * screen never showed a single one.
   *
   * Tempo is what gets shown per swing, and club speed deliberately is NOT. That is roundSwingRead's
   * own argument, not a shortcut: an IMU cannot tell a rehearsal from the real one, and an
   * uncalibrated wrist speed on course is a number nobody should act on. Tempo survives the ambiguity
   * because a fast waggle and a fast swing both say the same thing about the player's rhythm. So this
   * reports what the wrist measured on this hole and never claims "this was your shot".
   */
  const liveWatchSwings = useWatchStore(s => s.sessionSwings);
  const swingsForHole = useMemo(() => {
    /**
     * 2026-08-14 — the SAVED swings win for a finished round.
     *
     * watchStore holds sessionSwings in memory only, so a recap opened after the app restarted (the
     * normal case — you look at the round later) would find nothing. endRound now snapshots them onto
     * the record; the live session is the fallback for a round still in progress, and for rounds that
     * finished before this shipped.
     */
    const source: RoundSwing[] = record?.watchSwings?.length
      ? (record.watchSwings as RoundSwing[])
      : (liveWatchSwings as unknown as RoundSwing[]);
    return groupSwingsByHole(source).get(hole) ?? [];
  }, [record?.watchSwings, liveWatchSwings, hole]);

  /**
   * 2026-08-14 — cross-reference the logged shots against the watch swings on this hole.
   *
   * Tim's design: GPS over-counts (cart stops, walking to a partner's ball) and the watch over-counts
   * (waggles, rehearsals), but they fail in OPPOSITE directions — so a stop with a swing beside it in
   * time is a real shot. Purely additive: this annotates shots, never filters or reorders them.
   *
   * MUST stay above the early returns below. The first version of this sat after them — a conditional
   * hook, which is a render crash in the field, and the exact shape that white-screened Tim's app this
   * morning. The rules-of-hooks lock caught it.
   */
  const confirmations = useMemo(
    () => confirmShotsWithSwings(shotsForHole, swingsForHole),
    [shotsForHole, swingsForHole],
  );
  const confirmLine = confirmationSummary(confirmations);

  // 2026-06-16 (Tim — "view hole" was blank when no shots logged) — the saved
  // static hole image for a bundled course, so the hole view shows the hole even
  // when shot tracking dropped out that round (network errors). Prefer the
  // courseId-keyed lookup; fall back to the record's course name.
  const courseName = isLive ? activeCourse : record?.courseName ?? null;
  const staticHoleImage = getLocalHoleImageById(courseId, hole) ?? getLocalHoleImage(courseName, hole);

  if (!geometryLoaded) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00C896" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // 2026-08-14 — swings alone are enough to have something to show. The old gate returned the empty
  // state on `shotsForHole.length === 0`, which hid the watch data completely for anyone who hadn't
  // turned on auto shot detection (it defaults OFF) — the exact case Tim hit at his last round.
  if (shotsForHole.length === 0 && swingsForHole.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        {staticHoleImage ? (
          <>
            <Image source={staticHoleImage} style={styles.staticHero} resizeMode="cover" />
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Hole {hole}</Text>
              <Text style={styles.emptyText}>No shots were tracked on this hole this round — here&apos;s the hole.</Text>
            </View>
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No shots logged on hole {hole}</Text>
            <Text style={styles.emptyText}>Open a hole you actually played.</Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <HoleShotMap
        hole={hole}
        shots={shotsForHole}
        confirmations={confirmations}
        geometry={geometry}
        onClose={() => router.back()}
        onPrevHole={prevHole != null ? () => router.replace(`/recap/hole/${round_id}/${prevHole}` as never) : undefined}
        onNextHole={nextHole != null ? () => router.replace(`/recap/hole/${round_id}/${nextHole}` as never) : undefined}
        prevDisabled={prevHole == null}
        nextDisabled={nextHole == null}
      />
      {swingsForHole.length > 0 ? (
        <View style={styles.swingBlock}>
          <Text style={styles.swingHeader}>
            WATCH · {swingsForHole.length} SWING{swingsForHole.length === 1 ? '' : 'S'} ON THIS HOLE
          </Text>
          {confirmLine ? <Text style={styles.swingConfirm}>{confirmLine}</Text> : null}
          {swingsForHole.map((s, i) => (
            <View key={`${s.timestamp}-${i}`} style={styles.swingRow}>
              <Text style={styles.swingClub}>{s.club || '—'}</Text>
              <Text style={styles.swingMetric}>
                {s.tempoRatio ? `${Math.round(s.tempoRatio * 10) / 10}:1 tempo` : 'tempo —'}
              </Text>
            </View>
          ))}
          {/*
            Says what this is, because the watch cannot tell a rehearsal from the real one. Reporting
            these as "your shots" would be a claim the data doesn't support — every waggle looks like a
            swing to an IMU.
          */}
          <Text style={styles.swingNote}>
            Every swing the watch measured here — practice swings included. Tempo is the honest on-course
            reading; club speed needs a calibrated capture in Smart Motion.
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '700' },
  staticHero: { width: '100%', height: '62%' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: '#6b7280', textAlign: 'center', fontSize: 14 },
  swingBlock: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, gap: 6 },
  swingHeader: { color: '#00C896', fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  swingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swingClub: { color: '#ffffff', fontSize: 14, fontWeight: '800', minWidth: 74 },
  swingMetric: { color: '#c2cad4', fontSize: 13, fontWeight: '600' },
  swingConfirm: { color: '#00C896', fontSize: 12, fontWeight: '700' },
  swingNote: { color: '#6b7280', fontSize: 11, marginTop: 4, lineHeight: 15 },
});
