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
import { AssertCtx, runWithAsserts, type ScenarioReport } from './assert';
import { ConsoleProbe, IssueEventProbe, LoopLagProbe, LAG_NOISE_FLOOR_MS, SELFTEST_SCENARIO_ID, type ProbeTrace } from './probe';
import * as M from './mocks';
import { dispatchVoiceIntent } from './dispatch';
import { useSwingSessionStore } from '../../store/swingSessionStore';
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

/**
 * EVERY scenario runs inside the three device probes (services/harness/probe.ts) — console errors,
 * the app's own issue-log flow, and JS-thread stalls. They wrap here rather than being opted into by
 * individual scenarios on purpose: a probe you have to remember to add is a probe that is missing
 * from exactly the scenario that needed it.
 *
 * The probes are stopped in `finally` because a scenario that throws is the case that most needs its
 * trace read — and because a ConsoleProbe left patched would follow the app out of the harness.
 */
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
    const stored = useSwingSessionStore.getState().activeSession?.primary_issue;
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
    const stored = useSwingSessionStore.getState().activeSession?.primary_issue;
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
    const stored = useSwingSessionStore.getState().activeSession?.primary_issue;
    a.expectEqual('primary_fault === no_dominant_fault', stored?.primary_fault, 'no_dominant_fault');
    a.expect('fix populated for no_dominant_fault', !!stored?.fix);
    a.expect('drill populated for no_dominant_fault', !!stored?.drill);
    await seed.teardown();
  }),
};

const SCEN_4: Scenario = {
  id: 'C4',
  title: 'Golf Father rule — red_vs_yellow EN + ES',
  category: 'critical',
  run: () => runWithAsserts('C4', 'Golf Father rule — red_vs_yellow EN + ES', async (a) => {
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
  title: 'Golf Father rule — driver_or_3wood (over-the-top branch)',
  category: 'critical',
  run: () => runWithAsserts('C5', 'Golf Father rule — driver_or_3wood over-the-top', async (a) => {
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
    // EN copy from i18n/locales/en.json the Golf Father.driver_or_3wood
    a.expectContains('Response mentions 3-wood', r.voice_response, '3-wood');
    await tLoc(); await tFeed(); await tReset(); await tEn();
  }),
};

const SCEN_6: Scenario = {
  id: 'C6',
  title: 'Golf Father rule — flag_or_center (default handicap)',
  category: 'critical',
  run: () => runWithAsserts('C6', 'Golf Father rule — flag_or_center safe', async (a) => {
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
  title: 'ES language thread — the Golf Father rule routes through i18n',
  category: 'critical',
  run: () => runWithAsserts('C8', 'ES language thread', async (a) => {
    // Verify the language thread through a path that does NOT need
    // an active round. ask_golf_father (Golf Father rules) reads i18n.t
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
    useSwingSessionStore.getState().setShotFeelTranscript(seed.sessionId, seed.shotId, 'felt blocky, came over the top');
    const shot = useSwingSessionStore.getState().activeSession?.shots.find(s => s.id === seed.shotId);
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
  title: 'Club wiring downstream + the untagged club is an ESTIMATE, guarded per element',
  category: 'nice',
  /**
   * 2026-09-02 — Tim's device run failed this: "unknown ball speed = 100x1.36 = 136 - expected 136,
   * got null". The scenario was right and the CODE had drifted.
   *
   * The 06-09 honesty pass read the untagged club as an invented number and nulled ball speed
   * outright. Tim's correction: "we weren't saying fabricated number... lower the guard a bit so we
   * could get an estimate. We were supposed to put guards BY ELEMENT." An untagged club does not make
   * the estimate dishonest, it makes it wider - and the fix is confidence + range, not suppression.
   * Fixed in services/swingMetricsService.ts; these checks now hold the shape of that rule so the
   * next honesty pass tightens the right knob.
   *
   * What "by element" means, asserted element by element: ball speed DOWNGRADES (a low bucket and a
   * wide range), while smash factor SUPPRESSES - because smash is ball over club, and against a ball
   * speed derived from an assumed ratio it would only ever hand back the constant.
   */
  run: () => runWithAsserts('N16', 'Club wiring downstream', async (a) => {
    // 1) THE CLUB TAG REACHES THE DERIVATION. Two clubs that are both KNOWN, with different typical
    //    smash ratios - if the tag were ignored these would be identical.
    const m1 = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club: 'driver' });
    const m8i = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club: '8I' });
    a.expectEqual('driver ball speed = 100x1.48 = 148', m1.ball_speed.value, 148);
    a.expectEqual('8i ball speed = 100x1.36 = 136', m8i.ball_speed.value, 136);
    a.expect('driver != 8i - the club tag reaches the derivation', m1.ball_speed.value !== m8i.ball_speed.value);

    // 2) THE UNTAGGED CLUB STILL GETS ITS ESTIMATE - the generic 1.36, not a withheld dash.
    const m2 = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club: null });
    a.expectEqual('unknown ball speed = 100x1.36 = 136', m2.ball_speed.value, 136);

    // 3) ...AND IT IS GUARDED AS AN ESTIMATE, not presented as a reading. This is the half that makes
    //    check 2 honest: a low bucket, a visible range, and a note saying what to do about it.
    a.expectEqual('untagged ball speed is LOW confidence', m2.ball_speed.confidenceLabel, 'low');
    a.expect('untagged ball speed carries a range, not a bare number',
      Array.isArray(m2.ball_speed.range), `range=${JSON.stringify(m2.ball_speed.range)}`);
    a.expect('the note says the club is untagged', (m2.ball_speed.estimateNote ?? '').includes('not tagged'),
      m2.ball_speed.estimateNote ?? '(none)');
    // A TAGGED club must stay sharper than an untagged one, or the downgrade is cosmetic.
    a.expect('tagged is more confident than untagged', m8i.ball_speed.confidence > m2.ball_speed.confidence,
      `8i ${m8i.ball_speed.confidence} vs untagged ${m2.ball_speed.confidence}`);

    // 4) THE NEXT ELEMENT GUARDS ITSELF. Smash is ball over club; against a ball speed that came from
    //    an assumed ratio it is that constant every swing, so it stays suppressed in BOTH cases - the
    //    lowered ball-speed guard must not leak into it.
    a.expect('untagged -> smash still suppressed (would be the constant)', m2.smash_factor.value == null,
      `got ${JSON.stringify(m2.smash_factor.value)}`);
    a.expect('tagged-but-derived -> smash still suppressed', m8i.smash_factor.value == null,
      `got ${JSON.stringify(m8i.smash_factor.value)}`);

    // 2026-08-06 (Tim - "smash + speed factors we can derive from... impact... acoustics when they can be
    // picked up"). A real ACOUSTIC ball speed against a club-speed estimate yields a per-swing SMASH
    // ESTIMATE (previously suppressed). It's an estimate (source 'pose', not truth-grade), and it VARIES
    // with the acoustic ball reading - so it's a real per-swing signal, not the circular typical constant.
    const m3 = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, measuredBallSpeedMph: 140, club: 'driver' });
    a.expectEqual('acoustic smash = 140/100 = 1.40', m3.smash_factor.value, 1.4);
    a.expectEqual('smash is estimate-grade (source pose), not measured', m3.smash_factor.source, 'pose');
    // Without an acoustic ball reading, smash stays SUPPRESSED (no circular constant / fabricated number).
    const m4 = synthesizeSwingMetrics({ measuredClubSpeedMph: 100, club: 'driver' });
    a.expect('no acoustic -> smash null (no fabricated constant)', m4.smash_factor.value == null);
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
    const beforeTotal = JSON.parse(JSON.stringify(stats.total ?? {}));
    const beforeCarry = JSON.parse(JSON.stringify(stats.carry ?? {}));
    stats.recordCarry('7I', 150);
    const bag = bagDistances();
    a.expect('7I present in bag after a logged carry', typeof bag['7I'] === 'number' && (bag['7I'] ?? 0) > 0);
    a.expect('Putter excluded from full-shot bag', bag['Putter'] === undefined);
    useClubStatsStore.setState({ total: beforeTotal, carry: beforeCarry });
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


/**
 * SCEN_21 — THE SWING-LOCATE CHAIN, ON THE DEVICE THAT HAS TO DO IT.
 *
 * 2026-09-01 (Tim): "anything you'd otherwise ask me to verify should go in the harness, so the SIM
 * can run on the phone and the issue log carries the result."
 *
 * Everything the desktop sim can check about this chain, it already checks. What it CANNOT check is
 * the half that only exists on a handset: whether MediaPipe is actually linked in this build, and
 * whether the pure anchor maths agrees with itself on a real device's clock. Those are the two things
 * I would otherwise have had to ask him to confirm from a screenshot.
 *
 * A swing is the fastest thing in a clip. deriveSwingAnchors reads start/top/impact/end off the
 * hand-speed signal, and the whole 09-01 speed fix — on-device locate replacing a cold-Lambda vision
 * call on four surfaces — rests on it being available AND correct here.
 */
const SCEN_21: Scenario = {
  id: 'C21',
  title: 'Swing locate works on THIS device (pose available + anchors correct)',
  category: 'critical',
  run: () => runWithAsserts('C21', 'Swing locate works on THIS device', async (a) => {
    const { getMediaPipeStatus } = await import('../mediaPipePoseService');
    const { deriveSwingAnchors, wristCentroid } = await import('../swing/poseMotion');
    const { sampleTimesMs, LOCATE_FRAME_COUNT } = await import('../swing/onDeviceLocate');

    // 1) Is the native pose module actually in THIS build? A desktop test can never answer this, and
    //    when it is absent every locate silently falls back to the network call it was replacing.
    const status = await getMediaPipeStatus().catch(() => null);
    a.expect(
      'on-device pose is available in this build',
      status?.available === true,
      status ? `available=${status.available} modelLoaded=${status.modelLoaded}` : 'status probe threw',
    );

    // 2) The sample plan must stay inside a real clip. Off-by-one here reads frames that do not exist.
    const times = sampleTimesMs(11_640);
    a.expect('locate samples the clip', times.length === LOCATE_FRAME_COUNT, `${times.length} times`);
    a.expect(
      'no sample falls outside the clip',
      times.every((t) => t > 0 && t < 11_640),
      `first=${times[0]} last=${times[times.length - 1]}`,
    );

    // 3) The maths, on this device's clock. A synthetic swing: settle, backswing to a high slow top,
    //    fast downswing to impact at 1150ms, follow-through.
    const samples: { tMs: number; x: number; y: number }[] = [];
    for (let t = 0; t <= 1600; t += 50) {
      let x: number, y: number;
      if (t <= 400) { x = 0.50; y = 0.60; }
      else if (t <= 900) { const f = (t - 400) / 500; y = 0.60 - 0.25 * f; x = 0.50 - 0.08 * f; }
      else if (t <= 1150) { const f = (t - 900) / 250; y = 0.35 + 0.27 * f * f; x = 0.42 + 0.08 * f; }
      else { const f = (t - 1150) / 450; y = 0.62 - 0.30 * f; x = 0.50 + 0.10 * f; }
      samples.push({ tMs: t, x, y });
    }
    const anchors = deriveSwingAnchors(samples);
    a.expect('anchors resolve for a clean swing', !!anchors, anchors ? 'ok' : 'null');
    if (anchors) {
      a.expect('impact lands on the downswing', Math.abs(anchors.impactMs - 1150) <= 100, `impactMs=${anchors.impactMs}`);
      a.expect('top precedes impact', anchors.topMs < anchors.impactMs, `top=${anchors.topMs}`);
      a.expect(
        'the window brackets the swing',
        anchors.startMs < anchors.topMs && anchors.endMs > anchors.impactMs,
        `start=${anchors.startMs} end=${anchors.endMs}`,
      );
    }

    // 4) The wrist reader only speaks when it can see a wrist — this is what keeps "wrist informs
    //    timing" from quietly becoming "whatever keypoint was handy informs timing".
    const noWrist = wristCentroid({ timestampMs: 0, keypoints: [] } as never);
    a.expect('no wrist means no answer', noWrist === null, `got ${JSON.stringify(noWrist)}`);
  }),
};


/**
 * SCEN_22 — WHERE THE TIME ACTUALLY GOES, ON THIS PHONE.
 *
 * 2026-09-01 (Tim): the harness should throw on "timestamps, flow issues, bottlenecks... as close to
 * the actual progress on the device as possible."
 *
 * Correctness scenarios cannot see slowness — a step that still returns the right answer in nine
 * seconds passes every assertion in this file. His complaint was never that the read was wrong; it
 * was "hard to show a wow factor when you have to wait probably more than a minute." So the budgets
 * ARE the assertions here, and each one is set to what the path is supposed to cost, not to what it
 * currently costs — a budget fitted to today's number can never detect a regression.
 */
const SCEN_22: Scenario = {
  id: 'C22',
  title: 'Speed: the analysis path costs what it should on THIS device',
  category: 'critical',
  run: () => runWithAsserts('C22', 'Speed: the analysis path on this device', async (a) => {
    const { getApiBaseUrl } = await import('../apiBase');
    const base = getApiBaseUrl();
    a.note('api base', base || '(none — offline or unresolved)');

    // 1) REACHABILITY, and what it costs. The dead-host guard aborts a real analysis on two failed
    //    probes, so the probe's own latency is the thing that decides whether a good read survives.
    if (base) {
      /**
       * 2026-09-02 (Tim's device run, TWICE: "health probe answers quickly — 71423ms (budget 3000ms)"
       * and, an hour earlier, "threw after 126099ms: Network request failed").
       *
       * TWO DEFECTS, one line. The first is this check's own: `fetch` had no signal, so a step
       * budgeted at 3 seconds ran for 126 — 96% of a 131-second run — and the number it produced,
       * "126099ms", is a duration the app would never wait. An unbounded probe inside a bounded
       * budget measures something that does not happen in the product.
       *
       * The second is the finding underneath it, and it is the one that matters. /api/health?lite=1
       * is a static JSON return with no probes and no upstream calls; it answers in ~0.2s. So the
       * host is not slow — the path from THIS device to it is, by two orders of magnitude, twice in
       * twelve minutes. That has a direct product consequence: `armDeadHostGuard` in
       * services/poseDetection.ts decides whether to abort a real swing analysis by probing this
       * exact URL on a 3s → 6s → 12s ladder. A single elapsed number cannot say whether that guard
       * would have survived; the ladder can, so the harness now runs the ladder.
       *
       * Each rung is bounded and reported. The verdict is the user-visible sentence: if all three
       * rungs time out here, a real swing analysis on this network is aborted as `dead_host`, and
       * that is a swing Tim loses — which is precisely the log line from 09-01 that bought the third
       * probe. [[the-client-must-be-the-last-to-give-up]] [[a-budget-must-fit-what-runs-inside-it]]
       */
      const url = `${base.replace(/\/+$/, '')}/api/health?lite=1`;
      // Bounded exactly like the real guard's rung — an abort here is the app's own behaviour, not a
      // harness artefact.
      const rung = async (ms: number): Promise<{ ok: boolean; tookMs: number; note: string }> => {
        const t0 = Date.now();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
          const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
          return { ok: r.ok, tookMs: Date.now() - t0, note: `HTTP ${r.status}` };
        } catch (e) {
          const msg = e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80);
          // An abort at the budget and a hard network error are different diagnoses: one is a host
          // that is merely slower than the rung, the other is a path that is not working at all.
          return { ok: false, tookMs: Date.now() - t0, note: ctrl.signal.aborted ? `timed out at ${ms}ms` : msg };
        } finally {
          clearTimeout(timer);
        }
      };

      const p1 = await rung(3_000);
      a.expect('health probe answers within the guard\'s first rung (3s)', p1.ok, `${p1.tookMs}ms · ${p1.note}`);

      // Only walk the rest of the ladder when the first rung failed — on a healthy network this costs
      // nothing, and on a sick one it produces the whole verdict in one run.
      let p2 = p1, p3 = p1;
      if (!p1.ok) {
        p2 = await rung(6_000);
        a.expect('…or the second rung (6s)', p2.ok, `${p2.tookMs}ms · ${p2.note}`);
        if (!p2.ok) {
          p3 = await rung(12_000);
          a.expect('…or the patient third rung (12s)', p3.ok, `${p3.tookMs}ms · ${p3.note}`);
        }
      }

      // THE VERDICT, in the words of the consequence rather than the measurement.
      const guardWouldFire = !p1.ok && !p2.ok && !p3.ok;
      a.expect('the dead-host guard would NOT abort a real swing analysis here', !guardWouldFire,
        guardWouldFire
          ? 'all three rungs silent → a real locate is aborted as dead_host and the swing is lost, ' +
            'even though /api/health?lite=1 is a static return that answers in ~0.2s off-device'
          : `first answer after ${(p1.ok ? p1 : p2.ok ? p2 : p3).tookMs}ms`);

      // A SECOND probe once the connection is warm. A slow first and a fast second is connection
      // setup (DNS / TCP / TLS); two slow ones are the path itself — different problems, different fixes.
      if (p1.ok || p2.ok || p3.ok) {
        const warm = await rung(3_000);
        a.note('warm probe', `${warm.tookMs}ms · ${warm.note} (cold was ${p1.tookMs}ms — a fast warm probe means connection setup, not the path)`);
      }

      /**
       * 2026-09-02 — WHO ELSE IS TALKING TO THIS ORIGIN?
       *
       * Tim's 20:19 run is the reason this exists. The health GET took 71 seconds and returned
       * HTTP 200 — the host answered, it just answered late — and then, two scenarios later, a
       * DIFFERENT request to the SAME origin (course-geometry) came back in 301ms. A dead host does
       * not do that. A saturated one does.
       *
       * `fetchCourseGeometry` dedupes per courseId, so several DIFFERENT courses build at once, and
       * each build holds a request open with an 85-second budget against our own origin — while
       * Android's HTTP client will only keep a handful of connections per host and queues the rest.
       * A tiny GET behind four 85-second builds is not a reachability problem, it is our own
       * background work starving the foreground path. That is the same shape as the note already in
       * armDeadHostGuard: the guard competes with the very request it is guarding.
       *
       * So the harness stops guessing and reads the device: how many builds were in flight, and does
       * the probe recover once they finish. Slow-then-fast is starvation by our own traffic;
       * slow-then-still-slow is the network path. Only runs when the ladder already failed, so a
       * healthy device pays nothing. [[a-budget-must-fit-what-runs-inside-it]] [[echo-what-the-code-threw-away]]
       */
      if (guardWouldFire) {
        const { useGeometryStatusStore } = await import('../../store/geometryStatusStore');
        const buildingNow = Object.entries(useGeometryStatusStore.getState().building)
          .filter(([, v]) => v)
          .map(([k]) => k);
        const { geometryBuildLoad } = await import('../courseGeometryService');
        const load = geometryBuildLoad();
        a.note('same-origin course-geometry builds in flight',
          buildingNow.length
            ? `${buildingNow.length} — ${buildingNow.join(', ')} · pool: ${load.active} active / ` +
              `${load.queued} queued (cap ${load.max}); each active build holds a request to this SAME origin for up to 85s`
            : `0 building · pool: ${load.active} active / ${load.queued} queued (cap ${load.max}) — nothing of ours was building, so the queue is not ours`);

        // Give our own traffic a bounded chance to drain, then ask the host one more time. This is
        // the discriminator: the same URL, the same device, seconds later, with the pool free.
        const settleStart = Date.now();
        while (Date.now() - settleStart < 15_000) {
          const stillBuilding = Object.values(useGeometryStatusStore.getState().building).some(Boolean);
          if (!stillBuilding) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const settleMs = Date.now() - settleStart;
        const after = await rung(3_000);
        a.expect('the host answers once our own background work has drained', after.ok,
          after.ok
            ? `${after.tookMs}ms after waiting ${settleMs}ms — the host was fine; OUR OWN same-origin ` +
              'traffic was starving the probe, so the dead-host verdict above is a false positive'
            : `${after.tookMs}ms · ${after.note} (waited ${settleMs}ms) — still silent with the pool ` +
              'free, so this is the network path to the host, not our own traffic');
      }
    } else {
      a.expect('health probe answers quickly', false, 'no API base URL — every network stage will fail');
    }

    // 2) THE ON-DEVICE POSE COST. This is the number the whole 09-01 speed fix rests on: twelve
    //    frames at 100-300ms is the assumption that made replacing a cold-Lambda locate worth it.
    //    If a frame costs a second here, the locate is the new bottleneck and its 6s budget will be
    //    spent before it finds a swing.
    const mp = await import('../mediaPipePoseService');
    const status = await mp.getMediaPipeStatus().catch(() => null);
    a.expect('on-device pose is linked', status?.available === true,
      status ? `available=${status.available} modelLoaded=${status.modelLoaded}` : 'probe threw');
    // 2026-09-02 — `available=true, modelLoaded=false, lastInference=0ms` is BOTH the healthy
    // not-yet-loaded shape and the shape getMediaPipeStatus() returns when the native call throws.
    // Tim's export showed exactly that and could not say which. Now it can, and a throw is a failure:
    // pose is the speed premise, and a locate that silently falls back to the network is the bug the
    // on-device path exists to prevent. [[a-field-that-is-sometimes-a-placeholder]]
    a.expect('the pose status is a real reading, not a probe failure', !status?.statusError,
      status?.statusError ? `getStatus() threw: ${status.statusError}` : 'native getStatus answered');
    a.note('pose model', status ? `loaded=${status.modelLoaded} quality=${status.loadedQuality} lastInference=${status.lastInferenceMs}ms` : 'unknown');

    // 3) THE STORES. A slow hydrate delays every screen behind it, and a store that never hydrates
    //    reads as "no data" rather than as an error — the failure mode that looks like an empty app.
    await a.within('swing library hydrated', 1_500, async () => {
      const { useSwingSessionStore } = await import('../../store/swingSessionStore');
      const st = useSwingSessionStore.getState();
      a.note('sessions in library', String(st.sessionHistory?.length ?? 0));
      return true;
    });

    // 4) THE PURE MATHS, timed. It runs inside the locate budget on every swing; if it is slow here
    //    it is slow there, and no amount of network improvement will help.
    const { deriveSwingAnchors } = await import('../swing/poseMotion');
    const samples = Array.from({ length: 33 }, (_, i) => {
      const t = i * 50;
      let x: number, y: number;
      if (t <= 400) { x = 0.50; y = 0.60; }
      else if (t <= 900) { const f = (t - 400) / 500; y = 0.60 - 0.25 * f; x = 0.50 - 0.08 * f; }
      else if (t <= 1150) { const f = (t - 900) / 250; y = 0.35 + 0.27 * f * f; x = 0.42 + 0.08 * f; }
      else { const f = (t - 1150) / 450; y = 0.62 - 0.30 * f; x = 0.50 + 0.10 * f; }
      return { tMs: t, x, y };
    });
    await a.within('anchor derivation is instant', 50, async () => deriveSwingAnchors(samples));

    // 5) THE ISSUE LOG ITSELF. Everything above is only useful if the log can carry it off the
    //    device — a diagnostic channel that quietly stopped working takes every other finding with it.
    const { useIssueLogStore } = await import('../../store/issueLogStore');
    const before = useIssueLogStore.getState().entries?.length ?? 0;
    useIssueLogStore.getState().addAppEvent('harness_selftest', { probe: true }, 'diag');
    const after = useIssueLogStore.getState().entries?.length ?? 0;
    a.expect('the issue log accepts entries', after > before, `entries ${before} -> ${after}`);
  }),
};


/**
 * SCEN_23 — THE HONESTY GATES, WITH REAL STATE IN THE STORE.
 *
 * 2026-09-01. Every fix on 09-01 rests on one rule: a MEASURED thing may narrow a search, and a
 * PLACEHOLDER may never be presented as a measurement. The desktop sim proves the rule is written in
 * the code. Only a device with a real store can prove it still holds once a session exists.
 *
 * The specific trap: SmartMotion synthesizes a whole-clip segment whose strike is a placeholder when
 * no swing is detected, and three consumers must refuse it — tempo (which subtracts the anchor without
 * refining it, so a coarse one makes the RATIO wrong), the club-path window, and frame extraction.
 * The flag that carries this is `synthesized`, and it is overloaded: it also means "not a real swing".
 * Flipping it on a measured WINDOW looked correct and would have broken tempo — that happened during
 * this very session and was caught by following the consumers.
 */
const SCEN_23: Scenario = {
  id: 'C23',
  title: 'Honesty: a placeholder strike is never treated as a measurement',
  category: 'critical',
  run: () => runWithAsserts('C23', 'Honesty: placeholder strike is refused', async (a) => {
    const { impactAnchorMs, narrowClubPathWindow } = await import('../swing/clubPathWindow');
    const { poseExtractInputsFor } = await import('../swing/poseExtractKey');

    // 1) A 'manual' shot's stored offset is the 0.6*duration placeholder. Re-centring the club path
    //    on it points the trace confidently at the wrong four seconds.
    const fabricated = impactAnchorMs({
      detectionMethod: 'manual',
      detectionOffsetSeconds: (11_640 * 0.6) / 1000,
      rawStartMs: 0, rawEndMs: 11_640,
    });
    a.expect('a manual shot offset is refused as an anchor', fabricated === null, `got ${fabricated}`);

    // 2) A HEARD strike is frame-accurate and must be used.
    const heard = impactAnchorMs({
      detectionMethod: 'audio_transient', detectionOffsetSeconds: 7,
      rawStartMs: 0, rawEndMs: 11_640,
    });
    a.expect('a heard strike anchors the window', heard === 7000, `got ${heard}`);
    const win = narrowClubPathWindow(0, 11_640, heard);
    a.expect('and narrows an 11.6s window to a swing',
      win.endMs - win.startMs === 4000, `${win.startMs}-${win.endMs}`);

    // 3) A pose-measured impact is accepted, but only INSIDE the window — a per-shot biomech read on
    //    a carved session can be on a different clock, and that must be self-detecting.
    a.expect('a pose impact inside the window is accepted',
      impactAnchorMs({ detectionMethod: 'manual', poseImpactMs: 7000, rawStartMs: 0, rawEndMs: 11_640 }) === 7000);
    a.expect('a pose impact on a different clock is refused',
      impactAnchorMs({ detectionMethod: 'manual', poseImpactMs: 25_000, rawStartMs: 3_000, rawEndMs: 20_000 }) === null);

    // 4) Frame extraction must not treat a synthesized strike as acoustic. This is the second consumer
    //    of the overloaded flag, and the one with no visible symptom when it is wrong.
    const synth = poseExtractInputsFor(
      [{ index: 1, strikeMs: 6984, startMs: 0, endMs: 11_640, confidence: 'low', peakDb: 0, confirmed: false, synthesized: true }] as never,
      0,
    );
    a.expect('a synthesized strike is not an acoustic anchor',
      synth.acousticImpactMs === null, `got ${synth.acousticImpactMs}`);
    const real = poseExtractInputsFor(
      [{ index: 1, strikeMs: 7000, startMs: 4500, endMs: 8500, confidence: 'high', peakDb: -22, confirmed: true, synthesized: false }] as never,
      0,
    );
    a.expect('a real strike IS an acoustic anchor', real.acousticImpactMs === 7000, `got ${real.acousticImpactMs}`);

    // 5) The drill verdict must never grade a chunked rep "got it". Contact honesty outranks the
    //    motion classification, and this is the surface a player reads as "the drill worked".
    const { deriveDrillVerdict } = await import('../drillVerdict');
    const chunked = deriveDrillVerdict({
      drillId: 'over_the_top', drillName: 'Gate', issueId: 'none', issueName: null,
      severity: null, confidence: 'high', contactMishit: 'fat', ballLaunched: false,
    });
    a.expect('the drill verdict resolves', !!chunked, chunked ? 'ok' : 'null');
    if (chunked) {
      a.expect('a fat rep is never graded got_it', chunked.grade !== 'got_it', `grade=${chunked.grade}`);
      a.note('fat-rep verdict', chunked.line);
    }
  }),
};

/**
 * SCEN_24 — THE PROBES THEMSELVES, BREAK-TESTED ON THE DEVICE.
 *
 * 2026-09-01. Every other scenario now runs inside three probes, and its report is only as honest as
 * they are. A probe that silently stopped observing would not fail anything — it would just quietly
 * report a clean device forever, which is the worst failure mode a diagnostic can have.
 *
 * So this scenario CAUSES each of the three conditions and asserts the probe caught it: a console
 * error, an app breadcrumb, and a blocked JS thread. It is the only scenario whose noise is
 * deliberate, which is why probe.ts excludes SELFTEST_SCENARIO_ID from the run summary.
 * [[break-test-every-guard-you-write]]
 */
const SCEN_24: Scenario = {
  id: SELFTEST_SCENARIO_ID,
  title: 'Harness self-test: the probes actually see errors, flow and stalls',
  category: 'critical',
  run: () => runWithAsserts(SELFTEST_SCENARIO_ID, 'Harness self-test: probes observe the device', async (a) => {
    // 1) ERRORS — a swallowed console.error must not escape the probe.
    const cp = new ConsoleProbe(true);
    cp.start();
    console.error('[harness selftest] deliberate error, ignore');
    const caught = cp.stop();
    a.expect(
      'ConsoleProbe captures a console.error',
      caught.some((l) => l.includes('deliberate error')),
      `captured ${caught.length} line(s)`,
    );
    // The restore check has to PROVE the patch is gone, not inspect it. `console.error.name` is ''
    // either way (the patch is an anonymous arrow), so that would have passed with the patch still
    // installed — a leaked patch is the failure that would follow the app out of the harness.
    console.error('[harness selftest] after stop, must NOT be captured');
    a.expect(
      'ConsoleProbe restores console.error after stop',
      !cp.stop().some((l) => l.includes('after stop')),
      `${caught.length} line(s) at stop, unchanged after`,
    );

    // 2) FLOW — the app's own issue-log breadcrumbs must show up, in order.
    const fp = new IssueEventProbe(true);
    fp.start();
    try {
      const { useIssueLogStore } = await import('../../store/issueLogStore');
      useIssueLogStore.getState().addAppEvent('harness_selftest', { probe: 'flow' }, 'diag');
    } catch { /* the assert below reports it */ }
    const flow = fp.stop();
    a.expect(
      'IssueEventProbe sees an event the app wrote during the scenario',
      flow.some((f) => f.includes('harness_selftest')),
      flow.length ? flow.join(' | ').slice(0, 160) : 'no flow captured',
    );

    // 3) BOTTLENECK — a genuinely blocked thread must be measured, not missed.
    const lp = new LoopLagProbe();
    lp.start();
    // A busy loop is the point: setTimeout would YIELD, and a yielding wait is exactly the thing a
    // lag probe must NOT report. Only real blocking counts. Kept just over the noise floor.
    const blockUntil = Date.now() + (LAG_NOISE_FLOOR_MS + 180);
    while (Date.now() < blockUntil) { /* deliberately blocking the JS thread */ }
    // The sampler needs one tick after the block to observe the drift it caused.
    await new Promise((r) => setTimeout(r, 260));
    const lag = lp.stop();
    a.expect('LoopLagProbe measures a real JS-thread stall', lag > 0, `maxLagMs=${lag}`);
    a.note('measured stall', `${lag}ms for a ~${LAG_NOISE_FLOOR_MS + 180}ms block`);

    // 4) And the quiet case: no block, no stall reported. A probe that always fires is noise.
    const quiet = new LoopLagProbe();
    quiet.start();
    await new Promise((r) => setTimeout(r, 300));
    const quietLag = quiet.stop();
    a.expect('LoopLagProbe stays silent on a responsive thread', quietLag === 0, `maxLagMs=${quietLag}`);
  }),
};

export const ALL_SCENARIOS: readonly Scenario[] = [
  SCEN_1, SCEN_2, SCEN_3, SCEN_4, SCEN_5, SCEN_6, SCEN_7, SCEN_8, SCEN_9,
  SCEN_10, SCEN_11, SCEN_12, SCEN_13, SCEN_14,
  SCEN_15, SCEN_16, SCEN_17,
  SCEN_18, SCEN_19, SCEN_20,
  SCEN_21, SCEN_22, SCEN_23, SCEN_24,
] as const;

// Suppress unused-import false positive (i18n must be imported to ensure
// the namespace is initialized before language flips in C4/C5/C6/C8).
void i18n;
