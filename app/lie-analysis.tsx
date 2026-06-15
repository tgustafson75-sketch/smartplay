import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, AppState } from 'react-native';
// 2026-05-26 — Fix CE: theme the StyleSheet so light mode renders correctly.
import { useTheme } from '../contexts/ThemeContext';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '../services/safeBack';
import { useKeepAwake } from 'expo-keep-awake';
import CourseDetailBanner from '../components/course/CourseDetailBanner';
import AnalysisResult from '../components/lieAnalysis/AnalysisResult';
import { bundleLieAnalysisContext, type PlayIntent } from '../services/lieAnalysisContext';
import {
  analyzeLie,
  enrichedLieAnalysis,
  type LieAnalysisResult,
  type LieAnalysis,
  type RiskRewardCall,
} from '../services/lieAnalysisService';
import { speak, stopSpeaking, captureUtterance, configureAudioForSpeech } from '../services/voiceService';
import { getCaddieName } from '../lib/persona';
import { useSettingsStore } from '../store/settingsStore';
// Phase 409 — persist the lie analysis onto the pending slot so the
// next logged shot carries it + the caddie brain can read it for the
// upcoming "what should I hit" question.
import { useRoundStore } from '../store/roundStore';
import { getDialog } from '../services/dialogEngine';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { getApiBaseUrl } from '../services/apiBase';

const apiUrl = getApiBaseUrl();

/**
 * Phase H — Lie Analysis Tool screen.
 *
 * Camera → capture → resize → analyze → speak → display. Voice triggers
 * (`/lie-analysis?intent=aggressive`, `?intent=conservative`, or no param)
 * arrive here via openToolHandler routing. Tap "Got it" returns to the
 * Caddie tab; tap "Try again" recaptures.
 */

type Phase = 'opener' | 'opener_listening' | 'camera' | 'analyzing' | 'result' | 'low_quality' | 'no_network' | 'error';

export default function LieAnalysisScreen() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  // 2026-05-26 — Fix CE: theme-aware styles (was hardcoded dark palette).
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ intent?: string; smartplay?: string }>();
  const playIntent: PlayIntent = (params.intent === 'aggressive' || params.intent === 'conservative') ? params.intent : null;
  // 2026-05-26 — Fix W.2: when entered via the SmartPlay voice command
  // (openToolHandler appends ?smartplay=1), start in the conversational
  // opener — caddie asks "what do you see?" and captures the player's
  // verbal context BEFORE the photo. Direct routes to /lie-analysis
  // (manual nav, intent-only voice triggers) skip the opener and land
  // straight on the camera as before — no regression for the
  // legacy/tactical path.
  const smartplayMode = params.smartplay === '1';

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // AppState listener — when the user backgrounds to grant permission in
  // Settings then returns, refresh the perm state so the UI unblocks
  // automatically. Without this, returning from Settings leaves the
  // "Allow Camera" screen stale until next forced re-render.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') { void requestCameraPermission(); }
    });
    return () => sub.remove();
  }, [requestCameraPermission]);

  const [phase, setPhase] = useState<Phase>(smartplayMode ? 'opener' : 'camera');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LieAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // 2026-05-26 — Fix W.2: captured verbal context from the SmartPlay
  // opener. Rides in LieAnalysisContext.player_notes to the vision
  // prompt. null when opener was skipped or capture failed.
  const [playerNotes, setPlayerNotes] = useState<string | null>(null);
  // 2026-05-22 — include_strategy toggle. When ON, the capture path
  // calls enrichedLieAnalysis (lie vision + acoustic prior +
  // metaCourseIntelligence risk band). When OFF (default), the
  // existing tactical-only analyzeLie path runs — same as before, no
  // regression. Persisted? Intentionally NOT — strategy depth is a
  // per-shot decision, not a profile setting.
  const [includeStrategy, setIncludeStrategy] = useState(false);
  const [riskReward, setRiskReward] = useState<RiskRewardCall | null>(null);

  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const caddiePersonality = useSettingsStore(s => s.caddiePersonality);
  const trustLevel = useTrustLevelStore(s => s.level);

  const speakAnalysis = useCallback(async (a: LieAnalysis) => {
    if (!voiceEnabled) return;
    // Phase H v2 — pick verbosity by trust level.
    // 2026-06-04 — L4 'engaged' template removed alongside L4 collapse.
    // L3 Active now inherits the engaged tone implicitly via responseMode.
    const summaryKey =
      trustLevel === 1 ? 'lie_analysis_summary_terse'
      : 'lie_analysis_summary';
    const summary = getDialog('caddie', summaryKey, {
      situation: a.situation_description,
      advice: a.tactical_advice,
    });
    const clubLine = a.recommended_club
      ? ' ' + getDialog('caddie', 'club_recommendation', { club: a.recommended_club })
      : '';
    const closer = a.conservative_call
      ? ' ' + getDialog('caddie', 'safety_call')
      : '';
    const goalLine = a.goal_aware_note
      ? ' ' + getDialog('caddie', 'goal_aware_addendum', { note: a.goal_aware_note })
      : '';
    const text = (summary + clubLine + closer + goalLine).trim();
    setSpeaking(true);
    try {
      await speak(text, voiceGender, language, apiUrl, { userInitiated: true });
    } finally {
      setSpeaking(false);
    }
  }, [voiceEnabled, voiceGender, language, trustLevel]);

  // 2026-05-26 — Fix W.2: SmartPlay conversational opener.
  // Fires ONCE on mount when smartplayMode is on. Caddie asks "What
  // do you see?" → speak() resolves → captureUtterance for ~10s
  // (silence-VAD auto-stops) → transcript → playerNotes → advance to
  // camera phase. Skip pressed (or capture fail) jumps straight to
  // camera with playerNotes left null — analysis still works, just
  // without the verbal grounding.
  const openerFiredRef = useRef(false);
  const runOpener = useCallback(async () => {
    if (openerFiredRef.current) return;
    openerFiredRef.current = true;
    const caddieName = getCaddieName(caddiePersonality);
    const prompt = `Hey, it's ${caddieName}. What do you see? Tell me your situation and I'll look at the lie with you.`;
    try {
      await configureAudioForSpeech();
      // userInitiated:true — the player launched SmartPlay via voice,
      // so this opener IS user-initiated. Without it, isVoiceAllowed
      // would silently drop on L1. [[voice-userinitiated-rule]]
      await speak(prompt, voiceGender, language, apiUrl, { userInitiated: true });
      setPhase('opener_listening');
      const heard = await captureUtterance(10_000, apiUrl, language);
      if (heard && heard.trim().length > 0) {
        setPlayerNotes(heard.trim());
      }
    } catch (e) {
      console.log('[lie-analysis] opener failed (non-fatal):', e);
    } finally {
      setPhase('camera');
    }
  }, [caddiePersonality, voiceGender, language]);

  useEffect(() => {
    if (smartplayMode && phase === 'opener') {
      void runOpener();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartplayMode]);

  const handleSkipOpener = useCallback(async () => {
    // 2026-06-15 (audit) — await the stop so the opener's TTS can't resolve + play
    // into the camera's recording audio session after the user skips.
    await stopSpeaking().catch(() => {});
    setPhase('camera');
  }, []);

  const runAnalysis = useCallback(async (uri: string) => {
    setPhase('analyzing');
    setRiskReward(null);
    try {
      // Resize to 1024px on long edge, JPEG ~75% to keep upload fast.
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const b64 = manipulated.base64;
      if (!b64) {
        setPhase('error');
        setErrorMessage('Could not encode image — try again.');
        return;
      }

      // 2026-05-22 — when "Include strategy" is toggled on, route
      // through enrichedLieAnalysis (vision + acoustic prior +
      // metaCourseIntelligence risk band). The enriched result still
      // contains the tactical LieAnalysis so we hand the same shape
      // to AnalysisResult, just with an additional riskReward overlay.
      // 2026-05-26 — Fix W.2: enriched path also threads playerNotes
      // through (still applies when smartplay opener captured context
      // AND user toggled strategy on for this shot).
      if (includeStrategy) {
        const enriched = await enrichedLieAnalysis({
          imageBase64: b64,
          imageMediaType: 'image/jpeg',
          voiceGender,
          include_strategy: true,
          player_notes: playerNotes,
        });
        setAnalysis(enriched.base);
        setRiskReward(enriched.risk_reward);
        setPhase('result');
        speakAnalysis(enriched.base);
        return;
      }

      const ctx = await bundleLieAnalysisContext(playIntent, playerNotes);
      const result: LieAnalysisResult = await analyzeLie(b64, ctx, 'image/jpeg', voiceGender);

      if (result.kind === 'ok') {
        setAnalysis(result.analysis);
        setPhase('result');
        speakAnalysis(result.analysis);
      } else if (result.kind === 'no_network') {
        setPhase('no_network');
      } else if (result.kind === 'low_quality') {
        setFollowUp(result.follow_up);
        setPhase('low_quality');
        if (voiceEnabled) {
          speak(getDialog('caddie', 'lie_low_confidence'), voiceGender, language, apiUrl).catch(() => {});
        }
      } else if (result.kind === 'too_large') {
        setErrorMessage('Image too large to send.');
        setPhase('error');
      } else {
        setErrorMessage(result.message);
        setPhase('error');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Unknown error');
      setPhase('error');
    }
  }, [playIntent, speakAnalysis, voiceEnabled, voiceGender, language, includeStrategy, playerNotes]);

  // 2026-06-07 (audit) — drain "Save for later" photos. Previously
  // handleSaveForLater copied the photo to lie_analysis_pending/ and
  // promised "I'll analyze it when you're back online", but NOTHING ever
  // read that directory back: the analysis never happened and files
  // leaked forever. On open, resume the oldest pending photo through the
  // normal analysis flow and remove it once analysis is kicked off.
  const drainedRef = useRef(false);
  useEffect(() => {
    if (drainedRef.current || imageUri) return;
    drainedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const dir = (FileSystem.documentDirectory ?? '') + 'lie_analysis_pending/';
        const info = await FileSystem.getInfoAsync(dir);
        if (!info.exists) return;
        const files = (await FileSystem.readDirectoryAsync(dir)).filter(f => f.endsWith('.jpg')).sort();
        if (files.length === 0 || cancelled) return;
        const oldest = dir + files[0];
        setImageUri(oldest);
        runAnalysis(oldest);
        // Remove once analysis is underway so it isn't re-drained; any
        // additional pending photos drain on subsequent opens.
        await FileSystem.deleteAsync(oldest, { idempotent: true });
      } catch (e) {
        console.log('[lie-analysis] drain pending failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [imageUri, runAnalysis]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;
      setImageUri(photo.uri);
      runAnalysis(photo.uri);
    } catch (e) {
      console.log('[lie-analysis] capture failed:', e);
      setErrorMessage('Capture failed — try again.');
      setPhase('error');
    }
  }, [runAnalysis]);

  const handleRetry = useCallback(() => {
    if (imageUri) {
      runAnalysis(imageUri);
    } else {
      setPhase('camera');
    }
  }, [imageUri, runAnalysis]);

  const handleSaveForLater = useCallback(async () => {
    if (!imageUri) { safeBack(); return; }
    try {
      const dir = (FileSystem.documentDirectory ?? '') + 'lie_analysis_pending/';
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const filename = dir + Date.now() + '.jpg';
      await FileSystem.copyAsync({ from: imageUri, to: filename });
    } catch (e) {
      console.log('[lie-analysis] save-for-later failed:', e);
    }
    safeBack();
  }, [imageUri]);

  const handleReplay = useCallback(async () => {
    if (!analysis) return;
    if (speaking) {
      try { await stopSpeaking(); } catch {}
      setSpeaking(false);
      return;
    }
    speakAnalysis(analysis);
  }, [analysis, speaking, speakAnalysis]);

  // Permission gate — loading state ALWAYS renders a back affordance so
  // a stalled OS dialog can never strand the user (Tim's "stuck on
  // Allow Camera" complaint).
  if (!cameraPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.permBox}>
          <ActivityIndicator color="#00C896" />
          <Text style={[styles.permText, { marginTop: 12 }]}>Checking camera permission…</Text>
          <TouchableOpacity style={styles.permLink} onPress={() => safeBack()}>
            <Text style={styles.permLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.permBox}>
          <Text style={styles.permTitle}>Camera Access</Text>
          <Text style={styles.permText}>
            TightLie needs the camera to look at your shot. The photo never leaves your device except to be analyzed.
          </Text>
          <TouchableOpacity
            style={styles.permBtn}
            onPress={async () => {
              // canAskAgain false → OS dialog won't appear; route to
              // Settings instead of silently no-opping the user's tap.
              if (cameraPermission && !cameraPermission.canAskAgain) {
                Linking.openSettings();
                return;
              }
              await requestCameraPermission();
            }}
          >
            <Text style={styles.permBtnText}>
              {cameraPermission && !cameraPermission.canAskAgain ? 'Open Settings' : 'Allow Camera'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.permLink} onPress={() => Linking.openSettings()}>
            <Text style={styles.permLinkText}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.permLink} onPress={() => safeBack()}>
            <Text style={styles.permLinkText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'result' && analysis && imageUri) {
    return (
      <SafeAreaView style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>TightLie</Text>
          <View style={styles.headerBtn} />
        </View>
        <AnalysisResult
          imageUri={imageUri}
          analysis={analysis}
          riskReward={riskReward}
          speaking={speaking}
          onReplay={handleReplay}
          onGotIt={() => {
            // Phase 409 — persist the analysis as the pending lie so
            // (a) the next shot logged carries this lie on its
            // shot.lie_analysis record (for recap + stats over time),
            // and (b) the caddie brain has the lie reality when the
            // player asks "what should I hit". The pending slot is
            // cleared by logShot once consumed; if the user re-runs
            // TightLie before logging a shot, the new analysis
            // overwrites the prior pending value (one lie per shot).
            try {
              const round = useRoundStore.getState();
              round.setPendingLieAnalysis(analysis);
            } catch (e) {
              console.log('[lie-analysis] persist pending failed (non-fatal):', e);
            }
            safeBack();
          }}
          onTryAgain={() => { setAnalysis(null); setImageUri(null); setPhase('camera'); }}
        />
      </SafeAreaView>
    );
  }

  if (phase === 'low_quality' || phase === 'no_network' || phase === 'error') {
    const title = phase === 'low_quality' ? 'Hard to read' : phase === 'no_network' ? 'No connection' : 'Something went wrong';
    const body = phase === 'low_quality'
      ? (followUp ?? 'The photo was tough to read. Try one with better light or a different angle.')
      : phase === 'no_network'
        ? "I'll save this photo and analyze it when you're back online."
        : (errorMessage ?? 'Try again in a moment.');
    return (
      <SafeAreaView style={styles.container}>
        <CourseDetailBanner />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>TightLie</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>{title}</Text>
          <Text style={styles.errorBody}>{body}</Text>
          <View style={styles.errorActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { setAnalysis(null); setImageUri(null); setPhase('camera'); }}>
              <Text style={styles.actionBtnText}>Try again</Text>
            </TouchableOpacity>
            {phase === 'no_network' && (
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={handleSaveForLater}>
                <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>Save for later</Text>
              </TouchableOpacity>
            )}
            {phase !== 'no_network' && imageUri && (
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={handleRetry}>
                <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>Re-analyze same photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // 2026-05-26 — Fix W.2: SmartPlay opener — caddie speaks "what do
  // you see?" then listens, captures verbal context, then advances
  // to camera. Hold pressed (Skip) leaves notes empty and goes
  // straight to camera. Same back affordance + cancel-safe.
  if (phase === 'opener' || phase === 'opener_listening') {
    const isListening = phase === 'opener_listening';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>SmartPlay</Text>
          <TouchableOpacity onPress={handleSkipOpener} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Skip</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.openerBody}>
          <View style={[styles.openerOrb, isListening && styles.openerOrbListening]}>
            <Text style={styles.openerOrbGlyph}>{isListening ? '◉' : '◔'}</Text>
          </View>
          <Text style={styles.openerHeadline}>
            {isListening ? 'Listening…' : 'Setting up…'}
          </Text>
          <Text style={styles.openerSub}>
            {isListening
              ? `Tell ${getCaddieName(caddiePersonality)} what you're looking at — distance, the pin, what's between you and it.`
              : `${getCaddieName(caddiePersonality)} is greeting you.`}
          </Text>
          <TouchableOpacity onPress={handleSkipOpener} style={styles.openerSkipBtn}>
            <Text style={styles.openerSkipText}>Skip to camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'camera' | 'analyzing'
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Top header */}
      <View style={[styles.cameraTop, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => safeBack()} style={styles.iconBtn}>
          <Text style={styles.iconBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.cameraTitle}>LIE ANALYSIS</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* 2026-05-26 — Fix W.2: surface the captured verbal context on
          the camera screen so the player can see what they said
          before the photo. Tap to clear. */}
      {phase === 'camera' && playerNotes && (
        <View style={[styles.playerNotesChip, { top: insets.top + 60 }]}>
          <Text style={styles.playerNotesLabel}>YOU SAID</Text>
          <Text style={styles.playerNotesText} numberOfLines={2}>
            &ldquo;{playerNotes}&rdquo;
          </Text>
          <TouchableOpacity onPress={() => setPlayerNotes(null)} hitSlop={8}>
            <Text style={styles.playerNotesClear}>clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* First-use instruction */}
      {phase === 'camera' && (
        <View style={styles.instructionBox} pointerEvents="none">
          <Text style={styles.instructionText}>Point at your lie and tap capture</Text>
        </View>
      )}

      {/* 2026-05-22 — Strategy toggle pill. ON routes capture through
          enrichedLieAnalysis (lie + acoustic prior + meta strategy
          risk band). OFF (default) keeps the tactical-only flow. */}
      {phase === 'camera' && (
        <View style={[styles.strategyToggleRow, { bottom: insets.bottom + 130 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => setIncludeStrategy(v => !v)}
            activeOpacity={0.85}
            style={[styles.strategyToggle, includeStrategy && styles.strategyToggleOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: includeStrategy }}
            accessibilityLabel="Include strategy in the lie read"
          >
            <View style={[styles.strategyDot, includeStrategy && styles.strategyDotOn]} />
            <Text style={[styles.strategyToggleText, includeStrategy && styles.strategyToggleTextOn]}>
              {includeStrategy ? 'STRATEGY ON' : 'TACTICAL ONLY'}
            </Text>
          </TouchableOpacity>
          {includeStrategy && (
            <Text style={styles.strategyHint}>
              Adds risk-band + alt play from course geometry
            </Text>
          )}
        </View>
      )}

      {/* Bottom — capture button or analyzing spinner */}
      <View style={[styles.cameraBottom, { paddingBottom: insets.bottom + 24 }]}>
        {phase === 'camera' ? (
          <TouchableOpacity onPress={handleCapture} activeOpacity={0.85} style={styles.shutterOuter}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        ) : (
          <View style={styles.analyzingBox}>
            <ActivityIndicator color="#00C896" />
            <Text style={styles.analyzingText}>Analyzing…</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// 2026-05-26 — Fix CE: themed StyleSheet via makeStyles(colors). Hex codes
// that matched dark-theme tokens are pulled from `c` so light mode renders.
function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
return StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: c.background,
  },
  headerBtn: { minWidth: 80 },
  headerBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800' },

  cameraTop: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  cameraTitle: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },

  // 2026-05-26 — Fix W.2 opener phase styles.
  openerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  openerOrb: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, borderColor: 'rgba(0, 200, 150, 0.55)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  openerOrbListening: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0, 200, 150, 0.18)',
  },
  openerOrbGlyph: { color: '#00C896', fontSize: 48, fontWeight: '700' },
  openerHeadline: {
    color: '#ffffff', fontSize: 22, fontWeight: '800', marginBottom: 8,
    letterSpacing: 0.3,
  },
  openerSub: {
    color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 21,
    textAlign: 'center', maxWidth: 320,
  },
  openerSkipBtn: { marginTop: 32, paddingVertical: 10, paddingHorizontal: 18 },
  openerSkipText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
  // Captured-verbal-context chip on the camera screen.
  playerNotesChip: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: 'rgba(6, 15, 9, 0.85)',
    borderColor: 'rgba(0, 200, 150, 0.4)', borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  playerNotesLabel: {
    color: '#00C896', fontSize: 9, fontWeight: '900', letterSpacing: 1,
  },
  playerNotesText: { color: '#ffffff', fontSize: 12, flex: 1, fontStyle: 'italic' },
  playerNotesClear: { color: '#00C896', fontSize: 11, fontWeight: '700' },
  instructionBox: {
    position: 'absolute',
    top: '40%',
    left: 0, right: 0,
    alignItems: 'center',
  },
  instructionText: {
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    fontSize: 14,
    fontWeight: '600',
  },

  // 2026-05-22 — Strategy toggle pill (above the shutter, below the
  // instruction). Distinguished from the SAFE PLAY tag in
  // AnalysisResult by living on the capture surface, not the result
  // card. Default OFF — strategy is opt-in per shot.
  strategyToggleRow: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    gap: 6,
  },
  strategyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  strategyToggleOn: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0,200,150,0.18)',
  },
  strategyDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  strategyDotOn: {
    backgroundColor: '#00C896',
  },
  strategyToggleText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11, fontWeight: '900', letterSpacing: 1.4,
  },
  strategyToggleTextOn: {
    color: '#00C896',
  },
  strategyHint: {
    color: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    fontSize: 11, fontWeight: '600',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8,
  },

  cameraBottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center', paddingTop: 20,
    backgroundColor: 'rgba(6,15,9,0.55)',
  },
  shutterOuter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 5, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#ffffff' },
  analyzingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 18, paddingHorizontal: 22,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 14,
  },
  analyzingText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: c.background },
  permTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  permText: { color: '#9ca3af', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  permBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: c.background, fontSize: 16, fontWeight: '800' },
  permLink: { marginTop: 16 },
  permLinkText: { color: '#9ca3af', fontSize: 14 },

  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: c.background },
  errorTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  errorBody: { color: '#cbd5e1', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 22 },
  errorActions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    paddingVertical: 12, paddingHorizontal: 18,
    borderWidth: 1, borderColor: c.border, borderRadius: 10,
    backgroundColor: '#0a1e12',
  },
  actionBtnPrimary: { borderColor: '#00C896', backgroundColor: '#003d20' },
  actionBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  actionBtnTextPrimary: { color: '#00C896' },
});
}
