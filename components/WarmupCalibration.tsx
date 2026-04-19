/**
 * WarmupCalibration.tsx
 *
 * Pre-round warmup wizard that calibrates club distances from 3 swings per club.
 *
 * Flow
 * ────
 *  1. Club List screen — tap a club to start warmup for it
 *  2. Swing Entry screen — log distance + direction for each of 3 swings
 *  3. Club Summary — show average, compare to stored model, voice feedback
 *  4. Final Summary — all calibrated clubs + voice "ready to play" message
 *
 * Integration
 * ───────────
 *  • Calls `onCalibrate(clubName, distances[])` — parent updates playerModel
 *  • Calls `onSpeak(text)` — parent routes through VoiceEngine
 *  • Never touches storage directly — pure UI / callback layer
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Animated,
} from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShotDirection = 'left' | 'straight' | 'right';

export interface SwingEntry {
  distance:  number;
  direction: ShotDirection;
}

export interface ClubCalibration {
  clubName:   string;
  swings:     SwingEntry[];
  average:    number;
  priorAvg?:  number | null;   // from player model before warmup
}

export interface WarmupCalibrationProps {
  /** Ordered list of clubs to offer, with prior avg if available */
  clubList: Array<{ name: string; priorAvg: number | null }>;
  /** Called after 3 swings logged for a club — parent mutates playerModel */
  onCalibrate: (clubName: string, samples: number[]) => void;
  /** Parent routes through VoiceEngine */
  onSpeak: (text: string) => void;
  /** Called when user taps "Start Round" */
  onComplete: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SWINGS_REQUIRED = 3;

const DIRECTION_LABELS: { value: ShotDirection; label: string; color: string }[] = [
  { value: 'left',     label: '◀ Left',     color: '#f87171' },
  { value: 'straight', label: '▲ Straight', color: '#4ade80' },
  { value: 'right',    label: 'Right ▶',    color: '#fbbf24' },
];

// Voice feedback per club (rotated pool)
const CLUB_FEEDBACK_POOL: Record<string, string[]> = {
  driver: [
    "Driver is online today.",
    "Solid driver numbers. Let's keep the swing smooth.",
    "Distance is good. Trust that driver off the tee.",
  ],
  '3 wood': [
    "Three-wood is dialled in. Good choice when you need control.",
    "Solid three-wood. Use that when you need to find the fairway.",
  ],
  default: [
    "{club} looks good today.",
    "{club} numbers are solid. Commit to it.",
    "Good {club}. Trust those numbers out there.",
  ],
};

function getClubFeedback(clubName: string, avg: number, priorAvg: number | null): string {
  const lower = clubName.toLowerCase();
  const pool  = CLUB_FEEDBACK_POOL[lower] ?? CLUB_FEEDBACK_POOL.default;
  const base  = pool[Math.floor(Math.random() * pool.length)]
    .replace('{club}', clubName);

  if (priorAvg != null) {
    const delta = avg - priorAvg;
    if (Math.abs(delta) >= 5) {
      const dir = delta > 0 ? 'up' : 'down';
      return `${base} You're ${Math.abs(delta)} yards ${dir} from your usual carry.`;
    }
  }
  return `${base} Average carry today: ${avg} yards.`;
}

// ─── Screen types ─────────────────────────────────────────────────────────────

type Screen = 'list' | 'swings' | 'clubSummary' | 'finalSummary';

// ─── Component ────────────────────────────────────────────────────────────────

export default function WarmupCalibration({
  clubList,
  onCalibrate,
  onSpeak,
  onComplete,
}: WarmupCalibrationProps) {
  const [screen,          setScreen]         = useState<Screen>('list');
  const [activeClub,      setActiveClub]      = useState('');
  const [currentSwing,    setCurrentSwing]    = useState(1);           // 1–3
  const [swingEntries,    setSwingEntries]    = useState<SwingEntry[]>([]);
  const [distanceInput,   setDistanceInput]   = useState('');
  const [direction,       setDirection]       = useState<ShotDirection>('straight');
  const [calibrated,      setCalibrated]      = useState<ClubCalibration[]>([]);
  const [lastCalibration, setLastCalibration] = useState<ClubCalibration | null>(null);

  // ── Start warmup for a club ───────────────────────────────────────────
  const startClub = useCallback((clubName: string) => {
    setActiveClub(clubName);
    setCurrentSwing(1);
    setSwingEntries([]);
    setDistanceInput('');
    setDirection('straight');
    setScreen('swings');
    onSpeak(`Alright, let's get ${SWINGS_REQUIRED} swings with ${clubName}. Enter the carry distance after each shot.`);
  }, [onSpeak]);

  // ── Log a swing ───────────────────────────────────────────────────────
  const logSwing = useCallback(() => {
    const dist = parseInt(distanceInput, 10);
    if (!dist || dist < 20 || dist > 400) return;

    const entry: SwingEntry = { distance: dist, direction };
    const newEntries = [...swingEntries, entry];
    setSwingEntries(newEntries);

    if (newEntries.length < SWINGS_REQUIRED) {
      // More swings needed
      setCurrentSwing((n) => n + 1);
      setDistanceInput('');
      setDirection('straight');
      onSpeak(`Got it. Swing ${newEntries.length + 1} of ${SWINGS_REQUIRED}.`);
    } else {
      // Club done — compute average and show summary
      const avg = Math.round(
        newEntries.reduce((s, e) => s + e.distance, 0) / newEntries.length,
      );
      const priorAvg = clubList.find((c) => c.name === activeClub)?.priorAvg ?? null;

      const calibration: ClubCalibration = {
        clubName: activeClub,
        swings:   newEntries,
        average:  avg,
        priorAvg,
      };

      // Fire parent callback immediately
      onCalibrate(activeClub, newEntries.map((e) => e.distance));

      const feedback = getClubFeedback(activeClub, avg, priorAvg);
      onSpeak(feedback);

      setLastCalibration(calibration);
      setCalibrated((prev) => {
        // Replace if already calibrated
        const idx = prev.findIndex((c) => c.clubName === activeClub);
        if (idx >= 0) {
          const next = [...prev];
          next[idx]  = calibration;
          return next;
        }
        return [...prev, calibration];
      });
      setScreen('clubSummary');
    }
  }, [distanceInput, direction, swingEntries, activeClub, clubList, onCalibrate, onSpeak]);

  // ── Render ────────────────────────────────────────────────────────────
  if (screen === 'swings') {
    return <SwingScreen
      clubName={activeClub}
      swingNumber={currentSwing}
      total={SWINGS_REQUIRED}
      distanceInput={distanceInput}
      setDistanceInput={setDistanceInput}
      direction={direction}
      setDirection={setDirection}
      onLog={logSwing}
      prevEntries={swingEntries}
    />;
  }

  if (screen === 'clubSummary' && lastCalibration) {
    return <ClubSummaryScreen
      calibration={lastCalibration}
      calibratedCount={calibrated.length}
      onNextClub={() => setScreen('list')}
      onFinish={() => {
        setScreen('finalSummary');
        onSpeak("All clubs calibrated. You're dialled in — let's go play.");
      }}
    />;
  }

  if (screen === 'finalSummary') {
    return <FinalSummaryScreen
      calibrated={calibrated}
      onComplete={onComplete}
    />;
  }

  // Default: club list
  return (
    <ScrollView
      style={styles.wrapper}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Pre-Round Warmup</Text>
        <Text style={styles.listSubtitle}>
          Hit {SWINGS_REQUIRED} balls with each club to calibrate your distances for today.
        </Text>
        {calibrated.length > 0 && (
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {calibrated.length} club{calibrated.length !== 1 ? 's' : ''} calibrated
            </Text>
            <Pressable
              onPress={() => {
                setScreen('finalSummary');
                const msg = calibrated.length >= 3
                  ? `${calibrated.length} clubs dialled in. Ready to play.`
                  : 'Warmup complete. Let\'s go play.';
                onSpeak(msg);
              }}
              style={styles.skipBtn}
            >
              <Text style={styles.skipBtnText}>Skip → Start Round</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Club grid */}
      {clubList.map((club) => {
        const done = calibrated.find((c) => c.clubName === club.name);
        return (
          <ClubRow
            key={club.name}
            name={club.name}
            priorAvg={club.priorAvg}
            calibrated={done ?? null}
            onPress={() => startClub(club.name)}
          />
        );
      })}

      {/* Start without warmup */}
      <Pressable
        onPress={() => {
          onSpeak('Heading straight to the course. Trust your swing.');
          onComplete();
        }}
        style={styles.skipRoundBtn}
      >
        <Text style={styles.skipRoundText}>Skip warmup — Start Round</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Sub-screens ──────────────────────────────────────────────────────────────

interface SwingScreenProps {
  clubName:       string;
  swingNumber:    number;
  total:          number;
  distanceInput:  string;
  setDistanceInput: (v: string) => void;
  direction:      ShotDirection;
  setDirection:   (v: ShotDirection) => void;
  onLog:          () => void;
  prevEntries:    SwingEntry[];
}

function SwingScreen({
  clubName, swingNumber, total, distanceInput,
  setDistanceInput, direction, setDirection, onLog, prevEntries,
}: SwingScreenProps) {
  return (
    <ScrollView style={styles.wrapper} contentContainerStyle={{ padding: 20, gap: 20 }}>
      {/* Header */}
      <View style={styles.swingHeader}>
        <Text style={styles.swingClubName}>{clubName}</Text>
        <Text style={styles.swingProgress}>Swing {swingNumber} of {total}</Text>
        {/* Dots */}
        <View style={styles.dotRow}>
          {Array.from({ length: total }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < prevEntries.length && styles.dotFilled]}
            />
          ))}
        </View>
      </View>

      {/* Previous entries */}
      {prevEntries.length > 0 && (
        <View style={styles.prevEntries}>
          {prevEntries.map((e, i) => (
            <View key={i} style={styles.prevEntry}>
              <Text style={styles.prevEntryNum}>#{i + 1}</Text>
              <Text style={styles.prevEntryDist}>{e.distance} yd</Text>
              <Text style={[
                styles.prevEntryDir,
                e.direction === 'straight' ? styles.dirGreen
                  : e.direction === 'left'  ? styles.dirRed
                  : styles.dirYellow,
              ]}>
                {e.direction}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Distance input */}
      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>Carry Distance (yards)</Text>
        <TextInput
          style={styles.distanceInput}
          value={distanceInput}
          onChangeText={(v) => setDistanceInput(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="e.g. 158"
          placeholderTextColor="#2d5a3e"
          maxLength={3}
          returnKeyType="done"
          selectionColor="#4ade80"
          autoFocus
        />
      </View>

      {/* Direction selector */}
      <View style={styles.directionSection}>
        <Text style={styles.inputLabel}>Shot Shape</Text>
        <View style={styles.directionRow}>
          {DIRECTION_LABELS.map(({ value, label, color }) => (
            <Pressable
              key={value}
              onPress={() => setDirection(value)}
              style={[
                styles.dirBtn,
                direction === value && { borderColor: color, backgroundColor: color + '22' },
              ]}
            >
              <Text style={[styles.dirBtnText, direction === value && { color }]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Log button */}
      <Pressable
        onPress={onLog}
        disabled={!distanceInput || parseInt(distanceInput, 10) < 20}
        style={({ pressed }) => [
          styles.logBtn,
          (!distanceInput || parseInt(distanceInput, 10) < 20) && styles.logBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.logBtnText}>
          {swingNumber < total ? `Log Swing ${swingNumber} →` : 'Finish Club ✓'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

interface ClubSummaryScreenProps {
  calibration:     ClubCalibration;
  calibratedCount: number;
  onNextClub:      () => void;
  onFinish:        () => void;
}

function ClubSummaryScreen({ calibration, calibratedCount, onNextClub, onFinish }: ClubSummaryScreenProps) {
  const { clubName, swings, average, priorAvg } = calibration;
  const delta = priorAvg != null ? average - priorAvg : null;

  return (
    <View style={[styles.wrapper, { padding: 24, gap: 20 }]}>
      {/* Success badge */}
      <View style={styles.successBadge}>
        <Text style={styles.successCheck}>✓</Text>
        <Text style={styles.successTitle}>{clubName} Calibrated</Text>
        <Text style={styles.successAvg}>{average} yards avg</Text>
        {delta != null && Math.abs(delta) >= 3 && (
          <Text style={[
            styles.successDelta,
            delta > 0 ? styles.deltaUp : styles.deltaDown,
          ]}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} yd vs usual
          </Text>
        )}
      </View>

      {/* Swing breakdown */}
      <View style={styles.swingBreakdown}>
        {swings.map((s, i) => (
          <View key={i} style={styles.breakdownRow}>
            <Text style={styles.breakdownNum}>Swing {i + 1}</Text>
            <Text style={styles.breakdownDist}>{s.distance} yd</Text>
            <Text style={[
              styles.breakdownDir,
              s.direction === 'straight' ? styles.dirGreen
                : s.direction === 'left'  ? styles.dirRed
                : styles.dirYellow,
            ]}>
              {s.direction}
            </Text>
          </View>
        ))}
      </View>

      {/* Actions */}
      <Pressable onPress={onNextClub} style={styles.nextClubBtn}>
        <Text style={styles.nextClubBtnText}>Calibrate Next Club</Text>
      </Pressable>

      <Pressable onPress={onFinish} style={styles.finishWarmupBtn}>
        <Text style={styles.finishWarmupBtnText}>
          ✅ Done — {calibratedCount} club{calibratedCount !== 1 ? 's' : ''} calibrated → Start Round
        </Text>
      </Pressable>
    </View>
  );
}

interface FinalSummaryScreenProps {
  calibrated: ClubCalibration[];
  onComplete: () => void;
}

function FinalSummaryScreen({ calibrated, onComplete }: FinalSummaryScreenProps) {
  return (
    <ScrollView style={styles.wrapper} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={styles.finalTitle}>{"🏌️ You're Dialled In"}</Text>
      <Text style={styles.finalSubtitle}>
        {calibrated.length} club{calibrated.length !== 1 ? 's' : ''} calibrated for {"today's"} round.
      </Text>

      {calibrated.length === 0 ? (
        <Text style={styles.noCalibText}>No clubs calibrated — using your stored averages.</Text>
      ) : (
        calibrated.map((c) => {
          const delta = c.priorAvg != null ? c.average - c.priorAvg : null;
          return (
            <View key={c.clubName} style={styles.summaryRow}>
              <Text style={styles.summaryClub}>{c.clubName}</Text>
              <Text style={styles.summaryAvg}>{c.average} yd</Text>
              {delta != null && Math.abs(delta) >= 3 ? (
                <Text style={[
                  styles.summaryDelta,
                  delta > 0 ? styles.deltaUp : styles.deltaDown,
                ]}>
                  {delta > 0 ? '+' : ''}{delta}
                </Text>
              ) : (
                <Text style={styles.summaryDeltaNone}>—</Text>
              )}
            </View>
          );
        })
      )}

      <Pressable onPress={onComplete} style={styles.startRoundBtn}>
        <Text style={styles.startRoundBtnText}>⛳ Start Round</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── Club row (list screen) ────────────────────────────────────────────────────

interface ClubRowProps {
  name:       string;
  priorAvg:   number | null;
  calibrated: ClubCalibration | null;
  onPress:    () => void;
}

function ClubRow({ name, priorAvg, calibrated, onPress }: ClubRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.clubRow,
        calibrated && styles.clubRowDone,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.clubRowName}>{name}</Text>
        {priorAvg != null && !calibrated && (
          <Text style={styles.clubRowPrior}>Stored: {priorAvg} yd</Text>
        )}
      </View>
      {calibrated ? (
        <View style={styles.clubRowCalibrated}>
          <Text style={styles.clubRowCalibratedText}>✓ {calibrated.average} yd</Text>
        </View>
      ) : (
        <Text style={styles.clubRowArrow}>Hit 3 →</Text>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: '#091410',
  },
  listContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 40,
  },

  // List header
  listHeader: {
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a3020',
    marginBottom: 6,
  },
  listTitle:    { color: '#4ade80', fontSize: 18, fontWeight: '800' },
  listSubtitle: { color: '#4a7c5e', fontSize: 13, lineHeight: 18 },
  progressRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  progressText: { color: '#86efac', fontSize: 13, fontWeight: '700' },

  skipBtn: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  skipBtnText: { color: '#4ade80', fontSize: 12, fontWeight: '800' },

  // Club rows
  clubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d2018',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a4a2e',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  clubRowDone: {
    borderColor: '#16a34a',
    backgroundColor: '#0a1e10',
  },
  clubRowName:  { color: '#d1fae5', fontSize: 14, fontWeight: '700' },
  clubRowPrior: { color: '#2d5a3e', fontSize: 12, marginTop: 2 },
  clubRowCalibrated: {
    backgroundColor: '#14532d',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  clubRowCalibratedText: { color: '#4ade80', fontSize: 12, fontWeight: '800' },
  clubRowArrow: { color: '#4a7c5e', fontSize: 13, fontWeight: '700' },

  skipRoundBtn: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  skipRoundText: { color: '#2d5a3e', fontSize: 13, textDecorationLine: 'underline' },

  // Swing screen
  swingHeader: {
    alignItems: 'center',
    gap: 6,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a3020',
  },
  swingClubName:  { color: '#4ade80', fontSize: 22, fontWeight: '900' },
  swingProgress:  { color: '#4a7c5e', fontSize: 14, fontWeight: '600' },
  dotRow:         { flexDirection: 'row', gap: 10, marginTop: 4 },
  dot:            { width: 14, height: 14, borderRadius: 7, backgroundColor: '#1a3020', borderWidth: 1.5, borderColor: '#2d5a3e' },
  dotFilled:      { backgroundColor: '#4ade80', borderColor: '#4ade80' },

  prevEntries: {
    backgroundColor: '#0a1e10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a3020',
    padding: 12,
    gap: 8,
  },
  prevEntry:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  prevEntryNum:  { color: '#2d5a3e', fontSize: 12, fontWeight: '700', width: 26 },
  prevEntryDist: { color: '#86efac', fontSize: 14, fontWeight: '800', width: 54 },
  prevEntryDir:  { fontSize: 12, fontWeight: '700' },

  inputSection: { gap: 8 },
  inputLabel:   { color: '#4a7c5e', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  distanceInput: {
    height: 56,
    backgroundColor: '#0d2018',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#1a4a2e',
    paddingHorizontal: 20,
    color: '#4ade80',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  directionSection: { gap: 8 },
  directionRow:     { flexDirection: 'row', gap: 8 },
  dirBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#0d2018',
    borderWidth: 1.5,
    borderColor: '#1a3020',
    alignItems: 'center',
  },
  dirBtnText: { color: '#4a7c5e', fontSize: 13, fontWeight: '700' },

  logBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  logBtnDisabled: { backgroundColor: '#0d2018', borderWidth: 1, borderColor: '#1a3020' },
  logBtnText:     { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },

  // Club summary screen
  successBadge: {
    alignItems: 'center',
    backgroundColor: '#0d2018',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#166534',
    padding: 24,
    gap: 6,
  },
  successCheck: { fontSize: 40, color: '#4ade80' },
  successTitle: { color: '#4ade80', fontSize: 18, fontWeight: '800' },
  successAvg:   { color: '#86efac', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  successDelta: { fontSize: 14, fontWeight: '700', marginTop: 4 },

  swingBreakdown: {
    backgroundColor: '#0a1e10',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a3020',
    padding: 14,
    gap: 10,
  },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  breakdownNum: { color: '#2d5a3e', fontSize: 12, fontWeight: '700', width: 56 },
  breakdownDist: { color: '#86efac', fontSize: 16, fontWeight: '800', width: 58, fontVariant: ['tabular-nums'] },
  breakdownDir: { fontSize: 13, fontWeight: '700' },

  nextClubBtn: {
    backgroundColor: '#0d2018',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#4ade80',
    marginTop: 8,
  },
  nextClubBtnText: { color: '#4ade80', fontSize: 15, fontWeight: '800' },

  finishWarmupBtn: {
    backgroundColor: '#14532d',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#16a34a',
  },
  finishWarmupBtnText: { color: '#86efac', fontSize: 14, fontWeight: '800', textAlign: 'center' },

  // Final summary screen
  finalTitle:    { color: '#4ade80', fontSize: 22, fontWeight: '900' },
  finalSubtitle: { color: '#4a7c5e', fontSize: 14, lineHeight: 20 },
  noCalibText:   { color: '#2d5a3e', fontSize: 14, fontStyle: 'italic' },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d2018',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a4a2e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  summaryClub:      { flex: 1, color: '#d1fae5', fontSize: 14, fontWeight: '700' },
  summaryAvg:       { color: '#4ade80', fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  summaryDelta:     { fontSize: 12, fontWeight: '700', width: 36, textAlign: 'right' },
  summaryDeltaNone: { color: '#1a3020', fontSize: 12, width: 36, textAlign: 'right' },

  startRoundBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  startRoundBtnText: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },

  // Shared direction colours
  dirGreen:  { color: '#4ade80' },
  dirRed:    { color: '#f87171' },
  dirYellow: { color: '#fbbf24' },

  // Shared delta colours
  deltaUp:   { color: '#4ade80' },
  deltaDown: { color: '#f87171' },
});
