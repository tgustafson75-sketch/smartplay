/**
 * Cage Drill — full-screen capture + analyze flow.
 *
 * State machine:
 *   SETUP → CHECKING → READY | NOT_READY
 *                    └ NOT_READY auto-reverts to SETUP after 2s
 *           READY → RECORDING (12s) → UPLOADING → RESULT | ERROR
 *           ERROR → "Try Again" → SETUP
 *           RESULT → "Swing Again" → SETUP
 *
 * Capture: 1080p / 30fps / audio / single .mp4 in FileSystem.cacheDirectory.
 * Auto-stop at 12s OR on user stop tap.
 *
 * Bullseye visibility check is the gate before recording can start. The
 * still-frame upload to /api/cage/check-bullseye decides READY vs NOT_READY.
 *
 * Kevin badge (top-left, taps to listening) and ••• menu (top-right) stay
 * visible at all times so the player can pull Kevin in or exit cleanly.
 *
 * Layout adapts to Z Fold open / closed via useWindowDimensions aspect ratio.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, ScrollView, Image, useWindowDimensions, Animated, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  checkBullseye,
  analyzeCageVideo,
  coachReview,
  isMockMode,
  type CageAnalyzeResponse,
  type CoachReviewResponse,
} from '../../services/cageApi';
import { toggle as toggleListening } from '../../services/listeningSession';
import { safeBack } from '../../services/safeBack';
import { useSettingsStore } from '../../store/settingsStore';
import { speak, configureAudioForSpeech } from '../../services/voiceService';
import { getCaddieName } from '../../lib/persona';
import CageOverlay, { type CageOverlayPhase } from '../../components/swinglab/CageOverlay';
import { setActiveSurface } from '../../services/activeSurfaceRegistry';
import { subscribeCapture } from '../../services/mediaCapture';

type Phase =
  | 'SETUP'
  | 'CHECKING'
  | 'READY'
  | 'NOT_READY'
  | 'RECORDING'
  | 'UPLOADING'
  | 'RESULT'
  | 'ERROR';

const RECORDING_MAX_SECONDS = 12;

const KEVIN_CAPTION: Partial<Record<Phase, string>> = {
  SETUP:     'Position your camera so the bullseye is in the frame.',
  CHECKING:  'Looking for the target…',
  READY:     'Locked in. Ready when you are.',
  NOT_READY: "I can't see the target. Step left a bit.",
  RECORDING: 'Swing when ready.',
  UPLOADING: 'Lemme take a look at that one…',
  RESULT:    "Here's what I saw.",
  ERROR:     'Something went sideways on my end.',
};

const CONFIDENCE_DOT: Record<CoachReviewResponse['confidence'], string> = {
  high:   '#00C896',
  medium: '#fbbf24',
  low:    '#9ca3af',
};

export default function CageDrillScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const aspect = H / W;
  // Z Fold open ≈ 8:9 → aspect ~1.13. Closed phone ≈ 9:21 → aspect ~2.33.
  // Standard phone ≈ 9:19.5 → aspect ~2.17.
  const isFoldOpen = aspect < 1.5;

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCountdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notReadyRevertRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<Phase>('SETUP');
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CageAnalyzeResponse | null>(null);
  const [coach, setCoach] = useState<CoachReviewResponse | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { voiceEnabled, voiceGender, language, caddiePersonality } = useSettingsStore();
  const caddieName = getCaddieName(caddiePersonality);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // ── Permissions ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!camPerm?.granted) void requestCamPerm();
    if (!micPerm?.granted) void requestMicPerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 105 — register drills surface so caddieResolver routes the
  // drills-pillar caddie (Serena by default).
  useEffect(() => {
    setActiveSurface('drill_session');
    return () => { setActiveSurface(null); };
  }, []);

  // PGA HOPE follow-up (A4) — single-handed players cannot reach the
  // bottom-right record button while holding the camera. Subscribe to
  // 'swing' kind voice captures so saying "record" / "capture" / "start"
  // triggers the same handler the button does. Only fires while phase
  // is READY (don't double-trigger mid-recording).
  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeCapture(['swing'], () => {
      if (cancelled) return;
      // Race-safe: only trigger if we're in the phase that allows it.
      // The button uses phase === 'READY' as its guard; mirror that.
      if (phase === 'READY') {
        void handleStartRecording();
      }
    });
    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordCountdownRef.current) clearTimeout(recordCountdownRef.current);
      if (notReadyRevertRef.current) clearTimeout(notReadyRevertRef.current);
    };
  }, []);

  // ── NOT_READY auto-revert to SETUP after 2s ─────────────────────────
  useEffect(() => {
    if (phase !== 'NOT_READY') return;
    if (notReadyRevertRef.current) clearTimeout(notReadyRevertRef.current);
    notReadyRevertRef.current = setTimeout(() => setPhase('SETUP'), 2000);
    return () => {
      if (notReadyRevertRef.current) {
        clearTimeout(notReadyRevertRef.current);
        notReadyRevertRef.current = null;
      }
    };
  }, [phase]);

  // ── State transitions ───────────────────────────────────────────────

  const handleCheckPosition = useCallback(async () => {
    if (!cameraRef.current) return;
    console.log('[path3:cage] check_position requested');
    setPhase('CHECKING');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5, base64: true, skipProcessing: true,
      });
      const b64 = photo?.base64 ?? '';
      if (!b64) {
        setErrorMessage('Could not capture preview frame.');
        setPhase('ERROR');
        return;
      }
      const res = await checkBullseye(b64);
      if (res.kind !== 'ok') {
        setErrorMessage(res.kind === 'no_network' ? 'No network. Try again.' : res.message);
        setPhase('ERROR');
        return;
      }
      if (res.data.detected && res.data.canvas_visible) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPhase('READY');
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPhase('NOT_READY');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    // Audit fix — double-tap guard. If a recording promise is already
    // in flight (rapid tap before the first state flush), bail. The
    // phase check covers the same case via React state.
    if (recordingPromiseRef.current) return;
    // Audit fix — mic permission gate. recordAsync silently produces
    // a videoless / audioless file when mic isn't granted; surface it
    // as a recoverable alert instead of a confusing capture failure.
    if (!micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted) {
        Alert.alert(
          'Microphone needed',
          'Cage Drill records audio to detect strikes. Allow microphone access to record.',
        );
        return;
      }
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setRecordedSeconds(0);
    setPhase('RECORDING');

    // Tick countdown
    const startedAt = Date.now();
    recordTimerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      setRecordedSeconds(s);
    }, 100);

    // Auto-stop at 12s
    recordCountdownRef.current = setTimeout(() => {
      void stopRecordingAndUpload();
    }, RECORDING_MAX_SECONDS * 1000);

    try {
      // expo-camera v17: recordAsync resolves with { uri } when stopped.
      recordingPromiseRef.current = cameraRef.current.recordAsync({
        maxDuration: RECORDING_MAX_SECONDS,
      }) as Promise<{ uri: string } | undefined>;
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micPerm, requestMicPerm]);

  const stopRecordingAndUpload = useCallback(async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recordCountdownRef.current) {
      clearTimeout(recordCountdownRef.current);
      recordCountdownRef.current = null;
    }

    // Audit fix — stop the recording WHILE the camera is still mounted.
    // Switching to UPLOADING below removes the CameraView from the tree
    // (cameraVisible is false for UPLOADING). Calling stopRecording after
    // unmount would no-op against a null ref and the recordAsync promise
    // could hang or reject. Stop synchronously, then transition.
    try { cameraRef.current?.stopRecording(); } catch {}

    setPhase('UPLOADING');

    try {
      const recorded = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      const sourceUri = recorded?.uri;
      if (!sourceUri) {
        setErrorMessage('Recording produced no file.');
        setPhase('ERROR');
        return;
      }

      // Move to a stable cache path so the camera's temp file doesn't
      // get evicted before upload completes.
      const cacheDir = FileSystem.cacheDirectory ?? '';
      const cachedUri = `${cacheDir}cage_drill_${Date.now()}.mp4`;
      try {
        await FileSystem.copyAsync({ from: sourceUri, to: cachedUri });
      } catch {
        // Fall through with the original uri if copy fails.
      }
      const uploadUri = (await FileSystem.getInfoAsync(cachedUri)).exists ? cachedUri : sourceUri;

      const res = await analyzeCageVideo(uploadUri);

      // Best-effort delete of the local cache file regardless of outcome.
      try { await FileSystem.deleteAsync(cachedUri, { idempotent: true }); } catch {}

      if (res.kind !== 'ok') {
        setErrorMessage(res.kind === 'no_network' ? 'Upload failed — no network. Try again.' : res.message);
        setPhase('ERROR');
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(res.data);

      // Hand features.json to Kevin's cage_swing_review tool. The coach
      // response replaces the raw-JSON display from Prompt 1; the JSON is
      // still available behind a 'Show details' expander.
      const coachRes = await coachReview(res.data, voiceGender);
      if (coachRes.kind === 'ok') {
        setCoach(coachRes.data);
        if (voiceEnabled) {
          void (async () => {
            await configureAudioForSpeech();
            await speak(coachRes.data.kevin_response, voiceGender, language, apiUrl);
          })();
        }
      } else {
        // Don't fail the whole flow if Kevin times out — still show the
        // result card with a soft fallback caption.
        setCoach({
          kevin_response: "I saw the swing — couldn't put words to it just now. Take another and we'll see.",
          confidence: 'low',
        });
      }
      setPhase('RESULT');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('ERROR');
    }
  }, [voiceEnabled, voiceGender, language, apiUrl]);

  const handleSwingAgain = useCallback(() => {
    setResult(null);
    setCoach(null);
    setErrorMessage(null);
    setDetailsOpen(false);
    setRecordedSeconds(0);
    setPhase('SETUP');
  }, []);

  const handleTryAgain = useCallback(() => {
    setErrorMessage(null);
    setRecordedSeconds(0);
    setPhase('SETUP');
  }, []);

  const onBadgeTap = useCallback(() => {
    void toggleListening();
  }, []);

  // ── Caption pulse on phase change ───────────────────────────────────
  const captionFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    captionFade.setValue(0);
    Animated.timing(captionFade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Permission gates ────────────────────────────────────────────────
  if (!camPerm) return <SafeAreaView style={styles.container}><ActivityIndicator color="#00C896" style={{ marginTop: 80 }} /></SafeAreaView>;
  if (!camPerm.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
        <View style={styles.permWrap}>
          <Text style={styles.permTitle}>Camera permission needed</Text>
          <Text style={styles.permBody}>Cage Drill records your swing to score your strikes.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestCamPerm()}>
            <Text style={styles.primaryBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────
  // Audit fix — keep camera mounted through UPLOADING so the recordAsync
  // promise can resolve cleanly. The full-screen UPLOADING overlay covers
  // the camera visually; functional reason for keeping the View alive is
  // the recording promise lifecycle, not the pixel.
  const cameraVisible = phase === 'SETUP' || phase === 'CHECKING' || phase === 'READY' || phase === 'NOT_READY' || phase === 'RECORDING' || phase === 'UPLOADING';

  return (
    <View style={styles.container}>
      {cameraVisible && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode={phase === 'RECORDING' ? 'video' : 'picture'}
          videoQuality="1080p"
        />
      )}

      {/* Dim overlay so chrome reads on bright camera frames. */}
      {cameraVisible && <View style={styles.cameraDim} pointerEvents="none" />}

      {/* Phase AM — multi-purpose alignment overlay. Renders only during
          setup phases; hidden during RECORDING / UPLOADING so the
          recording UI isn't crowded with the alignment scaffold. Color
          maps to phase (amber → green when READY, red on NOT_READY). */}
      {(phase === 'SETUP' || phase === 'CHECKING' || phase === 'READY' || phase === 'NOT_READY') && (
        <CageOverlay phase={phase as CageOverlayPhase} />
      )}

      <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />

      {/* Kevin caption — always visible, fades on phase change. */}
      <Animated.View
        style={[
          styles.captionWrap,
          { top: insets.top + 76, opacity: captionFade },
          isFoldOpen && { left: 96, right: 96 },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.caption}>{KEVIN_CAPTION[phase] ?? ''}</Text>
        {isMockMode() && <Text style={styles.mockHint}>MOCK MODE</Text>}
      </Animated.View>

      {/* RECORDING — large countdown + stop button. */}
      {phase === 'RECORDING' && (
        <View style={[styles.recordingWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          <View style={styles.countdownCard}>
            <Text style={styles.countdownNum}>{Math.max(0, RECORDING_MAX_SECONDS - recordedSeconds)}</Text>
            <Text style={styles.countdownLabel}>SECONDS LEFT</Text>
          </View>
          <TouchableOpacity style={styles.stopBtn} onPress={() => void stopRecordingAndUpload()}>
            <View style={styles.stopSquare} />
            <Text style={styles.stopText}>STOP</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SETUP / READY / NOT_READY — bottom CTAs. */}
      {(phase === 'SETUP' || phase === 'READY' || phase === 'NOT_READY' || phase === 'CHECKING') && (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 32 }]} pointerEvents="box-none">
          {phase === 'CHECKING' ? (
            <View style={styles.checkingCard}>
              <ActivityIndicator color="#00C896" />
              <Text style={styles.checkingText}>Checking position…</Text>
            </View>
          ) : phase === 'READY' ? (
            <>
              {/* Re-sim P0 #2 — surface the voice trigger one-time so
                  players (especially those who can't easily reach the
                  button) know it exists. Hidden once tutorialsSeen marks
                  cage_voice_trigger. */}
              {!useSettingsStore.getState().tutorialsSeen?.['cage_voice_trigger'] && (
                <View style={styles.voiceHintRow}>
                  <Ionicons name="mic-outline" size={14} color="#00C896" />
                  <Text style={styles.voiceHintText} accessibilityLabel="Tip: say record or capture to start recording with voice">
                    {'Tip: say "record" or "capture" — hands-free.'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, styles.recordBtn]}
                onPress={() => {
                  useSettingsStore.getState().markTutorialSeen('cage_voice_trigger');
                  void handleStartRecording();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Start recording your swing — or say record"
              >
                <View style={styles.recordDot} />
                <Text style={styles.primaryBtnText}>Start Recording</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, phase === 'NOT_READY' && styles.primaryBtnDisabled]}
              onPress={handleCheckPosition}
              disabled={phase === 'NOT_READY'}
              activeOpacity={0.85}
            >
              <Ionicons name="scan-outline" size={20} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Check Position</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* UPLOADING — full-card overlay with filler caption + spinner. */}
      {phase === 'UPLOADING' && (
        <View style={styles.fullOverlay}>
          <View style={styles.uploadCard}>
            <ActivityIndicator size="large" color="#00C896" />
            <Text style={styles.uploadText}>{KEVIN_CAPTION.UPLOADING}</Text>
          </View>
        </View>
      )}

      {/* RESULT — Kevin's response card + collapsible features.json. */}
      {phase === 'RESULT' && result && (
        <SafeAreaView style={styles.resultContainer} edges={['top', 'bottom']}>
          <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
          <ScrollView style={styles.resultScroll} contentContainerStyle={styles.resultScrollContent}>

            {/* Kevin response card — primary surface */}
            <View style={styles.kevinCard}>
              <View style={styles.kevinHeader}>
                <Image
                  source={require('../../assets/avatars/smartplay_caddie_badge.png')}
                  style={styles.kevinAvatar}
                  resizeMode="contain"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kevinName}>{caddieName}</Text>
                  {coach ? (
                    <View style={styles.confidenceRow}>
                      <View style={[styles.confidenceDot, { backgroundColor: CONFIDENCE_DOT[coach.confidence] }]} />
                      <Text style={styles.confidenceLabel}>{coach.confidence.toUpperCase()} CONFIDENCE</Text>
                    </View>
                  ) : (
                    <ActivityIndicator color="#00C896" size="small" style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                  )}
                </View>
              </View>
              <Text style={styles.kevinResponse}>
                {coach ? coach.kevin_response : 'Working on it…'}
              </Text>
            </View>

            {/* Collapsible features.json — debug surface, off by default */}
            <TouchableOpacity
              style={styles.detailsToggle}
              onPress={() => setDetailsOpen(o => !o)}
              activeOpacity={0.85}
            >
              <Ionicons name={detailsOpen ? 'chevron-down' : 'chevron-forward'} size={16} color="#9ca3af" />
              <Text style={styles.detailsLabel}>{detailsOpen ? 'Hide details' : 'Show details'}</Text>
            </TouchableOpacity>
            {detailsOpen && (
              <View style={styles.jsonCard}>
                <Text style={styles.jsonText}>{JSON.stringify(result, null, 2)}</Text>
              </View>
            )}

          </ScrollView>
          <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 24, position: 'relative' }]} pointerEvents="box-none">
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSwingAgain} activeOpacity={0.85}>
              <Ionicons name="refresh" size={18} color="#0d1a0d" />
              <Text style={styles.primaryBtnText}>Swing Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* ERROR — message + Try Again. */}
      {phase === 'ERROR' && (
        <SafeAreaView style={styles.resultContainer} edges={['top', 'bottom']}>
          <Header insets={insets} onBack={() => safeBack()} onMore={() => setMoreOpen(true)} onBadge={onBadgeTap} />
          <View style={styles.errorWrap}>
            <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
            <Text style={styles.errorTitle}>{KEVIN_CAPTION.ERROR}</Text>
            <Text style={styles.errorBody}>{errorMessage ?? 'Unknown error.'}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleTryAgain} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* ••• action sheet — minimal local menu so the affordance is real. */}
      <Modal transparent visible={moreOpen} animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMoreOpen(false)}>
          <View style={[styles.menuSheet, { paddingTop: insets.top + 60, paddingRight: 12 }]}>
            <View style={styles.menuCard}>
              <MenuItem
                icon="settings-outline"
                label="Settings"
                onPress={() => { setMoreOpen(false); router.push('/settings' as never); }}
              />
              <MenuItem
                icon="library-outline"
                label="My Swing Library"
                onPress={() => { setMoreOpen(false); router.push('/swinglab/library' as never); }}
              />
              <MenuItem
                icon="close-circle-outline"
                label="Close"
                onPress={() => { setMoreOpen(false); router.back(); }}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function Header({
  insets, onBack, onMore, onBadge,
}: {
  insets: { top: number };
  onBack: () => void;
  onMore: () => void;
  onBadge: () => void;
}) {
  return (
    <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="box-none">
      <TouchableOpacity onPress={onBadge} style={styles.badgeBtn} accessibilityLabel="Talk to your caddie">
        <Image
          source={require('../../assets/avatars/smartplay_caddie_badge.png')}
          style={styles.badgeImg}
          resizeMode="contain"
        />
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>Cage Drill</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color="#9ca3af" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onMore} style={styles.iconBtn} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={22} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <Ionicons name={icon} size={18} color="#00C896" />
      <Text style={styles.menuLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  cameraDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6, 15, 9, 0.18)' },

  header: {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 30,
  },
  badgeBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: '#00C896',
    backgroundColor: 'rgba(6, 15, 9, 0.65)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  badgeImg: { width: 30, height: 30 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900', letterSpacing: 1.4 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(6, 15, 9, 0.65)',
    alignItems: 'center', justifyContent: 'center',
  },

  captionWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 25 },
  caption: {
    color: '#ffffff', fontSize: 15, fontWeight: '600',
    textAlign: 'center', lineHeight: 21,
    backgroundColor: 'rgba(6, 15, 9, 0.72)',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(0, 200, 150, 0.35)',
  },
  mockHint: {
    color: '#fbbf24', fontSize: 10, fontWeight: '900', letterSpacing: 1.4,
    marginTop: 6,
  },

  ctaWrap: {
    position: 'absolute', left: 16, right: 16, bottom: 0,
    alignItems: 'center', gap: 10, zIndex: 25,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00C896', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24,
    minWidth: 220,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '900' },

  recordBtn: { backgroundColor: '#ef4444' },
  recordDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ffffff' },

  voiceHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(6, 15, 9, 0.78)',
    borderColor: 'rgba(0, 200, 150, 0.45)', borderWidth: 1,
    borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12,
  },
  voiceHintText: { color: '#d1d5db', fontSize: 12, fontWeight: '600' },

  checkingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(6, 15, 9, 0.85)', borderColor: '#00C896', borderWidth: 1,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18,
  },
  checkingText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  recordingWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', gap: 18, zIndex: 25,
  },
  countdownCard: {
    backgroundColor: 'rgba(6, 15, 9, 0.85)', borderColor: '#ef4444', borderWidth: 2,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center',
  },
  countdownNum: { color: '#ffffff', fontSize: 56, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 62 },
  countdownLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginTop: 2 },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#ef4444', paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 32,
  },
  stopSquare: { width: 14, height: 14, backgroundColor: '#ffffff' },
  stopText: { color: '#ffffff', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },

  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 15, 9, 0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 40,
  },
  uploadCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 16, padding: 28, alignItems: 'center', gap: 16, maxWidth: 340,
  },
  uploadText: { color: '#ffffff', fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 21 },

  resultContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#060f09', zIndex: 45 },
  resultScroll: { flex: 1 },
  resultScrollContent: { paddingHorizontal: 16, paddingTop: 70, paddingBottom: 120 },

  kevinCard: {
    backgroundColor: '#0d2418', borderColor: '#00C896', borderWidth: 1.5,
    borderRadius: 16, padding: 16, gap: 12,
  },
  kevinHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kevinAvatar: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: '#00C896',
  },
  kevinName: { color: '#00C896', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  confidenceDot: { width: 8, height: 8, borderRadius: 4 },
  confidenceLabel: { color: '#6b7280', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  kevinResponse: { color: '#ffffff', fontSize: 16, fontWeight: '500', lineHeight: 23 },

  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 4, marginTop: 12,
  },
  detailsLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  jsonCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, padding: 14,
  },
  jsonText: { color: '#e5e7eb', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 },

  errorWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, gap: 12,
  },
  errorTitle: { color: '#ef4444', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  errorBody: { color: '#d1d5db', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },

  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  permBody: { color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 12 },

  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  menuSheet: { alignItems: 'flex-end' },
  menuCard: {
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 14, padding: 6, minWidth: 200,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  menuLabel: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
