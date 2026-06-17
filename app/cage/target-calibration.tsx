/**
 * Cage Target Calibration — acoustic dataset builder.
 *
 * Flow per shot:
 *   1. LISTENING  — impact recorder running. Shows dim target + "Hit a shot".
 *   2. CONFIRMING — impact detected. Shows active target + "Tap where it hit".
 *   3. SAVED      — position recorded. Shows the dot, brief confirm, then
 *                   auto-returns to LISTENING for the next shot.
 *
 * Each confirmed shot saves a CageTargetSample (wavUri + hitX/hitY + peakDb)
 * to acousticCalibrationStore.targetSamples. After 5+ samples a scatter plot
 * appears so Tim can see his distribution.
 *
 * The resulting dataset can be batch-sent to /api/acoustic-detect for
 * server-side spectral analysis to find canvas-center vs canvas-edge vs net
 * discriminating features.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { CageTargetUI } from '../../components/cage/CageTargetUI';
import type { HitPosition } from '../../components/cage/CageTargetUI';
import {
  startImpactRecording,
  stopAndDetectImpact,
} from '../../services/acousticImpactDetector';
import {
  useAcousticCalibrationStore,
  type CageTargetSample,
  type TargetHitType,
} from '../../store/acousticCalibrationStore';

type Phase = 'idle' | 'listening' | 'confirming' | 'saved';

const CAGE_WIDTH_FT = 10;
const CAGE_HEIGHT_FT = 10;
const CANVAS_SIZE_FT = 3;

// Minimum samples before showing the scatter plot
const SCATTER_MIN = 5;

const HIT_TYPE_LABEL: Record<TargetHitType, string> = {
  canvas_center: 'Canvas — Center',
  canvas_edge: 'Canvas — Edge',
  net: 'Net',
};

const HIT_TYPE_COLOR: Record<TargetHitType, string> = {
  canvas_center: '#00C896',
  canvas_edge: '#f59e0b',
  net: '#ef4444',
};

export default function CageTargetCalibration() {
  const router = useRouter();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>('idle');
  const [lastPeakDb, setLastPeakDb] = useState<number | null>(null);
  const [lastWavUri, setLastWavUri] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<HitPosition | null>(null);
  const recordingRef = useRef(false);

  const { targetSamples, addTargetSample } = useAcousticCalibrationStore();

  // ── Scatter plot: build canvas-space dots from samples ──────────────────
  const dots = targetSamples.filter(s => s.hitType !== 'net' && s.hitX != null && s.hitY != null);

  // ── Start listening for next shot ────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setPhase('listening');
    setPendingSave(null);

    const started = await startImpactRecording({
      mode: 'single-shot',
      onImpactDetected: () => {
        // Impact fired — stop recording and move to confirming
        void stopAndDetectImpact().then(reading => {
          recordingRef.current = false;
          setLastPeakDb(reading?.peak_db ?? -999);
          setLastWavUri(reading?.audio_uri ?? null);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setPhase('confirming');
        });
      },
    });

    if (!started) {
      recordingRef.current = false;
      setPhase('idle');
    }
  }, []);

  // ── User taps target ─────────────────────────────────────────────────────
  const handleTargetTap = useCallback((pos: HitPosition) => {
    if (phase !== 'confirming') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingSave(pos);
  }, [phase]);

  // ── Confirm and save ─────────────────────────────────────────────────────
  const confirmSave = useCallback(() => {
    if (!pendingSave) return;
    addTargetSample({
      wavUri: lastWavUri,
      peakDb: lastPeakDb ?? -999,
      impactMs: 0,
      hitType: pendingSave.hitType,
      hitX: pendingSave.hitX,
      hitY: pendingSave.hitY,
      cage: {
        widthFt: CAGE_WIDTH_FT,
        heightFt: CAGE_HEIGHT_FT,
        canvasSizeFt: CANVAS_SIZE_FT,
      },
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase('saved');
    // Auto-advance to next shot after 1.2s
    setTimeout(() => { void startListening(); }, 1200);
  }, [pendingSave, lastWavUri, lastPeakDb, addTargetSample, startListening]);

  // ── Skip (re-tap) ────────────────────────────────────────────────────────
  const retap = useCallback(() => {
    setPendingSave(null);
  }, []);

  // ── Discard current shot (bad acoustic) ─────────────────────────────────
  const discardShot = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void startListening();
  }, [startListening]);

  // Start on mount
  useEffect(() => { void startListening(); }, [startListening]);

  // Cleanup on unmount — stop any running recorder
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        void stopAndDetectImpact().catch(() => {});
        recordingRef.current = false;
      }
    };
  }, []);

  const sessionCount = targetSamples.length;
  const canvasCount = targetSamples.filter(s => s.hitType !== 'net').length;
  const netCount = targetSamples.filter(s => s.hitType === 'net').length;
  const centerCount = targetSamples.filter(s => s.hitType === 'canvas_center').length;

  const SCATTER_SIZE = 200;
  const CANVAS_RATIO = CANVAS_SIZE_FT / CAGE_WIDTH_FT;
  const scatterCanvasPx = SCATTER_SIZE * CANVAS_RATIO;
  const scatterCanvasOffset = (SCATTER_SIZE - scatterCanvasPx) / 2;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>Target Calibration</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Status bar */}
        <View style={[styles.statusBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.statusCount, { color: colors.text_primary }]}>{sessionCount}</Text>
          <Text style={[styles.statusLabel, { color: colors.text_secondary }]}>shots logged</Text>
          <View style={styles.statusDivider} />
          <View style={[styles.statusDot, { backgroundColor: '#00C896' }]} />
          <Text style={[styles.statusLabel, { color: colors.text_secondary }]}>{centerCount} center</Text>
          <View style={styles.statusDivider} />
          <View style={[styles.statusDot, { backgroundColor: '#f59e0b' }]} />
          <Text style={[styles.statusLabel, { color: colors.text_secondary }]}>{canvasCount - centerCount} edge</Text>
          <View style={styles.statusDivider} />
          <View style={[styles.statusDot, { backgroundColor: '#ef4444' }]} />
          <Text style={[styles.statusLabel, { color: colors.text_secondary }]}>{netCount} net</Text>
        </View>

        {/* Phase instruction */}
        <View style={styles.instructionWrap}>
          {phase === 'listening' && (
            <>
              <View style={[styles.listeningPulse, { borderColor: colors.accent }]} />
              <Text style={[styles.instruction, { color: colors.text_primary }]}>Hit a shot</Text>
              <Text style={[styles.instructionSub, { color: colors.text_secondary }]}>
                Listening for impact…
              </Text>
            </>
          )}
          {phase === 'confirming' && !pendingSave && (
            <>
              <Text style={[styles.instruction, { color: colors.text_primary }]}>Tap where it hit</Text>
              <Text style={[styles.instructionSub, { color: colors.text_secondary }]}>
                Peak: {lastPeakDb != null ? `${lastPeakDb.toFixed(1)} dBFS` : '—'}
              </Text>
            </>
          )}
          {phase === 'confirming' && pendingSave && (
            <>
              <Text style={[styles.instruction, { color: HIT_TYPE_COLOR[pendingSave.hitType] }]}>
                {HIT_TYPE_LABEL[pendingSave.hitType]}
              </Text>
              <Text style={[styles.instructionSub, { color: colors.text_secondary }]}>
                {pendingSave.hitType !== 'net'
                  ? `x ${(pendingSave.hitX ?? 0).toFixed(2)}  y ${(pendingSave.hitY ?? 0).toFixed(2)}`
                  : 'Outside canvas'}
              </Text>
            </>
          )}
          {phase === 'saved' && (
            <Text style={[styles.instruction, { color: '#00C896' }]}>Saved ✓</Text>
          )}
          {phase === 'idle' && (
            <Text style={[styles.instructionSub, { color: colors.text_secondary }]}>
              Tap Start to begin
            </Text>
          )}
        </View>

        {/* Target UI */}
        <View style={styles.targetWrap}>
          <CageTargetUI
            onHit={handleTargetTap}
            disabled={phase !== 'confirming'}
            size={260}
            cageFt={CAGE_WIDTH_FT}
            canvasFt={CANVAS_SIZE_FT}
          />
        </View>

        {/* Confirm / retap / discard row */}
        {phase === 'confirming' && (
          <View style={styles.actionRow}>
            {pendingSave ? (
              <>
                <Pressable style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={retap}>
                  <Text style={[styles.actionBtnText, { color: colors.text_secondary }]}>Re-tap</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, { backgroundColor: '#00C896' }]} onPress={confirmSave}>
                  <Text style={[styles.actionBtnText, { color: '#000' }]}>Save shot</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={[styles.actionBtn, styles.actionBtnSecondary]} onPress={discardShot}>
                <Text style={[styles.actionBtnText, { color: colors.text_secondary }]}>Discard / retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {phase === 'idle' && (
          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: colors.accent }]}
            onPress={() => { void startListening(); }}
          >
            <Text style={styles.startBtnText}>Start</Text>
          </TouchableOpacity>
        )}

        {/* Scatter plot — shows once enough samples exist */}
        {dots.length >= SCATTER_MIN && (
          <View style={[styles.scatterCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.scatterTitle, { color: colors.text_primary }]}>
              Hit distribution ({dots.length} canvas shots)
            </Text>
            <View style={[styles.scatterWrap, { width: SCATTER_SIZE, height: SCATTER_SIZE }]}>
              {/* Net background */}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1a4a1a', borderRadius: 6 }]} />
              {/* Canvas area */}
              <View style={{
                position: 'absolute',
                left: scatterCanvasOffset,
                top: scatterCanvasOffset,
                width: scatterCanvasPx,
                height: scatterCanvasPx,
                backgroundColor: '#f5f0e8',
                borderWidth: 1.5,
                borderColor: '#d4c9a8',
              }}>
                {/* Center crosshair */}
                <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(0,0,0,0.12)' }} />
                <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(0,0,0,0.12)' }} />
              </View>
              {/* Dots */}
              {(dots as CageTargetSample[]).map(dot => {
                const px = scatterCanvasOffset + scatterCanvasPx / 2 + (dot.hitX ?? 0) * scatterCanvasPx / 2;
                const py = scatterCanvasOffset + scatterCanvasPx / 2 - (dot.hitY ?? 0) * scatterCanvasPx / 2;
                return (
                  <View
                    key={dot.id}
                    style={{
                      position: 'absolute',
                      left: px - 4,
                      top: py - 4,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: HIT_TYPE_COLOR[dot.hitType],
                      opacity: 0.85,
                    }}
                  />
                );
              })}
            </View>
            <Text style={[styles.scatterSub, { color: colors.text_secondary }]}>
              {centerCount} center · {canvasCount - centerCount} edge · {netCount} net
            </Text>
          </View>
        )}

        {/* Footer hint */}
        <Text style={[styles.footerHint, { color: colors.text_secondary }]}>
          Each shot saves the WAV + your confirmed location for spectral pattern analysis.
          {'\n'}Aim for 10+ canvas hits and 5+ net hits for a useful dataset.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 20 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  statusCount: { fontSize: 22, fontWeight: '800' },
  statusLabel: { fontSize: 12, fontWeight: '500' },
  statusDivider: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  instructionWrap: { alignItems: 'center', gap: 4, minHeight: 54 },
  instruction: { fontSize: 20, fontWeight: '800' },
  instructionSub: { fontSize: 13, fontWeight: '500' },
  listeningPulse: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 2, marginBottom: 2,
  },

  targetWrap: { alignItems: 'center' },

  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnSecondary: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  actionBtnText: { fontSize: 15, fontWeight: '700' },

  startBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  startBtnText: { fontSize: 16, fontWeight: '800', color: '#000' },

  scatterCard: {
    borderRadius: 12, borderWidth: 1, padding: 16,
    alignItems: 'center', gap: 12,
  },
  scatterTitle: { fontSize: 14, fontWeight: '700' },
  scatterWrap: { borderRadius: 6, overflow: 'hidden' },
  scatterSub: { fontSize: 12, fontWeight: '500' },

  footerHint: { fontSize: 12, lineHeight: 18, textAlign: 'center', opacity: 0.7 },
});
