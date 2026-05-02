import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import HoleShotMap from '../../../../components/recap/HoleShotMap';
import { useRoundStore } from '../../../../store/roundStore';
import { fetchCourseGeometry, getHoleGeometry, type HoleGeometry } from '../../../../services/courseGeometryService';
import type { ShotResult } from '../../../../store/roundStore';

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

  const live = useRoundStore.getState();
  const isLive = live.isRoundActive && live.currentRoundId === round_id;
  const record = useMemo(
    () => live.roundHistory.find(r => r.id === round_id) ?? null,
    [round_id, live.roundHistory],
  );

  const courseId = isLive ? live.activeCourseId : record?.courseId ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allShots: ShotResult[] = isLive ? live.shots : record?.shots ?? [];
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
      if (!courseId) {
        setGeometryLoaded(true);
        return;
      }
      const cached = getHoleGeometry(courseId, hole);
      if (cached && !cancelled) {
        setGeometry(cached);
        setGeometryLoaded(true);
        return;
      }
      const full = await fetchCourseGeometry(courseId);
      if (cancelled) return;
      setGeometry(full?.holes.find(h => h.hole_number === hole) ?? null);
      setGeometryLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [courseId, hole]);

  const shotsForHole = allShots.filter(s => s.hole === hole);

  if (!geometryLoaded) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00C896" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (shotsForHole.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No shots logged on hole {hole}</Text>
          <Text style={styles.emptyText}>Open a hole you actually played.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <HoleShotMap
        hole={hole}
        shots={shotsForHole}
        geometry={geometry}
        onClose={() => router.back()}
        onPrevHole={prevHole != null ? () => router.replace(`/recap/hole/${round_id}/${prevHole}` as never) : undefined}
        onNextHole={nextHole != null ? () => router.replace(`/recap/hole/${round_id}/${nextHole}` as never) : undefined}
        prevDisabled={prevHole == null}
        nextDisabled={nextHole == null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: '#6b7280', textAlign: 'center', fontSize: 14 },
});
