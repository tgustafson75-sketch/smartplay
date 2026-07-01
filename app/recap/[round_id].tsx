import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  BackHandler,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { safeBack } from '../../services/safeBack';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { captureRef } from 'react-native-view-shot';
import { loadRecap } from '../../services/planStorage';
import { synthesizeRecapFromRecord } from '../../services/recapSynth';
import { speak, stopSpeaking, isSpeaking } from '../../services/voiceService';
import { checkContent } from '../../services/contentGuardrail';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import { useRoundStore } from '../../store/roundStore';
import { useIssueLogStore } from '../../store/issueLogStore';
import PhotoCollage from '../../components/recap/PhotoCollage';
import HandicapImpactCard from '../../components/recap/HandicapImpactCard';
import OutcomeCard from '../../components/recap/OutcomeCard';
import { track } from '../../services/analytics';
import { buildShareCardProps } from '../../services/shareCardGenerator';
import { computeRecapHero } from '../../services/recapHero';
import { buildNarrationScript } from '../../services/recapNarration';
import RoundShareCard from '../../components/RoundShareCard';
import type { RoundRecap, HoleComparison } from '../../types/plan';
import type { GhostHoleResult } from '../../types/ghost';
import type { RoundPhoto } from '../../store/roundStore';
import { getApiBaseUrl } from '../../services/apiBase';

// Day 1 fix — module-level stable empty array. Used as the selector
// fallback below so the Zustand selector returns the SAME reference
// across renders when the round has no photos. The prior `?? []`
// inline fallback produced a fresh `[]` per render → Zustand's
// useSyncExternalStore saw a "changed snapshot" → re-rendered →
// re-ran the selector → new `[]` → loop → "Maximum update depth
// exceeded" on the End Round → recap navigation. Same fix pattern
// as the GpsQualityOverlay split-selector bug fix (2026-05-16).
const EMPTY_PHOTOS: RoundPhoto[] = [];

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
  parByHole,
}: {
  hc: HoleComparison;
  ghostResult?: GhostHoleResult;
  index: number;
  highlightedHole: number | null;
  onViewHole: (hole: number) => void;
  parByHole: Record<number, number>;
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
  const hasScore = hc.actual_score != null;
  // Compute vs-par delta so score pills reflect real performance color.
  const par = parByHole[hc.hole_number] ?? null;
  const vspar = hasScore && par != null ? (hc.actual_score as number) - par : null;

  return (
    <Animated.View style={[styles.holeCard, isHighlighted && styles.holeCardHighlighted, animStyle]}>
      <View style={styles.holeCardHeader}>
        <Text style={styles.holeNum}>Hole {hc.hole_number}</Text>
        {hasScore && !ghostResult && (
          <View style={[styles.variancePill, { backgroundColor: varianceColor(vspar) + '22', borderColor: varianceColor(vspar) }]}>
            <Text style={[styles.variancePillText, { color: varianceColor(vspar) }]}>
              {hc.actual_score}
            </Text>
          </View>
        )}
        {hasScore && ghostResult && (
          <Text style={[styles.variancePillText, { color: varianceColor(vspar) }]}>
            Score: {hc.actual_score}
          </Text>
        )}
      </View>

      {ghostResult && <GhostRow ghostResult={ghostResult} holeNum={hc.hole_number} />}

      {/* 2026-06-04 — Plan line removed with HolePlan demolition. */}
      {/* 2026-06-04 — Outcome card (actual shots only). Renders only when
          the hole has matched shots; the component itself returns null when
          matched_shots is empty so this guard is belt + suspenders. */}
      {hc.matched_shots.length > 0 && (
        <OutcomeCard comparison={hc} />
      )}
      {Boolean(hc.kevin_summary) && (
        <Text style={styles.kevinSummary}>{hc.kevin_summary}</Text>
      )}
      <TouchableOpacity
        style={styles.viewHoleBtn}
        onPress={() => onViewHole(hc.hole_number)}
        accessibilityRole="button"
        accessibilityLabel={`View detail for hole ${hc.hole_number}`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
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
  const roundPhotos = useRoundStore(s => s.roundHistory.find(r => r.id === round_id)?.round_photos ?? EMPTY_PHOTOS);
  const deleteRound = useRoundStore(s => s.deleteRound);
  // Build a hole→par lookup so score pills can show vs-par color
  // (green under, amber bogey, red double+). courseHoles lives on the
  // active store state — valid for just-ended rounds and any round
  // whose course hasn't been overwritten by a new one. Falls back to
  // an empty map (neutral gray) for older history rounds.
  // 2026-07-01 (Tim — "Maximum update depth exceeded" opening a past round's card/scorecard from
  // the dashboard) — this selector BUILT A NEW OBJECT every render, so zustand's Object.is check
  // saw a changed result on every pass → re-render → new object → infinite loop → crash. Fix:
  // select the STABLE courseHoles slice (same ref unless it changes) and build the map in a useMemo
  // that only recomputes when courseHoles actually changes.
  const courseHoles = useRoundStore(s => s.courseHoles);
  const parByHole = useMemo(() => {
    const map: Record<number, number> = {};
    for (const h of courseHoles) map[h.hole] = h.par;
    return map;
  }, [courseHoles]);
  // 2026-05-21 — Fix R: subscribe to issue log entries so the recap
  // can surface "Kevin, log this" notes captured during the round.
  // Must be called before any conditional return below (rules of hooks).
  const issueEntries = useIssueLogStore(s => s.entries);
  const apiUrl = getApiBaseUrl();

  // Android hardware back → same as on-screen "← Back" button.
  // Recap is often entered via navigate_replace (end-round), leaving
  // it at the root of the stack. Without this, hardware back does
  // nothing and users feel stuck.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        safeBack();
        return true;
      });
      return () => sub.remove();
    }, [])
  );

  const cardRef = useRef<View>(null);
  const flatListRef = useRef<FlatList>(null);
  const [recap, setRecap] = useState<RoundRecap | null>(null);
  const [loading, setLoading] = useState(true);
  // 2026-06-08 (audit #2) — distinguish "timed out" from "still loading" and
  // allow a manual retry instead of a back-button-only dead-end.
  const [timedOut, setTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const narratingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [highlightedHole, setHighlightedHole] = useState<number | null>(null);

  // 2026-05-16 — Poll for the recap file. endRound now fires Sonnet
  // recap generation fire-and-forget; the file lands a few seconds after
  // the user navigates here. Previously this was a single load that
  // captured the not-yet-existing state and left the screen blank
  // forever. Polls every 1s for up to 30s; stops as soon as recap loads.
  // 2026-06-13 (Tim — speed is critical) — render INSTANTLY. A stored round used to
  // spin for up to 30s polling the recap archive; if no LLM recap was ever generated
  // (older in-app rounds, or generation still pending), it just spun. Now: prefer the
  // archived (rich) recap if present, else SYNTHESIZE one from the stored RoundRecord
  // immediately (scores/shots/summary we already have). Only a JUST-ended round (recap
  // generating in the background) keeps polling to swap in the richer version — and it
  // does so behind the already-rendered synth, never a spinner.
  useEffect(() => {
    if (!round_id) return;
    let cancelled = false;
    const shown = { current: false };

    void (async () => {
      const archived = await loadRecap(round_id).catch(() => null);
      if (cancelled) return;
      if (archived) { setRecap(archived); setLoading(false); shown.current = true; return; }
      // No archive — show the stored round instantly.
      const rec = useRoundStore.getState().roundHistory.find((r) => r.id === round_id);
      if (rec) { setRecap(synthesizeRecapFromRecord(rec)); setLoading(false); shown.current = true; }

      // Background upgrade: only when it's worth waiting — the round JUST ended (Sonnet
      // recap lands a few seconds later) OR we have nothing to show yet. Old history
      // rounds with a synth already on screen don't poll (no wasted reads, no spinner).
      const rec2 = rec ?? null;
      const justEnded = rec2 ? (Date.now() - rec2.endedAt) < 90_000 : true;
      if (!justEnded) {
        if (!shown.current) { setTimedOut(true); setLoading(false); }
        return;
      }
      let attempts = 0;
      const MAX_ATTEMPTS = 30;
      const tick = async () => {
        if (cancelled) return;
        attempts += 1;
        const r = await loadRecap(round_id).catch(() => null);
        if (cancelled) return;
        if (r) { setRecap(r); setLoading(false); shown.current = true; return; }
        if (attempts >= MAX_ATTEMPTS) {
          if (!shown.current) { setTimedOut(true); setLoading(false); }
          return;
        }
        setTimeout(() => { void tick(); }, 1000);
      };
      void tick();
    })();

    return () => { cancelled = true; };
  }, [round_id, retryNonce]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete round?',
      'This removes the round from your history and rebuilds your handicap. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            if (round_id) deleteRound(round_id);
            router.replace('/(tabs)/caddie' as never);
          },
        },
      ],
    );
  }, [round_id, deleteRound, router]);

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

  // PGA HOPE follow-up (B4) — pros asked for a PDF artifact for the
  // player's HOPE file. Captures the share card as PNG, embeds it in a
  // printable HTML template, and routes through expo-print to produce a
  // shareable PDF. Same card content as the PNG share, formatted for
  // print/file storage.
  const handleSharePdf = useCallback(async () => {
    if (!recap || sharing) return;
    setSharing(true);
    try {
      const pngUri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'base64' });
      const dataUrl = `data:image/png;base64,${pngUri}`;
      const dateStr = new Date(recap.ended_at ?? Date.now()).toLocaleDateString();
      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: letter; margin: 0.5in; }
              body { font-family: -apple-system, system-ui, sans-serif; color: #0d1a0d; }
              .header { font-size: 12pt; color: #6b7280; margin-bottom: 8pt; }
              .title { font-size: 22pt; font-weight: 800; margin-bottom: 14pt; }
              img { width: 100%; max-width: 7.5in; border-radius: 12pt; }
            </style>
          </head>
          <body>
            <div class="header">SmartPlay Round Recap · ${dateStr}</div>
            <div class="title">${recap.course_name ?? 'Round Recap'}</div>
            <img src="${dataUrl}" />
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Share not available', 'Native share is not supported on this device.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save round recap as PDF' });
      track('round_shared_pdf', { round_id: recap.round_id, mode: recap.mode });
    } catch (e) {
      console.warn('[recap] pdf export failed:', e);
      Alert.alert('Could not generate PDF', 'Try again in a moment.');
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
      await speak(text, voiceGender, 'en', apiUrl, { userInitiated: true });
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
        await speak(safeSegmentText, voiceGender, 'en', apiUrl, { userInitiated: true });
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
          <TouchableOpacity onPress={handleDelete} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{timedOut ? 'Recap is taking longer than usual' : 'Recap not ready yet'}</Text>
          <Text style={styles.emptyText}>Your round data is saved{timedOut ? ' — tap Try again, or it’ll be ready next time you open the app.' : '. The recap will be available the next time you open the app.'}</Text>
          {timedOut ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => { setTimedOut(false); setLoading(true); setRetryNonce(n => n + 1); }}
            >
              <Text style={styles.emptyBtnText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
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

  // 2026-05-21 — Fix R: filter "Kevin, log this" entries captured during
  // this round (subscribed up top so the hook runs unconditionally).
  // Window = started_at → ended_at + 5min grace so a thought spoken right
  // after End Round still shows on the recap.
  const ROUND_NOTE_GRACE_MS = 5 * 60 * 1000;
  const roundNotes = issueEntries
    .filter(e =>
      // 2026-06-16 (Tim — recap was THREE PAGES of transcribe/voice errors) — this
      // section is for the player's OWN notes ("Kevin, log this"), NOT the diagnostic
      // log. issueEntries holds both; only 'user' (or legacy undefined) entries are
      // real notes. Excludes voice_error / voice_silent_fail / transcribe_error /
      // gps_error / analysis_error / app_error so the recap reads like a recap again.
      (e.kind === 'user' || e.kind == null) &&
      e.timestamp >= recap.started_at &&
      e.timestamp <= recap.ended_at + ROUND_NOTE_GRACE_MS
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Round Recap</Text>
        <TouchableOpacity onPress={handleDelete} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </TouchableOpacity>
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
                {/* 2026-06-04 — total_planned_score removed with HolePlan. */}
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
              {/* Re-sim P0 #3 — surface "Walk me through it" prominently
                  for first-recap viewers. Coach Davis flagged that gen-pop
                  golfers don't know the guided walkthrough exists. Hides
                  permanently after first use. */}
              {voiceEnabled && !useSettingsStore.getState().tutorialsSeen?.['recap_walkthrough'] && (
                <TouchableOpacity
                  style={styles.walkthroughCta}
                  onPress={() => {
                    useSettingsStore.getState().markTutorialSeen('recap_walkthrough');
                    void handleNarrate();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Walk me through this round — caddie will narrate the highlights with hole-by-hole context"
                >
                  <Text style={styles.walkthroughCtaText}>◈ Walk me through this round</Text>
                  <Text style={styles.walkthroughCtaSub}>{caddieName} will guide you hole-by-hole</Text>
                </TouchableOpacity>
              )}
              <View style={styles.kevinActions}>
                {voiceEnabled && (
                  <TouchableOpacity
                    style={styles.playBtn}
                    onPress={handlePlayAloud}
                    accessibilityRole="button"
                    accessibilityLabel={speaking ? 'Stop playback' : 'Play recap aloud'}
                    accessibilityState={{ busy: speaking }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.playBtnText}>{speaking ? 'Stop' : '▶ Play aloud'}</Text>
                  </TouchableOpacity>
                )}
                {voiceEnabled && (
                  <TouchableOpacity
                    style={[styles.playBtn, narrating && styles.playBtnActive]}
                    onPress={handleNarrate}
                    accessibilityRole="button"
                    accessibilityLabel={narrating ? 'Stop narration' : 'Walk me through this round hole by hole'}
                    accessibilityState={{ busy: narrating }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
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
                accessibilityRole="button"
                accessibilityLabel="Share this round as an image"
              >
                <Text style={styles.shareBtnText}>
                  {sharing ? 'Generating...' : '↑ Share this round'}
                </Text>
              </TouchableOpacity>
              {/* PGA HOPE follow-up (B4) — pros asked for a PDF artifact
                  for the player's HOPE file. Same card, printable. */}
              <TouchableOpacity
                style={[styles.shareBtn, sharing && styles.shareBtnDisabled, { marginTop: 8 }]}
                onPress={handleSharePdf}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel="Save this round as a PDF for your file"
              >
                <Text style={styles.shareBtnText}>
                  {sharing ? 'Generating...' : '⤓ Save as PDF'}
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
                      <Text style={[styles.keyMomentScore, {
                        color: varianceColor(
                          hc.actual_score != null && parByHole[hc.hole_number] != null
                            ? hc.actual_score - parByHole[hc.hole_number]
                            : null,
                        ),
                      }]}>
                        {hc.actual_score ?? '—'}
                      </Text>
                      <Text style={styles.keyMomentSummary} numberOfLines={3}>
                        {hc.kevin_summary}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* 2026-05-21 — Fix R: notes captured via "Kevin, log this"
                during the round window. Hidden when zero notes; otherwise
                shows hole + time + text per entry, vertically stacked. */}
            {roundNotes.length > 0 && (
              <View style={styles.notesSection}>
                <Text style={styles.holesHeader}>NOTES FROM THIS ROUND</Text>
                {roundNotes.map(note => {
                  const hole = note.context?.currentHole ?? null;
                  const time = new Date(note.timestamp).toLocaleTimeString([], {
                    hour: 'numeric', minute: '2-digit',
                  });
                  return (
                    <View key={note.id} style={styles.noteCard}>
                      <View style={styles.noteHeaderRow}>
                        <Text style={styles.noteHeader}>
                          {hole != null ? `Hole ${hole}` : 'Off-course'}
                        </Text>
                        <Text style={styles.noteTime}>{time}</Text>
                      </View>
                      <Text style={styles.noteText}>{note.text}</Text>
                    </View>
                  );
                })}
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
            parByHole={parByHole}
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
  // Phase 406 wave 2 — graceful-landscape recap. The FlatList content
  // is a single-column stack of cards; on landscape (Fold open inner /
  // phone rotated / tablet) cap the column at 720dp and center it so
  // the layout doesn't stretch to span the full wide canvas. Each card
  // still reads cleanly; the surrounding canvas just letterboxes.
  listContent: { paddingBottom: 48, maxWidth: 720, alignSelf: 'center', width: '100%' },
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
  walkthroughCta: {
    marginTop: 12, marginBottom: 4,
    backgroundColor: '#00C896', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  walkthroughCtaText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },
  walkthroughCtaSub: { color: '#0d1a0d', fontSize: 11, fontWeight: '600', marginTop: 2, opacity: 0.75 },
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
  notesSection: { marginBottom: 16, paddingHorizontal: 12 },
  noteCard: {
    backgroundColor: '#0d2418', borderRadius: 10,
    borderWidth: 1, borderColor: '#1e3a28',
    padding: 12, marginBottom: 8,
  },
  noteHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  noteHeader: { color: '#6b7280', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  noteTime: { color: '#6b7280', fontSize: 10, fontWeight: '600' },
  noteText: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
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
