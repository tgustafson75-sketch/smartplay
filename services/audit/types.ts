/**
 * 2026-05-19 — GPS Audit v2: shared types.
 *
 * Lives outside services/gpsAudit.ts (the legacy v1 file we're
 * superseding) so v2 can grow into its own folder without forcing
 * a rewrite of the v1 file in the same commit.
 */

export interface ProbeSample {
  surface: string;
  ts: number;
  tick: number;
  ground_truth_lat: number | null;
  ground_truth_lng: number | null;
  value: unknown;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: unknown;
  detail?: string;
  violations?: unknown[];
  n_samples?: number;
}

export interface EmitterConfig {
  noise_sigma_m?: number;
  dropout_window_ms?: number | null;
  glitch_lateral_m?: number | null;
  drift_mps?: number;
  pace_mps?: number;
}

export interface ScenarioConfig {
  id: number;
  scenario_id: string;
  name: string;
  description: string;
  emitter: EmitterConfig;
  duration_sec?: number;
  end_after_holes?: number;
  actions?: ScenarioAction[];
}

export type ScenarioAction =
  | { at_sec: number; kind: 'manual_mark' }
  | { at_sec: number; kind: 'force_dropout'; duration_ms: number }
  | { at_sec: number; kind: 'force_jump'; lateral_m: number }
  | { at_sec: number; kind: 'force_advance_hole' }
  | { at_sec: number; kind: 'simulate_kevin_invocation' };

export interface ScenarioResult {
  id: number;
  scenario_id: string;
  name: string;
  description: string;
  started_at: string;
  duration_ms: number;
  config: EmitterConfig;
  assertions: AssertionResult[];
  probe_traces: Record<string, ProbeSample[]>;
  overall: 'pass' | 'fail' | 'warn';
  fatal_error: string | null;
}

export interface AuditReport {
  audit_version: 'v2';
  run_id: string;
  started_at: string;
  completed_at: string;
  device: { platform: string; window_w: number; window_h: number };
  bundle_commit: string;
  summary: {
    scenarios_run: number;
    scenarios_passed: number;
    scenarios_failed: number;
    scenarios_warn: number;
    total_assertions: number;
    assertions_passed: number;
    assertions_failed: number;
  };
  scenarios: ScenarioResult[];
}
