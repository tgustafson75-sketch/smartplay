/**
 * 2026-11-01 — GOLF WORKOUT (ported from SmartPump's Golf Performance block + Swing Rx).
 *
 * Three phases of the Long Game block, each with Power / Strength / Stability sessions. Log each
 * working set as you do it; when every working set of a session is logged, the session lands in the
 * shared workout history (useWorkoutStore) alongside every other workout. Warm-up sets are shown
 * muted and never logged.
 *
 * Swing Rx: import a Caddie swing analysis (a .json/.txt export) and its prescribed movements become
 * a tracked session you log like any other. Progress counts only sets logged after the import.
 *
 * Loads: SmartPlay has no bodyweight yet, so loads use SmartPump's 175 lb default and the screen
 * says so. Free until 2.0 (golfWorkoutUnlocked is the paywall seam).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { useGolfWorkoutStore, golfWorkoutUnlocked } from '../store/golfWorkoutStore';
import { GOLF_BLOCK, QUALITY_BY_MOVEMENT, QUALITY_META, QUALITY_ORDER, buildGolfSession, getGolfSession } from '../services/golf/golfProgram';
import { RX_EXTRA_MOVEMENT_QUALITY, buildRxSession, computeRxProgress, rxQualityLabels, rxSession, type SwingPrescription } from '../services/golf/swingRx';
import { describeStrengthSpec } from '../services/golf/strengthBuild';
import { parseFailureMessage } from '../services/golf/swingRxParse';
import { importSwingRxFromFile } from '../services/golf/swingRxFile';
import { useToastStore } from '../store/toastStore';
import { ACCENT_SKY } from '../theme/tokens';
import type { PlannedExerciseInSession, StrengthSpec } from '../services/golf/sessionTypes';

/** The open-session key for the active Swing Rx block (golf session ids never collide with it). */
const RX_KEY = 'rx';

interface OpenSession {
  id: string;
  name: string;
  blurb: string;
  exercises: StrengthSpec[];
  plan: PlannedExerciseInSession[];
}

export default function GolfWorkoutScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const prescriptions = useGolfWorkoutStore((s) => s.prescriptions);
  const loggedSets = useGolfWorkoutStore((s) => s.loggedSets);
  const logSet = useGolfWorkoutStore((s) => s.logSet);
  const completeSession = useGolfWorkoutStore((s) => s.completeSession);
  const addPrescription = useGolfWorkoutStore((s) => s.addPrescription);

  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Working sets logged this visit, keyed `${exerciseId}:${setIndex}`. */
  const [doneSets, setDoneSets] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  /** Session ids already written to the workout history this visit — a double tap can't log twice. */
  const loggedRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef<number | null>(null);

  const unlocked = golfWorkoutUnlocked();
  const activeRx: SwingPrescription | null = prescriptions[0] ?? null;
  const rxProgress = useMemo(() => (activeRx ? computeRxProgress(activeRx, loggedSets) : null), [activeRx, loggedSets]);

  /** Sets logged per performance quality, across the golf block and any Rx movements. */
  const qualityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const set of loggedSets) {
      const q = QUALITY_BY_MOVEMENT[set.payload.exerciseId] ?? RX_EXTRA_MOVEMENT_QUALITY[set.payload.exerciseId];
      if (q) counts[q] = (counts[q] ?? 0) + 1;
    }
    return counts;
  }, [loggedSets]);

  const openView: OpenSession | null = useMemo(() => {
    if (!openKey) return null;
    if (openKey === RX_KEY) {
      if (!activeRx) return null;
      const session = rxSession(activeRx);
      return { id: `${RX_KEY}:${activeRx.id}`, name: session.name, blurb: session.blurb, exercises: session.exercises, plan: buildRxSession(activeRx, undefined) };
    }
    const session = getGolfSession(openKey);
    if (!session) return null;
    return { id: session.id, name: session.name, blurb: session.blurb, exercises: session.exercises, plan: buildGolfSession(session, undefined) };
  }, [openKey, activeRx]);

  const openSession = useCallback((key: string) => {
    setOpenKey(key);
    setDoneSets(new Set());
    startedAtRef.current = Date.now();
  }, []);

  const toggleSet = useCallback((exerciseId: string, index: number, weight: number, reps: number) => {
    if (!openView) return;
    const key = `${exerciseId}:${index}`;
    if (doneSets.has(key)) {
      setDoneSets((prev) => { const next = new Set(prev); next.delete(key); return next; });
      return;
    }
    logSet({ exerciseId, weight, reps });
    const next = new Set(doneSets);
    next.add(key);
    setDoneSets(next);

    // Every working set of the session logged → one entry in the shared workout history.
    const working = openView.plan.flatMap((ex) =>
      ex.sets.map((s, i) => ({ key: `${ex.exerciseId}:${i}`, working: s.isWorking === true })),
    ).filter((s) => s.working);
    const allDone = working.every((s) => next.has(s.key));
    if (allDone && !loggedRef.current.has(openView.id)) {
      loggedRef.current.add(openView.id);
      const stored = completeSession({
        title: openView.name,
        exercises: openView.exercises.map((e) => describeStrengthSpec(e).label),
        startedAt: startedAtRef.current ?? undefined,
      });
      useToastStore.getState().show(stored ? t('golf_workout.session_logged') : t('golf_workout.already_logged'));
    }
  }, [openView, doneSets, logSet, completeSession, t]);

  const importRx = useCallback(async () => {
    setImporting(true);
    setImportNote(null);
    try {
      const res = await importSwingRxFromFile();
      if (res.kind === 'parsed') {
        if (res.result.ok) {
          addPrescription(res.result.rx);
          setImportNote(t('golf_workout.rx_imported'));
        } else {
          setImportNote(parseFailureMessage(res.result.reason, res.result.detail));
        }
      } else if (res.kind === 'picker_unavailable') {
        setImportNote(t('golf_workout.rx_no_picker'));
      } else if (res.kind === 'read_failed') {
        setImportNote(t('golf_workout.rx_read_failed'));
      }
    } finally {
      setImporting(false);
    }
  }, [addPrescription, t]);

  if (!unlocked) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.subtitle, { color: colors.text_muted, padding: 16 }]}>{t('golf_workout.locked')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (openKey ? setOpenKey(null) : safeBack())} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>{openView ? openView.name : t('golf_workout.title')}</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}>
        {openView ? (
          <>
            <Text style={[styles.subtitle, { color: colors.text_muted }]}>{openView.blurb}</Text>
            <Text style={[styles.note, { color: colors.text_muted }]}>{t('golf_workout.loads_note')}</Text>
            {openView.plan.map((ex) => {
              const spec = openView.exercises.find((e) => e.exerciseId === ex.exerciseId);
              const { label, summary } = spec ? describeStrengthSpec(spec) : { label: ex.exerciseId, summary: '' };
              return (
                <View key={ex.exerciseId} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.cardTop}>
                    <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{label}</Text>
                    <Text style={[styles.cardSummary, { color: ACCENT_SKY }]}>{summary}</Text>
                  </View>
                  {spec?.note ? <Text style={[styles.cue, { color: colors.text_muted }]}>{spec.note}</Text> : null}
                  <View style={styles.setRow}>
                    {ex.sets.map((s, i) => {
                      if (s.isWarmup) {
                        return (
                          <View key={i} style={[styles.setChip, { borderColor: colors.border }]}>
                            <Text style={[styles.setText, { color: colors.text_muted }]}>{t('golf_workout.warmup')} {s.weight > 0 ? s.weight : ''}</Text>
                          </View>
                        );
                      }
                      const key = `${ex.exerciseId}:${i}`;
                      const done = doneSets.has(key);
                      return (
                        <TouchableOpacity
                          key={i}
                          onPress={() => toggleSet(ex.exerciseId, i, s.weight, s.reps)}
                          style={[styles.setChip, { borderColor: done ? '#3FB950' : colors.border, backgroundColor: done ? 'rgba(63,185,80,0.12)' : 'transparent' }]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: done }}
                        >
                          <Text style={[styles.setText, { color: done ? '#3FB950' : colors.text_primary }]}>
                            {s.weight > 0 ? `${s.weight} × ${s.reps}` : `${s.reps}`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </>
        ) : (
          <>
            <Text style={[styles.subtitle, { color: colors.text_muted }]}>{t('golf_workout.subtitle')}</Text>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>{t('golf_workout.rx_title')}</Text>
              {activeRx && rxProgress ? (
                <>
                  <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{activeRx.label}</Text>
                  <Text style={[styles.cue, { color: colors.text_muted }]}>{rxQualityLabels(activeRx).join(' · ')}</Text>
                  <Text style={[styles.cardSummary, { color: ACCENT_SKY, marginTop: 6 }]}>
                    {t('golf_workout.rx_progress', { logged: rxProgress.setsLogged, target: rxProgress.targetSets })}
                  </Text>
                  {rxProgress.movements.map((m) => (
                    <Text key={m.exerciseId} style={[styles.cue, { color: colors.text_muted }]}>
                      {m.label} · {m.setsLogged}/{m.targetSets}
                    </Text>
                  ))}
                  <TouchableOpacity style={[styles.doBtn, { borderColor: ACCENT_SKY }]} onPress={() => openSession(RX_KEY)} accessibilityRole="button">
                    <Text style={[styles.doBtnText, { color: ACCENT_SKY }]}>{t('golf_workout.rx_start')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={[styles.cue, { color: colors.text_muted }]}>{t('golf_workout.rx_none')}</Text>
              )}
              <TouchableOpacity style={[styles.doBtn, { borderColor: ACCENT_SKY }]} onPress={importRx} disabled={importing} accessibilityRole="button">
                <Text style={[styles.doBtnText, { color: ACCENT_SKY }]}>{importing ? t('golf_workout.rx_importing') : t('golf_workout.rx_import')}</Text>
              </TouchableOpacity>
              {importNote ? <Text style={[styles.cue, { color: colors.text_muted, marginTop: 8 }]}>{importNote}</Text> : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>{t('golf_workout.quality_title')}</Text>
              {QUALITY_ORDER.map((q) => (
                <View key={q} style={styles.qualityRow}>
                  <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{QUALITY_META[q].label}</Text>
                  <Text style={[styles.cardSummary, { color: colors.text_muted }]}>
                    {t('golf_workout.quality_sets', { count: qualityCounts[q] ?? 0 })}
                  </Text>
                </View>
              ))}
            </View>

            {GOLF_BLOCK.phases.map((phase) => (
              <View key={phase.id}>
                <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>{phase.name.toUpperCase()} · {phase.weeks}</Text>
                <Text style={[styles.cue, { color: colors.text_muted, marginBottom: 6 }]}>{phase.focus}</Text>
                {phase.sessions.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => openSession(s.id)}
                    style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityRole="button"
                  >
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardTitle, { color: colors.text_primary }]}>{s.name}</Text>
                      <Text style={[styles.cardSummary, { color: colors.text_muted }]}>{s.type}</Text>
                    </View>
                    <Text style={[styles.cue, { color: colors.text_muted }]}>{s.blurb}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 12 },
  note: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 14, marginBottom: 6 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', flex: 1 },
  cardSummary: { fontSize: 12, fontWeight: '800' },
  cue: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  qualityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  setRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  setChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1.5 },
  setText: { fontSize: 13, fontWeight: '800' },
  doBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, marginTop: 12 },
  doBtnText: { fontSize: 13, fontWeight: '800' },
});
