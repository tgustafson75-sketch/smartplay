/**
 * 2026-06-24 — Smart Tempo screen.
 *
 * The honest tempo-analysis flow, modeled on Tim's TempoTouch prototype.
 * Replaces the abstract metronome with a REAL read: the player marks three
 * swing phases on their own video — backswing-start, top, impact — and we
 * compute the actual backswing:downswing tempo ratio vs the tour-standard
 * 3:1 (services/smartTempo.ts).
 *
 * THREE states:
 *   A) ENTRY  — no swing loaded. Record / pick-from-library / metronome.
 *   B) MARK   — a swing is loaded. Scrub the video, tap a phase, "Mark it".
 *               detectTempoPhases pre-seeds whatever real signal exists
 *               (acoustic impact + pose) so the user only NUDGES; the rest
 *               is honest manual marking.
 *   C) RESULT — all three marked → computeTempo → the TempoTouch result card
 *               (rating, coaching, data block) + Replay Tempo + Save.
 *
 * HONESTY: only real marks → a real ratio. No fabricated numbers. If a phase
 * isn't marked there is no result; if the marks are out of order computeTempo
 * returns null and we nudge to re-mark.
 *
 * Reuses the swing-detail player primitives: <Video> (expo-av) + resolveClipUri
 * (re-anchors persisted file:// paths under the live container) + the scrubTo
 * "seek-and-hold-the-frame" pattern.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Modal, TextInput, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Video, ResizeMode, type AVPlaybackStatus, type AVPlaybackStatusSuccess } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useCageStore } from '../../store/cageStore';
import { useToastStore } from '../../store/toastStore';
import { resolveClipUri } from '../../services/videoUpload';
import { getLibrary } from '../../services/swingLibrary';
import {
  computeTempo, detectTempoPhases,
  type TempoPhases, type TempoResult, type TempoRating, type TempoMode,
} from '../../services/smartTempo';
import { TempoMetronome, type MetronomeMode } from '../../services/tempoMetronome';
import TempoPatch from '../../components/swinglab/TempoPatch';

// ─── Phase model ───────────────────────────────────────────────────────
type PhaseKey = 'backswingStartSec' | 'topSec' | 'impactSec';

type PhaseMeta = { key: PhaseKey; tab: string; caption: string };

// Full-swing labels (default). Putting reuses the same three phases but with
// stroke-specific wording (a putt has a backstroke + a forward-stroke ball-pass,
// not a "top of backswing" + acoustic "impact").
const PHASE_META_FULL: PhaseMeta[] = [
  { key: 'backswingStartSec', tab: 'Backswing Start', caption: 'Mark where the club starts back' },
  { key: 'topSec',            tab: 'Top',             caption: 'Mark the top of the backswing' },
  { key: 'impactSec',         tab: 'Impact',          caption: 'Mark impact' },
];
const PHASE_META_PUTT: PhaseMeta[] = [
  { key: 'backswingStartSec', tab: 'Takeaway',  caption: 'Mark where the putter starts back' },
  { key: 'topSec',            tab: 'End of Back', caption: 'Mark the end of the backstroke (reversal)' },
  { key: 'impactSec',         tab: 'Ball Pass', caption: 'Mark the forward stroke passing the ball' },
];

// Rating → brand token. on_tempo=green, rushed=amber, slow/smooth=sky.
function ratingColor(rating: TempoRating, c: ReturnType<typeof useTheme>['colors']): string {
  switch (rating) {
    case 'on_tempo': return c.accent;
    case 'rushed':   return c.accent_amber;
    case 'slow':
    case 'smooth':   return c.accent_sky;
  }
}

export default function SmartTempoScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ swing_id?: string; clipUri?: string; tempoMode?: string }>();

  // The swing currently under review. swing_id binds to a persisted session
  // (so Save updates it in place); clipUri can load a bare clip with no session.
  const [swingId, setSwingId] = useState<string | null>(params.swing_id ?? null);
  const [rawClipUri, setRawClipUri] = useState<string | null>(params.clipUri ?? null);

  const hasHydrated = useCageStore(s => s.hasHydrated);
  const session = useCageStore(s =>
    swingId ? s.sessionHistory.find(x => x.id === swingId) ?? null : null,
  );
  const shot = session?.shots[0];

  // The clip to play: an explicit clipUri param, else the loaded session's shot.
  const sourceClipUri = rawClipUri ?? shot?.clipUri ?? null;
  const inReview = sourceClipUri != null;

  // 2026-06-24 (Tim — mode-aware tempo) — is this a PUTT or a FULL SWING?
  // DTL + face-on are the SAME full swing (one shared 3:1 profile); putting is
  // the genuinely different stroke (~2:1 + pose-only impact). Infer putt from,
  // in order: the carried route param (Smart Motion sets tempoMode=putt when it
  // routes a putt here), the session's putting_analysis, or a putter club tag.
  // Everything else (incl. face-on) is a full swing.
  const tempoMode: TempoMode = useMemo(() => {
    if (params.tempoMode === 'putt') return 'putt';
    if (session?.putting_analysis != null) return 'putt';
    if (session?.club === 'PT') return 'putt';
    return 'full_swing';
  }, [params.tempoMode, session?.putting_analysis, session?.club]);
  const isPuttMode = tempoMode === 'putt';
  // Phase labels follow the mode (full swing vs putting stroke).
  const PHASE_META = isPuttMode ? PHASE_META_PUTT : PHASE_META_FULL;

  // 2026-06-24 (Tim — camera-first) — Smart Tempo opens straight into its OWN
  // camera (Smart Motion in 'tempo' capture mode), which records the swing and
  // routes BACK here with a swing_id → the player lands on the tempo RESULT, no
  // manual pick. `browsing` is the escape hatch: tapping "Pick from library"
  // sets it so the entry shows the small library option instead of re-launching
  // the camera. autoLaunchedRef makes the launch one-shot per mount so we never
  // ping-pong with the camera.
  const [browsing, setBrowsing] = useState(false);
  const autoLaunchedRef = useRef(false);
  const launchCamera = useCallback(() => {
    router.push({
      pathname: '/swinglab/smartmotion' as never,
      params: { captureMode: 'tempo', returnTo: '/swinglab/smart-tempo' } as never,
    });
  }, [router]);
  useEffect(() => {
    // Auto-open the camera once, on first mount, only when we landed with NO
    // swing and aren't already reviewing one. If the user came back from a
    // library pick or a recorded swing (inReview), or chose to browse, don't.
    if (inReview || browsing || autoLaunchedRef.current) return;
    if (params.swing_id || params.clipUri) return; // arrived pointed at a swing → don't hijack
    autoLaunchedRef.current = true;
    launchCamera();
  }, [inReview, browsing, params.swing_id, params.clipUri, launchCamera]);

  // ── Resolve the playable URI (re-anchor stale container paths) ────────
  const [playbackUri, setPlaybackUri] = useState<string | null>(sourceClipUri);
  const [videoError, setVideoError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPlaybackUri(sourceClipUri);
    setVideoError(null);
    if (sourceClipUri && sourceClipUri.startsWith('file://')) {
      void resolveClipUri(sourceClipUri).then(r => {
        if (cancelled) return;
        if (r) setPlaybackUri(r);
        else setVideoError('Video file not found on this device.');
      });
    }
    return () => { cancelled = true; };
  }, [sourceClipUri]);

  // ── Player state (mirrors swing-detail) ──────────────────────────────
  const videoRef = useRef<Video>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(session?.upload?.duration_sec ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekBarW, setSeekBarW] = useState(0);
  // Replay-tempo loop: when active, the player loops backswingStart→impact.
  const replayRef = useRef<{ startSec: number; endSec: number } | null>(null);
  const [replaying, setReplaying] = useState(false);

  // ── Phase marks ──────────────────────────────────────────────────────
  const [marks, setMarks] = useState<Partial<TempoPhases>>({});
  // Which marks came from auto-detection (honest "auto" vs "tap to mark" hint).
  const [autoKeys, setAutoKeys] = useState<Set<PhaseKey>>(new Set());
  const [activePhase, setActivePhase] = useState<PhaseKey>('backswingStartSec');
  // 2026-06-24 — auto-detection confidence for the honesty banner. 'auto' = all
  // three phases came from real signal; 'partial'/'none' = the player must refine
  // the missing marks. Mirrors detectTempoPhases' confidence.
  const [detectConfidence, setDetectConfidence] = useState<'auto' | 'partial' | 'none'>('none');
  const detectedForRef = useRef<string | null>(null);

  // Reset marks + re-run auto-detect whenever the swing source changes.
  useEffect(() => {
    if (!sourceClipUri) return;
    const detectKey = swingId ?? sourceClipUri;
    if (detectedForRef.current === detectKey) return;
    detectedForRef.current = detectKey;
    setMarks({});
    setAutoKeys(new Set());
    setActivePhase('backswingStartSec');
    setDetectConfidence('none');

    // Feed detectTempoPhases whatever this swing actually persists:
    //   • IMPACT — cage swings carry shot.detectionOffsetSeconds, the acoustic
    //     strike offset (seconds since recording start). The player position
    //     is on the SAME master-clip clock, so we pass it as impactMs with
    //     clipStartMs=0 (no realignment needed).
    //   • POSE  — session.biomechanics.frames. These are sparse keyframes
    //     (~5), usually < the 4-clean-samples the apex finder needs, so pose
    //     auto-detect commonly returns nothing → honest manual marking.
    // If a swing carries neither, every phase is manual. Never blocks.
    const impactMs =
      typeof shot?.detectionOffsetSeconds === 'number' && Number.isFinite(shot.detectionOffsetSeconds)
        ? shot.detectionOffsetSeconds * 1000
        : null;
    const out = detectTempoPhases({
      impactMs,
      poseFrames: session?.biomechanics?.frames ?? null,
      clipStartMs: 0,
    }, tempoMode);
    const seeded: Partial<TempoPhases> = {};
    const autos = new Set<PhaseKey>();
    (['backswingStartSec', 'topSec', 'impactSec'] as PhaseKey[]).forEach(k => {
      const v = out.phases[k];
      if (typeof v === 'number') { seeded[k] = v; autos.add(k); }
    });
    setDetectConfidence(out.confidence);
    if (Object.keys(seeded).length > 0) {
      setMarks(seeded);
      setAutoKeys(autos);
      // Land the user on the first UNmarked phase so they can fill the gap.
      const firstMissing = (['backswingStartSec', 'topSec', 'impactSec'] as PhaseKey[]).find(k => seeded[k] == null);
      if (firstMissing) setActivePhase(firstMissing);
    }
  }, [sourceClipUri, swingId, shot?.detectionOffsetSeconds, session?.biomechanics?.frames, tempoMode]);

  // ── Playback status ──────────────────────────────────────────────────
  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const s = status as AVPlaybackStatusSuccess;
    const posSec = (s.positionMillis ?? 0) / 1000;
    if (s.positionMillis != null) setPosition(posSec);
    if (s.durationMillis != null) setDuration(s.durationMillis / 1000);
    setIsPlaying(s.isPlaying === true);
    // Replay-tempo loop: when we pass the marked impact, snap back to the
    // marked backswing-start so the player FEELS the tempo on repeat.
    const r = replayRef.current;
    if (r && s.isPlaying && posSec >= r.endSec) {
      void videoRef.current?.setPositionAsync(r.startSec * 1000);
    }
  };

  // ── scrubTo — seek + HOLD the frame (reused from swing-detail) ────────
  const scrubTo = useCallback(async (sec: number) => {
    stopReplay();
    try {
      await videoRef.current?.setPositionAsync(sec * 1000);
      await videoRef.current?.pauseAsync();
    } catch { /* best-effort */ }
  }, []);

  const togglePlayPause = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const st = await v.getStatusAsync();
      if (st.isLoaded && st.isPlaying) { await v.pauseAsync(); return; }
      if (st.isLoaded) {
        stopReplay();
        const pos = st.positionMillis ?? 0;
        const dur = st.durationMillis ?? 0;
        if (dur > 0 && pos >= dur - 80) await v.setPositionAsync(0);
        await v.playAsync();
      }
    } catch { /* */ }
  }, []);

  const markActive = useCallback(() => {
    setMarks(prev => ({ ...prev, [activePhase]: position }));
    setAutoKeys(prev => { const n = new Set(prev); n.delete(activePhase); return n; }); // a manual mark is no longer "auto"
    // Advance to the next unmarked phase for a smooth left-to-right flow.
    const order: PhaseKey[] = ['backswingStartSec', 'topSec', 'impactSec'];
    const updated: Partial<TempoPhases> = { ...marks, [activePhase]: position };
    const next = order.find(k => updated[k] == null);
    if (next) setActivePhase(next);
  }, [activePhase, position, marks]);

  // ── Result ───────────────────────────────────────────────────────────
  const allMarked = marks.backswingStartSec != null && marks.topSec != null && marks.impactSec != null;
  const result: TempoResult | null = useMemo(() => {
    if (!allMarked) return null;
    return computeTempo({
      backswingStartSec: marks.backswingStartSec!,
      topSec: marks.topSec!,
      impactSec: marks.impactSec!,
    }, tempoMode);
  }, [allMarked, marks.backswingStartSec, marks.topSec, marks.impactSec, tempoMode]);
  const outOfOrder = allMarked && result == null;

  // ── Metronome (actual vs ideal) ───────────────────────────────────────
  // One TempoMetronome instance per screen; lazy-loads the tick/tock tones.
  // The compare control plays the player's REAL measured spacing ('actual'),
  // the tour 3:1 ('ideal'), or both back-to-back ('both') so the offset is
  // audible — the audible twin of the TempoPatch.
  const [metroMode, setMetroMode] = useState<MetronomeMode | null>(null);
  const metroRef = useRef<TempoMetronome | null>(null);
  if (metroRef.current == null) {
    metroRef.current = new TempoMetronome({ onStop: () => setMetroMode(null) });
  }
  useEffect(() => {
    const m = metroRef.current;
    return () => { void m?.dispose(); };
  }, []);
  // If the marks change (re-mark) while a metronome is running, stop it so it
  // can't keep playing a stale rhythm.
  useEffect(() => {
    if (metroMode && metroRef.current?.isRunning) {
      metroRef.current.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.backswingMs, result?.downswingMs]);
  const toggleMetro = useCallback((mode: MetronomeMode) => {
    const m = metroRef.current;
    if (!m || !result) return;
    if (metroMode === mode) { m.stop(); setMetroMode(null); return; }
    // Visual replay + audio compete for nothing, but stop a video replay loop so
    // the speaker tones aren't fighting muted video (video is muted anyway).
    setMetroMode(mode);
    void m.play(result, mode);
  }, [metroMode, result]);

  // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off). Fire once
  // when a tempo result first lands (all three marks placed + in order).
  const tempoTrackedRef = useRef(false);
  useEffect(() => {
    if (result && !tempoTrackedRef.current) {
      tempoTrackedRef.current = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/usageTelemetry').track('smart_tempo_completed', { ratio: result.ratio ?? null });
      } catch { /* telemetry never throws */ }
    }
  }, [result]);

  // ── Replay tempo (loop backswingStart→impact) ────────────────────────
  function stopReplay() {
    replayRef.current = null;
    setReplaying(false);
  }
  const replayTempo = useCallback(async () => {
    if (marks.backswingStartSec == null || marks.impactSec == null) return;
    const startSec = marks.backswingStartSec;
    const endSec = marks.impactSec;
    if (!(endSec > startSec)) return;
    replayRef.current = { startSec, endSec };
    setReplaying(true);
    try {
      await videoRef.current?.setPositionAsync(startSec * 1000);
      await videoRef.current?.playAsync();
    } catch { /* */ }
  }, [marks.backswingStartSec, marks.impactSec]);

  // ── Save ─────────────────────────────────────────────────────────────
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const openSave = useCallback(() => {
    if (!result) return;
    setSaveName(session?.upload?.notes ?? `${session?.club ?? 'Swing'} tempo`);
    setSaveOpen(true);
  }, [result, session?.upload?.notes, session?.club]);

  const doSave = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    try {
      let targetId = swingId;
      if (!targetId) {
        // Saving a bare clip (came in via clipUri / pick with no session) — create
        // a library entry first, then attach the tempo. Reuses ingestUploadedSwing.
        const clip = playbackUri ?? rawClipUri ?? sourceClipUri;
        if (clip) {
          targetId = useCageStore.getState().ingestUploadedSwing({
            clipUri: clip,
            club: 'Swing',
            source: 'uploaded_video',
            captureKind: 'upload',
            upload: {
              uploaded_at: Date.now(),
              notes: saveName.trim() || 'Smart Tempo swing',
              swinger: 'Me',
              duration_sec: duration ?? null,
            },
          });
          setSwingId(targetId);
        }
      }
      // For an existing library swing we attach the tempo to it in place (its
      // display name is unchanged — the store has no session-rename setter, and
      // the name field here is only for newly-created entries).
      if (targetId) {
        useCageStore.getState().setSessionTempo(targetId, result);
        useToastStore.getState().show('Tempo saved to your library.');
      }
      setSaveOpen(false);
    } catch {
      useToastStore.getState().show('Couldn’t save — try again.');
    } finally {
      setSaving(false);
    }
  }, [result, swingId, playbackUri, rawClipUri, sourceClipUri, saveName, duration]);

  // ── Library picker ───────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const libraryEntries = useMemo(
    () => (pickerOpen ? getLibrary('all').filter(e => e.session.shots[0]?.clipUri) : []),
    [pickerOpen],
  );
  const pickSwing = useCallback((id: string) => {
    setRawClipUri(null);
    setSwingId(id);
    setPickerOpen(false);
    setBrowsing(false); // picked a swing → leave browse state (now in review)
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  if (inReview && !hasHydrated && swingId) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.text_muted, marginTop: 12 }}>Loading swing…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (inReview && (params.swing_id || params.clipUri) == null
            ? backToEntry()
            : router.back())}
          hitSlop={10}
          style={styles.headerIcon}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text_primary }]}>Smart Tempo</Text>
        <View style={styles.headerIcon}>
          <Ionicons name="speedometer-outline" size={20} color={colors.accent_amber} />
        </View>
      </View>

      {!inReview ? (
        // ─── A) ENTRY ────────────────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.entryBody}>
          <Text style={[styles.blurb, { color: colors.text_muted }]}>
            Smart Tempo opens your camera, records the swing, and reads your REAL
            backswing:downswing ratio against the tour 3:1 — then plays it back so you can
            HEAR and SEE the difference. No guessing, only your real marks.
          </Text>

          <Pressable
            onPress={launchCamera}
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Open the camera and record a swing"
          >
            <Ionicons name="videocam" size={20} color="#06281b" />
            <Text style={styles.primaryBtnText}>Open camera</Text>
          </Pressable>
          <Text style={[styles.metHint, { color: colors.text_muted }]}>
            Records a swing and brings you straight to your tempo read.
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={() => { setBrowsing(true); setPickerOpen(true); }}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Pick a swing from your library"
          >
            <Ionicons name="albums-outline" size={18} color={colors.accent_sky} />
            <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Pick from library</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/swinglab/tempo-trainer' as never)}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Open the tempo metronome to swing to a 3:1 beat"
          >
            <Ionicons name="musical-notes-outline" size={18} color={colors.accent_amber} />
            <Text style={[styles.secondaryBtnText, { color: colors.text_primary }]}>Swing to a 3:1 beat</Text>
          </Pressable>
          <Text style={[styles.metHint, { color: colors.text_muted }]}>
            Practice the rhythm to the metronome, then record to measure it.
          </Text>
        </ScrollView>
      ) : (
        // ─── B/C) MARK + RESULT ──────────────────────────────────────────
        <ScrollView contentContainerStyle={styles.reviewBody}>
          {/* Mode chip — DTL + face-on read as one FULL-SWING tempo (3:1);
              putting is the smoother, more even ~2:1 stroke. */}
          <View style={[styles.modeChip, { borderColor: isPuttMode ? colors.accent_sky : colors.accent }]}>
            <Ionicons
              name={isPuttMode ? 'golf-outline' : 'speedometer-outline'}
              size={14}
              color={isPuttMode ? colors.accent_sky : colors.accent}
            />
            <Text style={[styles.modeChipText, { color: colors.text_primary }]}>
              {isPuttMode ? 'Putting tempo' : 'Full-swing tempo'}
            </Text>
            <Text style={[styles.modeChipTarget, { color: colors.text_muted }]}>
              {isPuttMode ? 'target ~2:1 · smooth & even' : 'target 3:1'}
            </Text>
          </View>

          {/* Player */}
          <View style={styles.videoWrap}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => void togglePlayPause()}>
              <Video
                ref={videoRef}
                source={{ uri: playbackUri ?? sourceClipUri ?? '' }}
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls={false}
                isMuted
                shouldCorrectPitch={false}
                onLoad={async () => {
                  setVideoError(null);
                  // Hold on the first frame so the user scrubs deliberately.
                  try { await videoRef.current?.pauseAsync(); } catch { /* */ }
                }}
                onPlaybackStatusUpdate={onStatus}
                onError={() => setVideoError('This video could not be played on this device.')}
              />
            </Pressable>

            {videoError && (
              <View style={styles.videoErr}>
                <Ionicons name="alert-circle-outline" size={36} color={colors.accent_amber} />
                <Text style={styles.videoErrText}>{videoError}</Text>
              </View>
            )}

            {/* Center play/pause */}
            <Pressable
              onPress={() => void togglePlayPause()}
              style={styles.centerPlay}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#fff" style={{ opacity: isPlaying ? 0.5 : 1 }} />
            </Pressable>

            {/* Tap-to-seek bar + phase mark dots */}
            <Pressable
              onPress={(e) => {
                if (!duration || duration <= 0 || seekBarW <= 0) return;
                const frac = Math.max(0, Math.min(1, e.nativeEvent.locationX / seekBarW));
                void scrubTo(frac * duration);
              }}
              onLayout={(e) => setSeekBarW(e.nativeEvent.layout.width)}
              style={styles.seekHit}
              accessibilityRole="adjustable"
              accessibilityLabel="Seek bar — tap to jump to a point in the swing"
            >
              <View style={styles.seekTrack}>
                <View style={[styles.seekFill, { width: `${duration && duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0}%` }]} />
                {/* Marked-phase ticks */}
                {duration && duration > 0 ? PHASE_META.map(p => {
                  const v = marks[p.key];
                  if (v == null) return null;
                  const left = Math.max(0, Math.min(100, (v / duration) * 100));
                  const tint = p.key === 'impactSec' ? colors.accent : p.key === 'topSec' ? colors.accent_sky : colors.accent_amber;
                  return <View key={p.key} style={[styles.seekTick, { left: `${left}%`, backgroundColor: tint }]} />;
                }) : null}
              </View>
            </Pressable>
          </View>

          {/* Honesty banner — auto-detection couldn't nail every phase, so the
              player must REFINE the missing marks. Lead with auto, flag the gap.
              Hidden once a complete in-order result lands. */}
          {!result && detectConfidence !== 'auto' && (
            <View style={[styles.refineBanner, { borderColor: colors.accent_sky }]}>
              <Ionicons name="construct-outline" size={16} color={colors.accent_sky} />
              <Text style={[styles.refineText, { color: colors.text_secondary }]}>
                {detectConfidence === 'none'
                  ? (isPuttMode
                      ? "Putting tempo is read from motion only (a putt is quiet — no strike to anchor on), so we couldn't auto-read it. Scrub the video and tap each phase — your real marks build the result."
                      : "We couldn't auto-read this swing's tempo. Scrub the video and tap each phase to mark it — your real marks build the result.")
                  : (isPuttMode
                      ? 'We motion-estimated this putt, but pose-only putt reads are less certain than a full swing — scrub and confirm each phase (especially the ball-pass) so the ratio is yours.'
                      : 'We auto-marked what we could read. Scrub to the unmarked phase(s) and mark them — your real marks build the result.')}
              </Text>
            </View>
          )}

          {/* Phase tabs */}
          <View style={styles.tabRow}>
            {PHASE_META.map(p => {
              const marked = marks[p.key] != null;
              const active = activePhase === p.key;
              const isAuto = autoKeys.has(p.key);
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setActivePhase(p.key)}
                  style={[
                    styles.tab,
                    { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : 'transparent' },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.tab}${marked ? ', marked' : ', not marked'}`}
                >
                  <View style={styles.tabTop}>
                    {marked
                      ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
                      : <View style={[styles.tabDot, { borderColor: colors.text_muted }]} />}
                    <Text
                      style={[styles.tabLabel, { color: active ? colors.accent : colors.text_primary }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >{p.tab}</Text>
                  </View>
                  {marked ? (
                    <Text style={[styles.tabState, { color: isAuto ? colors.accent_sky : colors.text_muted }]}>
                      {isAuto ? 'auto' : marks[p.key]!.toFixed(2) + 's'}
                    </Text>
                  ) : (
                    <Text style={[styles.tabState, { color: colors.text_muted }]}>tap to mark</Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Active-phase caption + Mark button */}
          <Text style={[styles.caption, { color: colors.text_muted }]}>
            {PHASE_META.find(p => p.key === activePhase)!.caption}
            {'  ·  '}{position.toFixed(2)}s
          </Text>
          <Pressable
            onPress={markActive}
            style={[styles.markBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${PHASE_META.find(p => p.key === activePhase)!.tab} at the current frame`}
          >
            <Ionicons name="flag" size={18} color="#06281b" />
            <Text style={styles.markBtnText}>
              Mark {PHASE_META.find(p => p.key === activePhase)!.tab}
            </Text>
          </Pressable>

          {/* ─── C) RESULT ─────────────────────────────────────────────── */}
          {outOfOrder && (
            <View style={[styles.nudge, { borderColor: colors.accent_amber }]}>
              <Ionicons name="swap-vertical-outline" size={18} color={colors.accent_amber} />
              <Text style={[styles.nudgeText, { color: colors.text_primary }]}>
                These marks are out of order — backswing must come before the top, and the top
                before impact. Re-mark the one that’s off.
              </Text>
            </View>
          )}

          {result && (() => {
            const rc = ratingColor(result.rating, colors);
            return (
              <View style={[styles.resultCard, { borderColor: rc, backgroundColor: colors.surface }]}>
                <Text style={[styles.resultEyebrow, { color: colors.text_muted }]}>TEMPO RATING</Text>
                <Text style={[styles.resultRating, { color: rc }]}>{result.ratingLabel}</Text>
                <View style={styles.ratioBig}>
                  <Text style={[styles.ratioBigNum, { color: rc }]}>{result.ratioLabel}</Text>
                  <Text style={[styles.ratioBigTarget, { color: colors.text_muted }]}>{result.targetLabel}</Text>
                </View>
                <Text style={[styles.coaching, { color: colors.text_secondary }]}>{result.coaching}</Text>

                <View style={[styles.dataBlock, { borderColor: colors.border }]}>
                  <DataCell label="Backswing" value={`${result.backswingMs} ms`} colors={colors} />
                  <DataCell label="Downswing" value={`${result.downswingMs} ms`} colors={colors} />
                  <DataCell label="Ratio" value={result.ratioLabel} colors={colors} accent={rc} />
                </View>

                {/* ── Tempo Patch — your real marks vs the ideal 3:1 ── */}
                <TempoPatch result={result} />

                {/* ── Metronome compare — HEAR actual vs ideal ── */}
                <Text style={[styles.metroEyebrow, { color: colors.text_muted }]}>HEAR YOUR TEMPO</Text>
                <View style={styles.metroRow}>
                  {([
                    { mode: 'actual' as const, label: 'Your tempo', icon: 'person-outline' as const },
                    { mode: 'ideal' as const, label: `Ideal ${result.targetRatio}:1`, icon: 'flag-outline' as const },
                    { mode: 'both' as const, label: 'Compare', icon: 'git-compare-outline' as const },
                  ]).map(b => {
                    const on = metroMode === b.mode;
                    return (
                      <Pressable
                        key={b.mode}
                        onPress={() => toggleMetro(b.mode)}
                        style={[styles.metroBtn, { borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accent_muted : 'transparent' }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Play ${b.label} as a metronome`}
                      >
                        <Ionicons name={on ? 'stop' : b.icon} size={15} color={on ? colors.accent : colors.text_primary} />
                        <Text style={[styles.metroBtnText, { color: on ? colors.accent : colors.text_primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{on ? 'Stop' : b.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.metroHint, { color: colors.text_muted }]}>
                  Tick-tick-tock at your measured spacing vs the {result.targetLabel}. Built from your real marks.
                </Text>

                <View style={styles.resultActions}>
                  <Pressable
                    onPress={() => (replaying ? (stopReplay(), void videoRef.current?.pauseAsync()) : void replayTempo())}
                    style={[styles.resultBtn, { borderColor: colors.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel="Replay your tempo"
                  >
                    <Ionicons name={replaying ? 'stop' : 'repeat'} size={18} color={colors.accent} />
                    <Text style={[styles.resultBtnText, { color: colors.accent }]}>{replaying ? 'Stop' : 'Replay Tempo'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={openSave}
                    style={[styles.resultBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel="Save this tempo to your library"
                  >
                    <Ionicons name="bookmark" size={18} color="#06281b" />
                    <Text style={[styles.resultBtnText, { color: '#06281b' }]}>Save</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}

          {/* Pick a different swing */}
          <Pressable onPress={() => setPickerOpen(true)} style={styles.swapLink} hitSlop={8}>
            <Ionicons name="albums-outline" size={14} color={colors.accent_sky} />
            <Text style={[styles.swapLinkText, { color: colors.accent_sky }]}>Pick a different swing</Text>
          </Pressable>
        </ScrollView>
      )}

      {/* ─── Library picker modal ────────────────────────────────────────── */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: colors.text_primary }]}>Pick a swing</Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.text_muted} />
              </Pressable>
            </View>
            {libraryEntries.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: colors.text_muted }]}>
                No swings with video yet. Record one first.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {libraryEntries.map(e => (
                  <Pressable
                    key={e.session.id}
                    onPress={() => pickSwing(e.session.id)}
                    style={[styles.libRow, { borderColor: colors.border }]}
                    accessibilityRole="button"
                  >
                    {e.thumbnail_uri
                      ? <Image source={{ uri: e.thumbnail_uri }} style={styles.libThumb} />
                      : <View style={[styles.libThumb, { backgroundColor: colors.surface_elevated, alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons name="golf-outline" size={18} color={colors.text_muted} />
                        </View>}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.libLabel, { color: colors.text_primary }]} numberOfLines={1}>{e.display_label}</Text>
                      <Text style={[styles.libMeta, { color: colors.text_muted }]} numberOfLines={1}>
                        {new Date(e.date_ms).toLocaleDateString()}
                        {e.session.tempo_result ? `  ·  ${e.session.tempo_result.ratioLabel}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ─── Save modal ──────────────────────────────────────────────────── */}
      <Modal visible={saveOpen} animationType="fade" transparent onRequestClose={() => setSaveOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.saveSheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text_primary, marginBottom: 12 }]}>Save tempo</Text>
            <TextInput
              value={saveName}
              onChangeText={setSaveName}
              placeholder="Name this swing"
              placeholderTextColor={colors.text_muted}
              style={[styles.saveInput, { borderColor: colors.border, color: colors.text_primary }]}
              maxLength={60}
            />
            {result && (
              <Text style={[styles.savePreview, { color: colors.text_muted }]}>
                {result.ratingLabel} · {result.ratioLabel} (back {result.backswingMs}ms / down {result.downswingMs}ms)
              </Text>
            )}
            <View style={styles.saveActions}>
              <Pressable onPress={() => setSaveOpen(false)} style={[styles.saveCancel, { borderColor: colors.border }]} disabled={saving}>
                <Text style={{ color: colors.text_muted, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void doSave()}
                style={[styles.saveConfirm, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#06281b" size="small" /> : <Text style={{ color: '#06281b', fontWeight: '900' }}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );

  // Return from review to the entry state when we own the swing selection
  // (i.e. it wasn't passed in as a route param — then back means leave).
  function backToEntry() {
    stopReplay();
    metroRef.current?.stop();
    setMetroMode(null);
    setSwingId(null);
    setRawClipUri(null);
    detectedForRef.current = null;
    setMarks({});
    setAutoKeys(new Set());
    setBrowsing(false);
  }
}

function DataCell({ label, value, colors, accent }: {
  label: string; value: string; colors: ReturnType<typeof useTheme>['colors']; accent?: string;
}) {
  return (
    <View style={styles.dataCell}>
      <Text style={[styles.dataLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.dataValue, { color: accent ?? colors.text_primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },

  // Entry
  entryBody: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 },
  blurb: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 },
  primaryBtnText: { color: '#06281b', fontSize: 17, fontWeight: '900' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1, marginTop: 12 },
  secondaryBtnText: { fontSize: 15, fontWeight: '800' },
  divider: { height: 1, marginVertical: 24 },
  metHint: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 8 },

  // Review
  reviewBody: { paddingHorizontal: 16, paddingBottom: 48 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 12 },
  modeChipText: { fontSize: 12.5, fontWeight: '900', letterSpacing: 0.3 },
  modeChipTarget: { fontSize: 11, fontWeight: '700' },
  videoWrap: { width: '100%', aspectRatio: 9 / 12, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden' },
  videoErr: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.82)', padding: 24 },
  videoErrText: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  centerPlay: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  seekHit: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 30, justifyContent: 'flex-end', paddingBottom: 6 },
  seekTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' },
  seekFill: { height: 5, backgroundColor: '#88F700' },
  seekTick: { position: 'absolute', width: 3, height: 13, top: -4, borderRadius: 2, marginLeft: -1.5 },

  tabRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tab: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center' },
  tabTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  tabLabel: { fontSize: 12, fontWeight: '800' },
  tabState: { fontSize: 10, fontWeight: '700', marginTop: 3, letterSpacing: 0.3 },

  caption: { fontSize: 13, textAlign: 'center', marginTop: 16, fontWeight: '600' },
  markBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 10 },
  markBtnText: { color: '#06281b', fontSize: 16, fontWeight: '900' },

  nudge: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 16 },
  nudgeText: { flex: 1, fontSize: 13, lineHeight: 19 },

  refineBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  refineText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  metroEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, alignSelf: 'flex-start', marginTop: 18 },
  metroRow: { flexDirection: 'row', gap: 8, marginTop: 8, width: '100%' },
  metroBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 4 },
  metroBtnText: { fontSize: 12.5, fontWeight: '800' },
  metroHint: { fontSize: 11, lineHeight: 16, marginTop: 8, alignSelf: 'flex-start' },

  resultCard: { borderWidth: 1.5, borderRadius: 18, padding: 18, marginTop: 18, alignItems: 'center' },
  resultEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  resultRating: { fontSize: 30, fontWeight: '900', marginTop: 4 },
  ratioBig: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 6 },
  ratioBigNum: { fontSize: 46, fontWeight: '900' },
  ratioBigTarget: { fontSize: 13, fontWeight: '700' },
  coaching: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  dataBlock: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, marginTop: 16, width: '100%' },
  dataCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  dataLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  dataValue: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  resultActions: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  resultBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, borderWidth: 1.5 },
  resultBtnText: { fontSize: 14, fontWeight: '900' },

  swapLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 22 },
  swapLinkText: { fontSize: 13, fontWeight: '700' },

  // Modals
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  modalEmpty: { fontSize: 14, textAlign: 'center', paddingVertical: 30 },
  libRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingVertical: 11 },
  libThumb: { width: 44, height: 44, borderRadius: 8 },
  libLabel: { fontSize: 15, fontWeight: '800' },
  libMeta: { fontSize: 12, marginTop: 2 },

  saveSheet: { margin: 24, marginBottom: 'auto', marginTop: 'auto', borderRadius: 18, padding: 20 },
  saveInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  savePreview: { fontSize: 12, marginTop: 10 },
  saveActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  saveCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
  saveConfirm: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
});
