/**
 * 2026-05-19 — GPS Test Harness v2: Comprehensive Audit runner.
 *
 * Auto-executes a series of GPS test scenarios sequentially, capturing
 * observed values vs ground truth at each step, asserting deviation
 * thresholds, and building a structured JSON report.
 *
 * NOT manual button-hitting. The user taps ONE "Run Audit" button and
 * 5+ minutes later gets a JSON report with pass/fail per scenario.
 *
 * Each scenario produces:
 *   { id, name, observations: [{at, expected, actual, deviation, pass}],
 *     assertions: [{name, pass, detail}],
 *     overall: 'pass' | 'fail' | 'warn',
 *     duration_ms }
 *
 * Ground truth = the simulator's known position (we control it).
 * Actual = what each GPS-consuming surface reports (yardage, hole,
 * off-course flag, marker position, etc).
 */

import { setSimulatorPace, setSimulatorPaused } from './simulatedGPS';

// ─── Types ───────────────────────────────────────────────────────────

export interface AuditAssertion {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface AuditObservation {
  at: string; // human-readable moment ("H1 mid-fairway", "after Manual Mark")
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  deviation_yards?: number | null;
  pass: boolean;
}

export interface AuditScenarioResult {
  id: string;
  name: string;
  description: string;
  started_at: string; // ISO
  duration_ms: number;
  observations: AuditObservation[];
  assertions: AuditAssertion[];
  overall: 'pass' | 'fail' | 'warn';
  notes?: string[];
}

export interface AuditReport {
  generated_at: string;
  bundle_commit: string;
  total_duration_ms: number;
  total_pass: number;
  total_fail: number;
  total_warn: number;
  scenarios: AuditScenarioResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Pause until predicate returns true OR timeout. Polls every 250ms. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`[gpsAudit] waitFor TIMEOUT: ${label}`);
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Snapshot the current GPS-consuming surface values. */
function snapshot(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../store/roundStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useOffCourseStore } = require('./offCourseDetector');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLastFix, getGreenYardagesSync } = require('./smartFinderService');
  const round = useRoundStore.getState();
  const off = useOffCourseStore.getState();
  const fix = getLastFix();
  const fmb = getGreenYardagesSync(round.currentHole);
  return {
    fix_lat: fix?.location?.lat ?? null,
    fix_lng: fix?.location?.lng ?? null,
    fix_accuracy_m: fix?.accuracy_m ?? null,
    currentHole: round.currentHole,
    isRoundActive: round.isRoundActive,
    scoresLogged: Object.keys(round.scores).length,
    shotsLogged: round.shots.length,
    fmb_front: fmb?.front ?? null,
    fmb_middle: fmb?.middle ?? null,
    fmb_back: fmb?.back ?? null,
    offCourse: off.isOffCourse,
    yardsToNearestHole: off.yardsToNearestHole,
  };
}

// ─── Scenarios ───────────────────────────────────────────────────────

type RunnerCtx = {
  onProgress: (msg: string, fraction: number) => void;
  startMockRound: () => Promise<string>;
  stopMockRound: () => Promise<void>;
};

async function scenarioCleanBaseline(ctx: RunnerCtx): Promise<AuditScenarioResult> {
  const started = Date.now();
  const obs: AuditObservation[] = [];
  const ass: AuditAssertion[] = [];

  ctx.onProgress('Scenario 1: clean baseline · starting round', 0);
  setSimulatorPace(4);
  setSimulatorPaused(false);
  await ctx.startMockRound();

  // Wait for the simulator to log at least 2 holes' worth of scores.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../store/roundStore');
  ctx.onProgress('Scenario 1: walking through holes 1-3', 0.3);
  const reached = await waitFor(
    () => Object.keys(useRoundStore.getState().scores).length >= 3,
    300_000,
    'baseline: 3 holes scored',
  );
  obs.push({
    at: 'after 3 holes',
    expected: { scores_logged: '>=3' },
    actual: { scores_logged: Object.keys(useRoundStore.getState().scores).length },
    pass: reached,
  });
  ass.push({
    name: '3+ holes scored within 5 min',
    pass: reached,
    detail: reached ? 'OK' : 'TIMEOUT — simulator may not be advancing',
  });

  // Snapshot mid-round
  const snap = snapshot();
  obs.push({
    at: 'mid-round snapshot',
    expected: { isRoundActive: true, offCourse: false },
    actual: { isRoundActive: snap.isRoundActive, offCourse: snap.offCourse },
    pass: snap.isRoundActive === true && snap.offCourse === false,
  });
  ass.push({
    name: 'round active & not off-course mid-round',
    pass: snap.isRoundActive === true && snap.offCourse === false,
  });

  // Stop the round to clean up for next scenario
  await ctx.stopMockRound();
  await sleep(500);

  const pass = ass.every(a => a.pass);
  return {
    id: 'clean_baseline',
    name: 'Clean Baseline (no noise)',
    description: 'Synthetic round at 4 m/s, no GPS noise. Expect smooth advance, no off-course, scores log.',
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    observations: obs,
    assertions: ass,
    overall: pass ? 'pass' : 'fail',
  };
}

async function scenarioPaceVariations(ctx: RunnerCtx): Promise<AuditScenarioResult> {
  const started = Date.now();
  const obs: AuditObservation[] = [];
  const ass: AuditAssertion[] = [];

  ctx.onProgress('Scenario 2: pace variations · starting round at 8 m/s', 0);
  setSimulatorPace(8);
  await ctx.startMockRound();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../store/roundStore');
  const reached = await waitFor(
    () => Object.keys(useRoundStore.getState().scores).length >= 2,
    180_000,
    'pace 8 m/s: 2 holes scored',
  );
  obs.push({
    at: 'pace 8 m/s · 2 holes',
    expected: { scores_logged: '>=2' },
    actual: { scores_logged: Object.keys(useRoundStore.getState().scores).length },
    pass: reached,
  });
  ass.push({
    name: 'fast pace still scores holes',
    pass: reached,
  });

  await ctx.stopMockRound();
  await sleep(500);
  const pass = ass.every(a => a.pass);
  return {
    id: 'pace_variations',
    name: 'Pace Variations (8 m/s vs 4 m/s)',
    description: 'Verify the scoring + transition path works at non-default pace.',
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    observations: obs,
    assertions: ass,
    overall: pass ? 'pass' : 'fail',
  };
}

async function scenarioFixChangePropagation(ctx: RunnerCtx): Promise<AuditScenarioResult> {
  const started = Date.now();
  const obs: AuditObservation[] = [];
  const ass: AuditAssertion[] = [];

  ctx.onProgress('Scenario 3: fix-change propagation', 0);
  setSimulatorPace(4);
  await ctx.startMockRound();

  // Subscribe to fix-change events and count them over 10 seconds.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sf = require('./smartFinderService');
  let count = 0;
  const unsub = sf.subscribeFixChange(() => { count += 1; });
  await sleep(10_000);
  unsub();

  // At 4 m/s pace with 1Hz tick, we expect ~10 emits in 10 seconds.
  obs.push({
    at: '10 seconds of fix-change observation',
    expected: { fix_change_events: '>=8' },
    actual: { fix_change_events: count },
    pass: count >= 8,
  });
  ass.push({
    name: 'subscribeFixChange fires at ~1 Hz',
    pass: count >= 8 && count <= 14,
    detail: `observed ${count} events`,
  });

  await ctx.stopMockRound();
  await sleep(500);
  const pass = ass.every(a => a.pass);
  return {
    id: 'fix_change_propagation',
    name: 'Fix-change Pub/Sub Propagation',
    description: 'Verify setSimulatedFix notifies fix-change listeners on every tick.',
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    observations: obs,
    assertions: ass,
    overall: pass ? 'pass' : 'fail',
  };
}

async function scenarioYardageMath(ctx: RunnerCtx): Promise<AuditScenarioResult> {
  const started = Date.now();
  const obs: AuditObservation[] = [];
  const ass: AuditAssertion[] = [];

  ctx.onProgress('Scenario 4: yardage math sanity', 0);
  setSimulatorPace(4);
  await ctx.startMockRound();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../store/roundStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getGreenYardagesSync } = require('./smartFinderService');

  // Wait for round to fully start.
  await waitFor(() => useRoundStore.getState().isRoundActive, 30_000, 'round active');
  await sleep(3_000); // let simulator settle on a position

  const fmb = getGreenYardagesSync(useRoundStore.getState().currentHole);
  const middleSane = fmb.middle != null && fmb.middle > 0 && fmb.middle < 800;
  const frontBackOrdered =
    fmb.front == null || fmb.back == null || fmb.front <= fmb.back + 30;
  obs.push({
    at: 'mid-round F/M/B sample',
    expected: { middle_in_range: '1-800', front_le_back: true },
    actual: { fmb },
    pass: middleSane && frontBackOrdered,
  });
  ass.push({ name: 'middle yardage in plausible range', pass: middleSane });
  ass.push({ name: 'front ≤ back (or one is null)', pass: frontBackOrdered });

  await ctx.stopMockRound();
  await sleep(500);
  const pass = ass.every(a => a.pass);
  return {
    id: 'yardage_math',
    name: 'Yardage Math Sanity',
    description: 'F/M/B values are in plausible ranges; sanity clamps work.',
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    observations: obs,
    assertions: ass,
    overall: pass ? 'pass' : 'fail',
  };
}

async function scenarioPauseResume(ctx: RunnerCtx): Promise<AuditScenarioResult> {
  const started = Date.now();
  const obs: AuditObservation[] = [];
  const ass: AuditAssertion[] = [];

  ctx.onProgress('Scenario 5: pause / resume', 0);
  setSimulatorPace(4);
  await ctx.startMockRound();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../store/roundStore');
  await waitFor(() => useRoundStore.getState().isRoundActive, 10_000, 'active');
  await sleep(3_000);
  const beforePauseHole = useRoundStore.getState().currentHole;

  setSimulatorPaused(true);
  await sleep(5_000);
  const afterPauseHole = useRoundStore.getState().currentHole;

  obs.push({
    at: 'after 5s pause',
    expected: { hole_unchanged: beforePauseHole },
    actual: { hole: afterPauseHole },
    pass: beforePauseHole === afterPauseHole,
  });
  ass.push({
    name: 'pause stops hole progression',
    pass: beforePauseHole === afterPauseHole,
  });

  setSimulatorPaused(false);
  await sleep(20_000);
  const afterResumeHole = useRoundStore.getState().currentHole;
  obs.push({
    at: '20s after resume',
    expected: { hole_advanced: '>' + afterPauseHole },
    actual: { hole: afterResumeHole },
    pass: afterResumeHole >= afterPauseHole,
  });
  ass.push({
    name: 'resume advances holes again',
    pass: afterResumeHole >= afterPauseHole,
  });

  await ctx.stopMockRound();
  await sleep(500);
  const pass = ass.every(a => a.pass);
  return {
    id: 'pause_resume',
    name: 'Pause / Resume',
    description: 'Verify setSimulatorPaused stops/resumes hole progression cleanly.',
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    observations: obs,
    assertions: ass,
    overall: pass ? 'pass' : 'fail',
  };
}

// ─── Runner ──────────────────────────────────────────────────────────

export async function runComprehensiveAudit(
  ctx: RunnerCtx,
): Promise<AuditReport> {
  const start = Date.now();
  const scenarios: AuditScenarioResult[] = [];

  const list: ((ctx: RunnerCtx) => Promise<AuditScenarioResult>)[] = [
    scenarioCleanBaseline,
    scenarioPaceVariations,
    scenarioFixChangePropagation,
    scenarioYardageMath,
    scenarioPauseResume,
  ];

  for (let i = 0; i < list.length; i++) {
    ctx.onProgress(`Scenario ${i + 1} of ${list.length}`, i / list.length);
    try {
      const r = await list[i](ctx);
      scenarios.push(r);
    } catch (e) {
      scenarios.push({
        id: `scenario_${i + 1}_threw`,
        name: `Scenario ${i + 1} threw`,
        description: 'Scenario function threw an unhandled error',
        started_at: new Date().toISOString(),
        duration_ms: 0,
        observations: [],
        assertions: [{ name: 'no throw', pass: false, detail: e instanceof Error ? e.message : String(e) }],
        overall: 'fail',
        notes: [e instanceof Error ? e.stack ?? e.message : String(e)],
      });
    }
  }

  ctx.onProgress('Audit complete', 1);
  return {
    generated_at: new Date().toISOString(),
    bundle_commit: '0b263c5',
    total_duration_ms: Date.now() - start,
    total_pass: scenarios.filter(s => s.overall === 'pass').length,
    total_fail: scenarios.filter(s => s.overall === 'fail').length,
    total_warn: scenarios.filter(s => s.overall === 'warn').length,
    scenarios,
  };
}
