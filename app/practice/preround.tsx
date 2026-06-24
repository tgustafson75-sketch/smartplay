/**
 * 2026-06-15 (Tim — the 20-min "get me ready" routine) — PRE-ROUND WARM UP.
 *
 * The adaptive orchestrator (mockup: ChatGPT "Preround Warm Up"): pick the time
 * you ACTUALLY have (10/20/30), and it composes a momentum-first sequence that
 * fits — stretch → setup → swings → first-tee brief → confidence ball. Every
 * step launches a REAL capability; readiness is DERIVED from steps you actually
 * complete (honest), never a fabricated score ([[time-constrained-golfer-lens]],
 * [[simplified-sophistication]]).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { composePreroundPlan, preroundReadiness, type PreroundFocus, type PreroundStep } from '../../services/practice/preroundPlan';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getCaddieName } from '../../lib/persona';
import { getApiBaseUrl } from '../../services/apiBase';
import { safeBack } from '../../services/safeBack';
import { ACCENT_SKY } from '../../theme/tokens';

const DURATIONS = [10, 20, 30] as const;
const FOCI: { key: PreroundFocus; label: string }[] = [
  { key: 'tempo', label: 'Tempo' },
  { key: 'contact', label: 'Contact' },
  { key: 'power', label: 'Power' },
];
const FALLBACK_BRIEF = 'Course is set up. You know what to do. One target at a time, commit to each shot, and let the warm-up carry over. Go play.';

export default function PreroundWarmUp() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [minutes, setMinutes] = useState<number>(20);
  const [focus, setFocus] = useState<PreroundFocus>('tempo');
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const firstName = usePlayerProfileStore((s) => s.firstName);
  const caddiePersonality = useSettingsStore((s) => s.caddiePersonality);

  const plan = useMemo(() => composePreroundPlan({ minutes, focus }), [minutes, focus]);

  // The set of steps changes when the budget/focus changes → reset progress so
  // readiness always reflects THIS plan honestly.
  useEffect(() => { setCompleted(new Set()); }, [minutes, focus]);

  const readiness = preroundReadiness(plan.steps.length, completed.size);
  const allDone = completed.size >= plan.steps.length && plan.steps.length > 0;

  const toggleDone = useCallback((id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const fetchBrief = useCallback(async () => {
    if (briefText || briefLoading) return;
    setBriefLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/preround`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName || '', caddieName: getCaddieName(caddiePersonality) }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json();
      setBriefText((typeof data?.brief === 'string' && data.brief.trim()) || FALLBACK_BRIEF);
    } catch {
      setBriefText(FALLBACK_BRIEF); // honest offline fallback — never a dead step
    } finally {
      setBriefLoading(false);
    }
  }, [briefText, briefLoading, firstName, caddiePersonality]);

  const doStep = useCallback((step: PreroundStep) => {
    switch (step.kind) {
      case 'stretch':
        router.push('/(tabs)/caddie' as never); // health-aware stretch lives with the caddie
        break;
      case 'setup':
        router.push('/swinglab/setup-check' as never);
        break;
      case 'swings':
      case 'finish':
        router.push('/swinglab/smartmotion' as never);
        break;
      case 'brief':
        setBriefOpen((o) => !o);
        if (!briefText) void fetchBrief();
        break;
    }
  }, [router, briefText, fetchBrief]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack()} style={styles.headerBtn} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Pre-Round Warm Up</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}>
        <Text style={[styles.subtitle, { color: colors.text_muted }]}>
          Pick the time you&apos;ve actually got — I&apos;ll build the warm-up to fit and end you on a good one.
        </Text>

        {/* Time budget */}
        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>HOW LONG DO YOU HAVE?</Text>
        <View style={styles.chipRow}>
          {DURATIONS.map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => setMinutes(d)}
              style={[styles.durChip, { borderColor: colors.border }, minutes === d && styles.durChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: minutes === d }}
            >
              <Text style={[styles.durChipNum, { color: minutes === d ? '#04130b' : colors.text_primary }]}>{d}</Text>
              <Text style={[styles.durChipUnit, { color: minutes === d ? '#04130b' : colors.text_muted }]}>min</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Focus */}
        <Text style={[styles.sectionLabel, { color: colors.text_muted }]}>TODAY&apos;S FOCUS</Text>
        <View style={styles.chipRow}>
          {FOCI.map((f) => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFocus(f.key)}
              style={[styles.focusChip, { borderColor: colors.border }, focus === f.key && styles.focusChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: focus === f.key }}
            >
              <Text style={[styles.focusChipText, { color: focus === f.key ? '#88F700' : colors.text_muted }]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Honest readiness — completion-derived, never fabricated. */}
        <View style={[styles.readyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.readyTop}>
            <Text style={[styles.readyLabel, { color: colors.text_muted }]}>READINESS</Text>
            <Text style={[styles.readyCount, { color: allDone ? '#3FB950' : colors.text_primary }]}>
              {completed.size} of {plan.steps.length} · ~{plan.allocated} min
            </Text>
          </View>
          <View style={[styles.readyTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.readyFill, { width: `${Math.round(readiness * 100)}%` }]} />
          </View>
          {allDone ? (
            <Text style={styles.readyDone}>You&apos;re ready — go play.</Text>
          ) : null}
        </View>

        {/* The composed sequence */}
        {plan.steps.map((step, i) => {
          const done = completed.has(step.id);
          return (
            <View key={step.id} style={[styles.stepCard, { backgroundColor: colors.surface, borderColor: done ? '#3FB950' : colors.border }]}>
              <View style={[styles.stepIconBox, { backgroundColor: hexFade(step.accent, 0.14) }]}>
                <Ionicons name={step.icon as React.ComponentProps<typeof Ionicons>['name']} size={20} color={step.accent} />
              </View>
              <View style={styles.stepBody}>
                <View style={styles.stepTitleRow}>
                  <Text style={[styles.stepNum, { color: colors.text_muted }]}>{i + 1}</Text>
                  <Text style={[styles.stepTitle, { color: colors.text_primary }]}>{step.title}</Text>
                  <Text style={[styles.stepMin, { color: step.accent }]}>{step.minutes}m</Text>
                </View>
                <Text style={[styles.stepFocus, { color: colors.text_muted }]}>
                  {step.focus}{step.club ? ` · ${step.club}` : ''}
                </Text>

                {step.kind === 'brief' && briefOpen ? (
                  <View style={styles.briefBox}>
                    {briefLoading ? (
                      <ActivityIndicator color={ACCENT_SKY} />
                    ) : (
                      <Text style={[styles.briefText, { color: colors.text_primary }]}>{briefText ?? FALLBACK_BRIEF}</Text>
                    )}
                  </View>
                ) : null}

                <View style={styles.stepActions}>
                  <TouchableOpacity style={[styles.doBtn, { borderColor: step.accent }]} onPress={() => doStep(step)} accessibilityRole="button">
                    <Text style={[styles.doBtnText, { color: step.accent }]}>
                      {step.kind === 'brief' ? (briefOpen ? 'Hide' : 'Read it') : step.kind === 'stretch' ? 'Ask caddie' : 'Do it'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.doneBtn} onPress={() => toggleDone(step.id)} accessibilityRole="button" accessibilityState={{ checked: done }}>
                    <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={done ? '#3FB950' : colors.text_muted} />
                    <Text style={[styles.doneText, { color: done ? '#3FB950' : colors.text_muted }]}>{done ? 'Done' : 'Mark done'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function hexFade(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4, marginBottom: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 12, marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 10 },
  durChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, borderWidth: 1.5 },
  durChipOn: { backgroundColor: '#88F700', borderColor: '#88F700' },
  durChipNum: { fontSize: 24, fontWeight: '900' },
  durChipUnit: { fontSize: 11, fontWeight: '700', marginTop: -2 },
  focusChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
  focusChipOn: { borderColor: '#88F700', backgroundColor: 'rgba(136,247,0,0.12)' },
  focusChipText: { fontSize: 13, fontWeight: '800' },
  readyCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 18, marginBottom: 8 },
  readyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  readyLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  readyCount: { fontSize: 13, fontWeight: '800' },
  readyTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  readyFill: { height: 8, borderRadius: 4, backgroundColor: '#3FB950' },
  readyDone: { color: '#3FB950', fontSize: 13, fontWeight: '800', marginTop: 10 },
  stepCard: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  stepIconBox: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepBody: { flex: 1 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { fontSize: 12, fontWeight: '900' },
  stepTitle: { fontSize: 15, fontWeight: '800', flex: 1 },
  stepMin: { fontSize: 13, fontWeight: '900' },
  stepFocus: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  briefBox: { marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: 'rgba(59,158,255,0.08)' },
  briefText: { fontSize: 13, lineHeight: 20 },
  stepActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  doBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5 },
  doBtnText: { fontSize: 13, fontWeight: '800' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  doneText: { fontSize: 13, fontWeight: '700' },
});
