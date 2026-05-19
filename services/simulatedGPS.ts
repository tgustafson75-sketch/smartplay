/**
 * Phase Q.5b — Simulated GPS test harness.
 *
 * Drives the smartFinderService cached fix from a pre-built waypoint
 * walk path so holeDetection / lie analysis / SmartFinder distance
 * calculations can be verified end-to-end without needing real GPS or
 * an actual course visit.
 *
 * Architecture: services/smartFinderService exposes setSimulatedFix +
 * clearSimulatedFix + isSimulatedActive. This service drives the
 * waypoint progression on a setInterval, interpolating between
 * consecutive waypoints at realistic walking pace. All other services
 * (holeDetection, courseGeometry, SmartFinder) read GPS from the same
 * source and don't know they're being fed simulated data.
 */

import { setSimulatedFix, clearSimulatedFix, isSimulatedActive } from './smartFinderService';
import type { SimulatedWalk, SimulatedWalkPoint } from '../data/simulatedWalks';
import { SIMULATED_WALKS } from '../data/simulatedWalks';
import type { ShotResult } from '../store/roundStore';

const TICK_MS = 1_000; // 1Hz fix updates — matches a real-world GPS poll cadence
const METERS_PER_DEG_LAT = 111_111;

export type SimulatedWalkState = {
  walk_id: string;
  waypoint_index: number;
  fraction_through: number;
  current_lat: number;
  current_lng: number;
  next_label: string | null;
  pace_mps: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let activeWalk: SimulatedWalk | null = null;
let waypointIdx = 0;
let segmentStartTs = 0;
let listeners = new Set<(s: SimulatedWalkState | null) => void>();
// 2026-05-19 — Pace overrides + step mode. Tim's harness was outrunning
// holeDetection's 10s sustained-position window because the default pace
// was 240 m/s. New controls let the dev pick a realistic walking pace
// (so transitions actually fire), pause/resume, or step waypoint-by-
// waypoint to debug per-segment behavior.
let paceOverrideMps: number | null = null;
let paused = false;
let stepMode = false;
let pendingStepAdvance = false;

export function setSimulatorPace(mps: number | null): void {
  paceOverrideMps = mps;
  console.log('[simGPS] pace override:', mps ?? 'walk-default');
}
export function getSimulatorPaceOverride(): number | null { return paceOverrideMps; }
export function setSimulatorPaused(p: boolean): void {
  paused = p;
  if (!paused) segmentStartTs = Date.now();
  console.log('[simGPS] paused:', p);
}
export function isSimulatorPaused(): boolean { return paused; }
export function setSimulatorStepMode(s: boolean): void {
  stepMode = s;
  pendingStepAdvance = false;
  console.log('[simGPS] step mode:', s);
}
export function isSimulatorStepMode(): boolean { return stepMode; }
export function simulatorStepOnce(): void {
  pendingStepAdvance = true;
  segmentStartTs = Date.now() - 999_999;
}

// 2026-05-19 — Harness event log. Every interesting state change
// (start, stop, waypoint reached, score logged, hole transition,
// off-course flip) is appended here so the GPS Test Bench can show
// a live timestamped log. Ring buffer capped at 100 events.
export type HarnessEvent = { ts: number; kind: string; detail: string };
const harnessEvents: HarnessEvent[] = [];
const eventListeners = new Set<(e: HarnessEvent[]) => void>();
export function logHarnessEvent(kind: string, detail: string): void {
  const ev = { ts: Date.now(), kind, detail };
  harnessEvents.push(ev);
  if (harnessEvents.length > 100) harnessEvents.shift();
  eventListeners.forEach(l => { try { l([...harnessEvents]); } catch {} });
}
export function subscribeHarnessEvents(cb: (e: HarnessEvent[]) => void): () => void {
  eventListeners.add(cb);
  cb([...harnessEvents]);
  return () => { eventListeners.delete(cb); };
}
export function clearHarnessEvents(): void {
  harnessEvents.length = 0;
  eventListeners.forEach(l => { try { l([]); } catch {} });
}

function metersBetween(a: SimulatedWalkPoint, b: SimulatedWalkPoint): number {
  const dLat = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * METERS_PER_DEG_LAT * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function emit(s: SimulatedWalkState | null): void {
  listeners.forEach(l => { try { l(s); } catch (e) { console.log('[simGPS] listener err', e); } });
}

/** Subscribe to walk progress for UI rendering. */
export function subscribeToWalk(cb: (s: SimulatedWalkState | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getAvailableWalks(): SimulatedWalk[] {
  return SIMULATED_WALKS;
}

export function getActiveWalk(): SimulatedWalk | null {
  return activeWalk;
}

/**
 * Start a simulated walk by id. Cancels any in-progress walk first.
 * Logs progress to console.
 */
export function startSimulatedWalk(walkId: string): boolean {
  const walk = SIMULATED_WALKS.find(w => w.id === walkId);
  if (!walk) {
    console.log('[simGPS] unknown walk id:', walkId);
    return false;
  }
  stopSimulatedWalk();

  activeWalk = walk;
  waypointIdx = 0;
  segmentStartTs = Date.now();
  // Drop the first waypoint immediately so listeners see something.
  setSimulatedFix(walk.points[0]);
  emit({
    walk_id: walk.id,
    waypoint_index: 0,
    fraction_through: 0,
    current_lat: walk.points[0].lat,
    current_lng: walk.points[0].lng,
    next_label: walk.points[1]?.label ?? null,
    pace_mps: walk.pace_mps ?? 1.4,
  });
  console.log('[simGPS] start:', walk.id, '·', walk.points.length, 'waypoints');
  logHarnessEvent('start', `${walk.display_name} · ${walk.points.length} waypoints`);

  timer = setInterval(tick, TICK_MS);
  return true;
}

export function stopSimulatedWalk(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (activeWalk) console.log('[simGPS] stop:', activeWalk.id);
  activeWalk = null;
  waypointIdx = 0;
  clearSimulatedFix();
  emit(null);
}

// 2026-05-19 — Synthesize a realistic per-hole shot trace from
// (par, score, yardage). Lets the recap pipeline see club distribution,
// pattern detection (your 7i goes right etc), shots-per-hole flow,
// etc. instead of an empty shots[] array.
//
// Strategy:
//   - putts = 2 typically (1 if birdie, 3 if double-bogey or worse)
//   - non-putt strokes = score - putts
//   - Tee shot: Driver on par 4/5, mid-iron on par 3
//   - Then approach + chip(s) by remaining distance using the club map
//   - Last non-putt shot picks the closest "to the green" club
const CLUB_DISTANCES: { name: string; yards: number }[] = [
  { name: 'Driver', yards: 260 },
  { name: '3W', yards: 230 },
  { name: '5W', yards: 210 },
  { name: '4i', yards: 190 },
  { name: '5i', yards: 175 },
  { name: '6i', yards: 160 },
  { name: '7i', yards: 145 },
  { name: '8i', yards: 130 },
  { name: '9i', yards: 115 },
  { name: 'PW', yards: 100 },
  { name: 'SW', yards: 75 },
  { name: 'LW', yards: 50 },
];
function clubForDistance(yards: number): string {
  if (yards <= 0) return 'PW';
  // Find smallest club >= yards (so we don't underclub).
  for (let i = CLUB_DISTANCES.length - 1; i >= 0; i--) {
    if (CLUB_DISTANCES[i].yards >= yards) return CLUB_DISTANCES[i].name;
  }
  return 'Driver';
}
function synthesizeShots(par: number, score: number, yardage: number): {
  club: string;
  feel: 'flush' | 'solid' | 'fat' | 'thin';
  direction: 'left' | 'straight' | 'right';
  shape: 'draw' | 'straight' | 'fade';
  distance_yards: number;
}[] {
  const offset = score - par;
  // Putt count: birdie usually 1 putt; bogey+ usually 2; double+ sometimes 3.
  const putts = offset <= -1 ? 1 : offset >= 2 ? (Math.random() < 0.4 ? 3 : 2) : 2;
  const fullSwings = Math.max(1, score - putts);
  const shots: ReturnType<typeof synthesizeShots> = [];
  // Tee shot — Driver on par 4/5, mid-iron on par 3 scaled to yardage.
  let remaining = yardage;
  const teeClub = par === 3 ? clubForDistance(yardage) : 'Driver';
  const teeDist = Math.min(remaining, par === 3 ? yardage : 240);
  shots.push({
    club: teeClub,
    feel: Math.random() < 0.7 ? 'solid' : (Math.random() < 0.5 ? 'flush' : 'thin'),
    direction: Math.random() < 0.65 ? 'straight' : (Math.random() < 0.5 ? 'left' : 'right'),
    shape: Math.random() < 0.6 ? 'straight' : (Math.random() < 0.5 ? 'draw' : 'fade'),
    distance_yards: teeDist,
  });
  remaining = Math.max(0, remaining - teeDist);

  // Approach + chips for remaining full-swing shots.
  for (let i = 1; i < fullSwings; i++) {
    const isLast = i === fullSwings - 1;
    // Last full swing should leave ~10-20y short (chip into birdie/par putt).
    const target = isLast ? Math.max(20, remaining) : Math.min(remaining, 175);
    const club = clubForDistance(target);
    shots.push({
      club,
      feel: Math.random() < 0.6 ? 'solid' : (Math.random() < 0.5 ? 'pure' as 'flush' : 'thin'),
      direction: Math.random() < 0.6 ? 'straight' : (Math.random() < 0.5 ? 'left' : 'right'),
      shape: Math.random() < 0.7 ? 'straight' : (Math.random() < 0.5 ? 'draw' : 'fade'),
      distance_yards: target,
    });
    remaining = Math.max(0, remaining - target);
  }

  // Putts — always with Putter, 0 distance for synthetic (real shots
  // would have actual roll distance but the recap doesn't require it).
  for (let i = 0; i < putts; i++) {
    shots.push({
      club: 'Putter',
      feel: 'solid',
      direction: 'straight',
      shape: 'straight',
      distance_yards: 5,
    });
  }
  return shots;
}

// 2026-05-18 — Randomized score generator for synthetic rounds. The
// per-par distributions roughly mimic a bogey-handicap recreational
// player so the recap surface gets realistic variance (not all-pars
// every time). Picked by Tim's "mix it up — don't get consistent one
// for one par" feedback. Weights sum to 100.
function rollSyntheticScore(par: number): number {
  type Roll = { offset: number; weight: number };
  const distribution: Roll[] =
    par === 3 ? [
      { offset: -1, weight: 5 },
      { offset: 0,  weight: 50 },
      { offset: 1,  weight: 35 },
      { offset: 2,  weight: 8 },
      { offset: 3,  weight: 2 },
    ] :
    par === 4 ? [
      { offset: -1, weight: 8 },
      { offset: 0,  weight: 40 },
      { offset: 1,  weight: 35 },
      { offset: 2,  weight: 12 },
      { offset: 3,  weight: 5 },
    ] : /* par 5 */ [
      { offset: -1, weight: 15 },
      { offset: 0,  weight: 35 },
      { offset: 1,  weight: 30 },
      { offset: 2,  weight: 15 },
      { offset: 3,  weight: 5 },
    ];
  const r = Math.random() * 100;
  let cum = 0;
  for (const { offset, weight } of distribution) {
    cum += weight;
    if (r <= cum) return Math.max(1, par + offset);
  }
  return par;
}

function tick(): void {
  if (!activeWalk) return;
  if (paused) return;
  if (stepMode && !pendingStepAdvance) return;
  const points = activeWalk.points;
  if (waypointIdx >= points.length - 1) {
    console.log('[simGPS] walk complete');
    logHarnessEvent('walk_complete', `Reached final waypoint (${points.length})`);
    stopSimulatedWalk();
    return;
  }

  const a = points[waypointIdx];
  const b = points[waypointIdx + 1];
  const segmentMeters = metersBetween(a, b);
  // 2026-05-19 — Pace override takes precedence over walk's pace_mps so
  // Tim can swap fast/realistic on the fly without rebuilding the walk.
  const pace = paceOverrideMps ?? activeWalk.pace_mps ?? 1.4;
  const segmentMs = (segmentMeters / pace) * 1000;
  const elapsed = Date.now() - segmentStartTs;
  const t = Math.min(1, elapsed / Math.max(segmentMs, 1));

  const lat = a.lat + (b.lat - a.lat) * t;
  const lng = a.lng + (b.lng - a.lng) * t;
  // 2026-05-19 — Audit v2 hook: apply noise/dropout/glitch/drift to
  // the clean lat/lng before publishing, and record ground truth for
  // probe assertions. When audit mode is off, applyNoise is a no-op
  // and the noised values equal the clean values (configureNoise
  // defaults to sigma 0).
  let publishLat: number | null = lat;
  let publishLng: number | null = lng;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const probes = require('./audit/probes');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const injector = require('./audit/noiseInjector');
    probes.setGroundTruth(lat, lng);
    const noised = injector.applyNoise(lat, lng);
    publishLat = noised.lat;
    publishLng = noised.lng;
  } catch { /* audit module not loaded; publish clean */ }
  if (publishLat != null && publishLng != null) {
    setSimulatedFix({ lat: publishLat, lng: publishLng });
  }
  // Probe sample: capture per-tick raw consumer state.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const probes = require('./audit/probes');
    if (probes.isProbeActive()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sf = require('./smartFinderService');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const off = require('./offCourseDetector');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useRoundStore } = require('../store/roundStore');
      const round = useRoundStore.getState();
      const fix = sf.getLastFix();
      const fmb = sf.getGreenYardagesSync(round.currentHole);
      probes.recordSample('gps.raw', { lat: publishLat, lng: publishLng, accuracy_m: fix?.accuracy_m ?? null });
      probes.recordSample('gps.smoothed', fix ? { lat: fix.location.lat, lng: fix.location.lng } : null);
      probes.recordSample('yardage.toGreenCenter', fmb?.middle ?? null);
      probes.recordSample('yardage.toGreenFront', fmb?.front ?? null);
      probes.recordSample('yardage.toGreenBack', fmb?.back ?? null);
      probes.recordSample('waypoint.currentHole', round.currentHole);
      probes.recordSample('waypoint.offCourse', off.useOffCourseStore.getState().isOffCourse);
    }
  } catch { /* probes not loaded */ }

  if (t >= 1) {
    waypointIdx += 1;
    segmentStartTs = Date.now();
    if (stepMode) pendingStepAdvance = false;
    const reached = b.label ?? `wp ${waypointIdx}`;
    console.log('[simGPS] reached:', reached);
    logHarnessEvent('waypoint', `→ ${reached} (idx ${waypointIdx})`);
    // 2026-05-18 — If this waypoint is a tagged green, log a
    // randomized score for that hole so the scorecard + recap pipeline
    // populates end-to-end. Only fires when the round-active state
    // hasn't been changed (e.g. user discarded mid-walk).
    // 2026-05-19 — Mid-fairway arrival logs the tee shot for this hole.
    // Lets the STROKE counter on the data strip tick up to 2 while the
    // simulator is still walking through the hole, instead of staying
    // at 1 until the green-burst fires every shot at once.
    if (!b.isGreen && b.label?.includes('mid-fairway') && b.holeNumber != null && b.par != null) {
      try {
        const { useRoundStore } = require('../store/roundStore');
        const round = useRoundStore.getState();
        if (round.isRoundActive && !round.shots.some((s: ShotResult) => s.hole === b.holeNumber)) {
          const holeRecord = round.courseHoles.find((c: { hole: number }) => c.hole === b.holeNumber);
          const yardage = holeRecord?.distance ?? (b.par === 3 ? 150 : b.par === 4 ? 380 : 510);
          const teeClub = b.par === 3 ? clubForDistance(yardage) : 'Driver';
          round.logShot({
            feel: Math.random() < 0.7 ? 'solid' : (Math.random() < 0.5 ? 'flush' : 'thin'),
            direction: Math.random() < 0.65 ? 'straight' : (Math.random() < 0.5 ? 'left' : 'right'),
            shape: Math.random() < 0.6 ? 'straight' : (Math.random() < 0.5 ? 'draw' : 'fade'),
            club: teeClub,
            hole: b.holeNumber,
            timestamp: Date.now(),
            acousticContact: null,
            distance_yards: b.par === 3 ? Math.min(yardage, 220) : 240,
            logged_via: 'tap',
            shot_in_hole_index: 1,
            hole_number: b.holeNumber,
          });
          logHarnessEvent('shot', `H${b.holeNumber} #1 ${teeClub} (tee)`);
        }
      } catch (e) {
        console.log('[simGPS] tee shot log failed:', e);
      }
    }

    if (b.isGreen && b.holeNumber != null && b.par != null) {
      try {
        const { useRoundStore } = require('../store/roundStore');
        const round = useRoundStore.getState();
        if (round.isRoundActive && round.scores[b.holeNumber] == null) {
          const score = rollSyntheticScore(b.par);
          round.logScore(b.holeNumber, score);
          const offset = score - b.par;
          const label = offset === -1 ? 'birdie' : offset === 0 ? 'par' : offset === 1 ? 'bogey' : offset === 2 ? 'double' : `+${offset}`;
          console.log(`[simGPS] H${b.holeNumber} synthetic score: ${score} (${label})`);
          logHarnessEvent('score', `H${b.holeNumber} = ${score} (${label}) on par ${b.par}`);
          // 2026-05-19 — Synthesize the REMAINING shots (the tee shot
          // was already logged at the mid-fairway waypoint above).
          // Drives club distribution stats, pattern detection, per-hole
          // shot trace. Putts logged via logPutts for the scorecard's
          // putts column.
          const holeRecord = round.courseHoles.find((c: { hole: number }) => c.hole === b.holeNumber);
          const yardage = holeRecord?.distance ?? (b.par === 3 ? 150 : b.par === 4 ? 380 : 510);
          const synthShots = synthesizeShots(b.par, score, yardage);
          const existingShotCount = round.shots.filter((s: ShotResult) => s.hole === b.holeNumber).length;
          let putts = 0;
          // Skip the first `existingShotCount` non-putt shots (we already
          // logged the tee shot at mid-fairway).
          let skipped = 0;
          for (let i = 0; i < synthShots.length; i++) {
            const s = synthShots[i];
            if (s.club === 'Putter') { putts += 1; continue; }
            if (skipped < existingShotCount) { skipped += 1; continue; }
            round.logShot({
              feel: s.feel as ShotResult['feel'],
              direction: s.direction,
              shape: s.shape,
              club: s.club,
              hole: b.holeNumber,
              timestamp: Date.now() + i,
              acousticContact: null,
              distance_yards: s.distance_yards,
              logged_via: 'tap',
              shot_in_hole_index: existingShotCount + (i - skipped) + 1,
              hole_number: b.holeNumber,
            });
          }
          if (putts > 0) round.logPutts(b.holeNumber, putts);
          logHarnessEvent('shots', `H${b.holeNumber} · ${synthShots.length - putts} full + ${putts} putts`);
        }
        // 2026-05-19 — Auto-advance currentHole when the simulator
        // reaches a green. holeDetection's polling-based auto-transition
        // is too dependent on pace/timing for the harness (Tim hit
        // 18/18 scores but current_hole stuck at 1/18). Advance
        // deterministically here so the entire downstream chain
        // (Caddie data strip, F/M/B yardage, SmartVision hole image)
        // updates as the harness walks through the round. Capped at
        // courseHoles.length so we don't index past hole 18.
        const nextHole = b.holeNumber + 1;
        const totalHoles = round.courseHoles.length;
        if (round.isRoundActive && round.currentHole !== nextHole && nextHole <= totalHoles) {
          round.setCurrentHole(nextHole);
          logHarnessEvent('transition', `→ hole ${nextHole} (synthetic advance from H${b.holeNumber} green)`);
        }
      } catch (e) {
        console.log('[simGPS] synthetic score log failed:', e);
        logHarnessEvent('error', `score log failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  emit({
    walk_id: activeWalk.id,
    waypoint_index: waypointIdx,
    fraction_through: t,
    current_lat: lat,
    current_lng: lng,
    next_label: points[waypointIdx + 1]?.label ?? null,
    pace_mps: pace,
  });
}

export { isSimulatedActive };

// 2026-05-17 — JSON-driven synthetic round playback.
//
// Loads __mocks__/mockRound.json and converts each hole into a 4-point
// waypoint trace (tee → 1/3 fairway → 2/3 fairway → green). Time
// between waypoints is compressed by the JSON's compressionRatio so a
// real 4-hour round plays in ~4 minutes by default. Pure dev tool —
// production builds can call this too (no native deps) but the entry
// point is hidden behind Settings → Owner Tools → "Simulate Round".

interface MockRoundHole {
  holeNumber: number;
  par: number;
  expectedYardage: number;
  computedYardage: number;
  bearingDeg: number;
  tee: { lat: number; lng: number; timestampMs: number };
  green: { lat: number; lng: number; timestampMs: number };
  hazards: string[];
  shotsPlanned: number;
}

export interface MockRound {
  schemaVersion: number;
  courseName: string;
  courseId: string;
  totalHoles: number;
  compressionRatio: number;
  shotIntervalMs: number;
  betweenHoleWalkMs: number;
  holes: MockRoundHole[];
}

/** Convert a MockRound JSON object into a SimulatedWalk that
 *  startSimulatedWalk understands. Each hole expands to:
 *    [tee] → [1/3 fairway] → [2/3 fairway] → [green] → [next hole tee]
 *  with the last hole's green capped (no next-tee continuation). */
export function buildWalkFromMockRound(round: MockRound): SimulatedWalk {
  const points: SimulatedWalkPoint[] = [];
  for (let i = 0; i < round.holes.length; i++) {
    const h = round.holes[i];
    const { tee, green } = h;
    // Tee position
    points.push({ lat: tee.lat, lng: tee.lng, label: `H${h.holeNumber} tee` });
    // Fairway interpolations to seed sustained-position windows
    points.push({
      lat: tee.lat + (green.lat - tee.lat) * 0.34,
      lng: tee.lng + (green.lng - tee.lng) * 0.34,
      label: `H${h.holeNumber} mid-fairway`,
      // 2026-05-19 — Tag fairway waypoints with their hole so the
      // simulator can log a tee shot when the player arrives here.
      // STROKE counter on the data strip then increments mid-hole
      // instead of staying at 1 until the green burst-logs everything.
      holeNumber: h.holeNumber,
      par: h.par,
    });
    points.push({
      lat: tee.lat + (green.lat - tee.lat) * 0.67,
      lng: tee.lng + (green.lng - tee.lng) * 0.67,
      label: `H${h.holeNumber} approach`,
      holeNumber: h.holeNumber,
      par: h.par,
    });
    // Green
    points.push({
      lat: green.lat,
      lng: green.lng,
      label: `H${h.holeNumber} green`,
      holeNumber: h.holeNumber,
      par: h.par,
      isGreen: true,
    });
  }
  // 2026-05-19 — Pace dropped from 240 m/s (fast-forward, ~7s/round)
  // to 4 m/s (~brisk jog). Reason: at 240 m/s the simulator passed
  // through each green→next-tee transition zone in <1 second, well
  // below holeDetection's 10s SUSTAINED_TRANSITION_MS window. Auto-
  // transitions never fired and the round stayed pinned on hole 1
  // forever. At 4 m/s:
  //   - within-hole segments (~60m): ~15s walking
  //   - green→next-tee segment (~50m): ~12s — clears the 10s window
  //   - per-hole total: ~57s, 18 holes ≈ 17 min, 9 holes ≈ 9 min
  // Slow but functional. Pace overrides via setSimulatorPace() let
  // the dev switch back to fast-forward for pure math validation.
  return {
    id: `mock-round-${round.courseId}`,
    display_name: `Synthetic: ${round.courseName} (${round.totalHoles} holes)`,
    course_name_hint: round.courseName.toLowerCase(),
    description: 'Synthetic round from a MockRound JSON. Pace tuned to clear holeDetection sustained-position gates.',
    pace_mps: 4,
    points,
  };
}

/** 2026-05-18 — Start a synthetic round end-to-end:
 *   1. Build CourseHole[] from the mock JSON and call roundStore.startRound
 *      so isRoundActive flips true, courseHoles populates, and downstream
 *      subscribers (holeDetection, orchestrator, SmartFinder) wake up.
 *   2. Suppress the real GPS watcher (otherwise the device's actual fix
 *      fights the simulator and yardages snap back to real coords).
 *   3. Feed the simulated walk so the cached fix marches tee→green for
 *      every hole.
 *  Returns the walk_id so callers can subscribe / stop. */
export function startSyntheticRound(round: MockRound): string {
  try {
    return _startSyntheticRoundInternal(round);
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.log('[simGPS] startSyntheticRound FATAL:', msg);
    // Surface via owner sentinel so it appears in /owner-logs even if
    // the UI alert path also throws.
    try {
      const { ownerSentinel } = require('./ownerSentinel');
      ownerSentinel('simGPS.startSyntheticRound', e);
    } catch {}
    throw e;
  }
}

function _startSyntheticRoundInternal(round: MockRound): string {
  // 1. Build CourseHole records from the mock holes. The mock JSON only
  //    has tee + green coords, so middle/front/back all collapse onto
  //    the green centroid — fine for a synthetic test (yardages won't
  //    be 3-decimal accurate but the hole-progression / Kevin firing /
  //    auto-detect paths all exercise correctly).
  const courseHoles = round.holes.map(h => ({
    hole: h.holeNumber,
    par: h.par,
    distance: h.expectedYardage,
    front: Math.max(0, h.expectedYardage - 10),
    back: h.expectedYardage + 10,
    teeLat: h.tee.lat,
    teeLng: h.tee.lng,
    middleLat: h.green.lat,
    middleLng: h.green.lng,
    frontLat: h.green.lat,
    frontLng: h.green.lng,
    backLat: h.green.lat,
    backLng: h.green.lng,
    note: '',
    estimated: true,
  }));

  // 1b. Seed the geometry cache so holeDetection.detectCurrentHole()
  //     can find tee + green coords and auto-advance the hole as the
  //     simulator walks. Without this, holeDetection short-circuits
  //     with "no current-hole green geometry" and the round sits on
  //     hole 1 forever.
  try {
    const { _seedGeometry } = require('./courseGeometryService');
    _seedGeometry({
      course_id: round.courseId,
      course_name: round.courseName,
      fetched_at: Date.now(),
      holes: round.holes.map(h => ({
        hole_number: h.holeNumber,
        par: h.par,
        yardage: h.expectedYardage,
        tee: { lat: h.tee.lat, lng: h.tee.lng },
        green: { lat: h.green.lat, lng: h.green.lng },
        green_front: { lat: h.green.lat, lng: h.green.lng },
        green_back: { lat: h.green.lat, lng: h.green.lng },
        bearing_deg: h.bearingDeg,
        hazards: [],
        fairway_centerline: [],
        green_outline: [],
      })),
    });
    console.log('[simGPS] seeded synthetic geometry for', round.holes.length, 'holes');
  } catch (e) {
    console.log('[simGPS] geometry seed failed (non-fatal):', e);
  }

  // 2. Surgical state mutation in lieu of roundStore.startRound().
  //    Why: startRound triggers a cascade of async IIFEs (Health Connect
  //    permission ask, real-GPS bootstrap, walking detector ticker,
  //    geometry pre-warm hitting the network with our fake courseId,
  //    background-location request, etc.) — any of which can crash a
  //    dev-client build that doesn't have the corresponding native
  //    modules wired up. The synthetic harness needs NONE of those:
  //    we own the GPS fix, we don't care about Health Connect, and the
  //    geometry is already seeded above. So we directly set just the
  //    state that downstream subscribers (holeDetection, off-course
  //    detector, F/M/B yardages in Caddie tab) actually read.
  try {
    const { useRoundStore } = require('../store/roundStore');
    useRoundStore.setState({
      isRoundActive: true,
      mode: 'free_play',
      currentRoundId: 'synthetic-' + Date.now(),
      activeCourse: round.courseName,
      activeCourseId: round.courseId,
      courseHoles,
      nineHoleMode: false,
      isCompetition: false,
      roundNotes: 'Synthetic round playback (dev harness)',
      goal: null,
      currentHole: 1,
      currentYardage: courseHoles[0]?.distance ?? null,
      scores: {},
      putts: {},
      penalties: {},
      shots: [],
      holeStats: [],
      plans: [],
      currentRoundPhotos: [],
      emotionalLog: [],
      roundStartTime: Date.now(),
    });
    console.log('[simGPS] synthetic round state applied:', round.courseName, courseHoles.length, 'holes');
  } catch (e) {
    console.log('[simGPS] state setup failed:', e);
    throw e;
  }

  // 3. Kill the real GPS watcher so simulated coords aren't overridden
  //    by real ones (e.g. if the watcher was started earlier in the
  //    session). Wrapped because stopGpsManager spawns a
  //    backgroundLocationTask async stop that may not be available in
  //    every build profile.
  try {
    const { stopGpsManager } = require('./gpsManager');
    stopGpsManager();
    console.log('[simGPS] real GPS watcher suppressed — simulator owns the fix');
    logHarnessEvent('gps', 'real GPS watcher suppressed; simulator owns the fix');
  } catch (e) {
    console.log('[simGPS] stopGpsManager failed (non-fatal):', e);
  }

  // 4. Register and start the simulated walk. Wrapped because
  //    startSimulatedWalk emits to subscribers — if any subscriber
  //    throws during initial emit, we want a clean error, not a crash.
  try {
    const walk = buildWalkFromMockRound(round);
    const existingIdx = SIMULATED_WALKS.findIndex(w => w.id === walk.id);
    if (existingIdx >= 0) SIMULATED_WALKS[existingIdx] = walk;
    else SIMULATED_WALKS.push(walk);
    startSimulatedWalk(walk.id);
    return walk.id;
  } catch (e) {
    console.log('[simGPS] walk start failed:', e);
    throw e;
  }
}

/** 2026-05-18 — Stop the synthetic round end-to-end. Mirrors
 *  startSyntheticRound: discards the round in the store, clears the
 *  simulated fix, and stops the walk timer. */
export function stopSyntheticRound(): void {
  stopSimulatedWalk();
  try {
    const { useRoundStore } = require('../store/roundStore');
    const s = useRoundStore.getState();
    if (s.isRoundActive) {
      s.discardRound();
      console.log('[simGPS] synthetic round discarded from store');
      logHarnessEvent('stop', 'round discarded; state reset');
    }
  } catch (e) {
    console.log('[simGPS] discardRound failed:', e);
  }
}
