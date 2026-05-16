import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, AppState } from 'react-native';
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
import { analyzeLie, type LieAnalysisResult, type LieAnalysis } from '../services/lieAnalysisService';
import { speak, stopSpeaking } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
// Phase 409 — persist the lie analysis onto the pending slot so the
// next logged shot carries it + the caddie brain can read it for the
// upcoming "what should I hit" question.
import { useRoundStore } from '../store/roundStore';
import { getDialog } from '../services/dialogEngine';
import { useTrustLevelStore } from '../store/trustLevelStore';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';

/**
 * Phase H — Lie Analysis Tool screen.
 *
 * Camera → capture → resize → analyze → speak → display. Voice triggers
 * (`/lie-analysis?intent=aggressive`, `?intent=conservative`, or no param)
 * arrive here via openToolHandler routing. Tap "Got it" returns to the
 * Caddie tab; tap "Try again" recaptures.
 */

type Phase = 'camera' | 'analyzing' | 'result' | 'low_quality' | 'no_network' | 'error';

export default function LieAnalysisScreen() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ intent?: string }>();
  const playIntent: PlayIntent = (params.intent === 'aggressive' || params.intent === 'conservative') ? params.intent : null;

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

  const [phase, setPhase] = useState<Phase>('camera');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<LieAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const { voiceEnabled, voiceGender, language } = useSettingsStore();
  const trustLevel = useTrustLevelStore(s => s.level);

  const speakAnalysis = useCallback(async (a: LieAnalysis) => {
    if (!voiceEnabled) return;
    // Phase H v2 — pick verbosity by trust level.
    const summaryKey =
      trustLevel === 1 ? 'lie_analysis_summary_terse'
      : trustLevel === 4 ? 'lie_analysis_summary_engaged'
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
      await speak(text, voiceGender, language, apiUrl);
    } finally {
      setSpeaking(false);
    }
  }, [voiceEnabled, voiceGender, language, trustLevel]);

  const runAnalysis = useCallback(async (uri: string) => {
    setPhase('analyzing');
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
      const ctx = await bundleLieAnalysisContext(playIntent);
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
  }, [playIntent, speakAnalysis, voiceEnabled, voiceGender, language]);

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

      {/* First-use instruction */}
      {phase === 'camera' && (
        <View style={styles.instructionBox} pointerEvents="none">
          <Text style={styles.instructionText}>Point at your lie and tap capture</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#060f09',
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

  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#060f09' },
  permTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  permText: { color: '#9ca3af', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  permBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  permBtnText: { color: '#060f09', fontSize: 16, fontWeight: '800' },
  permLink: { marginTop: 16 },
  permLinkText: { color: '#9ca3af', fontSize: 14 },

  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#060f09' },
  errorTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginBottom: 12 },
  errorBody: { color: '#cbd5e1', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 22 },
  errorActions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    paddingVertical: 12, paddingHorizontal: 18,
    borderWidth: 1, borderColor: '#1e3a28', borderRadius: 10,
    backgroundColor: '#0a1e12',
  },
  actionBtnPrimary: { borderColor: '#00C896', backgroundColor: '#003d20' },
  actionBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '700' },
  actionBtnTextPrimary: { color: '#00C896' },
});
