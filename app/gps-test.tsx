/**
 * GPS Test Bench — owner-only diagnostic surface.
 *
 * The shipped GPS pipeline (gpsManager → smartFinderService → cockpit
 * data strip) has multiple layers of subscriptions, smoothing, outlier
 * rejection, and fallback. When yardages "feel wrong" on-course it's
 * impossible to tell from the cockpit alone whether GPS itself is bad,
 * the course geometry is missing, or something in the consumer chain
 * is stale.
 *
 * This screen short-circuits all of that. It shows:
 *   - Raw current fix (lat / lng / accuracy / speed / age)
 *   - A user-settable anchor coordinate
 *   - Live distance + bearing from current fix to anchor
 *
 * Workflow: open the screen, tap "Set anchor here". Walk away. The
 * distance should tick up in yards as you move. Walk back; it ticks
 * down. If the number doesn't change as you walk, GPS itself is the
 * problem (not course geometry, not the consumer chain).
 *
 * Reachable from Settings → Owner Tools → GPS Test Bench.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Share, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import {
  getLastFix as getGpsLastFix,
  getOneShotFix,
  subscribe as subscribeGps,
  type GpsFix,
} from '../services/gpsManager';
import { haversineYards } from '../utils/geoDistance';
import { startSyntheticRound, stopSyntheticRound, isSimulatedActive, subscribeToWalk, subscribeHarnessEvents, clearHarnessEvents, type MockRound, type SimulatedWalkState, type HarnessEvent } from '../services/simulatedGPS';
import { useRoundStore } from '../store/roundStore';
import { useOffCourseStore } from '../services/offCourseDetector';
import { runAuditV2 } from '../services/audit/scenarioRunner';
import type { AuditReport } from '../services/audit/types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PEBBLE_MOCK_ROUND: MockRound = require('../__mocks__/mockRound.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MENIFEE_MOCK_ROUND: MockRound = require('../__mocks__/menifeeRound.json');

interface Anchor {
  lat: number;
  lng: number;
  setAt: number;
}

function formatAge(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const λ1 = toRad(from.lng);
  const λ2 = toRad(to.lng);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx] ?? 'N';
}

export default function GpsTestScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [fix, setFix] = useState<GpsFix | null>(getGpsLastFix());
  const [tick, setTick] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [pulling, setPulling] = useState(false);
  // 2026-05-18 — Harness telemetry. Subscribes to the simulated-walk
  // emitter for per-tick state, and reads round-store scores via
  // selector for the running scorecard.
  const [walkState, setWalkState] = useState<SimulatedWalkState | null>(null);
  const [emitCount, setEmitCount] = useState(0);
  const [lastEmitMs, setLastEmitMs] = useState<number | null>(null);
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditProgress, setAuditProgress] = useState<{ msg: string; fraction: number; tally: { passed: number; failed: number } }>({ msg: '', fraction: 0, tally: { passed: 0, failed: 0 } });
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const activeCourseName = useRoundStore(s => s.activeCourse);
  const scores = useRoundStore(s => s.scores);
  const courseHoles = useRoundStore(s => s.courseHoles);
  const isOffCourse = useOffCourseStore(s => s.isOffCourse);
  const yardsToNearestHole = useOffCourseStore(s => s.yardsToNearestHole);
  // 2026-05-18 — Track every emit so the telemetry panel can show
  // sim_ticks / last_emit_age. If the simulator's setInterval is alive
  // but UI shows no progress, ticks will still climb. If ticks freeze
  // we know the interval was cleared.
  useEffect(() => {
    const unsub = subscribeToWalk((s) => {
      setWalkState(s);
      if (s) {
        setEmitCount(n => n + 1);
        setLastEmitMs(Date.now());
      }
    });
    return () => { unsub(); };
  }, []);
  useEffect(() => {
    const unsub = subscribeHarnessEvents(setEvents);
    return () => { unsub(); };
  }, []);

  // Subscribe to every accepted GPS fix from gpsManager. This is the
  // same subscription consumers like smartFinderService use, so what we
  // display here is exactly what the rest of the app receives.
  useEffect(() => {
    const unsub = subscribeGps((f) => {
      setFix(f);
      if (anchor) {
        const d = haversineYards(
          { lat: f.lat, lng: f.lng },
          { lat: anchor.lat, lng: anchor.lng },
        );
        setHistory((prev) => {
          const next = [...prev, Math.round(d)];
          return next.slice(-60);
        });
      }
    });
    return () => { unsub(); };
  }, [anchor]);

  // Tick every 1s so the "fix age" readout stays live even when no new
  // fix has arrived (helps detect a silently-dead watch).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const onRefresh = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const fresh = await getOneShotFix({ maxAgeMs: 0 });
      if (fresh) setFix(fresh);
      else Alert.alert('GPS unavailable', 'Could not pull a fresh fix. Step into open sky and try again.');
    } finally {
      setPulling(false);
    }
  }, [pulling]);

  const onSetAnchor = useCallback(() => {
    if (!fix) {
      Alert.alert('No fix', 'Wait for a GPS fix first, then set the anchor.');
      return;
    }
    setAnchor({ lat: fix.lat, lng: fix.lng, setAt: Date.now() });
    setHistory([0]);
  }, [fix]);

  const onClearAnchor = useCallback(() => {
    setAnchor(null);
    setHistory([]);
  }, []);

  const now = Date.now();
  const ageMs = fix ? now - fix.timestamp : null;
  const distYards = fix && anchor
    ? Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, { lat: anchor.lat, lng: anchor.lng }))
    : null;
  const brg = fix && anchor
    ? bearingDeg({ lat: fix.lat, lng: fix.lng }, { lat: anchor.lat, lng: anchor.lng })
    : null;
  const min = history.length > 0 ? Math.min(...history) : null;
  const max = history.length > 0 ? Math.max(...history) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text_primary }]}>GPS Test Bench</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 2026-05-19 — SYNTHETIC ROUND HARNESS is now the top section,
            wrapped in a single visually distinct bordered box with the
            two play buttons AND the live telemetry readout together so
            Tim doesn't have to scroll past anything to find both. */}
        <View style={[styles.harnessBlock, { backgroundColor: colors.surface_elevated, borderColor: colors.accent }]}>
          <View style={styles.harnessHeader}>
            <Ionicons name="flask-outline" size={18} color={colors.accent} />
            <Text style={[styles.harnessTitle, { color: colors.accent }]}>SYNTHETIC ROUND HARNESS</Text>
          </View>
          <Text style={[styles.empty, { color: colors.text_muted, marginBottom: 8 }]}>
            Pick a course to play. Only one round can run at a time. Telemetry below shows what the simulator is doing.
          </Text>

          {([
            { round: MENIFEE_MOCK_ROUND, label: 'Menifee Palms', color: '#00C896' },
            { round: PEBBLE_MOCK_ROUND, label: 'Pebble Beach', color: '#F5A623' },
          ] as const).map(({ round, label, color }) => {
            const simRunning = walkState != null;
            const isThisCourseRunning = walkState?.walk_id === `mock-round-${round.courseId}`;
            const otherCourseRunning = simRunning && !isThisCourseRunning;
            return (
              <TouchableOpacity
                key={round.courseId}
                disabled={otherCourseRunning}
                onPress={() => {
                  try {
                    if (isThisCourseRunning) {
                      stopSyntheticRound();
                      Alert.alert('Stopped', `${round.courseName} playback stopped and round discarded.`);
                    } else if (otherCourseRunning) {
                      Alert.alert('Already running', 'Stop the active synthetic round first.');
                    } else {
                      const id = startSyntheticRound(round);
                      Alert.alert(
                        'Round Started',
                        `${round.courseName} · ${round.totalHoles} holes (${id}).\n\nWatch the telemetry below for live progress.`,
                      );
                    }
                  } catch (e) {
                    const msg = e instanceof Error
                      ? `${e.name}: ${e.message}\n\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`
                      : String(e);
                    Alert.alert('Synthetic round error', msg);
                    console.log('[gps-test] synthetic round button error:', e);
                  }
                }}
                style={[
                  styles.btnPrimary,
                  {
                    backgroundColor: otherCourseRunning ? '#3a3a3a' : color,
                    marginTop: 8,
                    opacity: otherCourseRunning ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Toggle ${label} synthetic round playback`}
              >
                <Ionicons name={isThisCourseRunning ? 'stop-circle-outline' : 'play-circle-outline'} size={18} color="#000" style={{ marginRight: 6 }} />
                <Text style={styles.btnPrimaryText}>
                  {isThisCourseRunning
                    ? `Stop ${label}`
                    : otherCourseRunning
                    ? `${label} (other round active)`
                    : `Play ${label} (${round.totalHoles} holes)`}
                </Text>
              </TouchableOpacity>
            );
          })}

          {/* Telemetry — ALWAYS visible, shows "—" placeholders when
              nothing's running so Tim never wonders if the panel exists. */}
          <View style={[styles.telemetryBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.telemetryLabel, { color: colors.text_muted }]}>LIVE TELEMETRY</Text>
            <Row label="course" value={activeCourseName ?? '—'} colors={colors} />
            <Row label="round_active" value={String(isRoundActive)} colors={colors} />
            <Row label="current_hole" value={isRoundActive ? `${currentHole} / ${courseHoles.length || '?'}` : '—'} colors={colors} />
            <Row
              label="sim_emits"
              value={lastEmitMs ? `${emitCount} (${Math.round((Date.now() - lastEmitMs) / 1000)}s ago)` : `${emitCount}`}
              colors={colors}
            />
            <Row
              label="waypoint"
              value={walkState ? `${walkState.waypoint_index} → ${walkState.next_label ?? '—'}` : 'idle'}
              colors={colors}
            />
            <Row
              label="fraction_through"
              value={walkState ? walkState.fraction_through.toFixed(2) : '—'}
              colors={colors}
            />
            <Row
              label="sim_position"
              value={walkState ? `${walkState.current_lat.toFixed(5)}, ${walkState.current_lng.toFixed(5)}` : '—'}
              colors={colors}
            />
            <Row
              label="pace_mps"
              value={walkState ? walkState.pace_mps.toFixed(1) : '—'}
              colors={colors}
            />
            <Row
              label="off_course"
              value={isOffCourse ? `YES (${yardsToNearestHole ?? '?'}y from nearest)` : 'no'}
              colors={colors}
            />
            <Row
              label="scores_logged"
              value={`${Object.keys(scores).length} / ${courseHoles.length || '?'}`}
              colors={colors}
            />
            {Object.keys(scores).length > 0 ? (
              <View style={{ marginTop: 6 }}>
                <Text style={[styles.empty, { color: colors.text_muted, fontSize: 11, marginBottom: 4 }]}>
                  PER-HOLE
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(scores)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([h, s]) => {
                      const par = courseHoles.find(c => c.hole === Number(h))?.par ?? 4;
                      const offset = s - par;
                      const chipColor = offset < 0 ? '#00C896' : offset === 0 ? colors.text_primary : offset === 1 ? '#F5A623' : '#ef4444';
                      return (
                        <View key={h} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: chipColor, fontSize: 11, fontFamily: 'monospace' }}>
                            H{h}:{s}
                          </Text>
                        </View>
                      );
                    })}
                </View>
              </View>
            ) : null}
          </View>

          {/* 2026-05-19 — Live event log. Color-coded by event kind so
              Tim can see at a glance whether transitions fire, scores
              log, off-course flips, errors, etc. Shows last 20 events
              newest-on-top. */}
          <View style={[styles.telemetryBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={[styles.telemetryLabel, { color: colors.text_muted, marginBottom: 0 }]}>EVENT LOG · {events.length}</Text>
              {events.length > 0 ? (
                <TouchableOpacity onPress={() => clearHarnessEvents()} hitSlop={8}>
                  <Text style={{ color: colors.text_muted, fontSize: 11, fontWeight: '700' }}>clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {events.length === 0 ? (
              <Text style={[styles.empty, { color: colors.text_muted, fontSize: 11, paddingVertical: 4 }]}>
                No events yet. Start a synthetic round to populate.
              </Text>
            ) : (
              events.slice(-20).reverse().map((e, i) => {
                const kindColors: Record<string, string> = {
                  start: '#00C896',
                  stop: '#9ca3af',
                  walk_complete: '#00C896',
                  waypoint: '#9ca3af',
                  transition: '#F5A623',
                  score: '#3b82f6',
                  off_course: '#ef4444',
                  gps: '#9ca3af',
                  error: '#ef4444',
                };
                const c = kindColors[e.kind] ?? colors.text_primary;
                const time = new Date(e.ts).toLocaleTimeString();
                return (
                  <View key={`${e.ts}-${i}`} style={{ flexDirection: 'row', paddingVertical: 2 }}>
                    <Text style={{ color: c, fontSize: 10, fontFamily: 'monospace', width: 80 }}>
                      [{e.kind}]
                    </Text>
                    <Text style={{ color: colors.text_muted, fontSize: 10, fontFamily: 'monospace', width: 70 }}>
                      {time}
                    </Text>
                    <Text style={{ color: colors.text_primary, fontSize: 10, fontFamily: 'monospace', flex: 1 }}>
                      {e.detail}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* 2026-05-19 — Comprehensive Audit runner. Auto-executes a
              series of GPS scenarios sequentially (clean baseline,
              pace variation, fix-change propagation, yardage math
              sanity, pause/resume) and produces a structured pass/fail
              report. Atomic catch-all harness — tap once, get a JSON
              you can paste to me. */}
          <View style={[styles.telemetryBox, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}>
            <Text style={[styles.telemetryLabel, { color: colors.text_muted }]}>COMPREHENSIVE AUDIT</Text>
            <TouchableOpacity
              disabled={auditRunning}
              onPress={async () => {
                setAuditRunning(true);
                setAuditReport(null);
                setAuditProgress({ msg: 'Starting audit…', fraction: 0, tally: { passed: 0, failed: 0 } });
                try {
                  const report = await runAuditV2({
                    onProgress: (msg, fraction, tally) =>
                      setAuditProgress({ msg, fraction, tally: tally ?? { passed: 0, failed: 0 } }),
                    startMockRound: async () => {
                      const id = startSyntheticRound(MENIFEE_MOCK_ROUND);
                      return id;
                    },
                    stopMockRound: async () => {
                      stopSyntheticRound();
                    },
                    windowDims: { w: winW, h: winH },
                    platform: Platform.OS,
                  });
                  setAuditReport(report);
                  setAuditProgress({
                    msg: `Done · ${report.summary.scenarios_passed} pass / ${report.summary.scenarios_failed} fail`,
                    fraction: 1,
                    tally: {
                      passed: report.summary.assertions_passed,
                      failed: report.summary.assertions_failed,
                    },
                  });
                } catch (e) {
                  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
                  Alert.alert('Audit error', msg);
                } finally {
                  setAuditRunning(false);
                }
              }}
              style={[
                styles.btnPrimary,
                {
                  backgroundColor: auditRunning ? '#3a3a3a' : '#9333ea',
                  marginTop: 4,
                  opacity: auditRunning ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name={auditRunning ? 'hourglass-outline' : 'play-circle'} size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>
                {auditRunning ? 'Running audit…' : 'RUN FULL AUDIT (auto, ~10 min)'}
              </Text>
            </TouchableOpacity>
            {auditRunning || auditReport ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text_muted, fontSize: 11, fontFamily: 'monospace' }}>
                  {auditProgress.msg} · {Math.round(auditProgress.fraction * 100)}%
                </Text>
                <Text style={{ color: colors.text_muted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 }}>
                  ✓ {auditProgress.tally.passed} passed · ✗ {auditProgress.tally.failed} failed
                </Text>
                {auditReport ? (
                  <View style={{ marginTop: 6, gap: 4 }}>
                    {auditReport.scenarios.map(s => (
                      <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: s.overall === 'pass' ? '#00C896' : s.overall === 'warn' ? '#F5A623' : '#ef4444',
                        }} />
                        <Text style={{ color: colors.text_primary, fontSize: 11, fontFamily: 'monospace', flex: 1 }}>
                          {s.name}
                        </Text>
                        <Text style={{ color: colors.text_muted, fontSize: 10, fontFamily: 'monospace' }}>
                          {s.assertions.filter(a => a.passed).length}/{s.assertions.length}
                        </Text>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          await Share.share({
                            message: JSON.stringify(auditReport, null, 2),
                            title: `GPS Audit · ${new Date().toLocaleString()}`,
                          });
                        } catch (e) {
                          Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
                        }
                      }}
                      style={[styles.btnPrimary, { backgroundColor: '#9333ea', marginTop: 6 }]}
                    >
                      <Ionicons name="share-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                      <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>Export Audit JSON</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* 2026-05-19 — Export Report. Bundles the full harness state
              (events + scores + shots + putts + current round metadata
              + emit count + final position) into a JSON report and
              opens the native share sheet. Tim can copy/paste into our
              chat so I can see EXACTLY what happened without asking
              him to read off the event log row-by-row. */}
          <TouchableOpacity
            onPress={async () => {
              try {
                const fullEvents = events.map(e => ({
                  ts: e.ts, iso: new Date(e.ts).toISOString(), kind: e.kind, detail: e.detail,
                }));
                const round = useRoundStore.getState();
                const report = {
                  generated_at: new Date().toISOString(),
                  bundle_commit: '1024770', // matches latest at write time
                  walk_state: walkState,
                  emit_count: emitCount,
                  last_emit_ms: lastEmitMs,
                  last_emit_age_s: lastEmitMs ? Math.round((Date.now() - lastEmitMs) / 1000) : null,
                  off_course: isOffCourse,
                  yards_to_nearest_hole: yardsToNearestHole,
                  round: {
                    isRoundActive,
                    currentHole,
                    activeCourse: activeCourseName,
                    courseHolesCount: courseHoles.length,
                    scores,
                    putts: round.putts,
                    shotsCount: round.shots.length,
                    shots: round.shots.map(s => ({
                      hole: s.hole, club: s.club, feel: s.feel, direction: s.direction,
                      shape: s.shape, distance_yards: s.distance_yards,
                      shot_in_hole_index: s.shot_in_hole_index, ts: s.timestamp,
                    })),
                  },
                  events: fullEvents,
                };
                const json = JSON.stringify(report, null, 2);
                await Share.share({
                  message: json,
                  title: `Harness report · ${new Date().toLocaleString()}`,
                });
              } catch (e) {
                Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
              }
            }}
            style={[styles.btnPrimary, { backgroundColor: '#3b82f6', marginTop: 10 }]}
            accessibilityRole="button"
            accessibilityLabel="Export harness report as JSON"
          >
            <Ionicons name="share-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>Export Harness Report</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.hint, { color: colors.text_muted }]}>
          Set the anchor at a known spot, then walk. Distance should tick up as you move away and down as you come back. If it never moves, GPS itself is the problem — not course geometry, not the consumer chain.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>CURRENT FIX</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {fix == null ? (
            <Text style={[styles.empty, { color: colors.text_muted }]}>No fix yet. Tap Refresh.</Text>
          ) : (
            <>
              <Row label="Lat" value={fix.lat.toFixed(6)} colors={colors} />
              <Row label="Lng" value={fix.lng.toFixed(6)} colors={colors} />
              <Row
                label="Accuracy"
                value={fix.accuracy_m != null ? `±${fix.accuracy_m.toFixed(1)}m` : 'unknown'}
                colors={colors}
              />
              <Row
                label="Speed"
                value={fix.speed != null && fix.speed >= 0
                  ? `${(fix.speed * 2.237).toFixed(1)} mph`
                  : '—'}
                colors={colors}
              />
              <Row
                label="Age"
                value={ageMs != null ? formatAge(ageMs) : '—'}
                emphasis={ageMs != null && ageMs > 15_000 ? 'warn' : 'normal'}
                colors={colors}
              />
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={onRefresh}
          disabled={pulling}
          style={[styles.btnPrimary, { backgroundColor: colors.accent, opacity: pulling ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Refresh GPS fix"
        >
          <Ionicons name="refresh" size={18} color="#000" style={{ marginRight: 6 }} />
          <Text style={styles.btnPrimaryText}>{pulling ? 'Pulling…' : 'Refresh GPS'}</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 24 }]}>ANCHOR</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {anchor == null ? (
            <Text style={[styles.empty, { color: colors.text_muted }]}>No anchor set.</Text>
          ) : (
            <>
              <Row label="Anchor Lat" value={anchor.lat.toFixed(6)} colors={colors} />
              <Row label="Anchor Lng" value={anchor.lng.toFixed(6)} colors={colors} />
              <Row label="Set" value={formatAge(now - anchor.setAt) + ' ago'} colors={colors} />
            </>
          )}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            onPress={onSetAnchor}
            style={[styles.btnSecondary, { borderColor: colors.accent, flex: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Set anchor at current GPS position"
          >
            <Ionicons name="locate" size={16} color={colors.accent} style={{ marginRight: 6 }} />
            <Text style={[styles.btnSecondaryText, { color: colors.accent }]}>
              {anchor == null ? 'Set anchor here' : 'Reset to here'}
            </Text>
          </TouchableOpacity>
          {anchor != null && (
            <TouchableOpacity
              onPress={onClearAnchor}
              style={[styles.btnSecondary, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Clear anchor"
            >
              <Text style={[styles.btnSecondaryText, { color: colors.text_muted }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {anchor != null && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 24 }]}>DISTANCE TO ANCHOR</Text>
            <View style={[styles.card, styles.bigCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
              <Text style={[styles.bigYards, { color: colors.accent }]}>
                {distYards != null ? distYards : '—'}
                <Text style={[styles.bigYardsUnit, { color: colors.text_muted }]}> yds</Text>
              </Text>
              {brg != null && (
                <Text style={[styles.bearing, { color: colors.text_muted }]}>
                  Bearing {Math.round(brg)}° {compassLabel(brg)}
                </Text>
              )}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.text_muted, marginTop: 16 }]}>
              SAMPLES ({history.length})
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Row label="Last 60 samples min" value={min != null ? `${min} yds` : '—'} colors={colors} />
              <Row label="Last 60 samples max" value={max != null ? `${max} yds` : '—'} colors={colors} />
              <Row
                label="Range"
                value={min != null && max != null ? `${max - min} yds` : '—'}
                emphasis={min != null && max != null && (max - min) >= 10 ? 'good' : 'normal'}
                colors={colors}
              />
              <Text style={[styles.bodyHint, { color: colors.text_muted }]}>
                If range stays under ~5 yards while you walk a long distance, fixes are NOT arriving. If range tracks your actual walking distance roughly, GPS is alive.
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  emphasis = 'normal',
  colors,
}: {
  label: string;
  value: string;
  emphasis?: 'normal' | 'warn' | 'good';
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const valueColor =
    emphasis === 'warn' ? '#ef4444' :
    emphasis === 'good' ? colors.accent :
    colors.text_primary;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.text_muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', letterSpacing: 0.2 },
  body: { padding: 16 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  // 2026-05-19 — Synthetic harness block: visually distinct container
  // that groups the play buttons + live telemetry together at the top
  // of the GPS Test Bench. Accent-colored border + flask icon header
  // so Tim doesn't have to hunt for the telemetry — it's part of the
  // same prominent box as the play buttons.
  harnessBlock: {
    borderRadius: 14,
    borderWidth: 2,
    padding: 14,
    marginBottom: 20,
  },
  harnessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  harnessTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  telemetryBox: {
    marginTop: 14,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  telemetryLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  bodyHint: { fontSize: 11, lineHeight: 16, marginTop: 8, fontStyle: 'italic' },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bigCard: { alignItems: 'center', paddingVertical: 22 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontSize: 13, fontWeight: '600' },
  rowValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  empty: { fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 12,
  },
  btnPrimaryText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  btnSecondaryText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  bigYards: { fontSize: 56, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  bigYardsUnit: { fontSize: 18, fontWeight: '700' },
  bearing: { fontSize: 13, fontWeight: '600', marginTop: 6 },
});
