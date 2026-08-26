/**
 * 2026-07-23 (Tim — "make Coach Caddie an elite, unique lesson experience, drawn from real coaches").
 * 2026-07-24 REBUILD (Tim — "doesn't flow like a real lesson"): CAMERA-FIRST + AUTO-LOOP. The old flow
 * was a form — a wall of intro text, a manual "Record my swing" tap to open the camera as a SEPARATE
 * step, a black analyzing spinner, then a tap to bracket every rep. A real lesson is continuous: the
 * coach is already watching, talks you through in short lines, and reacts to each swing automatically.
 *
 * Now: starting a session drops you STRAIGHT onto the live camera. The coach speaks a SHORT opener,
 * then auto-captures a swing window, reads it, speaks feedback as a caption over the still-live camera,
 * and re-arms for the next swing — a hands-free rhythm the coach paces ("go again"), no per-rep taps.
 * Guided plans auto-advance on the checkpoint. A Pause/End bar is always available, and the honest
 * "couldn't read that one — reframe" stays IN the loop (never dumps to the menu).
 *
 * Compartmentalized: composes ONLY standalone primitives (SmartMotion swing analysis + voiceService)
 * and imports NONE of the frozen live-voice hooks. Coaching brain is services/coachKnowledge +
 * coachSession + coachLesson (all pure + unit-tested); this file is the flow shell around them.
 *
 * Strike AUTO-DETECT (react to the exact moment of impact vs a rolling window) + the diagnostic mode
 * sharing the same auto-loop are the next increment — device-tune (see memory: realtime-virtual-caddie-lesson).
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../contexts/ThemeContext';
import { safeBack } from '../../services/safeBack';
import { analyzeSwingFromVideo, type SwingBiomechanics } from '../../services/poseAnalysisApi';
import { resolveSwingerHandedness } from '../../services/swingerHandedness';
import { LESSON_FOCUSES, LESSON_PLANS, composeFocusFeedback, focusById, transitionLine, sessionSummaryLine, openerLine, type LessonFocus, type LessonPlan, type FocusFeedback } from '../../services/coachLesson';
import { diagnose, isDiagnosable, type CoachFault, type Diagnosis } from '../../services/coachKnowledge';
import { introLine, diagnosisReveal, prescriptionLine, evaluateRep, progressLine, homeworkLine, diagnoseBaseline, missConnectionLine, memoryLine } from '../../services/coachSession';
import { speak, stopSpeaking } from '../../services/voiceService';
import { prewarmVoice } from '../../services/voiceWarmup';
import { CoachSwingCamera, type CoachCameraHandle } from '../../components/coach/CoachSwingCamera';
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
type DxStage = 'intro' | 'reps' | 'progress' | 'homework';
// Camera-first phase — drives the caption + control bar while a session is live.
type Phase = 'watching' | 'reading' | 'feedback';

const WINDOW_SEC = 10;       // rolling swing window (the coach paces you to swing within it)
const REARM_MS = 900;        // beat after feedback before re-arming the next window
const OPENER_LEAD_MS = 2600; // let the short spoken opener land before the first window opens

export default function CoachLessonScreen() {
  const { colors } = useTheme();
  const [kind, setKind] = useState<Kind>('menu');
  const [error, setError] = useState<string | null>(null);

  // Camera-first session shell.
  const [sessionLive, setSessionLive] = useState(false); // camera mounted + coaching overlays shown
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<Phase>('watching');
  const [caption, setCaption] = useState('');            // the line shown over the live camera
  const sessionLiveRef = useRef(false);
  const pausedRef = useRef(false);
  const preparedRef = useRef(false);
  const promptRef = useRef('Make a swing when you\'re ready.'); // current "go" line for the window
  const loopGenRef = useRef(0);                          // invalidates stale in-flight loop steps
  const rearmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { sessionLiveRef.current = sessionLive; }, [sessionLive]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Focus / guided-plan mode.
  const [focus, setFocus] = useState<LessonFocus | null>(null);
  const [feedback, setFeedback] = useState<FocusFeedback | null>(null);
  const [rep, setRep] = useState(0);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [planStep, setPlanStep] = useState(0);
  const [repsOnFocus, setRepsOnFocus] = useState(0);
  // Mirror the fast-changing plan state into refs so the async loop reads current values (no stale closures).
  const focusRef = useRef<LessonFocus | null>(null);
  const planRef = useRef<LessonPlan | null>(null);
  const planStepRef = useRef(0);
  const repsOnFocusRef = useRef(0);
  useEffect(() => { focusRef.current = focus; }, [focus]);
  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { planStepRef.current = planStep; }, [planStep]);
  useEffect(() => { repsOnFocusRef.current = repsOnFocus; }, [repsOnFocus]);

  // Diagnostic lesson mode (tap-to-swing on the live camera; per-swing diagnosis is a bigger moment).
  const [dxStage, setDxStage] = useState<DxStage>('intro');
  const [priority, setPriority] = useState<Diagnosis | null>(null);
  // 2026-08-26 — `dxText` removed: it was written seven times and read nowhere. Every write was
  // paired with setCaption(...) and say(...), so the caption already rendered the text and the voice
  // already spoke it — this was a parallel copy of state that no longer had a consumer.
  const [lastValue, setLastValue] = useState<number | null>(null);
  const [goodReps, setGoodReps] = useState(0);
  const [lastMetrics, setLastMetrics] = useState<SwingBiomechanics | null>(null);
  const [addressedIds, setAddressedIds] = useState<string[]>([]);
  const [pendingProgress, setPendingProgress] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const captureInFlightRef = useRef(false);
  const coachCamRef = useRef<CoachCameraHandle>(null);

  const clearRearm = useCallback(() => { if (rearmRef.current) { clearTimeout(rearmRef.current); rearmRef.current = null; } }, []);
  const clearProgressTimer = useCallback(() => {
    if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null; }
    setPendingProgress(false);
  }, []);

  // Warm TTS on open so the first coaching word lands fast (a real coach doesn't pause 4s before talking).
  useEffect(() => { try { prewarmVoice(); } catch { /* opportunistic */ } }, []);
  // Stop everything on unmount — no timers, speech, or state-sets after leaving.
  useEffect(() => () => {
    loopGenRef.current++;
    if (rearmRef.current) clearTimeout(rearmRef.current);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    void stopSpeaking().catch(() => {});
  }, []);

  // ── camera on the live session (no per-rep mount) ──────────────────────────
  const prepareCamera = useCallback(async (): Promise<boolean> => {
    if (preparedRef.current) return true;
    const ready = await (coachCamRef.current?.prepare() ?? Promise.resolve(false));
    preparedRef.current = !!ready;
    return preparedRef.current;
  }, []);

  // Record ONE swing window on the already-live camera + analyze. Returns null when the camera can't
  // record (falls the caller back to the image-picker) or the window held no readable swing.
  const recordAndAnalyze = useCallback(async (): Promise<{ ok: boolean; m: SwingBiomechanics | null }> => {
    const uri = await (coachCamRef.current?.record(WINDOW_SEC) ?? Promise.resolve(null));
    if (!uri) return { ok: false, m: null };
    setPhase('reading'); setCaption('Reading that one…');
    try {
      // angle null → computeBiomechanics infers it from pose geometry (nulls DTL-invalid metrics so the
      // caddie never speaks a wrong number); handedness threaded so lefties read correctly.
      const m = await analyzeSwingFromVideo(uri, WINDOW_SEC * 1000, null, false, null, null, resolveSwingerHandedness());
      return { ok: true, m };
    } catch {
      return { ok: true, m: null };
    }
  }, []);

  // Image-picker fallback — only when the in-app camera can't start (permission flow / unavailable).
  const captureViaPicker = useCallback(async (): Promise<SwingBiomechanics | null> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError('Camera permission is needed to watch your swing.'); return null; }
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 12, quality: 0.7, allowsEditing: false });
    } catch { setError('Could not open the camera. Try again.'); return null; }
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset?.uri) return null;
    const raw = asset.duration ?? 0;
    const durationMs = raw > 0 && raw < 100 ? raw * 1000 : raw || 4000;
    try {
      return await analyzeSwingFromVideo(asset.uri, durationMs, null, false, null, null, resolveSwingerHandedness());
    } catch {
      return null;
    }
  }, []);

  // ── FOCUS / GUIDED-PLAN auto-loop ──────────────────────────────────────────
  // One rep: watch a window → read it → speak feedback as a caption → advance the plan or re-arm.
  // Recursive via a cancelable timer (not a while-loop) so it plays nice with React + Pause/End.
  const focusRep = useCallback(async () => {
    if (!sessionLiveRef.current || pausedRef.current || captureInFlightRef.current) return;
    const f = focusRef.current;
    if (!f) return;
    const gen = loopGenRef.current;
    captureInFlightRef.current = true;
    try {
      setPhase('watching'); setCaption(promptRef.current); setError(null);
      const { ok, m } = await recordAndAnalyze();
      // Bail if the session ended OR the user paused DURING the window (don't analyze/speak past a pause).
      if (gen !== loopGenRef.current || !sessionLiveRef.current || pausedRef.current) return;
      if (!ok) {
        // In-app camera couldn't record — fall back to the picker so the lesson still works. Re-arm
        // afterwards either way (a cancelled picker must NOT silently kill the loop).
        const pm = await captureViaPicker();
        if (gen !== loopGenRef.current || !sessionLiveRef.current || pausedRef.current) return;
        if (pm) applyFocusResult(f, pm);
        else scheduleRearm(focusRep, REARM_MS);
        return;
      }
      if (!m) {
        // Empty window — don't nag every time; just keep watching with a soft re-prompt.
        promptRef.current = 'Take your time — swing when you\'re ready.';
        setPhase('watching'); setCaption(promptRef.current);
        scheduleRearm(focusRep, REARM_MS);
        return;
      }
      applyFocusResult(f, m);
    } finally {
      captureInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordAndAnalyze, captureViaPicker]);

  // Apply a read swing to the focus/plan state: feedback caption + speech, then advance or re-arm.
  const applyFocusResult = useCallback((f: LessonFocus, m: SwingBiomechanics) => {
    const fb = composeFocusFeedback(f.id, m);
    setFeedback(fb); setRep((n) => n + 1);
    const repsNow = repsOnFocusRef.current + 1;
    setRepsOnFocus(repsNow);
    setPhase('feedback'); setCaption(fb.line); say(fb.line);

    const p = planRef.current;
    const hitCheckpoint = fb.verdict === 'good' || repsNow >= 2;
    if (p && hitCheckpoint) {
      const step = planStepRef.current;
      const nextStep = step + 1;
      if (nextStep >= p.focusIds.length) {
        // Plan complete — wrap up and end the session after the win line is heard.
        scheduleRearm(() => { say(sessionSummaryLine(p.label)); endSession(); }, 2600);
        return;
      }
      const next = focusById(p.focusIds[nextStep]);
      if (next) {
        // Auto-advance: speak the transition after the feedback lands, move to the next focus, keep watching.
        scheduleRearm(() => {
          if (!sessionLiveRef.current) return;
          setPlanStep(nextStep); setFocus(next); setFeedback(null); setRepsOnFocus(0);
          const opener = transitionLine(next);
          promptRef.current = `${next.cue} — swing when you\'re ready.`;
          setPhase('watching'); setCaption(opener); say(opener);
          scheduleRearm(focusRep, OPENER_LEAD_MS);
        }, 2600);
        return;
      }
    }
    // Same focus — re-arm the next rep after the feedback is heard.
    promptRef.current = 'Go again.';
    scheduleRearm(focusRep, 3200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRep]);

  const scheduleRearm = useCallback((fn: () => void, ms: number) => {
    clearRearm();
    if (pausedRef.current || !sessionLiveRef.current) return;
    rearmRef.current = setTimeout(() => { rearmRef.current = null; if (!pausedRef.current && sessionLiveRef.current) void fn(); }, ms);
  }, [clearRearm]);

  // ── session lifecycle ──────────────────────────────────────────────────────
  const goLiveAndOpen = useCallback(async (opener: string, firstPrompt: string) => {
    loopGenRef.current++;
    // 2026-07-25 (Tim — "double overlapping text + races in the caddie's speech" on Coach Caddie) — a
    // lesson must OWN the voice. If the global caddie was still mid-line when the lesson starts (a
    // pending brain response, the post-splash opener, an active-listening reply), that speech + the
    // lesson's opener play over each other and both captions render. Cancel any in-flight speech first
    // so only the lesson speaks. stopSpeaking() kills both the cloud/mp3 and device-TTS pipelines.
    try { await stopSpeaking(); } catch { /* best-effort */ }
    setSessionLive(true); sessionLiveRef.current = true;
    setPaused(false); pausedRef.current = false;
    setError(null); setFeedback(null);
    promptRef.current = firstPrompt;
    setPhase('watching'); setCaption(opener);
    await new Promise((r) => setTimeout(r, 250)); // let the camera mount so record() has a handle
    const ready = await prepareCamera();
    say(opener);
    if (ready) scheduleRearm(focusRep, OPENER_LEAD_MS);
    // No camera → the first focusRep falls back to the picker on its own.
    else scheduleRearm(focusRep, OPENER_LEAD_MS);
  }, [prepareCamera, scheduleRearm, focusRep]);

  const startFocus = useCallback((f: LessonFocus, opener: string) => {
    setKind('focus'); setFocus(f); focusRef.current = f; setRep(0); setRepsOnFocus(0);
    void goLiveAndOpen(opener, `${f.cue} — swing when you\'re ready.`);
  }, [goLiveAndOpen]);
  const pickFocus = useCallback((f: LessonFocus) => {
    setPlan(null); planRef.current = null; setPlanStep(0); planStepRef.current = 0;
    startFocus(f, openerLine(f));
  }, [startFocus]);
  const startPlan = useCallback((p: LessonPlan) => {
    const first = focusById(p.focusIds[0]); if (!first) return;
    setPlan(p); planRef.current = p; setPlanStep(0); planStepRef.current = 0;
    setKind('focus'); setFocus(first); focusRef.current = first; setRep(0); setRepsOnFocus(0);
    void goLiveAndOpen(`${p.intro} ${openerLine(first)}`, `${first.cue} — swing when you\'re ready.`);
  }, [goLiveAndOpen]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (next) { clearRearm(); void stopSpeaking().catch(() => {}); coachCamRef.current?.stop(); setCaption('Paused — tap resume when you\'re set.'); }
      else { setCaption(promptRef.current); scheduleRearm(focusRep, 400); }
      return next;
    });
  }, [clearRearm, scheduleRearm, focusRep]);

  const endSession = useCallback(() => {
    loopGenRef.current++;
    clearRearm(); clearProgressTimer();
    coachCamRef.current?.stop();
    void stopSpeaking().catch(() => {});
    setSessionLive(false); sessionLiveRef.current = false;
    setPaused(false); pausedRef.current = false;
    preparedRef.current = false;
    setKind('menu'); setFocus(null); setFeedback(null); setPlan(null); setPriority(null); setError(null);
  }, [clearRearm, clearProgressTimer]);

  // ── diagnostic lesson (tap-to-swing on the live camera) ────────────────────
  const startDiagnostic = useCallback(() => {
    setKind('diagnostic'); setDxStage('intro'); setPriority(null); setLastValue(null);
    setGoodReps(0); setLastMetrics(null); setAddressedIds([]); setError(null);
    const intro = introLine();
    loopGenRef.current++;
    setSessionLive(true); sessionLiveRef.current = true; setPaused(false); pausedRef.current = false;
    setPhase('watching'); setCaption(intro);
    // Same as goLiveAndOpen — cancel any in-flight global caddie speech so the lesson intro doesn't
    // race it (double voice + double caption). See the note there.
    void (async () => { try { await stopSpeaking(); } catch { /* best-effort */ } await new Promise((r) => setTimeout(r, 250)); await prepareCamera(); say(intro); })();
  }, [prepareCamera]);

  const beginPriority = useCallback((dx: Diagnosis, m: SwingBiomechanics) => {
    const prior = useCoachLessonStore.getState().lastFor(dx.fault.id);
    const days = prior ? Math.floor((Date.now() - prior.at) / 86_400_000) : null;
    const mem = memoryLine(dx.fault.name, days);
    const miss = missConnectionLine(dx.fault.id, usePlayerProfileStore.getState().missType);
    const reveal = diagnosisReveal(dx, m);
    const rx = prescriptionLine(dx.fault);
    const blocks = [mem, reveal, miss, rx].filter(Boolean) as string[];
    setPriority(dx); setLastValue(dx.value); setGoodReps(0); setDxStage('reps');
    setCaption(blocks[0] ?? reveal); say(blocks.join(' '));
  }, []);

  const recordDiagnostic = useCallback(async () => {
    if (captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    try {
      setPhase('watching'); setCaption('Swing when you\'re ready — I\'m watching.'); setError(null);
      const { ok, m: liveM } = await recordAndAnalyze();
      const m = ok ? liveM : await captureViaPicker();
      if (!m) {
        const line = "I couldn't read that swing — get your whole swing in frame, face-on, and let's try again.";
        setError(line); setPhase('watching'); setCaption(line);
        return;
      }
      setLastMetrics(m); setPhase('feedback');

      if (dxStage === 'intro') {
        if (!isDiagnosable(m)) {
          const line = "I couldn't read enough of that swing to coach it — film face-on, whole swing in frame, good light, and give me another.";
          setError(line); setCaption(line); say(line); return;
        }
        const dx = diagnoseBaseline(m);
        if (!dx) {
          const line = diagnosisReveal(null, m);
          setCaption(line); setDxStage('homework'); setPriority(null); say(line); return;
        }
        setAddressedIds([dx.fault.id]); beginPriority(dx, m); return;
      }

      if (dxStage === 'reps' && priority) {
        const evalRep = evaluateRep(priority.fault, m, lastValue);
        setLastValue(evalRep.value); setCaption(evalRep.line); say(evalRep.line);
        if (evalRep.fixed) {
          const nextGood = goodReps + 1; setGoodReps(nextGood);
          if (nextGood >= 2) {
            const next = diagnose(m).find((d) => !addressedIds.includes(d.fault.id)) ?? null;
            const line = progressLine(priority.fault, next);
            setPendingProgress(true);
            if (progressTimer.current) clearTimeout(progressTimer.current);
            progressTimer.current = setTimeout(() => {
              progressTimer.current = null; setPendingProgress(false);
              setDxStage('progress'); setCaption(line); say(line);
            }, 2200);
          }
        } else { setGoodReps(0); }
      }
    } finally {
      captureInFlightRef.current = false;
    }
  }, [recordAndAnalyze, captureViaPicker, dxStage, priority, lastValue, goodReps, addressedIds, beginPriority]);

  const recordLesson = useCallback((fault: CoachFault) => {
    try { useCoachLessonStore.getState().record({ faultId: fault.id, faultName: fault.name, hitCheckpoint: goodReps >= 2 }, Date.now()); } catch { /* best-effort */ }
  }, [goodReps]);
  const takeNextPriority = useCallback(() => {
    if (priority) recordLesson(priority.fault);
    if (!lastMetrics) { setDxStage('homework'); return; }
    const next = diagnose(lastMetrics).find((d) => !addressedIds.includes(d.fault.id)) ?? null;
    if (!next) { setDxStage('homework'); const hw = priority ? homeworkLine(priority.fault) : ''; setCaption(hw); say(hw); return; }
    setAddressedIds((ids) => [...ids, next.fault.id]); beginPriority(next, lastMetrics);
  }, [lastMetrics, addressedIds, priority, beginPriority, recordLesson]);
  const finishToHomework = useCallback(() => {
    if (!priority) { endSession(); return; }
    recordLesson(priority.fault);
    const hw = homeworkLine(priority.fault); setDxStage('homework'); setCaption(hw); say(hw);
  }, [priority, recordLesson, endSession]);

  const s = makeStyles(colors);

  // ── MENU ───────────────────────────────────────────────────────────────────
  if (kind === 'menu') {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => safeBack()} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
          </TouchableOpacity>
          <Text style={s.title}>Coach Caddie</Text>
          <View style={s.headerBtn} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <TouchableOpacity style={s.heroCard} onPress={startDiagnostic} accessibilityRole="button">
            <View style={s.heroTop}><Ionicons name="school" size={22} color="#0d1a0d" /><Text style={s.heroTag}>AI LESSON</Text></View>
            <Text style={s.heroTitle}>Get a real lesson</Text>
            <Text style={s.heroSub}>Your caddie watches a swing, finds the one thing costing you the most, and coaches you through it like a pro — feel, drill, and checkpoints.</Text>
            <View style={s.heroCta}><Text style={s.heroCtaText}>Start lesson</Text><Ionicons name="arrow-forward" size={16} color="#0d1a0d" /></View>
          </TouchableOpacity>

          <Text style={s.sectionLabel}>GUIDED SESSIONS</Text>
          {LESSON_PLANS.map((p) => (
            <TouchableOpacity key={p.id} style={s.planRow} onPress={() => startPlan(p)} accessibilityRole="button">
              <View style={{ flex: 1 }}><Text style={s.focusLabel}>{p.label}</Text><Text style={s.planBlurb}>{p.blurb}</Text></View>
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
      </SafeAreaView>
    );
  }

  // ── LIVE SESSION (camera-first, both modes) ─────────────────────────────────
  const isDiag = kind === 'diagnostic';
  const stepLabel = plan ? `step ${planStep + 1} of ${plan.focusIds.length}` : null;
  const pillText = isDiag ? (priority?.fault.name ?? 'Baseline') : (focus?.label ?? 'Focus');

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {/* Persistent live camera — the lesson surface for the whole session (mounts once, no per-rep flip). */}
      {sessionLive && <CoachSwingCamera ref={coachCamRef} facing="back" style={StyleSheet.absoluteFill} />}
      <View style={s.scrimTop} pointerEvents="none" />
      <View style={s.scrimBottom} pointerEvents="none" />

      {/* Header over the camera. */}
      <View style={s.headerOverlay}>
        <TouchableOpacity onPress={endSession} style={s.headerBtn} accessibilityRole="button" accessibilityLabel="End lesson">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.livePill}>
          <View style={[s.liveDot, { backgroundColor: phase === 'watching' && !paused ? '#ff5252' : colors.accent }]} />
          <Text style={s.livePillText}>{pillText}{stepLabel ? ` · ${stepLabel}` : ''}{rep > 0 && !isDiag ? ` · rep ${rep}` : ''}</Text>
        </View>
        <View style={s.headerBtn} />
      </View>

      {/* Phase chip (watching / reading) — subtle, over the camera, replaces the black spinner. */}
      <View style={s.phaseWrap} pointerEvents="none">
        {phase === 'reading' ? (
          <View style={s.phaseChip}><ActivityIndicator size="small" color="#fff" /><Text style={s.phaseChipText}>Reading that one…</Text></View>
        ) : phase === 'watching' && !paused ? (
          <View style={s.phaseChip}><Ionicons name="eye" size={14} color="#fff" /><Text style={s.phaseChipText}>Watching</Text></View>
        ) : null}
      </View>

      {/* Coaching caption — the coach's current line, over the camera. */}
      <View style={s.captionWrap} pointerEvents="box-none">
        {isDiag && dxStage === 'reps' && priority && (
          <View style={s.drillChip}>
            <Text style={s.drillChipLabel}>DRILL · {priority.fault.drill.name.toUpperCase()}</Text>
            <Text style={s.drillChipHow}>{priority.fault.drill.how}</Text>
          </View>
        )}
        <Text style={s.captionText}>{error ?? caption}</Text>
        {feedback?.metricLabel && !isDiag && <Text style={s.captionMetric}>{feedback.metricLabel}</Text>}
      </View>

      {/* Control bar. */}
      <View style={s.controlBar}>
        {isDiag ? (
          // Diagnostic: tap-to-swing on the live camera; decision points stay explicit.
          <>
            {dxStage === 'intro' && phase !== 'reading' && (
              <TouchableOpacity style={s.ctrlPrimary} onPress={recordDiagnostic}><Ionicons name="videocam" size={18} color="#0d1a0d" /><Text style={s.ctrlPrimaryText}>Record a baseline swing</Text></TouchableOpacity>
            )}
            {dxStage === 'reps' && !pendingProgress && phase !== 'reading' && (
              <TouchableOpacity style={s.ctrlPrimary} onPress={recordDiagnostic}><Ionicons name="videocam" size={18} color="#0d1a0d" /><Text style={s.ctrlPrimaryText}>Swing</Text></TouchableOpacity>
            )}
            {dxStage === 'progress' && (
              <>
                <TouchableOpacity style={s.ctrlPrimary} onPress={takeNextPriority}><Ionicons name="arrow-forward-circle" size={18} color="#0d1a0d" /><Text style={s.ctrlPrimaryText}>Take on the next thing</Text></TouchableOpacity>
                <TouchableOpacity style={s.ctrlGhost} onPress={finishToHomework}><Text style={s.ctrlGhostText}>Bank it & finish</Text></TouchableOpacity>
              </>
            )}
            {dxStage === 'homework' && (
              <TouchableOpacity style={s.ctrlPrimary} onPress={endSession}><Ionicons name="flag" size={18} color="#0d1a0d" /><Text style={s.ctrlPrimaryText}>Got it — end lesson</Text></TouchableOpacity>
            )}
            {(dxStage === 'intro' || dxStage === 'reps') && (
              <TouchableOpacity style={s.ctrlGhost} onPress={endSession}><Text style={s.ctrlGhostText}>End lesson</Text></TouchableOpacity>
            )}
          </>
        ) : (
          // Focus / plan: hands-free auto-loop — just Pause / End (no per-rep tap).
          <>
            <TouchableOpacity style={s.ctrlGhost} onPress={togglePause}>
              <Ionicons name={paused ? 'play' : 'pause'} size={16} color="#fff" />
              <Text style={s.ctrlGhostText}>{paused ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ctrlGhost} onPress={endSession}>
              <Text style={s.ctrlGhostText}>{plan ? 'End session' : 'End'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#000' },
    scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140, backgroundColor: 'rgba(0,0,0,0.45)' },
    scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 260, backgroundColor: 'rgba(0,0,0,0.5)' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
    headerOverlay: { position: 'absolute', top: 8, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, zIndex: 10 },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text_primary, fontSize: 18, fontWeight: '800' },
    livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    livePillText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    phaseWrap: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', zIndex: 8 },
    phaseChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
    phaseChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    captionWrap: { position: 'absolute', left: 16, right: 16, bottom: 120, gap: 10, zIndex: 9 },
    captionText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 27, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 6 },
    captionMetric: { color: colors.accent, fontSize: 14, fontWeight: '800' },
    drillChip: { backgroundColor: 'rgba(0,0,0,0.55)', borderColor: colors.accent, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
    drillChipLabel: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    drillChipHow: { color: '#fff', fontSize: 14, lineHeight: 20 },
    controlBar: { position: 'absolute', left: 16, right: 16, bottom: 28, gap: 10, zIndex: 10 },
    ctrlPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 26, paddingVertical: 15 },
    ctrlPrimaryText: { color: '#0d1a0d', fontSize: 16, fontWeight: '800' },
    ctrlGhost: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 26, paddingVertical: 13 },
    ctrlGhostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    // Menu styles (kind === 'menu').
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
  });
}
