import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { safeBack } from '../../services/safeBack';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { loadRecap } from '../../services/planStorage';
import { speak, stopSpeaking, isSpeaking } from '../../services/voiceService';
import { checkContent } from '../../services/contentGuardrail';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import { useRoundStore } from '../../store/roundStore';
import PhotoCollage from '../../components/recap/PhotoCollage';
import HandicapImpactCard from '../../components/recap/HandicapImpactCard';
import { track } from '../../services/analytics';
import { buildShareCardProps } from '../../services/shareCardGenerator';
import { computeRecapHero } from '../../services/recapHero';
import { buildNarrationScript } from '../../services/recapNarration';
import RoundShareCard from '../../components/RoundShareCard';
import type { RoundRecap, HoleComparison } from '../../types/plan';
import type { GhostHoleResult } from '../../types/ghost';

const MODE_LABELS: Record<string, string> = {
  break_100: 'Break 100',
  break_90: 'Break 90',
  break_80: 'Break 80',
  free_play: 'Free Play',
};

function deltaColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v < 0) return '#00C896';
  if (v === 0) return '#9ca3af';
  if (v === 1) return '#F5A623';
  return '#ef4444';
}

function deltaLabel(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return 'even';
  return v > 0 ? '+' + v : String(v);
}

function varianceColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v <= 0) return '#00C896';
  if (v === 1) return '#F5A623';
  return '#ef4444';
}

// ─── Animated hole card ───────────────────────────────────────────────────────

function AnimatedHoleCard({
  hc,
  ghostResult,
  index,
  highlightedHole,
  onViewHole,
}: {
  hc: HoleComparison;
  ghostResult?: GhostHoleResult;
  index: number;
  highlightedHole: number | null;
  onViewHole: (hole: number) => void;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(index * 150, withTiming(1, { duration: 280 }));
    translateY.value = withDelay(index * 150, withSpring(0, { damping: 14, stiffness: 100 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const isHighlighted = highlightedHole === hc.hole_number;
  const v = hc.variance;
  const hasScore = hc.actual_score != null;

  return (
    <Animated.View style={[styles.holeCard, isHighlighted && styles.holeCardHighlighted, animStyle]}>
      <View style={styles.holeCardHeader}>
        <Text style={styles.holeNum}>Hole {hc.hole_number}</Text>
        {hasScore && !ghostResult && (
          <View style={[styles.variancePill, { backgroundColor: varianceColor(v) + '22', borderColor: varianceColor(v) }]}>
            <Text style={[styles.variancePillText, { color: varianceColor(v) }]}>
              {hc.actual_score}{v != null ? ' (' + (v > 0 ? '+' : '') + v + ' plan)' : ''}
            </Text>
          </View>
        )}
        {hasScore && ghostResult && (
          <Text style={[styles.variancePillText, { color: varianceColor(v) }]}>
            Score: {hc.actual_score}
          </Text>
        )}
      </View>

      {ghostResult && <GhostRow ghostResult={ghostResult} holeNum={hc.hole_number} />}

      {hc.plan && (
        <Text style={styles.planLine}>
          Plan: {hc.plan.markers.tee.club_intent ?? '—'}
          {hc.plan.markers.approach?.club_intent ? ' → ' + hc.plan.markers.approach.club_intent : ''}
          {hc.plan.markers.pin?.club_intent ? ' → ' + hc.plan.markers.pin.club_intent : ''}
        </Text>
      )}
      {Boolean(hc.kevin_summary) && (
        <Text style={styles.kevinSummary}>{hc.kevin_summary}</Text>
      )}
      <TouchableOpacity style={styles.viewHoleBtn} onPress={() => onViewHole(hc.hole_number)}>
        <Text style={styles.viewHoleBtnText}>View hole →</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Three-column ghost row ───────────────────────────────────────────────────

function GhostRow({ ghostResult }: { ghostResult: GhostHoleResult; holeNum: number }) {
  const { ghost_score, current_score, delta } = ghostResult;
  return (
    <View style={styles.ghostRow}>
      <View style={styles.ghostCol}>
        <Text style={styles.ghostColLabel}>GHOST</Text>
        <Text style={styles.ghostColVal}>{ghost_score ?? '—'}</Text>
      </View>
      <View style={styles.ghostDivider} />
      <View style={styles.ghostCol}>
        <Text style={styles.ghostColLabel}>YOURS</Text>
        <Text style={styles.ghostColVal}>{current_score}</Text>
      </View>
      <View style={styles.ghostDivider} />
      <View style={styles.ghostCol}>
        <Text style={styles.ghostColLabel}>VS GHOST</Text>
        <Text style={[styles.ghostColDelta, { color: deltaColor(delta) }]}>{deltaLabel(delta)}</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function RecapScreen() {
  const { round_id } = useLocalSearchParams<{ round_id: string }>();
  const router = useRouter();
  const { voiceGender, voiceEnabled, caddiePersonality } = useSettingsStore();
  const caddieName = getCaddieName(caddiePersonality);
  // Phase R — pull round photos from the persisted RoundRecord (recap api
  // returns a different shape — photos live on the local roundStore).
  const roundPhotos = useRoundStore(s => s.roundHistory.find(r => r.id === round_id)?.round_photos ?? []);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

  const cardRef = useRef<View>(null);
  const flatListRef = useRef<FlatList>(null);
  const [recap, setRecap] = useState<RoundRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const narratingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [highlightedHole, setHighlightedHole] = useState<number | null>(null);

  useEffect(() => {
    if (!round_id) return;
    loadRecap(round_id).then(r => {
      setRecap(r);
      setLoading(false);
    });
  }, [round_id]);

  const handleShare = useCallback(async () => {
    if (!recap || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Share not available', 'Native share is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share this round' });
      track('round_shared', { round_id: recap.round_id, mode: recap.mode });
    } catch {
      Alert.alert('Could not generate share card', 'Try again in a moment.');
    } finally {
      setSharing(false);
    }
  }, [recap, sharing]);

  const handlePlayAloud = useCallback(async () => {
    if (!recap) return;
    if (isSpeaking()) { await stopSpeaking(); setSpeaking(false); return; }
    if (!voiceEnabled) return;
    setSpeaking(true);
    try {
      const rawText = recap.overall_kevin_summary ?? '';
      if (!rawText) return;
      const { text } = checkContent(rawText, null);
      await speak(text, voiceGender, 'en', apiUrl);
    } finally {
      setSpeaking(false);
    }
  }, [recap, voiceGender, voiceEnabled, apiUrl]);

  const handleNarrate = useCallback(async () => {
    if (!recap) return;
    if (narratingRef.current) {
      narratingRef.current = false;
      await stopSpeaking();
      setNarrating(false);
      setHighlightedHole(null);
      return;
    }
    if (!voiceEnabled) return;
    narratingRef.current = true;
    setNarrating(true);
    const segments = buildNarrationScript(recap);
    try {
      for (const segment of segments) {
        if (!narratingRef.current) break;
        if (segment.hole_to_highlight !== null) {
          setHighlightedHole(segment.hole_to_highlight);
          const idx = recap.hole_comparisons.findIndex(hc => hc.hole_number === segment.hole_to_highlight);
          if (idx >= 0 && flatListRef.current) {
            flatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
          }
        } else {
          setHighlightedHole(null);
        }
        const { text: safeSegmentText } = checkContent(segment.audio_text, null);
        await speak(safeSegmentText, voiceGender, 'en', apiUrl);
        if (!narratingRef.current) break;
        await new Promise(r => setTimeout(r, 400));
      }
    } finally {
      narratingRef.current = false;
      setNarrating(false);
      setHighlightedHole(null);
    }
  }, [recap, voiceGender, voiceEnabled, apiUrl]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#00C896" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!recap) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => safeBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Recap not ready yet</Text>
          <Text style={styles.emptyText}>Your round data is saved. The recap will be available the next time you open the app.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.replace('/(tabs)/caddie' as never)}>
            <Text style={styles.emptyBtnText}>Back to {caddieName}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const ghost = recap.ghost_match ?? null;
  const ghostDelta = ghost?.overall_delta ?? null;
  const hero = computeRecapHero(recap);

  // Key moments: up to 3 holes with the longest kevin_summary
  const keyMoments = recap.hole_comparisons
    .filter(hc => hc.actual_score != null && hc.kevin_summary && hc.kevin_summary.length > 15)
    .sort((a, b) => (b.kevin_summary?.length ?? 0) - (a.kevin_summary?.length ?? 0))
    .slice(0, 3);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Round Recap</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        ref={flatListRef}
        data={recap.hole_comparisons}
        keyExtractor={hc => String(hc.hole_number)}
        contentContainerStyle={styles.listContent}
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={
          <View>
            {/* Hero moment card */}
            <View style={[styles.heroCard, hero.type === 'ghost_win' || hero.type === 'mode_breakthrough' ? styles.heroCardGold : styles.heroCardDefault]}>
              <Text style={styles.heroHeadline}>{hero.headline}</Text>
              <Text style={styles.heroDetail}>{hero.detail}</Text>
            </View>

            {/* Phase R — round photo collage */}
            <PhotoCollage photos={roundPhotos} />

            {/* Phase T — handicap impact (Score Differential + Update Index? CTA).
                Hidden when Index isn't set; component handles its own gating. */}
            <HandicapImpactCard roundId={round_id ?? null} />

            <View style={styles.summaryCard}>
              <Text style={styles.courseName}>{recap.course_name}</Text>
              <Text style={styles.modeLabel}>{MODE_LABELS[recap.mode] ?? recap.mode}</Text>
              <View style={styles.scoreRow}>
                <View style={styles.scoreItem}>
                  <Text style={styles.scoreLabel}>SCORE</Text>
                  <Text style={styles.scoreValue}>{recap.total_score}</Text>
                </View>
                {recap.total_planned_score != null && (
                  <View style={styles.scoreItem}>
                    <Text style={styles.scoreLabel}>PLANNED</Text>
                    <Text style={styles.scoreValue}>{recap.total_planned_score}</Text>
                  </View>
                )}
                {ghost && (
                  <View style={styles.scoreItem}>
                    <Text style={styles.scoreLabel}>GHOST</Text>
                    <Text style={styles.scoreValue}>{ghost.ghost_total}</Text>
                  </View>
                )}
                <View style={styles.scoreItem}>
                  <Text style={styles.scoreLabel}>HOLES</Text>
                  <Text style={styles.scoreValue}>{recap.hole_comparisons.length}</Text>
                </View>
              </View>
            </View>

            {/* Ghost match banner */}
            {ghost && (
              <View style={[styles.ghostBanner, { borderColor: deltaColor(ghostDelta) }]}>
                <Text style={styles.ghostBannerLabel}>GHOST MATCH</Text>
                <Text style={styles.ghostBannerName}>{ghost.ghost_round_label}</Text>
                <Text style={[styles.ghostBannerDelta, { color: deltaColor(ghostDelta) }]}>
                  {ghostDelta === 0 ? 'Dead even'
                    : ghostDelta != null && ghostDelta < 0
                      ? `Won by ${Math.abs(ghostDelta)} stroke${Math.abs(ghostDelta) > 1 ? 's' : ''}`
                      : ghostDelta != null ? `Lost by ${ghostDelta} stroke${ghostDelta > 1 ? 's' : ''}` : '—'}
                </Text>
              </View>
            )}

            <View style={styles.kevinCard}>
              <Text style={styles.kevinLabel}>{caddieName.toUpperCase()}</Text>
              <Text style={styles.kevinOverall}>{recap.overall_kevin_summary}</Text>
              <View style={styles.kevinActions}>
                {voiceEnabled && (
                  <TouchableOpacity style={styles.playBtn} onPress={handlePlayAloud}>
                    <Text style={styles.playBtnText}>{speaking ? 'Stop' : '▶ Play aloud'}</Text>
                  </TouchableOpacity>
                )}
                {voiceEnabled && (
                  <TouchableOpacity style={[styles.playBtn, narrating && styles.playBtnActive]} onPress={handleNarrate}>
                    <Text style={[styles.playBtnText, narrating && styles.playBtnTextActive]}>
                      {narrating ? '■ Stop' : '◈ Walk me through it'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.shareBtn, sharing && styles.shareBtnDisabled]}
                onPress={handleShare}
                disabled={sharing}
              >
                <Text style={styles.shareBtnText}>
                  {sharing ? 'Generating...' : '↑ Share this round'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Key moments */}
            {keyMoments.length > 0 && (
              <View style={styles.keyMomentsSection}>
                <Text style={styles.holesHeader}>KEY MOMENTS</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keyMomentsScroll}>
                  {keyMoments.map(hc => (
                    <TouchableOpacity
                      key={hc.hole_number}
                      style={[styles.keyMomentCard, highlightedHole === hc.hole_number && styles.keyMomentCardActive]}
                      onPress={() => {
                        setHighlightedHole(hc.hole_number);
                        const idx = recap.hole_comparisons.findIndex(h => h.hole_number === hc.hole_number);
                        if (idx >= 0 && flatListRef.current) {
                          flatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
                        }
                      }}
                    >
                      <Text style={styles.keyMomentHole}>Hole {hc.hole_number}</Text>
                      <Text style={[styles.keyMomentScore, { color: varianceColor(hc.variance) }]}>
                        {hc.actual_score ?? '—'} {hc.variance != null ? '(' + (hc.variance > 0 ? '+' : '') + hc.variance + ')' : ''}
                      </Text>
                      <Text style={styles.keyMomentSummary} numberOfLines={3}>
                        {hc.kevin_summary}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={styles.holesHeader}>
              {ghost ? 'GHOST  ·  YOURS  ·  DELTA' : 'HOLE BY HOLE'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <AnimatedHoleCard
            hc={item}
            ghostResult={ghost?.hole_results[item.hole_number]}
            index={index}
            highlightedHole={highlightedHole}
            onViewHole={(h) => router.push(`/recap/hole/${round_id}/${h}` as never)}
          />
        )}
        ListFooterComponent={<View style={{ height: 48 }} />}
      />

      {/* Hidden share card — rendered offscreen for captureRef */}
      <View style={styles.offscreen} pointerEvents="none">
        <RoundShareCard ref={cardRef} {...buildShareCardProps(recap)} caddieName={caddieName} />
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 60 },
  backText: { color: '#00C896', fontSize: 16, fontWeight: '600' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  listContent: { paddingBottom: 48 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  emptyText: { color: '#6b7280', textAlign: 'center', fontSize: 14, lineHeight: 21 },
  emptyBtn: {
    marginTop: 24, backgroundColor: '#0d2418', borderRadius: 12,
    borderWidth: 1, borderColor: '#1e3a28', paddingVertical: 13, paddingHorizontal: 28,
  },
  emptyBtnText: { color: '#00C896', fontSize: 15, fontWeight: '700' },

  heroCard: {
    marginHorizontal: 12, marginBottom: 12, marginTop: 4,
    borderRadius: 14, borderWidth: 1.5, padding: 16,
  },
  heroCardGold: {
    backgroundColor: '#1a120a', borderColor: '#F5A623',
  },
  heroCardDefault: {
    backgroundColor: '#0d2418', borderColor: '#00C896',
  },
  heroHeadline: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  heroDetail: { color: '#9ca3af', fontSize: 13, lineHeight: 19 },

  summaryCard: {
    marginHorizontal: 12, marginBottom: 12,
    backgroundColor: '#0d2418', borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a28', padding: 16,
  },
  courseName: { color: '#ffffff', fontSize: 18, fontWeight: '800', marginBottom: 2 },
  modeLabel: { color: '#00C896', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  scoreRow: { flexDirection: 'row', gap: 24 },
  scoreItem: { alignItems: 'center' },
  scoreLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  scoreValue: { color: '#ffffff', fontSize: 28, fontWeight: '900' },
  ghostBanner: {
    marginHorizontal: 12, marginBottom: 12,
    backgroundColor: '#0d1a25', borderRadius: 10,
    borderWidth: 1.5, padding: 12,
  },
  ghostBannerLabel: { color: '#6b7280', fontSize: 9, fontWeight: '800', letterSpacing: 2, marginBottom: 2 },
  ghostBannerName: { color: '#ffffff', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  ghostBannerDelta: { fontSize: 20, fontWeight: '900' },
  kevinCard: {
    marginHorizontal: 12, marginBottom: 16,
    backgroundColor: '#0d2418', borderLeftWidth: 3, borderLeftColor: '#00C896',
    borderRadius: 8, padding: 14,
  },
  kevinLabel: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  kevinOverall: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  kevinActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  playBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#00C896', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  playBtnActive: { backgroundColor: '#003d20' },
  playBtnText: { color: '#00C896', fontSize: 13, fontWeight: '600' },
  playBtnTextActive: { color: '#00C896' },
  keyMomentsSection: { marginBottom: 12 },
  keyMomentsScroll: { paddingHorizontal: 12, gap: 10 },
  keyMomentCard: {
    width: 160, backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  keyMomentCardActive: { borderColor: '#00C896', backgroundColor: '#0a2416' },
  keyMomentHole: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  keyMomentScore: { fontSize: 18, fontWeight: '900', marginBottom: 6 },
  keyMomentSummary: { color: '#9ca3af', fontSize: 11, lineHeight: 16 },
  holesHeader: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginHorizontal: 16, marginBottom: 8 },
  holeCard: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28', padding: 12,
  },
  holeCardHighlighted: { borderColor: '#00C896', backgroundColor: '#0a2416' },
  holeCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  holeNum: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  variancePill: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  variancePillText: { fontSize: 12, fontWeight: '700' },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#060f09', borderRadius: 8,
    padding: 10, marginBottom: 8,
  },
  ghostCol: { flex: 1, alignItems: 'center' },
  ghostColLabel: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  ghostColVal: { color: '#ffffff', fontSize: 22, fontWeight: '900' },
  ghostColDelta: { fontSize: 22, fontWeight: '900' },
  ghostDivider: { width: 1, height: 36, backgroundColor: '#1e3a28' },
  planLine: { color: '#6b7280', fontSize: 11, marginBottom: 6 },
  kevinSummary: { color: '#e5e7eb', fontSize: 13, lineHeight: 19 },
  viewHoleBtn: {
    alignSelf: 'flex-start', marginTop: 10,
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  viewHoleBtnText: { color: '#00C896', fontSize: 12, fontWeight: '700' },
  shareBtn: {
    marginTop: 10, alignSelf: 'stretch',
    backgroundColor: '#003d20', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#00C896',
  },
  shareBtnDisabled: { opacity: 0.5 },
  shareBtnText: { color: '#00C896', fontSize: 13, fontWeight: '700' },
  offscreen: { position: 'absolute', top: -9999, left: -9999, opacity: 0 },
});
