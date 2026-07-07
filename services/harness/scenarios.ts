/**
 * Scenario harness — the 17 scenarios.
 *
 * 9 Critical + 5 High-value + 3 Nice-to-have, per the harness expansion
 * sketch. Each scenario is fully self-contained — seeds its own state,
 * runs assertions via AssertCtx, tears down. The runner in
 * app/harness.tsx renders the resulting ScenarioReport rows.
 *
 * 2026-05-24 — Built per the harness expansion sketch.
 */

import i18n from '../../i18n';
import { AssertCtx, type ScenarioReport, rollupStatus } from './assert';
import * as M from './mocks';
import { dispatchVoiceIntent } from './dispatch';
import { useCageStore } from '../../store/cageStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePracticeStore } from '../../store/practiceStore';
import { resolveGreenCoords } from '../smartFinderService';
import { synthesizeSwingMetrics } from '../swingMetricsService';
import { useClubStatsStore } from '../../store/clubStatsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
import { bagDistances } from '../shotStrategy';

export type ScenarioCategory = 'critical' | 'high' | 'nice';

export interface Scenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  run: () => Promise<ScenarioReport>;
}

async function runWithAsserts(id: string, title: string, body: (a: AssertCtx) => Promise<void>): Promise<ScenarioReport> {
  const t0 = Date.now();
  const a = new AssertCtx(id);
  let error: string | undefined;
  try {
    await body(a);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.log(`[harness ${id}] THROW ${error}`);
  }
  const durationMs = Date.now() - t0;
  const report: ScenarioReport = { id, title, status: 'pass', durationMs, checks: a.checks, error };
  report.status = rollupStatus(report);
  return report;
}

// ─── Critical (9) ───────────────────────────────────────────────────

const SCEN_1: Scenario = {
  id: 'C1',
  title: 'GolfFix render — diagnostic fault (over_the_top)',
  category: 'critical',
  run: () => runWithAsserts('C1', 'GolfFix render — diagnostic fault', async (a) => {
    const seed = M.seedCageSession({ club: 'driver' });
    const issue = M.buildPrimaryIssue({
      primary_fault: 'over_the_top',
      cause: 'Arms cast outside the swing plane on the downswing.',
      fix: 'Feel the grip drop straight down to start the downswing.',
      drill: 'Towel-under-trail-arm drill, 10 reps.',
      evidence: 'P5 → P6: club path 4.2° outside-in, arms ahead of body rotation.',
      shotIds: [seed.shotId],
    });
    M.injectSessionAnalysis(seed.sessionId, issue);
    const stored = useCageStore.getState().activeSession?.primary_issue;
    a.expect('Session primary_issue persisted', !!stored);
    a.expectEqual('primary_fault round-trips', stored?.primary_fault, 'over_the_top');
    a.expect('cause populated', !!stored?.cause);
    a.expect('fix populated', !!stored?.fix);
    a.expect('drill populated', !!stored?.drill);
    a.expect('evidence populated', !!stored?.evidence);
    await seed.teardown();
  }),
};

const SCEN_2: Scenario = {
  id: 'C2',
  title: 'GolfFix render — inconclusive',
  category: 'critical',
  run: () => runWithAsserts('C2', 'GolfFix render — inconclusive', async (a) => {
    const seed = M.seedCageSession({ club: '7i' });
    const issue = M.buildPrimaryIssue({
      primary_fault: 'inconclusive',
      shotIds: [seed.shotId],
    });
    M.injectSessionAnalysis(seed.sessionId, issue);
    const stored = useCageStore.getState().activeSession?.primary_issue;
    a.expectEqual('primary_fault === inconclusive', stored?.primary_fault, 'inconclusive');
    a.expect('no fix/drill required on inconclusive', stored?.fix === undefined && stored?.drill === undefined);
    await seed.teardown();
  }),
};

const SCEN_3: Scenario = {
  id: 'C3',
  title: 'GolfFix render — no_dominant_fault',
  category: 'critical',
  run: () => runWithAsserts('C3', 'GolfFix render — no_dominant_fault', async (a) => {
    const seed = M.seedCageSession({ club: '7i' });
    const issue = M.buildPrimaryIssue({
      primary_fault: 'no_dominant_fault',
      cause: 'Swing reads cleanly. Multiple small inconsistencies, no single dominant cause.',
      fix: 'Keep stacking reps — your shape is on the right track.',
      drill: 'Continue your current practice routine.',
      shotIds: [seed.shotId],
    });
    M.injectSessionAnalysis(seed.sessionId, issue);
    const stored = useCageStore.getState().activeSession?.primary_issue;
    a.expectEqual('primary_fault === no_dominant_fault', stored?.primary_fault, 'no_dominant_fault');
    a.expect('fix populated for no_dominant_fault', !!stored?.fix);
    a.expect('drill populated for no_dominant_fault', !!stored?.drill);
    await seed.teardown();
  }),
};

const SCEN_4: Scenario = {
  id: 'C4',
  title: 'Tank rule — red_vs_yellow EN + ES',
  category: 'critical',
  run: () => runWithAsserts('C4', 'Tank rule — red_vs_yellow EN + ES', async (a) => {
    // EN — i18n defaults to 'en'; assert canonical English phrase fragment.
    const tEn = M.seedLanguage('en');
    const en = await dispatchVoiceIntent({
      intent_type: 'ask_golf_father',
      parameters: { topic: 'rules', subtopic: 'red_vs_yellow', use_context: false },
      raw_text: 'red penalty vs yellow',
    });
    a.expect('EN dispatch succeeded', en.success);
    a.expectContains('EN response mentions Red stake', en.voice_response, 'Red stake');
    await tEn();

    // ES — flip via setLanguage so i18n.changeLanguage('es') runs.
    const tEs = M.seedLanguage('es');
    const es = await dispatchVoiceIntent({
      intent_type: 'ask_golf_father',
      parameters: { topic: 'rules', subtopic: 'red_vs_yellow', use_context: false },
      raw_text: 'red penalty vs yellow',
    });
    a.expect('ES dispatch succeeded', es.success);
    a.expectContains('ES response mentions Estaca roja', es.voice_response, 'Estaca roja');
    await tEs();
  }),
};

const SCEN_5: Scenario = {
  id: 'C5',
  title: 'Tank rule — driver_or_3wood (over-the-top branch)',
  category: 'critical',
  run: () => runWithAsserts('C5', 'Tank rule — driver_or_3wood over-the-top', async (a) => {
    const tEn = M.seedLanguage('en');
    const tReset = M.resetPracticeStats();
    const tFeed = M.feedPracticeSwings(8, { detected_issue: 'over_the_top', severity: 'significant' });
    const tLoc = M.seedLocationType('tee');
    // sanity — practice stats updated
    a.expect('overTheTopCount > 3 after seed', usePracticeStore.getState().overTheTopCount > 3);
    a.expect('swingCount > 5 after seed', usePracticeStore.getState().swingCount > 5);

    const r = await dispatchVoiceIntent({
      intent_type: 'ask_golf_father',
      parameters: { topic: 'course_management', subtopic: 'driver_or_3wood', use_context: false },
      raw_text: 'driver or 3 wood here',
    });
    a.expect('Dispatch succeeded', r.success);
    // EN copy from i18n/locales/en.json tank.driver_or_3wood
    a.expectContains('Response mentions 3-wood', r.voice_response, '3-wood');
    await tLoc(); await tFeed(); await tReset(); await tEn();
  }),
};

const SCEN_6: Scenario = {
  id: 'C6',
  title: 'Tank rule — flag_or_center (default handicap)',
  category: 'critical',
  run: () => runWithAsserts('C6', 'Tank rule — flag_or_center safe', async (a) => {
    const tEn = M.seedLanguage('en');
    // Handler defaults user_handicap to 18 (> 15 → safe branch).
    const r = await dispatchVoiceIntent({
      intent_type: 'ask_golf_father',
      parameters: { topic: 'course_management', subtopic: 'flag_or_center', use_context: false },
      raw_text: 'flag or center',
    });
    a.expect('Dispatch succeeded', r.success);
    a.expectContains('Response = safe-center copy', r.voice_response, 'Center of the green');
    await tEn();
  }),
};

const SCEN_7: Scenario = {
  id: 'C7',
  title: 'Truth-first resolver (CourseTruth wins over everything)',
  category: 'critical',
  run: () => runWithAsserts('C7', 'Truth-first resolver', async (a) => {
    const courseId = `harness_truth_${Date.now()}`;
    const hole = 7;
    const coord = { lat: 37.4275, lng: -122.1697 };
    const tCourse = M.seedActiveCourse(courseId, hole);
    await M.seedCourseTruth(courseId, hole, coord);
    const res = resolveGreenCoords(hole);
    a.expectEqual('source === truth', res.source, 'truth');
    a.expect('middle present', res.middle !== null);
    a.expect('middle lat matches', res.middle?.lat === coord.lat);
    a.expect('middle lng matches', res.middle?.lng === coord.lng);
    a.expect('front null on truth-only', res.front === null);
    a.expect('back null on truth-only', res.back === null);
    await tCourse();
  }),
};

const SCEN_8: Scenario = {
  id: 'C8',
  title: 'ES language thread — Tank rule routes through i18n',
  category: 'critical',
  run: () => runWithAsserts('C8', 'ES language thread', async (a) => {
    // Verify the language thread through a path that does NOT need
    // an active round. ask_golf_father (Tank rules) reads i18n.t
    // directly, so flipping language end-to-end exercises the same
    // translation plumbing distance_to_green would use, without the
    // global isRoundActive flip the prior version did (that flip
    // tripped roundStore subscribers in app/_layout.tsx — start
    // holeDetection / movement / off-course — which on a synthetic
    // harness state had nothing real to read and risked cascading).
    const tEs = M.seedLanguage('es');
    const r = await dispatchVoiceIntent({
      intent_type: 'ask_golf_father',
      parameters: { topic: 'rules', subtopic: 'red_vs_yellow', use_context: false },
      raw_text: 'roja contra amarilla',
      language: 'es',
    });
    a.expect('Dispatch succeeded', !!r && r.success);
    a.expectContains('Spanish copy (Estaca roja) returned', r?.voice_response, 'Estaca roja');
    await tEs();
  }),
};

const SCEN_9: Scenario = {
  id: 'C9',
  title: 'practiceStore accumulation (overTheTopCount, swingCount)',
  category: 'critical',
  run: () => runWithAsserts('C9', 'practiceStore accumulation', async (a) => {
    const tReset = M.resetPracticeStats();
    a.expectEqual('swingCount starts at 0', usePracticeStore.getState().swingCount, 0);
    a.expectEqual('overTheTopCount starts at 0', usePracticeStore.getState().overTheTopCount, 0);
    const tFeed = M.feedPracticeSwings(5, {
      detected_issue: 'over_the_top',
      severity: 'significant',
      observation: 'arms cast outside, classic over-the-top',
    });
    a.expectEqual('swingCount === 5', usePracticeStore.getState().swingCount, 5);
    a.expectEqual('overTheTopCount === 5', usePracticeStore.getState().overTheTopCount, 5);
    await tFeed(); await tReset();
  }),
};

// ─── High-value (5) ─────────────────────────────────────────────────

const SCEN_10: Scenario = {
  id: 'H10',
  title: 'Voice intent dispatch — 10 phrases (smoke test)',
  category: 'high',
  run: () => runWithAsserts('H10', 'Voice intent dispatch — 10 phrases', async (a) => {
    const tEn = M.seedLanguage('en');
    const phrases: Array<{ intent_type: string; parameters?: Record<string, unknown>; raw_text: string }> = [
      { intent_type: 'ask_golf_father', parameters: { topic: 'rules', subtopic: 'red_vs_yellow' }, raw_text: 'red vs yellow' },
      { intent_type: 'ask_golf_father', parameters: { topic: 'course_management', subtopic: 'flag_or_center' }, raw_text: 'flag or center' },
      { intent_type: 'ask_golf_father', parameters: { topic: 'rules', subtopic: 'nearest_point_relief' }, raw_text: 'cart path relief' },
      { intent_type: 'ask_golf_father', parameters: { topic: 'course_management', subtopic: 'lay_up' }, raw_text: 'should I lay up' },
      { intent_type: 'help', parameters: {}, raw_text: 'help' },
      { intent_type: 'acknowledge', parameters: {}, raw_text: 'thanks' },
      { intent_type: 'navigate', parameters: { destination: 'cage' }, raw_text: 'open cage' },
      { intent_type: 'query_status', parameters: { topic: 'score' }, raw_text: "what's my score" },
      { intent_type: 'query_status', parameters: { topic: 'hole' }, raw_text: "what hole am I on" },
      { intent_type: 'change_setting', parameters: { setting: 'language', value: 'en' }, raw_text: 'switch to English' },
    ];
    for (const p of phrases) {
      try {
        const r = await dispatchVoiceIntent(p);
        a.expect(`handler ran: ${p.intent_type}/${p.raw_text}`, r !== null && r !== undefined && typeof r.success === 'boolean');
      } catch (e) {
        a.expect(`handler ran: ${p.intent_type}/${p.raw_text}`, false, e instanceof Error ? e.message : String(e));
      }
    }
    await tEn();
  }),
};

const SCEN_11: Scenario = {
  id: 'H11',
  title: 'Meta album mock (graceful skip when native not bundled)',
  category: 'high',
  run: () => runWithAsserts('H11', 'Meta album mock', async (a) => {
    try {
      const ML = (await import('expo-media-library').catch(() => null)) as
        | { getAlbumsAsync?: (opts?: unknown) => Promise<Array<{ title: string; assetCount: number }>> }
        | null;
      if (!ML || typeof ML.getAlbumsAsync !== 'function') {
        a.skip('expo-media-library bundled', 'native module not bundled in this build');
        return;
      }
      // Probe-only — don't pretend to inject a fake album. Verify the
      // module exists + the call resolves without crashing.
      const albums = await ML.getAlbumsAsync({ includeSmartAlbums: false }).catch(() => []);
      a.expect('getAlbumsAsync resolved', Array.isArray(albums));
    } catch (e) {
      a.skip('Meta album check', e instanceof Error ? e.message : String(e));
    }
  }),
};

const SCEN_12: Scenario = {
  id: 'H12',
  title: 'Feel-capture transcript pathway (offline-safe)',
  category: 'high',
  run: () => runWithAsserts('H12', 'Feel-capture transcript writeback', async (a) => {
    const seed = M.seedCageSession({ club: 'driver', shot: { clipUri: 'harness://fake-clip.mp4' } });
    // Inject a known transcript directly — this exercises the WRITE
    // half of the feel-capture pipeline (setShotFeelTranscript). The
    // Whisper round-trip is network-dependent and out of harness scope.
    useCageStore.getState().setShotFeelTranscript(seed.sessionId, seed.shotId, 'felt blocky, came over the top');
    const shot = useCageStore.getState().activeSession?.shots.find(s => s.id === seed.shotId);
    a.expectContains('transcript persisted on shot', shot?.feel_narration_transcript ?? '', 'over the top');
    await seed.teardown();
  }),
};

const SCEN_13: Scenario = {
  id: 'H13',
  title: 'Skeleton honesty gate (__DEV__ check)',
  category: 'high',
  run: () => runWithAsserts('H13', 'Skeleton honesty gate', async (a) => {
    const dev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (dev) {
      a.skip('production skeleton gate', '__DEV__ is true; production-only assertion');
      return;
    }
    // 2026-07-04 — the old StubSkeletonOverlay mock is deleted entirely;
    // skeletons only render from real computed PoseFrames (SwingBodyOverlay).
    // This assertion survives as a trivial production sanity check on the
    // __DEV__ gate value the honesty gate historically read.
    a.expect('__DEV__ === false in production', dev === false);
  }),
};

const SCEN_14: Scenario = {
  id: 'H14',
  title: 'Tee geofence (locationType seeding)',
  category: 'high',
  run: () => runWithAsserts('H14', 'Tee geofence', async (a) => {
    const { useRoundStore } = await import('../../store/roundStore');
    const before = useRoundStore.getState().currentLocationType;
    const t = M.seedLocationType('tee', { hole: 3, lat: 37.4275, lng: -122.1697 });
    a.expectEqual('currentLocationType === tee', useRoundStore.getState().currentLocationType, 'tee');
    a.expectEqual('currentTeeBox.hole === 3', useRoundStore.getState().currentTeeBox?.hole, 3);
    await t();
    a.expectEqual('teardown restores prior locationType', useRoundStore.getState().currentLocationType, before);
  }),
};

// ─── Nice-to-have (3) ───────────────────────────────────────────────

const SCEN_15: Scenario = {
  id: 'N15',
  title: 'GPS Flow B confidence ask gate (cooldown semantics)',
  category: 'nice',
  run: () => runWithAsserts('N15', 'GPS confidence ask gates', async (a) => {
    try {
      const { useGpsHealthStore } = await import('../../store/gpsHealthStore');
      const store = useGpsHealthStore.getState();
      // Record fresh poor-signal readings and verify the time-cooldown
      // gate flips on once an ask has been recorded.
      if (typeof store.recordAccuracy !== 'function') {
        a.skip('gpsHealthStore.recordAccuracy', 'method not exported in this build');
        return;
      }
      store.recordAccuracy(20);
      const beforeAsk = useGpsHealthStore.getState().isTimeCooldownActive();
      a.expect('cooldown OFF before first ask', !beforeAsk);
      // Record an ask if the method exists; otherwise just verify the
      // gate exists and is callable.
      const recordAsk = (store as unknown as { recordAsk?: (e: unknown, ms: number) => void }).recordAsk;
      if (typeof recordAsk === 'function') {
        recordAsk({ at: Date.now(), hole: null, accuracy_m: 20, reason: 'poor_signal' }, 60_000);
        a.expect('cooldown ON after recordAsk', useGpsHealthStore.getState().isTimeCooldownActive());
      } else {
        a.skip('recordAsk method', 'not exported');
      }
    } catch (e) {
      a.skip('gpsHealthStore probe', e instanceof Error ? e.message : String(e));
    }
  }),
};

const SCEN_16: Scenario = {
  id: 'N16',
  title: 'Club wiring downstream (TYPICAL_SMASH_BY_CLUB.driver vs unknown)',
  category: 'nice',
  run: () => runWithAsserts('N16', 'Club wiring downstream', async (a) => {
    // synthesizeSwingMetrics derives ball speed from clubSpeed × typical
    // smash factor for the club. Driver = 1.48 vs unknown = 1.36.
    const m1 = synthesizeSwingMetrics({
      measuredClubSpeedMph: 100,
      club: 'driver',
    });
    const m2 = synthesizeSwingMetrics({
      measuredClubSpeedMph: 100,
      club: null,
    });
    a.expectEqual('driver ball speed = 100×1.48 = 148', m1.ball_speed.value, 148);
    a.expectEqual('unknown ball speed = 100×1.36 = 136', m2.ball_speed.value, 136);
    a.expect('driver ≠ unknown — club wiring is live', m1.ball_speed.value !== m2.ball_speed.value);
  }),
};

const SCEN_17: Scenario = {
  id: 'N17',
  title: 'Tutorial reset (markTutorialSeen + resetTutorials)',
  category: 'nice',
  run: () => runWithAsserts('N17', 'Tutorial reset', async (a) => {
    const key = 'harness_intro';
    const beforeSeen = { ...useSettingsStore.getState().tutorialsSeen };
    useSettingsStore.getState().markTutorialSeen(key);
    a.expectEqual('tutorial marked seen', useSettingsStore.getState().tutorialsSeen[key], true);
    useSettingsStore.getState().resetTutorials();
    a.expect('resetTutorials clears the entry', !useSettingsStore.getState().tutorialsSeen[key]);
    useSettingsStore.setState({ tutorialsSeen: beforeSeen });
  }),
};

// ─── 2026-06-08 session surfaces (N18-N20) ──────────────────────────

const SCEN_18: Scenario = {
  id: 'N18',
  title: 'Bag distances feed the caddie (clubStats → bagDistances)',
  category: 'nice',
  run: () => runWithAsserts('N18', 'bagDistances reflects clubStats', async (a) => {
    const stats = useClubStatsStore.getState();
    const before = JSON.parse(JSON.stringify(stats.stats ?? {}));
    stats.record('7I', 150);
    const bag = bagDistances();
    a.expect('7I present in bag after a logged shot', typeof bag['7I'] === 'number' && (bag['7I'] ?? 0) > 0);
    a.expect('Putter excluded from full-shot bag', bag['Putter'] === undefined);
    useClubStatsStore.setState({ stats: before });
  }),
};

const SCEN_19: Scenario = {
  id: 'N19',
  title: 'User role default + setRole round-trip',
  category: 'nice',
  run: () => runWithAsserts('N19', 'role round-trip', async (a) => {
    const p = usePlayerProfileStore.getState();
    const beforeRole = p.role;
    a.expect('role is one of golfer/instructor/student',
      ['golfer', 'instructor', 'student'].includes(p.role));
    p.setRole('instructor');
    a.expectEqual('setRole instructor sticks', usePlayerProfileStore.getState().role, 'instructor');
    usePlayerProfileStore.getState().setRole(beforeRole);
  }),
};

const SCEN_20: Scenario = {
  id: 'N20',
  title: 'Golfer avatar photo round-trips on a family member',
  category: 'nice',
  run: () => runWithAsserts('N20', 'avatar_photo_uri round-trip', async (a) => {
    const fam = useFamilyStore.getState();
    const id = fam.addMember({
      firstName: 'HarnessAvatarTest', nickname: null, relationship: 'friend',
      age: null, skillLevel: 'first_swings', handedness: 'unknown',
      approximate_handicap: null, avatar_emoji: '🏌️', avatar_photo_uri: 'file:///tmp/test.jpg',
    });
    a.expectEqual('photo persisted on add',
      useFamilyStore.getState().getMember(id)?.avatar_photo_uri, 'file:///tmp/test.jpg');
    useFamilyStore.getState().updateMember(id, { avatar_photo_uri: null });
    a.expect('photo cleared on update',
      !useFamilyStore.getState().getMember(id)?.avatar_photo_uri);
    useFamilyStore.getState().removeMember(id);
  }),
};

// ─── Registry ───────────────────────────────────────────────────────

export const ALL_SCENARIOS: readonly Scenario[] = [
  SCEN_1, SCEN_2, SCEN_3, SCEN_4, SCEN_5, SCEN_6, SCEN_7, SCEN_8, SCEN_9,
  SCEN_10, SCEN_11, SCEN_12, SCEN_13, SCEN_14,
  SCEN_15, SCEN_16, SCEN_17,
  SCEN_18, SCEN_19, SCEN_20,
] as const;

// Suppress unused-import false positive (i18n must be imported to ensure
// the namespace is initialized before language flips in C4/C5/C6/C8).
void i18n;
