/**
 * 2026-05-19 — GPS Audit v2: scenario runner.
 *
 * Executes the 12-scenario matrix in sequence. For each scenario:
 *   1. Reset all state (probes, simulator, round store, noise injector)
 *   2. Configure the noise injector
 *   3. Start the synthetic round
 *   4. Schedule scenario actions (manual marks, dropouts, jumps)
 *   5. Wait for end condition (hole count or duration)
 *   6. Run assertions
 *   7. Snapshot probe traces
 *   8. Stop the round
 *
 * Errors in any single scenario are caught + recorded; runner continues
 * to next scenario.
 */

import type {
  AssertionResult,
  AuditReport,
  ProbeSample,
  ScenarioConfig,
  ScenarioResult,
} from './types';
import { SCENARIOS } from './scenarios';
import {
  clearBuffers,
  getAllTraces,
  getTrace,
  startProbes,
  stopProbes,
} from './probes';
import { configureNoise, resetInjector, triggerDropout, triggerGlitch } from './noiseInjector';

export interface RunnerCtx {
  onProgress: (msg: string, fraction: number, runningTally?: { passed: number; failed: number }) => void;
  startMockRound: () => Promise<string>;
  stopMockRound: () => Promise<void>;
  windowDims: { w: number; h: number };
  platform: string;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function waitForHoleCount(targetCount: number, timeoutMs: number): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../../store/roundStore');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (Object.keys(useRoundStore.getState().scores).length >= targetCount) return true;
    await sleep(500);
  }
  return false;
}

async function waitForDuration(sec: number): Promise<void> {
  await sleep(sec * 1000);
}

function scheduleActions(scenario: ScenarioConfig): ReturnType<typeof setTimeout>[] {
  const handles: ReturnType<typeof setTimeout>[] = [];
  for (const action of scenario.actions ?? []) {
    handles.push(setTimeout(() => {
      try {
        if (action.kind === 'manual_mark') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const bus = require('../positionMarkBus');
          // Programmatic mark: we don't go through forceMarkPosition because
          // that pulls real GPS (which is suppressed during synthetic). Instead
          // we emit a MarkedPosition based on the current simulator fix.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const sf = require('../smartFinderService');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useRoundStore } = require('../../store/roundStore');
          const fix = sf.getLastFix();
          if (fix) {
            sf.setMarkedFix(fix.location.lat, fix.location.lng, fix.accuracy_m);
            const mark = {
              lat: fix.location.lat,
              lng: fix.location.lng,
              accuracy_m: fix.accuracy_m,
              timestamp: Date.now(),
              hole_at_mark: useRoundStore.getState().currentHole,
            };
            // Manually notify mark subscribers (mirror what
            // forceMarkPosition does internally).
            try {
              const listeners = bus.__getListenersForAudit?.();
              if (listeners) listeners.forEach((l: (m: typeof mark) => void) => { try { l(mark); } catch {} });
            } catch {}
          }
        } else if (action.kind === 'force_dropout') {
          triggerDropout(action.duration_ms);
        } else if (action.kind === 'force_jump') {
          triggerGlitch(action.lateral_m);
        } else if (action.kind === 'force_advance_hole') {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useRoundStore } = require('../../store/roundStore');
          const cur = useRoundStore.getState().currentHole;
          useRoundStore.getState().setCurrentHole(cur + 1);
        }
      } catch (e) {
        console.log('[audit] action failed:', action.kind, e);
      }
    }, action.at_sec * 1000));
  }
  return handles;
}

// ─── Assertions ─────────────────────────────────────────────────────

function assertNoNaN(trace: ProbeSample[]): AssertionResult {
  const violations = trace.filter(s => {
    const v = s.value as { lat?: number; lng?: number } | number | null;
    if (v == null) return false;
    if (typeof v === 'number') return !Number.isFinite(v);
    return (v.lat != null && !Number.isFinite(v.lat)) || (v.lng != null && !Number.isFinite(v.lng));
  });
  return {
    name: 'no NaN / infinite values',
    passed: violations.length === 0,
    n_samples: trace.length,
    violations: violations.length > 0 ? violations.slice(0, 3) : undefined,
  };
}

function assertYardageStability(maxJumpYd: number): AssertionResult {
  const trace = getTrace('yardage.toGreenCenter');
  let maxJump = 0;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1].value as number | null;
    const b = trace[i].value as number | null;
    if (a != null && b != null) {
      maxJump = Math.max(maxJump, Math.abs(b - a));
    }
  }
  return {
    name: `yardage stability (no jump > ${maxJumpYd}y between ticks)`,
    passed: maxJump <= maxJumpYd,
    actual: { max_jump_yards: maxJump },
    n_samples: trace.length,
  };
}

function assertNoFalseOffCourse(): AssertionResult {
  const trace = getTrace('waypoint.offCourse');
  const flips = trace.filter(s => s.value === true).length;
  return {
    name: 'no false off-course during clean run',
    passed: flips === 0,
    actual: { off_course_ticks: flips },
    n_samples: trace.length,
  };
}

function assertHolesAdvanced(min: number): AssertionResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../../store/roundStore');
  const scored = Object.keys(useRoundStore.getState().scores).length;
  return {
    name: `at least ${min} holes scored`,
    passed: scored >= min,
    actual: { scored },
  };
}

function assertHoleTransitions(min: number): AssertionResult {
  const trace = getTrace('waypoint.currentHole');
  let transitions = 0;
  let prev: number | null = null;
  for (const s of trace) {
    const v = s.value as number;
    if (prev != null && v !== prev) transitions += 1;
    prev = v;
  }
  return {
    name: `at least ${min} hole transitions observed`,
    passed: transitions >= min,
    actual: { transitions },
  };
}

// ─── Scenario assertion picker ───────────────────────────────────────

function assertionsFor(scenario: ScenarioConfig): AssertionResult[] {
  const out: AssertionResult[] = [];
  const trace = getTrace('gps.smoothed');
  out.push(assertNoNaN(trace));
  switch (scenario.scenario_id) {
    case 'clean_baseline':
      out.push(assertYardageStability(8));
      out.push(assertNoFalseOffCourse());
      out.push(assertHolesAdvanced(scenario.end_after_holes ?? 1));
      out.push(assertHoleTransitions((scenario.end_after_holes ?? 1) - 1));
      break;
    case 'light_jitter':
      out.push(assertYardageStability(12));
      out.push(assertNoFalseOffCourse());
      out.push(assertHolesAdvanced(scenario.end_after_holes ?? 1));
      break;
    case 'moderate_jitter':
      out.push(assertYardageStability(20));
      out.push(assertHolesAdvanced(scenario.end_after_holes ?? 1));
      break;
    case 'heavy_jitter':
      // Survivability only — no hard yardage assertion. Just no NaN.
      out.push(assertHolesAdvanced(1));
      break;
    case 'gps_dropout':
      out.push(assertHolesAdvanced(1));
      break;
    case 'gps_glitch':
      out.push(assertYardageStability(30));
      out.push(assertHolesAdvanced(1));
      break;
    case 'gps_drift':
      out.push(assertNoNaN(trace));
      break;
    case 'manual_mark_cycle':
      out.push(assertHolesAdvanced(1));
      break;
    case 'manual_mark_under_jitter':
      out.push(assertHolesAdvanced(1));
      break;
    case 'hole_transition_stress':
      out.push(assertHolesAdvanced(scenario.end_after_holes ?? 1));
      out.push(assertHoleTransitions((scenario.end_after_holes ?? 1) - 1));
      break;
    case 'off_course_detection':
      out.push(assertHolesAdvanced(1));
      break;
    case 'kevin_gps_context':
      out.push(assertHolesAdvanced(1));
      break;
  }
  return out;
}

// ─── Runner ─────────────────────────────────────────────────────────

export async function runAuditV2(ctx: RunnerCtx): Promise<AuditReport> {
  const runId = `audit-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const overallStart = Date.now();
  startProbes();

  const results: ScenarioResult[] = [];
  let runningPass = 0;
  let runningFail = 0;

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const fraction = i / SCENARIOS.length;
    ctx.onProgress(`SCENARIO ${i + 1}/${SCENARIOS.length} — ${sc.name}`, fraction, {
      passed: runningPass,
      failed: runningFail,
    });
    const sStart = Date.now();
    let fatal: string | null = null;
    let assertions: AssertionResult[] = [];
    let traces: Record<string, ProbeSample[]> = {};

    try {
      // Reset state
      clearBuffers();
      resetInjector();
      configureNoise(sc.emitter);

      // Apply pace BEFORE starting the walk so the walk uses the override.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sim = require('../simulatedGPS');
      if (sc.emitter.pace_mps) sim.setSimulatorPace(sc.emitter.pace_mps);
      sim.setSimulatorPaused(false);

      await ctx.startMockRound();

      // Schedule actions.
      const handles = scheduleActions(sc);

      // Wait for end condition.
      if (sc.end_after_holes) {
        await waitForHoleCount(sc.end_after_holes, 600_000); // 10 min cap per scenario
      } else if (sc.duration_sec) {
        await waitForDuration(sc.duration_sec);
      } else {
        await waitForDuration(60);
      }

      // Clear pending action timers.
      handles.forEach(h => clearTimeout(h));

      // Run assertions BEFORE stopping (need round state intact).
      assertions = assertionsFor(sc);

      // Snapshot probe traces.
      traces = getAllTraces();

      await ctx.stopMockRound();
      await sleep(1500); // cool-down
    } catch (e) {
      fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.log(`[audit] ${sc.scenario_id} FATAL:`, fatal);
      try { await ctx.stopMockRound(); } catch {}
    }

    const passedCount = assertions.filter(a => a.passed).length;
    const failedCount = assertions.filter(a => !a.passed).length;
    runningPass += passedCount;
    runningFail += failedCount;
    const overall: 'pass' | 'fail' | 'warn' =
      fatal ? 'fail' : failedCount === 0 ? 'pass' : 'fail';

    results.push({
      id: sc.id,
      scenario_id: sc.scenario_id,
      name: sc.name,
      description: sc.description,
      started_at: new Date(sStart).toISOString(),
      duration_ms: Date.now() - sStart,
      config: sc.emitter,
      assertions,
      probe_traces: traces,
      overall,
      fatal_error: fatal,
    });
  }

  stopProbes();
  ctx.onProgress('AUDIT COMPLETE', 1, { passed: runningPass, failed: runningFail });

  const completedAt = new Date().toISOString();
  return {
    audit_version: 'v2',
    run_id: runId,
    started_at: startedAt,
    completed_at: completedAt,
    device: {
      platform: ctx.platform,
      window_w: ctx.windowDims.w,
      window_h: ctx.windowDims.h,
    },
    // 2026-05-19 — Pull live bundle identity from expo-updates so audit
    // reports record exactly which JS bundle ran them.
    bundle_commit: await (async () => {
      try {
        const Updates = await import('expo-updates');
        return (Updates.updateId as string | null) ?? 'dev';
      } catch { return 'unknown'; }
    })(),
    summary: {
      scenarios_run: results.length,
      scenarios_passed: results.filter(r => r.overall === 'pass').length,
      scenarios_failed: results.filter(r => r.overall === 'fail').length,
      scenarios_warn: results.filter(r => r.overall === 'warn').length,
      total_assertions: runningPass + runningFail,
      assertions_passed: runningPass,
      assertions_failed: runningFail,
    },
    scenarios: results,
  };
}
