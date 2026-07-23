/**
 * 2026-07-23 (Tim — Coach Caddie Card, Phase 1). A compartmentalized guided lesson.
 *
 * The Caddie names ONE focus, you record a swing, it analyzes that swing scoped to the focus and
 * speaks feedback, then you go again. Turn-based (tap to record — no live mic contention). This
 * screen composes ONLY standalone primitives — SmartMotion swing analysis + voiceService.speak —
 * and deliberately imports NONE of the frozen live-voice hooks (useVoiceCaddie / usePipecatVoice /
 * VAD), so it can't affect any other flow. See services/coachLesson.ts.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../contexts/ThemeContext';
import { safeBack } from '../../services/safeBack';
import { analyzeSwingFromVideo } from '../../services/poseAnalysisApi';
import { LESSON_FOCUSES, LESSON_PLANS, composeFocusFeedback, focusById, transitionLine, sessionSummaryLine, type LessonFocus, type LessonPlan, type FocusFeedback } from '../../services/coachLesson';
import { speak } from '../../services/voiceService';
import { useSettingsStore } from '../../store/settingsStore';
import { getApiBaseUrl } from '../../services/apiBase';

type Phase = 'picker' | 'ready' | 'analyzing' | 'feedback';

// Best-effort spoken line. Uses the standalone one-voice-safe speak(); never throws / blocks.
function say(text: string) {
  try {
    const s = useSettingsStore.getState();
    void speak(text, s.voiceGender, s.language ?? 'en', getApiBaseUrl(), { userInitiated: true })?.catch?.(() => undefined);
  } catch { /* speech is optional */ }
}

export default function CoachLessonScreen() {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('picker');
  const [focus, setFocus] = useState<LessonFocus | null>(null);
  const [rep, setRep] = useState(0);
  const [feedback, setFeedback] = useState<FocusFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guided-session state. plan null = single-focus mode. planStep = index into plan.focusIds;
  // repsOnFocus gates auto-advance (advance after a 'good' rep or 2 reps so nobody gets stuck).
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [planStep, setPlanStep] = useState(0);
  const [repsOnFocus, setRepsOnFocus] = useState(0);

  const startFocus = (f: LessonFocus, spoken: string) => {
    setFocus(f);
    setFeedback(null);
    setError(null);
    setRepsOnFocus(0);
    setPhase('ready');
    say(spoken);
  };

  const pickFocus = useCallback((f: LessonFocus) => {
    setPlan(null);
    setPlanStep(0);
    startFocus(f, f.instruction);
  }, []);

  const startPlan = useCallback((p: LessonPlan) => {
    const first = focusById(p.focusIds[0]);
    if (!first) return;
    setPlan(p);
    setPlanStep(0);
    setRep(0);
    startFocus(first, `${p.intro} ${first.instruction}`);
  }, []);

  // Whether the current focus is "complete" and the session should offer the next one.
  const readyToAdvance = plan != null && feedback != null && (feedback.verdict === 'good' || repsOnFocus >= 2);
  const isLastFocusInPlan = plan != null && planStep >= plan.focusIds.length - 1;

  const advanceFocus = useCallback(() => {
    if (!plan) return;
    const nextStep = planStep + 1;
    if (nextStep >= plan.focusIds.length) {
      // Session done.
      say(sessionSummaryLine(plan.label));
      setPlan(null);
      setPlanStep(0);
      setPhase('picker');
      setFocus(null);
      setFeedback(null);
      return;
    }
    const next = focusById(plan.focusIds[nextStep]);
    if (!next) return;
    setPlanStep(nextStep);
    startFocus(next, transitionLine(next));
  }, [plan, planStep]);

  const recordSwing = useCallback(async () => {
    if (!focus) return;
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError('Camera permission is needed to watch your swing.'); return; }
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 12, quality: 0.7, allowsEditing: false });
    } catch { setError('Could not open the camera. Try again.'); return; }
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset?.uri) return;
    setPhase('analyzing');
    // expo-image-picker returns duration in ms on most platforms; guard the odd seconds case.
    const raw = asset.duration ?? 0;
    const durationMs = raw > 0 && raw < 100 ? raw * 1000 : raw || 4000;
    let fb: FocusFeedback;
    try {
      const analysis = await analyzeSwingFromVideo(asset.uri, durationMs);
      fb = analysis
        ? composeFocusFeedback(focus.id, analysis)
        : { verdict: 'unclear', line: "I couldn't pick up your swing on that clip — make sure your whole swing is in frame and let's go again.", metricLabel: null };
    } catch {
      fb = { verdict: 'unclear', line: "That analysis didn't come through — let's run the swing again.", metricLabel: null };
    }
    setFeedback(fb);
    setRep((n) => n + 1);
    setRepsOnFocus((n) => n + 1);
    setPhase('feedback');
    say(fb.line);
  }, [focus]);

  const s = makeStyles(colors);
  const verdictTint = (v: FocusFeedback['verdict']) => (v === 'good' ? colors.accent : v === 'refine' ? '#f5a623' : colors.text_muted);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => safeBack()} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="End lesson">
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>Coach Caddie</Text>
        <View style={s.headerBtn} />
      </View>

      {phase === 'picker' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={s.lead}>What do you want to work on?</Text>
          <Text style={[s.dim, { textAlign: 'left' }]}>Run a guided session, or pick a single focus. Your caddie coaches one thing at a time as you swing.</Text>

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
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
          <View style={s.focusPill}>
            <Text style={s.focusPillText}>{focus?.label}</Text>
            {plan && <Text style={s.repText}>step {planStep + 1} of {plan.focusIds.length}</Text>}
            {rep > 0 && <Text style={s.repText}>· rep {rep}</Text>}
          </View>

          {phase === 'analyzing' ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={s.dim}>Watching your swing…</Text>
            </View>
          ) : phase === 'feedback' && feedback ? (
            <View style={s.card}>
              <View style={s.verdictRow}>
                <Ionicons
                  name={feedback.verdict === 'good' ? 'checkmark-circle' : feedback.verdict === 'refine' ? 'sync-circle' : 'help-circle'}
                  size={22}
                  color={verdictTint(feedback.verdict)}
                />
                <Text style={[s.verdictText, { color: verdictTint(feedback.verdict) }]}>
                  {feedback.verdict === 'good' ? 'On it' : feedback.verdict === 'refine' ? 'Refine' : 'Try again'}
                </Text>
                {feedback.metricLabel && <Text style={s.metric}>{feedback.metricLabel}</Text>}
              </View>
              <Text style={s.feedbackLine}>{feedback.line}</Text>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.instruction}>{focus?.instruction}</Text>
              {focus && <Text style={s.cue}>Cue: {focus.cue}</Text>}
            </View>
          )}

          {error && <Text style={s.err}>{error}</Text>}

          <View style={{ flex: 1 }} />

          {phase !== 'analyzing' && (
            readyToAdvance ? (
              // In a guided session and this focus is nailed / had its reps — move on.
              <TouchableOpacity style={s.primaryBtn} onPress={advanceFocus} accessibilityRole="button">
                <Ionicons name={isLastFocusInPlan ? 'flag' : 'arrow-forward-circle'} size={18} color="#0d1a0d" />
                <Text style={s.primaryText}>
                  {isLastFocusInPlan ? 'Finish session' : `Next: ${focusById(plan!.focusIds[planStep + 1])?.label ?? 'continue'}`}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.primaryBtn} onPress={recordSwing} accessibilityRole="button">
                <Ionicons name="videocam" size={18} color="#0d1a0d" />
                <Text style={s.primaryText}>{phase === 'feedback' ? 'Swing again' : 'Record my swing'}</Text>
              </TouchableOpacity>
            )
          )}
          {/* In a session, still allow re-swinging the current focus even when advance is offered. */}
          {readyToAdvance && phase === 'feedback' && (
            <TouchableOpacity style={s.secondaryBtn} onPress={recordSwing} accessibilityRole="button">
              <Text style={s.secondaryText}>One more on this</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.secondaryBtn} onPress={() => { setPlan(null); setPhase('picker'); setFocus(null); setFeedback(null); }} accessibilityRole="button">
            <Text style={s.secondaryText}>{plan ? 'End session' : 'Change focus'}</Text>
          </TouchableOpacity>
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
    lead: { color: colors.text_primary, fontSize: 20, fontWeight: '800' },
    dim: { color: colors.text_muted, fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
    focusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 12 },
    focusLabel: { color: colors.text_primary, fontSize: 16, fontWeight: '700' },
    sectionLabel: { color: colors.text_muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: 22, marginBottom: 2 },
    planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, padding: 16, marginTop: 12 },
    planBlurb: { color: colors.text_muted, fontSize: 13, marginTop: 3 },
    focusPill: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16 },
    focusPillText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
    repText: { color: colors.text_muted, fontSize: 12, fontWeight: '600' },
    center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 60 },
    card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
    instruction: { color: colors.text_primary, fontSize: 17, fontWeight: '600', lineHeight: 24 },
    cue: { color: colors.text_muted, fontSize: 14, fontStyle: 'italic' },
    verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    verdictText: { fontSize: 16, fontWeight: '800' },
    metric: { color: colors.text_muted, fontSize: 13, fontWeight: '600', marginLeft: 'auto' },
    feedbackLine: { color: colors.text_primary, fontSize: 16, lineHeight: 23 },
    err: { color: '#F0803C', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 12 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 15, marginTop: 16 },
    primaryText: { color: '#0d1a0d', fontSize: 16, fontWeight: '800' },
    secondaryBtn: { alignItems: 'center', paddingVertical: 14 },
    secondaryText: { color: colors.text_muted, fontSize: 14, fontWeight: '700' },
  });
}
