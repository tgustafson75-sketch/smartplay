/**
 * Phase 416 — SmartMotion Quick Record.
 *
 * Minimal camera screen for SmartMotion's Record button. Single-tap
 * entry to capture — no checklist, no setup screen, no detour. Opens
 * the camera immediately, records a swing on Record tap, and routes
 * back to /swinglab/smartmotion?clipUri=<recorded-uri> when done.
 *
 * Architectural call: replaces the prior /camera-setup → /cage-drill
 * detour for the SmartMotion entry point. cage-drill stays put for
 * the longer cage-session flow (multi-swing, drill recommendation
 * follow-ups); this is the dedicated single-swing on-ramp Tim asked
 * for ("simple, intuitive, quick load, camera opens immediately").
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useTheme } from '../../contexts/ThemeContext';

const MAX_RECORD_SECONDS = 8;

export default function QuickRecord() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!camPerm) void requestCamPerm();
    if (!micPerm) void requestMicPerm();
    // request permissions on mount; intentionally one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleRecord = async () => {
    if (recording) {
      try { cameraRef.current?.stopRecording(); } catch {}
      return;
    }
    if (!cameraRef.current) return;
    setElapsed(0);
    setRecording(true);
    timerRef.current = setInterval(() => {
      setElapsed(e => {
        if (e + 1 >= MAX_RECORD_SECONDS) {
          try { cameraRef.current?.stopRecording(); } catch {}
        }
        return e + 1;
      });
    }, 1000);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_RECORD_SECONDS });
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRecording(false);
      setElapsed(0);
      const uri = (result as { uri?: string } | undefined)?.uri ?? null;
      if (uri) {
        router.replace({
          pathname: '/swinglab/smartmotion',
          params: { clipUri: uri },
        } as never);
      }
    } catch (e) {
      console.log('[quick-record] recordAsync failed:', e);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRecording(false);
      setElapsed(0);
    }
  };

  // Permission gate
  if (!camPerm || !micPerm) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]}>
        <View style={styles.permView}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.permText, { color: '#fff' }]}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!camPerm.granted || !micPerm.granted) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: '#000' }]}>
        <View style={styles.permView}>
          <Ionicons name="videocam-off-outline" size={40} color={colors.accent} />
          <Text style={[styles.permTitle, { color: '#fff' }]}>Camera + Mic Access</Text>
          <Text style={[styles.permText, { color: '#9ca3af' }]}>
            SmartMotion records your swing for analysis. Both stay on your phone.
          </Text>
          <TouchableOpacity
            style={[styles.permBtn, { backgroundColor: colors.accent }]}
            onPress={async () => {
              if (!camPerm.granted) {
                if (camPerm.canAskAgain) await requestCamPerm();
                else Linking.openSettings();
              }
              if (!micPerm.granted) {
                if (micPerm.canAskAgain) await requestMicPerm();
                else Linking.openSettings();
              }
            }}
          >
            <Text style={[styles.permBtnText, { color: '#060f09' }]}>
              {camPerm.canAskAgain && micPerm.canAskAgain ? 'Grant Permissions' : 'Open Settings'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={styles.permCancel}>
            <Text style={[styles.permCancelText, { color: '#9ca3af' }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
        videoQuality="720p"
      />

      {/* Top bar — back + flip camera */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.topBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.elapsedPill}>
          <View style={[styles.recDot, { opacity: recording ? 1 : 0.3 }]} />
          <Text style={styles.elapsedText}>{recording ? `${elapsed}s / ${MAX_RECORD_SECONDS}s` : 'Ready'}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
          style={styles.topBtn}
          disabled={recording}
        >
          <Ionicons name="camera-reverse" size={26} color={recording ? '#666' : '#fff'} />
        </TouchableOpacity>
      </View>

      {/* Bottom — big record button */}
      <View style={[styles.bottomArea, { bottom: insets.bottom + 24 }]}>
        <Text style={styles.hint}>
          {recording ? 'Tap to stop' : 'Frame the swing · phone vertical · stable mount'}
        </Text>
        <TouchableOpacity
          onPress={handleRecord}
          style={[
            styles.recordOuter,
            { borderColor: recording ? '#ef4444' : '#ffffff' },
          ]}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        >
          <View style={[
            styles.recordInner,
            recording
              ? { backgroundColor: '#ef4444', borderRadius: 6, width: 32, height: 32 }
              : { backgroundColor: '#ef4444', borderRadius: 28, width: 56, height: 56 },
          ]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 10,
  },
  topBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  elapsedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  elapsedText: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  bottomArea: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', gap: 14,
  },
  hint: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  recordOuter: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 4, alignItems: 'center', justifyContent: 'center',
  },
  recordInner: { /* dynamic */ },
  permView: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permTitle: { fontSize: 20, fontWeight: '900' },
  permText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  permBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 12 },
  permBtnText: { fontSize: 14, fontWeight: '900' },
  permCancel: { padding: 12, marginTop: 4 },
  permCancelText: { fontSize: 13, fontWeight: '600' },
});
