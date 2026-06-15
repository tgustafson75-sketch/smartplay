/**
 * 2026-06-14 (Tim — 20-min "get me ready" routine) — PRE-ROUND SETUP CHECK.
 *
 * One face-on address photo → a fundamentals read (grip / stance / ball
 * position / posture), momentum-first. The highest-ROI 10-second pre-round
 * check. Camera → capture → analyzeSetup → SetupCheckCard. Front/rear flip
 * (prop the phone facing you, or have someone hold it). Honest fail-safe:
 * any error returns an honest "couldn't read it" with retake.
 *
 * SERVER-GATED: only reachable while SETUP_CHECK_ENABLED is true (flips on
 * with the bundled Vercel deploy of SETUP_SYSTEM_PROMPT). Until then the
 * route renders a "coming with the next update" notice — never a dead read.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Linking, AppState } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useTheme } from '../../contexts/ThemeContext';
import { safeBack } from '../../services/safeBack';
import { analyzeSetup, SETUP_CHECK_ENABLED, type SetupCheckResult } from '../../services/swing/setupCheck';
import SetupCheckCard from '../../components/swinglab/SetupCheckCard';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { getCaddieName } from '../../lib/persona';
import { speak, stopSpeaking } from '../../services/voiceService';
import { getApiBaseUrl } from '../../services/apiBase';

const apiUrl = getApiBaseUrl();

type Phase = 'camera' | 'analyzing' | 'result';

export default function SetupCheckScreen() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [phase, setPhase] = useState<Phase>('camera');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<SetupCheckResult | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // 2026-06-15 (Tim) — self-timer so the user can set the phone down (esp. selfie/
  // face-on, propped on a stand) and walk into their address + pre-shot routine
  // before it fires. Off / 10s / 15s. countdown != null = a capture is counting down.
  const [timerSec, setTimerSec] = useState(10);
  const [countdown, setCountdown] = useState<number | null>(null);

  const { voiceEnabled, voiceGender, language, caddiePersonality } = useSettingsStore();
  const handedness = usePlayerProfileStore((s) => s.handedness);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') { void requestCameraPermission(); }
    });
    return () => sub.remove();
  }, [requestCameraPermission]);

  // 2026-06-15 (audit) — stop any in-flight setup readout when leaving the screen so
  // it can't play over the next screen's voice (sibling of the swing-detail fix).
  useEffect(() => () => { void stopSpeaking().catch(() => undefined); }, []);

  const speakResult = useCallback(async (r: SetupCheckResult) => {
    if (!voiceEnabled || !r.valid) return;
    const parts = [r.readyNote];
    if (r.adjustment) parts.push(r.adjustment);
    const text = parts.join(' ').trim();
    if (!text) return;
    setSpeaking(true);
    try { await speak(text, voiceGender, language, apiUrl, { userInitiated: true }); }
    finally { setSpeaking(false); }
  }, [voiceEnabled, voiceGender, language]);

  const runAnalysis = useCallback(async (uri: string) => {
    setPhase('analyzing');
    const r = await analyzeSetup(uri, {
      angle: facing === 'front' ? 'face_on' : 'face_on',
      caddieName: getCaddieName(caddiePersonality),
      handedness: handedness === 'left' ? 'left' : 'right',
    });
    setResult(r);
    setPhase('result');
    void speakResult(r);
  }, [facing, caddiePersonality, handedness, speakResult]);

  const captureNow = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;
      setImageUri(photo.uri);
      void runAnalysis(photo.uri);
    } catch {
      // Honest fail-safe — show an unreadable result with retake.
      setResult({ valid: false, reason: 'Capture failed — try again.', readyNote: '', strengths: [], adjustment: null, drill: null, evidence: null });
      setPhase('result');
    }
  }, [runAnalysis]);

  // Shutter tap: start the self-timer (or capture immediately when off). Tapping
  // again while counting cancels it.
  const handleShutter = useCallback(() => {
    if (countdown != null) { setCountdown(null); return; }
    if (timerSec <= 0) { void captureNow(); return; }
    setCountdown(timerSec);
  }, [countdown, timerSec, captureNow]);

  // Drive the countdown; fire the capture at 0.
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) { setCountdown(null); void captureNow(); return; }
    const id = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [countdown, captureNow]);

  const handleReplay = useCallback(async () => {
    if (!result) return;
    if (speaking) { try { await stopSpeaking(); } catch {} setSpeaking(false); return; }
    void speakResult(result);
  }, [result, speaking, speakResult]);

  const retake = useCallback(() => { setResult(null); setImageUri(null); setPhase('camera'); }, []);

  const header = (title: string) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn}>
        <Text style={styles.headerBtnText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  // Deploy gate — feature is built but the server prompt isn't live yet.
  if (!SETUP_CHECK_ENABLED) {
    return (
      <SafeAreaView style={styles.container}>
        {header('SETUP CHECK')}
        <View style={styles.gateBox}>
          <Ionicons name="construct-outline" size={40} color="#00C896" />
          <Text style={styles.gateTitle}>Almost ready</Text>
          <Text style={styles.gateBody}>
            The pre-round Setup Check turns on with the next update. It&apos;ll read your address — grip, stance, ball position — and give you one thing to dial in before the first tee.
          </Text>
          <TouchableOpacity style={styles.gateBtn} onPress={() => safeBack()}>
            <Text style={styles.gateBtnText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!cameraPermission) {
    return (
      <SafeAreaView style={styles.container}>
        {header('SETUP CHECK')}
        <View style={styles.gateBox}>
          <ActivityIndicator color="#00C896" />
          <Text style={[styles.gateBody, { marginTop: 12 }]}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        {header('SETUP CHECK')}
        <View style={styles.gateBox}>
          <Text style={styles.gateTitle}>Camera Access</Text>
          <Text style={styles.gateBody}>Setup Check needs the camera to read your address position. The photo only leaves your device to be analyzed.</Text>
          <TouchableOpacity
            style={styles.gateBtn}
            onPress={async () => {
              if (cameraPermission && !cameraPermission.canAskAgain) { Linking.openSettings(); return; }
              await requestCameraPermission();
            }}
          >
            <Text style={styles.gateBtnText}>{cameraPermission && !cameraPermission.canAskAgain ? 'Open Settings' : 'Allow Camera'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'result' && result) {
    return (
      <SafeAreaView style={styles.container}>
        {header('SETUP CHECK')}
        {result.valid ? (
          <SetupCheckCard
            result={result}
            imageUri={imageUri}
            speaking={speaking}
            onReplay={voiceEnabled ? handleReplay : undefined}
            onTryAgain={retake}
            onDone={() => safeBack()}
          />
        ) : (
          <View style={styles.gateBox}>
            <Ionicons name="eye-off-outline" size={40} color="#9ca3af" />
            <Text style={styles.gateTitle}>Couldn&apos;t read your setup</Text>
            <Text style={styles.gateBody}>{result.reason}</Text>
            <TouchableOpacity style={styles.gateBtn} onPress={retake}>
              <Text style={styles.gateBtnText}>Retake</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // camera | analyzing
  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

      <View style={[styles.cameraTop, { top: insets.top + 8 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => safeBack()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.cameraTitle}>SETUP CHECK</Text>
        <TouchableOpacity onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} style={styles.iconBtn} disabled={phase === 'analyzing'}>
          <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Face-on framing guide — head-to-feet, square to the camera. */}
      {phase === 'camera' && countdown == null && (
        <>
          <View style={styles.guideFrame} pointerEvents="none" />
          <View style={styles.instructionBox} pointerEvents="none">
            <Text style={styles.instructionText}>
              {timerSec > 0
                ? `Tap the shutter — you get ${timerSec}s to set the phone down and take your address, face-on (head to feet in frame).`
                : 'Take your address, face-on. Get head to feet in the frame, then capture.'}
            </Text>
          </View>
        </>
      )}

      {/* Self-timer countdown — tap anywhere to cancel. */}
      {phase === 'camera' && countdown != null && (
        <TouchableOpacity style={styles.countdownOverlay} activeOpacity={1} onPress={handleShutter}>
          <Text style={styles.countdownNumber}>{countdown}</Text>
          <Text style={styles.countdownHint}>Get into your address · tap to cancel</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.cameraBottom, { paddingBottom: insets.bottom + 24 }]}>
        {phase === 'camera' ? (
          <>
            {countdown == null && (
              <View style={styles.timerRow}>
                {([0, 10, 15] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setTimerSec(s)}
                    style={[styles.timerChip, timerSec === s && styles.timerChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: timerSec === s }}
                  >
                    <Text style={[styles.timerChipText, timerSec === s && styles.timerChipTextOn]}>
                      {s === 0 ? 'No timer' : `${s}s`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity onPress={handleShutter} activeOpacity={0.85} style={styles.shutterOuter}>
              <View style={[styles.shutterInner, countdown != null && styles.shutterInnerCounting]} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.analyzingBox}>
            <ActivityIndicator color="#00C896" />
            <Text style={styles.analyzingText}>Reading your setup…</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.background,
    },
    headerBtn: { minWidth: 64 },
    headerBtnText: { color: '#00C896', fontSize: 14, fontWeight: '700' },
    headerTitle: { color: c.text_primary, fontSize: 16, fontWeight: '800' },

    gateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: c.background, gap: 14 },
    gateTitle: { color: c.text_primary, fontSize: 20, fontWeight: '800' },
    gateBody: { color: c.text_muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    gateBtn: { backgroundColor: '#00C896', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 30, marginTop: 6 },
    gateBtnText: { color: c.background, fontSize: 16, fontWeight: '800' },

    cameraTop: {
      position: 'absolute', left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
    },
    iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    cameraTitle: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.5 },

    guideFrame: {
      position: 'absolute', top: '14%', bottom: '20%', left: '18%', right: '18%',
      borderWidth: 2, borderColor: 'rgba(0,200,150,0.55)', borderRadius: 16, borderStyle: 'dashed',
    },
    instructionBox: { position: 'absolute', top: '6%', left: 24, right: 24, alignItems: 'center' },
    instructionText: {
      color: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(0,0,0,0.6)',
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, fontSize: 13, fontWeight: '600', textAlign: 'center',
    },

    cameraBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 20, backgroundColor: 'rgba(6,15,9,0.55)' },
    timerRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    timerChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.5)' },
    timerChipOn: { borderColor: '#00C896', backgroundColor: 'rgba(0,200,150,0.18)' },
    timerChipText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    timerChipTextOn: { color: '#00C896' },
    shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
    shutterInnerCounting: { backgroundColor: '#00C896' },
    countdownOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
    countdownNumber: { color: '#fff', fontSize: 120, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12 },
    countdownHint: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700', marginTop: 8 },
    analyzingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, paddingHorizontal: 22, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 14 },
    analyzingText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  });
}
