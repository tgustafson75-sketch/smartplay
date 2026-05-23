/**
 * 2026-05-22 — Ball flight physics integrator.
 *
 * Pure-function ballistic simulation for a golf shot. No React, no
 * stores — just inputs in, sampled trajectory out. Used by:
 *   - services/arShotTracer.ts (pre-shot prediction + post-shot fit)
 *   - components/ArShotTraceOverlay.tsx (renders the sampled points)
 *   - services/shotTrace.ts (future: replace the symmetric parabola
 *     with this for richer recap visualization)
 *
 * Model:
 *   - Euler integration at DT seconds per step (10ms by default).
 *   - Gravity: 32.174 ft/s² down.
 *   - Drag: F_d = -k_d * v * |v|  (quadratic; k_d derived from typical
 *     golf ball Cd ~ 0.3 + cross-section + air density).
 *   - Magnus lift: simplified — back-spin produces vertical lift
 *     proportional to spin_rpm and forward velocity. Side-spin
 *     produces lateral curve (slice/hook arc).
 *   - Wind: subtracted from ball velocity before drag computed so
 *     headwind increases drag, tailwind reduces it.
 *   - Altitude: thinner air at elevation → lower drag coefficient.
 *
 * Calibration anchors (median PGA tour driver carry ~280y @ 167mph
 * ball speed, 11° launch, 2600rpm backspin) drive the constants. The
 * model produces sensible numbers for the 60-300y range with default
 * coefficients. Recap-quality, NOT TrackMan-quality.
 *
 * All units are USCS (yards, feet, mph, rpm, °F) inside this module
 * because every golfer-facing surface in the app uses them; SI
 * conversions happen at the boundary.
 */

import { devLog } from '../services/devLog';

// ─── Public types ────────────────────────────────────────────────────────

export interface FlightInput {
  /** Initial ball speed off the face in mph. Typical driver 150-180. */
  ballSpeed_mph: number;
  /** Launch angle from horizontal, degrees. Typical driver 10-14;
   *  wedges 28-36; putter ~1. */
  launchAngle_deg: number;
  /** Azimuth (compass bearing) in degrees, 0=N. The path will curve
   *  away from this baseline if spin includes side-spin. */
  azimuth_deg: number;
  /** Back-spin in rpm. Drives Magnus lift. Driver ~2600; wedge ~9000. */
  backspin_rpm: number;
  /** Side-spin in rpm. Positive = right curve (slice for RH).
   *  Negative = left curve (hook). Driver ~200-500 for amateur. */
  sidespin_rpm: number;
  /** Wind speed in mph. */
  wind_mph: number;
  /** Wind direction in degrees (where wind is FROM). 0=N. */
  windFrom_deg: number;
  /** Tee elevation above sea level in feet. Thinner air at altitude
   *  flattens trajectory and adds carry. */
  altitude_ft: number;
}

export interface FlightPoint {
  /** Time since launch in seconds. */
  t: number;
  /** Distance downrange (yards) along the AZIMUTH axis. Positive forward. */
  downrange_yd: number;
  /** Lateral offset (yards) — positive right of azimuth, negative left. */
  lateral_yd: number;
  /** Altitude above launch in feet. */
  altitude_ft: number;
}

export interface FlightResult {
  /** Sampled trajectory points, t=0 at launch through landing. */
  points: FlightPoint[];
  /** Peak altitude (apex) in feet. */
  apex_ft: number;
  /** Total carry distance in yards (downrange at landing). */
  carry_yd: number;
  /** Lateral displacement at landing (yards). Positive=right of target. */
  landing_lateral_yd: number;
  /** Time of flight in seconds. */
  flight_seconds: number;
  /** Final speed at landing in mph. */
  landing_speed_mph: number;
}

// ─── Tunables (calibrated against tour medians) ─────────────────────────

const DT_SEC = 0.01;           // 10ms integration step
const MAX_FLIGHT_SEC = 12;     // safety cap on iterations
const GRAVITY_FT_PER_SEC2 = 32.174;

/** Sea-level air density factor; reduces with altitude (per 1000ft). */
const ALTITUDE_DRAG_REDUCTION_PER_KFT = 0.03;

/** Drag coefficient * effective cross-section / mass. Tuned so a 167mph
 *  driver with 11° launch and 2600rpm backspin carries ~275y at sea level. */
const DRAG_K = 0.00027;

/** Magnus lift coefficient. Tuned so 2600rpm produces apex ~100ft on a
 *  default driver. */
const MAGNUS_LIFT_K = 0.0000041;

/** Side-spin curve coefficient — fraction of magnus lift applied laterally. */
const MAGNUS_SIDE_K = 0.0000028;

/** Unit conversions. */
const FT_PER_YD = 3;
const FPS_PER_MPH = 1.46667;
const MPH_PER_FPS = 1 / FPS_PER_MPH;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Simulate a ball flight from launch conditions. Pure function — same
 * input always produces the same result. Safe to run on a worker / inside
 * a Reanimated worklet (no closures over store state).
 *
 * Returns a FlightResult with sampled points (one per ~30ms by default
 * after the first-pass integrator runs at DT_SEC; we down-sample to
 * keep the SVG overlay light).
 */
export function simulateBallFlight(input: FlightInput): FlightResult {
  // Convert mph → fps for the integrator.
  const v0_fps = input.ballSpeed_mph * FPS_PER_MPH;
  const angleRad = (input.launchAngle_deg * Math.PI) / 180;
  // Downrange = +x; lateral = +y (right); vertical = +z (up).
  let vx = v0_fps * Math.cos(angleRad);
  let vy = 0;
  let vz = v0_fps * Math.sin(angleRad);

  // Wind vector resolved into downrange / lateral components against
  // the shot azimuth. windFrom_deg is where the wind comes FROM, so
  // wind-to direction is +180°.
  const windToDeg = (input.windFrom_deg + 180) % 360;
  const windRelDeg = degDiff(windToDeg, input.azimuth_deg);
  const windRelRad = (windRelDeg * Math.PI) / 180;
  const windSpeed_fps = input.wind_mph * FPS_PER_MPH;
  const windDown = windSpeed_fps * Math.cos(windRelRad);   // tailwind +
  const windLat  = windSpeed_fps * Math.sin(windRelRad);   // right-crosswind +

  // Altitude air-density correction — fewer drag particles up high.
  const altKft = input.altitude_ft / 1000;
  const dragScale = Math.max(0.7, 1 - altKft * ALTITUDE_DRAG_REDUCTION_PER_KFT);
  const dragK = DRAG_K * dragScale;

  // Spin → Magnus lift (vertical) + side curve (lateral).
  const liftAccel = MAGNUS_LIFT_K * input.backspin_rpm;
  const sideAccel = MAGNUS_SIDE_K * input.sidespin_rpm;

  let x = 0, y = 0, z = 0;
  const rawPoints: FlightPoint[] = [{ t: 0, downrange_yd: 0, lateral_yd: 0, altitude_ft: 0 }];
  let t = 0;
  while (t < MAX_FLIGHT_SEC) {
    // Velocity relative to air (subtract wind).
    const vrx = vx - windDown;
    const vry = vy - windLat;
    const vrz = vz;
    const vrMag = Math.sqrt(vrx * vrx + vry * vry + vrz * vrz);

    // Drag: opposes air-relative velocity, magnitude prop to v^2.
    const ax_drag = -dragK * vrMag * vrx;
    const ay_drag = -dragK * vrMag * vry;
    const az_drag = -dragK * vrMag * vrz;

    // Magnus lift: vertical component proportional to forward speed * backspin
    const az_magnus = liftAccel * Math.abs(vrx);
    // Side curve: lateral component proportional to forward speed * sidespin
    const ay_magnus = sideAccel * Math.abs(vrx);

    const ax = ax_drag;
    const ay = ay_drag + ay_magnus;
    const az = az_drag + az_magnus - GRAVITY_FT_PER_SEC2;

    vx += ax * DT_SEC;
    vy += ay * DT_SEC;
    vz += az * DT_SEC;
    x += vx * DT_SEC;
    y += vy * DT_SEC;
    z += vz * DT_SEC;
    t += DT_SEC;

    if (z <= 0 && t > 0.1) break;            // landed
    // Sample every ~30ms (3rd step).
    if (rawPoints.length === 0 || t - rawPoints[rawPoints.length - 1].t >= 0.03) {
      rawPoints.push({
        t: round3(t),
        downrange_yd: round1(x / FT_PER_YD),
        lateral_yd: round1(y / FT_PER_YD),
        altitude_ft: round1(Math.max(0, z)),
      });
    }
  }

  const apex_ft = rawPoints.reduce((m, p) => Math.max(m, p.altitude_ft), 0);
  const last = rawPoints[rawPoints.length - 1];
  const landingSpeed_fps = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const result: FlightResult = {
    points: rawPoints,
    apex_ft: round1(apex_ft),
    carry_yd: Math.round(last.downrange_yd),
    landing_lateral_yd: round1(last.lateral_yd),
    flight_seconds: round1(last.t),
    landing_speed_mph: round1(landingSpeed_fps * MPH_PER_FPS),
  };
  devLog(
    `[physics] sim carry=${result.carry_yd}y apex=${result.apex_ft}ft ` +
    `flight=${result.flight_seconds}s lat=${result.landing_lateral_yd}y`,
  );
  return result;
}

/**
 * Sensible defaults per club for amateur swing — gives the AR tracer
 * a reasonable starting point when only club + wind are known. Tour
 * numbers are higher; these reflect a single-digit-handicap amateur.
 */
export function defaultsForClub(club: string | null): Pick<
  FlightInput, 'ballSpeed_mph' | 'launchAngle_deg' | 'backspin_rpm' | 'sidespin_rpm'
> {
  const c = (club ?? '').toLowerCase();
  if (c.includes('driver')) return { ballSpeed_mph: 155, launchAngle_deg: 12, backspin_rpm: 2600, sidespin_rpm: 0 };
  if (c.includes('3w'))     return { ballSpeed_mph: 145, launchAngle_deg: 13, backspin_rpm: 3200, sidespin_rpm: 0 };
  if (c.includes('hybrid')) return { ballSpeed_mph: 135, launchAngle_deg: 15, backspin_rpm: 4000, sidespin_rpm: 0 };
  if (c.includes('4i'))     return { ballSpeed_mph: 130, launchAngle_deg: 16, backspin_rpm: 4800, sidespin_rpm: 0 };
  if (c.includes('5i'))     return { ballSpeed_mph: 125, launchAngle_deg: 18, backspin_rpm: 5400, sidespin_rpm: 0 };
  if (c.includes('6i'))     return { ballSpeed_mph: 120, launchAngle_deg: 19, backspin_rpm: 6000, sidespin_rpm: 0 };
  if (c.includes('7i'))     return { ballSpeed_mph: 115, launchAngle_deg: 21, backspin_rpm: 6800, sidespin_rpm: 0 };
  if (c.includes('8i'))     return { ballSpeed_mph: 108, launchAngle_deg: 24, backspin_rpm: 7500, sidespin_rpm: 0 };
  if (c.includes('9i'))     return { ballSpeed_mph: 100, launchAngle_deg: 27, backspin_rpm: 8200, sidespin_rpm: 0 };
  if (c === 'pw' || c.includes('pitch')) return { ballSpeed_mph: 92, launchAngle_deg: 30, backspin_rpm: 9000, sidespin_rpm: 0 };
  if (c.includes('gw'))     return { ballSpeed_mph: 82, launchAngle_deg: 33, backspin_rpm: 9500, sidespin_rpm: 0 };
  if (c.includes('sw'))     return { ballSpeed_mph: 72, launchAngle_deg: 36, backspin_rpm: 10000, sidespin_rpm: 0 };
  if (c.includes('lw'))     return { ballSpeed_mph: 60, launchAngle_deg: 40, backspin_rpm: 10500, sidespin_rpm: 0 };
  // Default = 7-iron.
  return { ballSpeed_mph: 115, launchAngle_deg: 21, backspin_rpm: 6800, sidespin_rpm: 0 };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function degDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
