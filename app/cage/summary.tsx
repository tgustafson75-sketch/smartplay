/**
 * app/cage/summary.tsx — CageSession Summary
 *
 * Reads the most recently completed session from cageStore.sessionHistory.
 * Posts to /api/cage-caddie for an AI coaching summary on mount.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Modal,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Rect } from 'react-native-svg';
import { useCageStore } from '../../store/cageStore';
import type { ShotFeel, ShotShape, CageShot } from '../../store/cageStore';
import { getApiBaseUrl } from '../../utils/apiUrl';
import { detectPatterns } from '../../services/cagePattern';
import { speakJob, PRIORITY } from '../../services/voice';
import { useSettingsStore } from '../../store/settingsStore';

// ── Constants ──────────────────────────────────────────────────────────────

const BG      = '#060f09';
const ACCENT  = '#00C896';
const SURFACE = '#0e2018';
const BORDER  = '#1c3a28';
const WHITE   = '#FFFFFF';
const BAR_H   = 14;
const MAX_BAR = 200; // px — max bar width

const SHAPES: ShotShape[] = ['pull', 'draw', 'straight', 'fade', 'push'];
const FEELS:  ShotFeel[]  = ['flush', 'thin', 'fat', 'shank'];

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Duration helper ────────────────────────────────────────────────────────

function durationMin(startTime: number, endTime: number | null): number {
  const end = endTime ?? Date.now();
  return Math.max(1, Math.round((end - startTime) / 60000));
}

// ── Bar chart row ──────────────────────────────────────────────────────────

function BarRow({
  label,
  count,
  total,
  isDominant,
}: {
  label: string;
  count: number;
  total: number;
  isDominant: boolean;
}) {
  const width = total > 0 ? Math.round((count / total) * MAX_BAR) : 0;
  const fillColor = isDominant ? ACCENT : '#3a5a4a';

  return (
    <View style={barStyles.row}>
      <Text style={barStyles.rowLabel}>{label}</Text>
      <View style={barStyles.track}>
        <Svg width={MAX_BAR} height={BAR_H}>
          <Rect x={0} y={0} width={MAX_BAR} height={BAR_H} rx={BAR_H / 2} fill="#1c3a28" />
          {width > 0 && (
            <Rect x={0} y={0} width={width} height={BAR_H} rx={BAR_H / 2} fill={fillColor} />
          )}
        </Svg>
      </View>
      <Text style={barStyles.rowCount}>{count}</Text>
    </View>
  );
}

const barStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },
  rowLabel: {
    color: WHITE,
    fontSize: 13,
    width: 70,
  },
  track: {
    flex: 1,
  },
  rowCount: {
    color: '#8cb8a2',
    fontSize: 13,
    width: 24,
    textAlign: 'right',
  },
});

// ── Main screen ────────────────────────────────────────────────────────────

export default function CageSummary() {
  const router          = useRouter();
  const sessionHistory  = useCageStore((s) => s.sessionHistory);
  const getClubProfile  = useCageStore((s) => s.getClubProfile);

  // Most recently completed session is always at index 0 (prepended in endSession)
  const session = sessionHistory[0] ?? null;

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Golf Fix review state ─────────────────────────────────────────────────
  const [showGolfFixSheet,  setShowGolfFixSheet]  = useState(false);
  const [golfFixLoading,    setGolfFixLoading]    = useState(false);
  const [golfFixReply,      setGolfFixReply]      = useState<string | null>(null);

  // ── AI coaching summary on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function fetchSummary() {
      setAiLoading(true);
      try {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/cage-caddie`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            club:          session!.club,
            feel:          null,
            shape:         null,
            shotNumber:    session!.shots.length,
            goal:          session!.goal ?? null,
            recentPattern: null,
            isSummary:     true,
            shots:         session!.shots.map((s) => ({
              club:  s.club,
              feel:  s.feel,
              shape: s.shape,
            })),
            cageMode: (session!.devices?.watch || session!.devices?.glasses) ? 'multi-device' : 'camera-only',
          }),
        });
        const data = await res.json();
        if (!cancelled) setAiSummary(data.message ?? null);
      } catch {
        if (!cancelled) setAiSummary('Coaching summary unavailable.');
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }

    void fetchSummary();
    return () => { cancelled = true; };
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Golf Fix question handler ─────────────────────────────────────────────
  const handleGolfFixQuestion = useCallback(async (question: string) => {
    if (!session) return;
    setGolfFixLoading(true);
    setShowGolfFixSheet(false);
    setGolfFixReply(null);
    try {
      const pattern = detectPatterns(session.shots, session.club as string | null);
      const shotHistory = session.shots.map((s) => ({
        club: s.club,
        feel: s.feel,
        shape: s.shape,
        aiAnalysis: s.aiAnalysis ?? null,
      }));
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/cage-caddie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          club: session.club,
          feel: null,
          shape: null,
          shotNumber: session.shots.length,
          goal: session.goal ?? null,
          recentPattern: pattern,
          isSummary: false,
          shots: null,
          cageMode: 'multi-device',
          isVoiceQuery: true,
          voiceTranscript: question,
          shotHistory,
        }),
      });
      const data = res.ok ? await res.json() : null;
      const reply = data?.message ?? 'Great session. Keep working on it.';
      setGolfFixReply(reply);
      const gender = useSettingsStore.getState().voiceGender ?? 'male';
      await speakJob(reply, PRIORITY.STRATEGY, gender as 'male' | 'female', () => {});
    } catch {
      setGolfFixReply('Great session. Keep building those reps.');
    } finally {
      setGolfFixLoading(false);
    }
  }, [session]);

  // ── No session guard ──────────────────────────────────────────────────────
  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No completed session found.</Text>
          <Pressable onPress={() => router.push('/cage' as any)} style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>Start One</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const shots     = session.shots;
  const total     = shots.length;
  const duration  = durationMin(session.startTime, session.endTime);

  // Shape counts
  const shapeCounts = Object.fromEntries(
    SHAPES.map((s) => [s, shots.filter((sh) => sh.shape === s).length]),
  ) as Record<ShotShape, number>;
  const dominantShape = SHAPES.reduce((a, b) =>
    shapeCounts[a] >= shapeCounts[b] ? a : b,
  );

  // Feel counts
  const feelCounts = Object.fromEntries(
    FEELS.map((f) => [f, shots.filter((sh) => sh.feel === f).length]),
  ) as Record<ShotFeel, number>;
  const dominantFeel = FEELS.reduce((a, b) =>
    feelCounts[a] >= feelCounts[b] ? a : b,
  );

  // Club profile status
  const profile      = getClubProfile(session.club);
  const totalCageShots = profile?.shotCount ?? total;
  const MIN_SHOTS    = 10;
  const hasProfile   = total >= MIN_SHOTS;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────── */}
        <Text style={styles.headerTitle}>SESSION SUMMARY</Text>
        <Text style={styles.headerSub}>
          {session.club} · {total} shot{total !== 1 ? 's' : ''} · {duration} min
        </Text>

        {/* ── Shape distribution ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Shot Shape</Text>
          {SHAPES.filter((s) => shapeCounts[s] > 0).map((s) => (
            <BarRow
              key={s}
              label={cap(s)}
              count={shapeCounts[s]}
              total={total}
              isDominant={s === dominantShape && shapeCounts[s] > 0}
            />
          ))}
          {SHAPES.every((s) => shapeCounts[s] === 0) && (
            <Text style={styles.noData}>No shape data logged.</Text>
          )}
        </View>

        {/* ── Feel distribution ────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Contact Feel</Text>
          {FEELS.filter((f) => feelCounts[f] > 0).map((f) => (
            <BarRow
              key={f}
              label={cap(f)}
              count={feelCounts[f]}
              total={total}
              isDominant={f === dominantFeel && feelCounts[f] > 0}
            />
          ))}
          {FEELS.every((f) => feelCounts[f] === 0) && (
            <Text style={styles.noData}>No feel data logged.</Text>
          )}
        </View>

        {/* ── Improvement arc (early vs late) ─────────────────────────── */}
        {total >= 6 && (() => {
          const mid       = Math.floor(total / 2);
          const early     = shots.slice(0, mid);
          const late      = shots.slice(-mid);
          const flushRate = (arr: typeof shots) => {
            const rated = arr.filter((s) => s.feel !== null);
            if (rated.length === 0) return null;
            return Math.round((rated.filter((s) => s.feel === 'flush').length / rated.length) * 100);
          };
          const onTargetRate = (arr: typeof shots) => {
            const shaped = arr.filter((s) => s.shape !== null);
            if (shaped.length === 0) return null;
            return Math.round((shaped.filter((s) => s.shape === 'straight' || s.shape === 'draw' || s.shape === 'fade').length / shaped.length) * 100);
          };
          const earlyFlush    = flushRate(early);
          const lateFlush     = flushRate(late);
          const earlyOnTarget = onTargetRate(early);
          const lateOnTarget  = onTargetRate(late);
          const hasData = earlyFlush !== null || earlyOnTarget !== null;
          if (!hasData) return null;
          const arcLabel = (() => {
            if (lateFlush !== null && earlyFlush !== null) {
              const delta = lateFlush - earlyFlush;
              if (delta >= 10) return { text: 'Improving', color: '#4ade80' };
              if (delta <= -10) return { text: 'Fatiguing', color: '#f97316' };
            }
            return { text: 'Consistent', color: '#94a3b8' };
          })();
          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Improvement Arc</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
                <Text style={{ color: arcLabel.color, fontWeight: '800', fontSize: 16 }}>{arcLabel.text}</Text>
                <Text style={{ color: '#6b7280', fontSize: 14, alignSelf: 'flex-end' }}>over {total} shots</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {/* Early */}
                <View style={{ flex: 1, backgroundColor: '#0d2318', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1a3a28' }}>
                  <Text style={{ color: '#6b7280', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                    First {mid}
                  </Text>
                  {earlyFlush !== null && (
                    <Text style={{ color: '#d1d5db', fontSize: 13 }}>
                      <Text style={{ color: '#4ade80', fontWeight: '700' }}>{earlyFlush}%</Text> flush
                    </Text>
                  )}
                  {earlyOnTarget !== null && (
                    <Text style={{ color: '#d1d5db', fontSize: 13, marginTop: 4 }}>
                      <Text style={{ color: '#4ade80', fontWeight: '700' }}>{earlyOnTarget}%</Text> on target
                    </Text>
                  )}
                </View>
                {/* Late */}
                <View style={{ flex: 1, backgroundColor: '#0d2318', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1a3a28' }}>
                  <Text style={{ color: '#6b7280', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                    Last {mid}
                  </Text>
                  {lateFlush !== null && (
                    <Text style={{ color: '#d1d5db', fontSize: 13 }}>
                      <Text style={{ color: lateFlush >= (earlyFlush ?? 0) ? '#4ade80' : '#f97316', fontWeight: '700' }}>{lateFlush}%</Text> flush
                    </Text>
                  )}
                  {lateOnTarget !== null && (
                    <Text style={{ color: '#d1d5db', fontSize: 13, marginTop: 4 }}>
                      <Text style={{ color: lateOnTarget >= (earlyOnTarget ?? 0) ? '#4ade80' : '#f97316', fontWeight: '700' }}>{lateOnTarget}%</Text> on target
                    </Text>
                  )}
                </View>
              </View>
            </View>
          );
        })()}

        {/* ── AI coaching summary ──────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Coaching Summary</Text>
          <View style={styles.coachingCard}>
            {aiLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={ACCENT} />
                <Text style={styles.loadingText}>Generating coaching summary...</Text>
              </View>
            ) : (
              <Text style={styles.coachingText}>
                {aiSummary ?? 'No summary available.'}
              </Text>
            )}
          </View>
        </View>

        {/* ── Device Coverage ──────────────────────────────────────── */}
        {(() => {
          const devSessions = session.devices;
          if (!devSessions) return null;

          const phoneCount   = shots.filter((s) => !!s.phoneAnalysis || !!s.phoneVideoUri).length;
          const glassesCount = shots.filter((s) => !!s.glassesAnalysis).length;
          const watchShots   = shots.filter((s) => s.watchData !== null && s.watchData !== undefined);
          const watchCount   = watchShots.length;

          const hasAnyDevice = devSessions.watch || devSessions.glasses;
          if (!hasAnyDevice && phoneCount === 0) return null;

          // Watch stats
          const hrShots  = watchShots.filter((s) => (s.watchData as any)?.heartRate !== null);
          const avgHR    = hrShots.length > 0
            ? Math.round(hrShots.reduce((sum, s) => sum + ((s.watchData as any).heartRate as number), 0) / hrShots.length)
            : null;
          const peakHRShot = hrShots.length > 0
            ? hrShots.reduce((max, s) =>
                ((s.watchData as any).heartRate as number) > ((max.watchData as any).heartRate as number) ? s : max,
              hrShots[0])
            : null;
          const peakHR = peakHRShot ? (peakHRShot.watchData as any).heartRate as number : null;
          const peakShotNum = peakHRShot ? shots.indexOf(peakHRShot) + 1 : null;

          const tempoShots   = watchShots.filter((s) => (s.watchData as any)?.tempoFeel);
          const tempoRushed  = tempoShots.filter((s) => (s.watchData as any).tempoFeel === 'rushed').length;
          const tempoNormal  = tempoShots.filter((s) => (s.watchData as any).tempoFeel === 'normal').length;
          const tempoSmooth  = tempoShots.filter((s) => (s.watchData as any).tempoFeel === 'smooth').length;

          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Data Coverage This Session</Text>

              {/* Coverage grid header */}
              <View style={coverageStyles.gridRow}>
                <Text style={[coverageStyles.col0, coverageStyles.header]}>Shot</Text>
                <Text style={[coverageStyles.col1, coverageStyles.header]}>📱</Text>
                {devSessions.glasses && <Text style={[coverageStyles.col2, coverageStyles.header]}>👓</Text>}
                {devSessions.watch   && <Text style={[coverageStyles.col3, coverageStyles.header]}>⌚</Text>}
              </View>

              {shots.slice(0, 18).map((s, i) => (
                <View key={i} style={coverageStyles.gridRow}>
                  <Text style={[coverageStyles.col0, coverageStyles.cell]}>{i + 1}</Text>
                  <Text style={[coverageStyles.col1, coverageStyles.cell]}>
                    {(s.phoneAnalysis || s.phoneVideoUri) ? '✅' : '❌'}
                  </Text>
                  {devSessions.glasses && (
                    <Text style={[coverageStyles.col2, coverageStyles.cell]}>
                      {s.glassesAnalysis ? '✅' : '❌'}
                    </Text>
                  )}
                  {devSessions.watch && (
                    <Text style={[coverageStyles.col3, coverageStyles.cell]}>
                      {s.watchData ? '✅' : '❌'}
                    </Text>
                  )}
                </View>
              ))}
              {shots.length > 18 && (
                <Text style={coverageStyles.moreText}>+ {shots.length - 18} more shots</Text>
              )}

              {/* Coverage percentages */}
              <View style={{ marginTop: 12, gap: 4 }}>
                <Text style={coverageStyles.pct}>📱 Phone: {phoneCount}/{total} shots ({total > 0 ? Math.round(phoneCount / total * 100) : 0}%)</Text>
                {devSessions.glasses && <Text style={coverageStyles.pct}>👓 Glasses: {glassesCount}/{total} shots ({total > 0 ? Math.round(glassesCount / total * 100) : 0}%)</Text>}
                {devSessions.watch   && <Text style={coverageStyles.pct}>⌚ Watch: {watchCount}/{total} shots ({total > 0 ? Math.round(watchCount / total * 100) : 0}%)</Text>}
              </View>

              {/* Watch HR stats */}
              {avgHR !== null && (
                <View style={{ marginTop: 10, gap: 3 }}>
                  <Text style={coverageStyles.stat}>Average HR: {avgHR} bpm{peakHR !== null ? ` | Peak: ${peakHR} bpm (shot ${peakShotNum})` : ''}</Text>
                  {tempoShots.length > 0 && (
                    <Text style={coverageStyles.stat}>
                      Rushed: {tempoRushed} shots | Normal: {tempoNormal} shots | Smooth: {tempoSmooth} shots
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        })()}

        {/* ── Club profile notice ──────────────────────────────────────── */}
        <View style={[styles.profileNotice, hasProfile ? styles.profileNoticeGood : styles.profileNoticeMuted]}>
          <Text style={[styles.profileNoticeText, hasProfile ? styles.profileNoticeTextGood : styles.profileNoticeTextMuted]}>
            {hasProfile
              ? `Your ${session.club} profile updated — ${totalCageShots} total cage shot${totalCageShots !== 1 ? 's' : ''}`
              : `Log ${MIN_SHOTS - total} more shot${MIN_SHOTS - total !== 1 ? 's' : ''} to build your ${session.club} swing profile`
            }
          </Text>
        </View>

        {/* ── Golf Fix review card ─────────────────────────────────────── */}
        <View style={styles.golfFixCard}>
          <Text style={styles.golfFixTitle}>Ask Golf Fix</Text>
          <Text style={styles.golfFixSubtitle}>
            Session complete — ask anything about this session before you leave the cage.
          </Text>
          {golfFixLoading && (
            <ActivityIndicator color={ACCENT} size="small" style={{ marginVertical: 8 }} />
          )}
          {golfFixReply ? (
            <View style={styles.golfFixReplyBubble}>
              <Text style={styles.golfFixReplyText}>{golfFixReply}</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.golfFixBtn}
            onPress={() => setShowGolfFixSheet(true)}
            disabled={golfFixLoading}
          >
            <Text style={styles.golfFixBtnText}>
              {golfFixLoading ? 'Thinking...' : '🏌️ Ask a Question'}
            </Text>
          </Pressable>
        </View>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Pressable
            style={[styles.footerBtn, styles.footerBtnOutline]}
            onPress={() => router.push('/cage' as any)}
          >
            <Text style={[styles.footerBtnText, styles.footerBtnTextOutline]}>New Session</Text>
          </Pressable>
          <Pressable
            style={[styles.footerBtn, styles.footerBtnPrimary]}
            onPress={() => router.push('/tabs/swinglab')}
          >
            <Text style={[styles.footerBtnText, styles.footerBtnTextPrimary]}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Golf Fix question sheet ──────────────────────────────────── */}
      <Modal
        visible={showGolfFixSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGolfFixSheet(false)}
      >
        <Pressable style={styles.sheetOverlay} onPress={() => setShowGolfFixSheet(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Ask Golf Fix</Text>
            <Text style={{ color: '#6b9e88', fontSize: 12, marginBottom: 14, textAlign: 'center' }}>
              Session review — uses all {session.shots.length} shots
            </Text>
            {[
              'What was my main issue this session?',
              'What is my dominant miss pattern?',
              'Give me one drill to fix this.',
              'How did I do overall?',
              'What should I focus on next session?',
            ].map((q) => (
              <Pressable
                key={q}
                style={styles.sheetPreset}
                onPress={() => handleGolfFixQuestion(q)}
              >
                <Text style={styles.sheetPresetText}>{q}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── Coverage grid styles ────────────────────────────────────────────────────

const coverageStyles = StyleSheet.create({
  gridRow: {
    flexDirection:   'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#1c3a28',
  },
  header: {
    color:      '#8cb8a2',
    fontWeight: '700',
    fontSize:   11,
    letterSpacing: 0.5,
  },
  cell: {
    color:    '#c0d8cc',
    fontSize: 13,
  },
  col0: { width: 44 },
  col1: { width: 36, textAlign: 'center' },
  col2: { width: 36, textAlign: 'center' },
  col3: { width: 36, textAlign: 'center' },
  moreText: {
    color:      '#4a7a60',
    fontSize:   11,
    marginTop:   6,
    fontStyle:  'italic',
  },
  pct: {
    color:    '#8cb8a2',
    fontSize: 12,
  },
  stat: {
    color:    '#8cb8a2',
    fontSize: 12,
  },
});

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 52,
  },

  // Empty
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  emptyText: {
    color: WHITE,
    fontSize: 15,
  },

  // Header
  headerTitle: {
    color: WHITE,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 6,
  },
  headerSub: {
    color: '#8cb8a2',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 28,
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionLabel: {
    color: '#8cb8a2',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  noData: {
    color: '#4a7a60',
    fontSize: 13,
    fontStyle: 'italic',
  },

  // Coaching card
  coachingCard: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: BORDER,
    borderRightColor: BORDER,
    borderBottomColor: BORDER,
    padding: 16,
    minHeight: 70,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#4a7a60',
    fontSize: 13,
    fontStyle: 'italic',
  },
  coachingText: {
    color: WHITE,
    fontSize: 14,
    lineHeight: 22,
  },

  // Profile notice
  profileNotice: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 28,
    borderWidth: 1,
  },
  profileNoticeGood: {
    backgroundColor: '#0a2e1a',
    borderColor: ACCENT,
  },
  profileNoticeMuted: {
    backgroundColor: SURFACE,
    borderColor: BORDER,
  },
  profileNoticeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  profileNoticeTextGood: {
    color: ACCENT,
  },
  profileNoticeTextMuted: {
    color: '#8cb8a2',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  footerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerBtnOutline: {
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  footerBtnPrimary: {
    backgroundColor: ACCENT,
  },
  footerBtnText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footerBtnTextOutline: {
    color: ACCENT,
  },
  footerBtnTextPrimary: {
    color: '#000',
  },

  // Golf Fix card
  golfFixCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 18,
    marginBottom: 20,
    gap: 10,
  },
  golfFixTitle: {
    color: WHITE,
    fontSize: 15,
    fontWeight: '700',
  },
  golfFixSubtitle: {
    color: '#8cb8a2',
    fontSize: 13,
    lineHeight: 18,
  },
  golfFixReplyBubble: {
    backgroundColor: '#0a1a10',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: ACCENT + '44',
  },
  golfFixReplyText: {
    color: WHITE,
    fontSize: 14,
    lineHeight: 20,
  },
  golfFixBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  golfFixBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },

  // Golf Fix question sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#2a4a38',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  sheetPreset: {
    backgroundColor: '#0a1a10',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sheetPresetText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '500',
  },
});
