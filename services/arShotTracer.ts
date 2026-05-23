/**
 * 2026-05-22 — AR Shot Tracer.
 *
 * Orchestrates pre-shot prediction + post-shot calibrated trace for
 * the AR overlay. Sits between:
 *   - utils/ballFlightPhysics.ts    (pure physics; computes the flight)
 *   - components/ArShotTraceOverlay (projects sampled points to screen)
 *   - voiceService / smartAnalysisEngine ("trace this shot")
 *
 * State model:
 *   - ZERO active traces at rest.
 *   - predictShot(club, target, conditions) → preview ActiveTrace
 *     (status='predicted', kind='preview') — overlay renders dashed.
 *   - markImpact() flips an existing preview into status='flying'
 *     and begins the animation clock. If no preview was running,
 *     creates one from defaults.
 *   - calibrateToObservedLanding(start, end) fits the physics result
 *     to match observed GPS endpoints (back-solves ballSpeed) so the
 *     overlay's landing dot lines up with the actual ball. Sets
 *     status='landed', kind='measured'.
 *   - Subscribers (the overlay component) react to status changes.
 *
 * Defensive: every state transition produces a valid ActiveTrace.
 * Missing geometry / weather falls back to club defaults. The component
 * always has SOMETHING to render once a trace is started.
 *
 * Voice integration:
 *   - speakNarration(trace, persona) produces "tracking… apex 92 feet…
 *     landing 248 yards" beats at the right t-offsets along the flight.
 *     Optional — caller decides when to fire.
 */

import {
  simulateBallFlight,
  defaultsForClub,
  type FlightInput,
  type FlightResult,
} from '../utils/ballFlightPhysics';
import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { getCachedWeather, fetchWeatherAt, type WeatherSnapshot } from './weatherService';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { getCaddieName } from '../lib/persona';
import { devLog } from './devLog';
import type { ShotLocation } from '../store/roundStore';

// ─── Types ───────────────────────────────────────────────────────────────

export type TraceStatus = 'predicted' | 'flying' | 'landed' | 'cleared';
export type TraceKind = 'preview' | 'live' | 'measured';

export interface ActiveTrace {
  id: string;
  status: TraceStatus;
  kind: TraceKind;
  /** Stable timestamp when the trace started; animation clock origin. */
  started_at_ms: number;
  /** Club used (if known). Drives default flight parameters. */
  club: string | null;
  /** Origin in lat/lng — anchor for projecting downrange/lateral. */
  start: ShotLocation;
  /** Shot azimuth bearing in degrees. */
  azimuth_deg: number;
  /** Physics simulation result. */
  flight: FlightResult;
  /** When measured: actual observed landing lat/lng. */
  observed_end?: ShotLocation | null;
  /** Conditions used for the simulation. */
  conditions: {
    wind_mph: number;
    windFrom_deg: number;
    altitude_ft: number;
  };
  /** Confidence 0..100. */
  confidence: number;
}

export interface PredictionInput {
  start: ShotLocation;
  /** Optional landing aim point — used for azimuth + carry sanity. */
  target?: ShotLocation;
  club: string | null;
  /** Optional explicit conditions override. Pulls from weather cache
   *  when omitted. */
  wind_mph?: number;
  windFrom_deg?: number;
  altitude_ft?: number;
}

// ─── State + subscriber fanout ───────────────────────────────────────────

let active: ActiveTrace | null = null;
type Listener = (trace: ActiveTrace | null) => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const cb of listeners) {
    try { cb(active); } catch (e) { devLog('[arTracer] listener threw: ' + String(e)); }
  }
}

export function subscribeActiveTrace(cb: Listener): () => void {
  listeners.add(cb);
  // Fire immediately so a fresh subscriber sees current state.
  try { cb(active); } catch { /* non-fatal */ }
  return () => { listeners.delete(cb); };
}

export function getActiveTrace(): ActiveTrace | null { return active; }

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build a pre-shot prediction. Status starts at 'predicted' so the
 * overlay can render a dashed preview while the player addresses the
 * ball. Call markImpact() when the swing fires.
 */
export async function predictShot(input: PredictionInput): Promise<ActiveTrace> {
  const conditions = await resolveConditions(input);
  const azimuth = input.target ? bearingDegrees(input.start, input.target) : 0;
  const defaults = defaultsForClub(input.club);
  const flightInput: FlightInput = {
    ...defaults,
    azimuth_deg: azimuth,
    wind_mph: conditions.wind_mph,
    windFrom_deg: conditions.windFrom_deg,
    altitude_ft: conditions.altitude_ft,
  };
  const flight = simulateBallFlight(flightInput);
  active = {
    id: newId('pred'),
    status: 'predicted',
    kind: 'preview',
    started_at_ms: Date.now(),
    club: input.club,
    start: input.start,
    azimuth_deg: azimuth,
    flight,
    conditions,
    confidence: 60,
  };
  devLog(`[arTracer] predicted club=${input.club} carry=${flight.carry_yd}y apex=${flight.apex_ft}ft`);
  notify();
  return active;
}

/**
 * Trigger the live-flight animation. If a preview is running, transition
 * to status='flying' and reset the clock. If no preview, build one from
 * the current round state (player's last known position + club).
 */
export async function markImpact(): Promise<ActiveTrace | null> {
  if (!active || active.status === 'cleared') {
    // No preview running — try to bootstrap from round state.
    const round = useRoundStore.getState();
    const lastShot = round.shots[round.shots.length - 1];
    const start = lastShot?.start_location ?? lastShot?.gps_location ?? null;
    if (!start) {
      devLog('[arTracer] markImpact bailed: no start location to anchor from');
      return null;
    }
    await predictShot({ start, club: lastShot?.club ?? round.club });
  }
  if (active) {
    active = { ...active, status: 'flying', kind: 'live', started_at_ms: Date.now() };
    devLog(`[arTracer] impact marked id=${active.id}`);
    notify();
  }
  return active;
}

/**
 * After the ball lands (player marked it / next shot back-filled), fit
 * the physics to the observed endpoints. Back-solves ballSpeed_mph so
 * the predicted carry matches the measured carry, holding other inputs
 * constant. Updates confidence based on how far the original prediction
 * drifted.
 */
export async function calibrateToObservedLanding(
  start: ShotLocation, end: ShotLocation, club: string | null,
): Promise<ActiveTrace> {
  const conditions = await resolveConditions({ start });
  const azimuth = bearingDegrees(start, end);
  const observedCarry_yd = haversineYards(start, end);
  const defaults = defaultsForClub(club);

  // Bisection back-solve on ballSpeed: find the speed that produces a
  // carry within 1 yard of the observed value, holding launch/spin/wind
  // constant. Bounded between 30 mph (chip) and 200 mph (long drive).
  let lo = 30, hi = 200;
  let bestFlight: FlightResult | null = null;
  let bestSpeed = defaults.ballSpeed_mph;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const f = simulateBallFlight({
      ...defaults,
      ballSpeed_mph: mid,
      azimuth_deg: azimuth,
      ...conditions,
    });
    bestFlight = f; bestSpeed = mid;
    if (f.carry_yd < observedCarry_yd) lo = mid; else hi = mid;
    if (Math.abs(f.carry_yd - observedCarry_yd) < 1) break;
  }
  if (!bestFlight) bestFlight = simulateBallFlight({ ...defaults, azimuth_deg: azimuth, ...conditions });

  // Confidence: lower the further the back-solve had to move from
  // defaults (very high or very low speed means the assumed defaults
  // were probably off for this player on this shot).
  const speedDrift = Math.abs(bestSpeed - defaults.ballSpeed_mph);
  const confidence = Math.max(40, Math.min(95, 90 - speedDrift * 0.4));

  active = {
    id: newId('meas'),
    status: 'landed',
    kind: 'measured',
    started_at_ms: Date.now(),
    club,
    start,
    azimuth_deg: azimuth,
    flight: bestFlight,
    observed_end: end,
    conditions,
    confidence: Math.round(confidence),
  };
  devLog(`[arTracer] calibrated speed=${bestSpeed.toFixed(0)}mph carry=${bestFlight.carry_yd}y conf=${active.confidence}`);
  notify();
  return active;
}

/** Wipe the active trace — call when the overlay closes / next shot
 *  starts / round ends. */
export function clearActiveTrace(): void {
  if (active) {
    active = { ...active, status: 'cleared' };
    devLog(`[arTracer] cleared id=${active.id}`);
    notify();
    active = null;
    notify();
  }
}

// ─── Voice narration ─────────────────────────────────────────────────────

/**
 * Produce a short, persona-aware narration of the active trace at three
 * timing beats (launch / apex / landing). Caller fires this through
 * voiceService.speak with `userInitiated: true`.
 */
export function buildNarration(trace: ActiveTrace): {
  launch: string;
  apex: string;
  landing: string;
} {
  const settings = useSettingsStore.getState();
  const caddieName = getCaddieName(settings.caddiePersonality);
  const launch = trace.club
    ? `${caddieName} — tracking that ${trace.club}.`
    : `${caddieName} — tracking.`;
  const apex = `Apex ${trace.flight.apex_ft} feet.`;
  const lateralBit = Math.abs(trace.flight.landing_lateral_yd) >= 6
    ? `, ${Math.abs(trace.flight.landing_lateral_yd)} yards ${trace.flight.landing_lateral_yd > 0 ? 'right' : 'left'}`
    : '';
  const landing = `Landing ${trace.flight.carry_yd} yards${lateralBit}.`;
  return { launch, apex, landing };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function resolveConditions(input: { start: ShotLocation }): Promise<ActiveTrace['conditions']> {
  // Try weather cache, then a fresh fetch. Default to calm.
  let weather: WeatherSnapshot | null = null;
  try {
    weather = getCachedWeather(input.start) ?? await fetchWeatherAt(input.start);
  } catch { /* non-fatal */ }
  return {
    wind_mph: weather?.wind_speed_mph ?? 0,
    windFrom_deg: weather?.wind_direction_deg ?? 0,
    // We don't have a course-altitude source today; default to 200ft
    // (most playable courses sit between sea level and 2000ft).
    altitude_ft: 200,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
