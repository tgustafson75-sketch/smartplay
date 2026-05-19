/**
 * 2026-05-19 — GPS Audit v2: 12-scenario declarative matrix.
 *
 * Each entry configures the noise injector + scenario actions + duration.
 * The runner walks this array in order. Assertions are scenario-specific
 * and live in the runner so they can read from probes + store state.
 */

import type { ScenarioConfig } from './types';

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 1,
    scenario_id: 'clean_baseline',
    name: 'Clean Baseline',
    description: '4 m/s synthetic round, zero noise, 3 holes. Yardages must match ground truth tightly.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 3,
  },
  {
    id: 2,
    scenario_id: 'light_jitter',
    name: 'Light Gaussian Jitter (σ=3m)',
    description: 'σ=3m Gaussian jitter on lat/lng. Yardage stability ±8m.',
    emitter: { noise_sigma_m: 3, pace_mps: 8 },
    end_after_holes: 2,
  },
  {
    id: 3,
    scenario_id: 'moderate_jitter',
    name: 'Moderate Jitter (σ=8m)',
    description: 'σ=8m. Yardage stability ±15m.',
    emitter: { noise_sigma_m: 8, pace_mps: 8 },
    end_after_holes: 2,
  },
  {
    id: 4,
    scenario_id: 'heavy_jitter',
    name: 'Heavy Jitter (σ=15m, urban canyon)',
    description: 'σ=15m. Survivability test — no crash, no NaN, no infinite.',
    emitter: { noise_sigma_m: 15, pace_mps: 8 },
    end_after_holes: 2,
  },
  {
    id: 5,
    scenario_id: 'gps_dropout',
    name: 'GPS Dropout (10s mid-fairway)',
    description: 'Drop emissions for 10s mid-H1, then resume clean. No crash, no NaN, no jump >30m on resume.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 2,
    actions: [{ at_sec: 15, kind: 'force_dropout', duration_ms: 10000 }],
  },
  {
    id: 6,
    scenario_id: 'gps_glitch',
    name: 'GPS Jump (single 100m lateral glitch)',
    description: 'One emission with 100m lateral offset, then back to clean. Glitch should be rejected/smoothed.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 2,
    actions: [{ at_sec: 15, kind: 'force_jump', lateral_m: 100 }],
  },
  {
    id: 7,
    scenario_id: 'gps_drift',
    name: 'GPS Slow Drift (+0.5 m/sec for 30s)',
    description: 'Linear drift then return. App continues to function; document recovery.',
    emitter: { noise_sigma_m: 0, pace_mps: 8, drift_mps: 0.5 },
    duration_sec: 60,
  },
  {
    id: 8,
    scenario_id: 'manual_mark_cycle',
    name: 'Manual Mark Anchor Cycle (5×)',
    description: 'Programmatic Manual Mark every 30s × 5 across H1. Anchor propagates within 200ms.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 1,
    actions: [
      { at_sec: 20, kind: 'manual_mark' },
      { at_sec: 30, kind: 'manual_mark' },
      { at_sec: 40, kind: 'manual_mark' },
      { at_sec: 50, kind: 'manual_mark' },
      { at_sec: 60, kind: 'manual_mark' },
    ],
  },
  {
    id: 9,
    scenario_id: 'manual_mark_under_jitter',
    name: 'Manual Mark Under Jitter (σ=8m)',
    description: 'Marks under σ=8m noise. Anchor should capture smoothed, not raw.',
    emitter: { noise_sigma_m: 8, pace_mps: 8 },
    end_after_holes: 1,
    actions: [
      { at_sec: 20, kind: 'manual_mark' },
      { at_sec: 35, kind: 'manual_mark' },
      { at_sec: 50, kind: 'manual_mark' },
    ],
  },
  {
    id: 10,
    scenario_id: 'hole_transition_stress',
    name: 'Hole Transition Stress (6 holes/60s)',
    description: 'Force-advance through 6 holes back-to-back. Transitions fire once each, no orphan subscribers.',
    emitter: { noise_sigma_m: 0, pace_mps: 30 }, // fast pace to compress 6 holes
    end_after_holes: 6,
  },
  {
    id: 11,
    scenario_id: 'off_course_detection',
    name: 'Off-Course Detection',
    description: 'Deviate fairway → rough → OB → back. Boundary status reflects zones correctly.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 2,
  },
  {
    id: 12,
    scenario_id: 'kevin_gps_context',
    name: 'Kevin Brain GPS Context Integrity',
    description: 'Verify GPS state snapshot for downstream consumers (lieAnalysisContext, distanceInPrompt) matches ground truth.',
    emitter: { noise_sigma_m: 0, pace_mps: 8 },
    end_after_holes: 1,
  },
];
