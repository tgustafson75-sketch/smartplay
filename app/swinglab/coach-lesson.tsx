/**
 * 2026-07-23 (Tim — "make Coach Caddie an elite, unique lesson experience, drawn from real coaches").
 *
 * Coach Caddie runs a real diagnostic lesson: it WATCHES a baseline swing, DIAGNOSES the one priority
 * (root cause over symptom), explains the why, prescribes a single FEEL + a named DRILL, then coaches
 * reps with honest, encouraging feedback until you hit the checkpoint — then progresses or sends you
 * home with one thing. Turn-based capture (tap to record) keeps it compartmentalized: it composes ONLY
 * standalone primitives (SmartMotion swing analysis + voiceService.speak) and imports NONE of the
 * frozen live-voice hooks, so it can't touch any other flow.
 *
 * Two lighter modes remain for quick work: Guided Sessions (multi-focus plans) and Single Focus.
 * The coaching brain is services/coachKnowledge + services/coachSession (both pure + unit-tested).
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../contexts/ThemeContext';
import { safeBack } from '../../services/safeBack';
import { analyzeSwingFromVideo, type SwingBiomechanics } from '../../services/poseAnalysisApi';
import { LESSON_FOCUSES, LESSON_PLANS, composeFocusFeedback, focusById, transitionLine, sessionSummaryLine, type LessonFocus, type LessonPlan, type FocusFeedback } from '../../services/coachLesson';
import { diagnose, type CoachFault, type Diagnosis } from '../../services/coachKnowledge';
import { introLine, diagnosisReveal, prescriptionLine, evaluateRep, progressLine, homeworkLine, diagnoseBaseline, missConnectionLine, memoryLine } from '../../services/coachSession';
import { speak } from '../../services/voiceService';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useCoachLessonStore } from '../../store/coachLessonStore';
import { getApiBaseUrl } from '../../services/apiBase';

// Best-effort spoken line. Uses the standalone one-voice-safe speak(); never throws / blocks.
function say(text: string) {
  try {
    const s = useSettingsStore.getState();
    void speak(text, s.voiceGender, s.language ?? 'en', getApiBaseUrl(), { userInitiated: true })?.catch?.(() => undefined);
  } catch { /* speech is optional */ }
}

type Kind = 'menu' | 'focus' | 'diagnostic';
type Cap = 'idle' | 'analyzing';
type DxStage = 'intro' | 'reps' | 'progress' | 'homework';

export default function CoachLessonScreen() {
  const { colors } = useTheme();
  const [kind, setKind] = useState<Kind>('menu');
  const [cap, setCap] = useState<Cap>('idle');
  const [error, setError] = useState<string | null>(null);

  // Focus / guided-plan mode.
  const [focus, setFocus] = useState<LessonFocus | null>(null);
  const [feedback, setFeedback] = useState<FocusFeedback | null>(null);
  const [rep, setRep] = useState(0);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [planStep, setPlanStep] = useState(0);
  const [repsOnFocus, setRepsOnFocus] = useState(0);

  // Diagnostic lesson mode.
  const [dxStage, setDxStage] = useState<DxStage>('intro');
  const [priority, setPriority] = useState<Diagnosis | null>(null);
  const [dxText, setDxText] = useState('');           // current spoken/shown coaching line
  const [lastValue, setLastValue] = useState<number | null>(null);
  const [goodReps, setGoodReps] = useState(0);
  const [lastMetrics, setLastMetrics] = useState<SwingBiomechanics | null>(null);
  const [addressedIds, setAddressedIds] = useState<string[]>([]);

  // ── shared capture ────────────────────────────────────────────────────────
  const captureSwing = useCallback(async (): Promise<SwingBiomechanics | null> => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError('Camera permission is needed to watch your swing.'); return null; }
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 12, quality: 0.7, allowsEditing: false });
    } catch { setError('Could not open the camera. Try again.'); return null; }
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset?.uri) return null;
    setCap('analyzing');
    const raw = asset.duration ?? 0;
    const durationMs = raw > 0 && raw < 100 ? raw * 1000 : raw || 4000;
    try {
      const analysis = await analyzeSwingFromVideo(asset.uri, durationMs);
      setCap('idle');
      return analysis;
    } catch {
      setCap('idle');
      return null;
    }
  }, []);

  // ── diagnostic lesson ─────────────────────────────────────────────────────
  const startDiagnostic = useCallback(() => {
    setKind('diagnostic');
    setDxStage('intro');
    setPriority(null);
    setLastValue(null);
    setGoodReps(0);
    setLastMetrics(null);
    setAddressedIds([]);
    setError(null);
    setDxText(introLine());
    say(introLine());
  }, []);

  const beginPriority = useCallback((dx: Diagnosis, m: SwingBiomechanics) => {
    // Personalize: continuity from the last lesson on this fault + a tie to the player's known miss.
    const prior = useCoachLessonStore.getState().lastFor(dx.fault.id);
    const days = prior ? Math.floor((Date.now() - prior.at) / 86_400_000) : null;
    const mem = memoryLine(dx.fault.name, days);
    const miss = missConnectionLine(dx.fault.id, usePlayerProfileStore.getState().missType);
    const reveal = diagnosisReveal(dx, m);
    const rx = prescriptionLine(dx.fault);
    const blocks = [mem, reveal, miss, rx].filter(Boolean) as string[];
    setPriority(dx);
    setLastValue(dx.value);
    setGoodReps(0);
    setDxStage('reps');
    setDxText(blocks.join('\n\n'));
    say(blocks.join(' '));
  }, []);

  const recordDiagnostic = useCallback(async () => {
    const m = await captureSwing();
    if (!m) {
      const line = "I couldn't read that swing — get your whole swing in frame (face-on is best) and let's try again.";
      setError(line);
      return;
    }
    setLastMetrics(m);

    if (dxStage === 'intro') {
      const dx = diagnoseBaseline(m);
      if (!dx) {
        // Clean swing — reinforce + hand to a sharpening focus.
        const line = diagnosisReveal(null, m);
        setDxText(line);
        setDxStage('homework');
        setPriority(null);
        say(line);
        return;
      }
      setAddressedIds([dx.fault.id]);
      beginPriority(dx, m);
      return;
    }

    if (dxStage === 'reps' && priority) {
      const evalRep = evaluateRep(priority.fault, m, lastValue);
      setLastValue(evalRep.value);
      setDxText(evalRep.line);
      say(evalRep.line);
      if (evalRep.fixed) {
        const nextGood = goodReps + 1;
        setGoodReps(nextGood);
        if (nextGood >= 2) {
          // Lock it in — offer to progress.
          const next = diagnose(m).find((d) => !addressedIds.includes(d.fault.id)) ?? null;
          const line = progressLine(priority.fault, next);
          setTimeout(() => { setDxStage('progress'); setDxText(line); say(line); }, 2200);
        }
      } else {
        setGoodReps(0);
      }
    }
  }, [captureSwing, dxStage, priority, lastValue, goodReps, addressedIds, beginPriority]);

  const recordLesson = useCallback((fault: CoachFault) => {
    try {
      useCoachLessonStore.getState().record({ faultId: fault.id, faultName: fault.name, hitCheckpoint: goodReps >= 2 }, Date.now());
    } catch { /* history is best-effort */ }
  }, [goodReps]);

  const takeNextPriority = useCallback(() => {
    if (priority) recordLesson(priority.fault); // bank the one we just finished
    if (!lastMetrics) { setDxStage('homework'); return; }
    const next = diagnose(lastMetrics).find((d) => !addressedIds.includes(d.fault.id)) ?? null;
    if (!next) { setDxStage('homework'); const hw = priority ? homeworkLine(priority.fault) : ''; setDxText(hw); say(hw); return; }
    setAddressedIds((ids) => [...ids, next.fault.id]);
    beginPriority(next, lastMetrics);
  }, [lastMetrics, addressedIds, priority, beginPriority, recordLesson]);

  const finishToHomework = useCallback(() => {
    if (!priority) { setKind('menu'); return; }
    recordLesson(priority.fault);
    const hw = homeworkLine(priority.fault);
    setDxStage('homework');
    setDxText(hw);
    say(hw);
  }, [priority, recordLesson]);

  // ── focus / guided-plan mode (unchanged behavior) ─────────────────────────
  const startFocus = (f: LessonFocus, spoken: string) => {
    setKind('focus'); setFocus(f); setFeedback(null); setError(null); setRepsOnFocus(0);
    say(spoken);
  };
  const pickFocus = useCallback((f: LessonFocus) => { setPlan(null); setPlanStep(0); startFocus(f, f.instruction); }, []);
  const startPlan = useCallback((p: LessonPlan) => {
    const first = focusById(p.focusIds[0]); if (!first) return;
    setPlan(p); setPlanStep(0); setRep(0); startFocus(first, `${p.intro} ${first.instruction}`);
  }, []);
  const readyToAdvance = plan != null && feedback != null && (feedback.verdict === 'good' || repsOnFocus >= 2);
  const isLastFocusInPlan = plan != null && planStep >= plan.focusIds.length - 1;
  const advanceFocus = useCallback(() => {
    if (!plan) return;
    const nextStep = planStep + 1;
    if (nextStep >= plan.focusIds.length) {
      say(sessionSummaryLine(plan.label)); setPlan(null); setPlanStep(0); setKind('menu'); setFocus(null); setFeedback(null); return;
    }
    const next = focusById(plan.focusIds[nextStep]); if (!next) return;
    setPlanStep(nextStep); startFocus(next, transitionLine(next));
  }, [plan, planStep]);
  const recordFocusSwing = useCallback(async () => {
    if (!focus) return;
    const m = await captureSwing();
    let fb: FocusFeedback;
    if (!m) fb = { verdict: 'unclear', line: "I couldn't pick up your swing — make sure your whole swing is in frame and let's go again.", metricLabel: null };
    else fb = composeFocusFeedback(focus.id, m);
    setFeedback(fb); setRep((n) => n + 1); setRepsOnFocus((n) => n + 1); say(fb.line);
  }, [focus, captureSwing]);

  const s = makeStyles(colors);
  const verdictTint = (v: FocusFeedback['verdict']) => (v === 'good' ? colors.accent : v === 'refine' ? '#f5a623' : colors.text_muted);
  const backToMenu = () => { setKind('menu'); setFocus(null); setFeedback(null); setPlan(null); setPriority(null); setError(null); };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => (kind === 'menu' ? safeBack() : backToMenu())} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>Coach Caddie</Text>
        <View style={s.headerBtn} />
      </View>

      {kind === 'menu' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Flagship — the real diagnostic lesson. */}
          <TouchableOpacity style={s.heroCard} onPress={startDiagnostic} accessibilityRole="button">
            <View style={s.heroTop}>
              <Ionicons name="school" size={22} color="#0d1a0d" />
              <Text style={s.heroTag}>AI LESSON</Text>
            </View>
            <Text style={s.heroTitle}>Get a real lesson</Text>
            <Text style={s.heroSub}>Your caddie watches a swing, finds the one thing costing you the most, and coaches you through it like a pro — feel, drill, and checkpoints.</Text>
            <View style={s.heroCta}><Text style={s.heroCtaText}>Start lesson</Text><Ionicons name="arrow-forward" size={16} color="#0d1a0d" /></View>
          </TouchableOpacity>

          <Text style={s.sectionLabel}>GUIDED SESSIONS</Text>
          {LESSON_PLANS.map((p) => (
            <TouchableOpacity key={p.id} style={s.planRow} onPress={() => startPlan(p)} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Text style={s.focusLabel}>{p.label}</Text>
                <Text style={s.planBlurb}>{p.blurb}</Text>
              </View>
              <Ionicons name="play-circle" size={22} color={colors.accent} />
            </TouchableOpacity>
          ))}

          <Text style={s.sectionLabel}>SINGLE FOCUS</Text>
          {LESSON_FOCUSES.map((f) => (
            <TouchableOpacity key={f.id} style={s.focusRow} onPress={() => pickFocus(f)} accessibilityRole="button">
              <Text style={s.focusLabel}>{f.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.text_muted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : kind === 'diagnostic' ? (
        <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
          {priority && (
            <View style={s.focusPill}>
              <Ionicons name="flag" size={13} color={colors.accent} />
              <Text style={s.focusPillText}>{priority.fault.name}</Text>
              {dxStage === 'reps' && <Text style={s.repText}>· {goodReps}/2 checkpoints</Text>}
            </View>
          )}

          {cap === 'analyzing' ? (
            <View style={s.center}><ActivityIndicator size="large" color={colors.accent} /><Text style={s.dim}>Watching your swing…</Text></View>
          ) : (
            <>
              <View style={s.card}>
                <Text style={s.coachLine}>{dxText}</Text>
              </View>
              {priority && (dxStage === 'reps') && (
                <View style={[s.card, { borderColor: colors.accent }]}>
                  <Text style={s.sectionLabel}>THE DRILL · {priority.fault.drill.name.toUpperCase()}</Text>
                  <Text style={s.drillHow}>{priority.fault.drill.how}</Text>
                  <View style={s.checkRow}>
                    <Ionicons name="checkmark-circle-outline" size={16} color={colors.accent} />
                    <Text style={s.checkText}>Checkpoint: {priority.fault.checkpoint}</Text>
                  </View>
                </View>
              )}
            </>
          )}

          {error && <Text style={s.err}>{error}</Text>}
          <View style={{ flex: 1 }} />

          {cap !== 'analyzing' && dxStage === 'intro' && (
            <TouchableOpacity style={s.primaryBtn} onPress={recordDiagnostic}><Ionicons name="videocam" size={18} color="#0d1a0d" /><Text style={s.primaryText}>Record a baseline swing</Text></TouchableOpacity>
          )}
          {cap !== 'analyzing' && dxStage === 'reps' && (
            <TouchableOpacity style={s.primaryBtn} onPress={recordDiagnostic}><Ionicons name="videocam" size={18} color="#0d1a0d" /><Text style={s.primaryText}>Swing</Text></TouchableOpacity>
          )}
          {dxStage === 'progress' && (
            <>
              <TouchableOpacity style={s.primaryBtn} onPress={takeNextPriority}><Ionicons name="arrow-forward-circle" size={18} color="#0d1a0d" /><Text style={s.primaryText}>Take on the next thing</Text></TouchableOpacity>
              <TouchableOpacity style={s.secondaryBtn} onPress={finishToHomework}><Text style={s.secondaryText}>Bank it & finish</Text></TouchableOpacity>
            </>
          )}
          {dxStage === 'homework' && (
            <TouchableOpacity style={s.primaryBtn} onPress={backToMenu}><Ionicons name="flag" size={18} color="#0d1a0d" /><Text style={s.primaryText}>Got it — end lesson</Text></TouchableOpacity>
          )}
        </ScrollView>
      ) : (
        // Focus / guided-plan mode.
        <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
          <View style={s.focusPill}>
            <Text style={s.focusPillText}>{focus?.label}</Text>
            {plan && <Text style={s.repText}>step {planStep + 1} of {plan.focusIds.length}</Text>}
            {rep > 0 && <Text style={s.repText}>· rep {rep}</Text>}
          </View>

          {cap === 'analyzing' ? (
            <View style={s.center}><ActivityIndicator size="large" color={colors.accent} /><Text style={s.dim}>Watching your swing…</Text></View>
          ) : feedback ? (
            <View style={s.card}>
              <View style={s.verdictRow}>
                <Ionicons name={feedback.verdict === 'good' ? 'checkmark-circle' : feedback.verdict === 'refine' ? 'sync-circle' : 'help-circle'} size={22} color={verdictTint(feedback.verdict)} />
                <Text style={[s.verdictText, { color: verdictTint(feedback.verdict) }]}>{feedback.verdict === 'good' ? 'On it' : feedback.verdict === 'refine' ? 'Refine' : 'Try again'}</Text>
                {feedback.metricLabel && <Text style={s.metric}>{feedback.metricLabel}</Text>}
              </View>
              <Text style={s.feedbackLine}>{feedback.line}</Text>
            </View>
          ) : (
            <View style={s.card}><Text style={s.instruction}>{focus?.instruction}</Text>{focus && <Text style={s.cue}>Cue: {focus.cue}</Text>}</View>
          )}

          {error && <Text style={s.err}>{error}</Text>}
          <View style={{ flex: 1 }} />

          {cap !== 'analyzing' && (
            readyToAdvance ? (
              <TouchableOpacity style={s.primaryBtn} onPress={advanceFocus}>
                <Ionicons name={isLastFocusInPlan ? 'flag' : 'arrow-forward-circle'} size={18} color="#0d1a0d" />
                <Text style={s.primaryText}>{isLastFocusInPlan ? 'Finish session' : `Next: ${focusById(plan!.focusIds[planStep + 1])?.label ?? 'continue'}`}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.primaryBtn} onPress={recordFocusSwing}>
                <Ionicons name="videocam" size={18} color="#0d1a0d" /><Text style={s.primaryText}>{feedback ? 'Swing again' : 'Record my swing'}</Text>
              </TouchableOpacity>
            )
          )}
          {readyToAdvance && (
            <TouchableOpacity style={s.secondaryBtn} onPress={recordFocusSwing}><Text style={s.secondaryText}>One more on this</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={s.secondaryBtn} onPress={backToMenu}><Text style={s.secondaryText}>{plan ? 'End session' : 'Change focus'}</Text></TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text_primary, fontSize: 18, fontWeight: '800' },
    heroCard: { backgroundColor: colors.accent, borderRadius: 16, padding: 18, gap: 8 },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    heroTag: { color: '#0d1a0d', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
    heroTitle: { color: '#0d1a0d', fontSize: 22, fontWeight: '900' },
    heroSub: { color: '#0d1a0d', fontSize: 14, lineHeight: 20, opacity: 0.85 },
    heroCta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    heroCtaText: { color: '#0d1a0d', fontSize: 15, fontWeight: '800' },
    sectionLabel: { color: colors.text_muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: 22, marginBottom: 2 },
    planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, padding: 16, marginTop: 12 },
    planBlurb: { color: colors.text_muted, fontSize: 13, marginTop: 3 },
    focusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 12 },
    focusLabel: { color: colors.text_primary, fontSize: 16, fontWeight: '700' },
    focusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16 },
    focusPillText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
    repText: { color: colors.text_muted, fontSize: 12, fontWeight: '600' },
    center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 60 },
    dim: { color: colors.text_muted, fontSize: 14, textAlign: 'center' },
    card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8, marginBottom: 12 },
    coachLine: { color: colors.text_primary, fontSize: 16, lineHeight: 24 },
    drillHow: { color: colors.text_primary, fontSize: 15, lineHeight: 22 },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
    checkText: { flex: 1, color: colors.text_muted, fontSize: 13, lineHeight: 18 },
    instruction: { color: colors.text_primary, fontSize: 17, fontWeight: '600', lineHeight: 24 },
    cue: { color: colors.text_muted, fontSize: 14, fontStyle: 'italic' },
    verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    verdictText: { fontSize: 16, fontWeight: '800' },
    metric: { color: colors.text_muted, fontSize: 13, fontWeight: '600', marginLeft: 'auto' },
    feedbackLine: { color: colors.text_primary, fontSize: 16, lineHeight: 23 },
    err: { color: '#F0803C', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 12 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 15, marginTop: 12 },
    primaryText: { color: '#0d1a0d', fontSize: 16, fontWeight: '800' },
    secondaryBtn: { alignItems: 'center', paddingVertical: 14 },
    secondaryText: { color: colors.text_muted, fontSize: 14, fontWeight: '700' },
  });
}
