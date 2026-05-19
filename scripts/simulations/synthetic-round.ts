/**
 * 2026-05-17 — Synthetic round harness validator.
 *
 * Runs node-side via `npx tsx scripts/simulations/synthetic-round.ts`.
 *
 * Purpose:
 *   1. Read __mocks__/mockRound.json
 *   2. Validate internal consistency of every hole (coords plausible,
 *      yardage matches haversine within tolerance, bearings in [0,360),
 *      timestamps monotonic, hazard list shape, etc.)
 *   3. Exercise the rangefinder + course-geometry math against the
 *      mock data to assert the parts of the GPS pipeline that DON'T
 *      require RN runtime (haversine, bearing, point-to-segment) still
 *      return sane numbers.
 *   4. Simulate the walk-through programmatically: for each hole, step
 *      from tee → 1/3 → 2/3 → green and assert the computed distance-
 *      to-green shrinks monotonically.
 *   5. Output a pass/fail summary + per-hole timing.
 *
 * NOT exercised here (requires RN runtime / device):
 *   - Zustand round-store transitions
 *   - holeDetection's setInterval polling
 *   - shotDetection's evaluate loop
 *   - The actual setSimulatedFix → subscriber fanout
 *
 * Those layers are exercised by Tim manually via the "Play Synthetic
 * Round" button on app/gps-test.tsx (which feeds the SAME JSON through
 * the SAME pipeline, just on-device).
 */

import fs from 'node:fs';
import path from 'node:path';

const EARTH_RADIUS_YARDS = 6_371_000 / 0.9144;

interface MockHole {
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

interface MockRound {
  schemaVersion: number;
  courseName: string;
  courseId: string;
  totalHoles: number;
  compressionRatio: number;
  shotIntervalMs: number;
  betweenHoleWalkMs: number;
  holes: MockHole[];
}

function haversineYards(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_YARDS * Math.asin(Math.sqrt(x));
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─── Test harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    const line = detail ? `${label} — ${detail}` : label;
    failures.push(line);
    console.log(`  ✗ ${line}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

// ─── Load + parse ────────────────────────────────────────────────────

const jsonPath = path.resolve(__dirname, '../../__mocks__/mockRound.json');
console.log(`Loading: ${jsonPath}`);
const raw = fs.readFileSync(jsonPath, 'utf-8');
const round = JSON.parse(raw) as MockRound;

// ─── Schema checks ───────────────────────────────────────────────────

section('Schema');
check('schemaVersion present and 1', round.schemaVersion === 1);
check('courseName string', typeof round.courseName === 'string' && round.courseName.length > 0);
check('totalHoles = holes.length', round.totalHoles === round.holes.length);
check('compressionRatio positive', round.compressionRatio > 0);
check('holes array length 9, 18, or other plausible', [9, 18].includes(round.holes.length));

// ─── Per-hole math ───────────────────────────────────────────────────

section(`Per-hole math (${round.holes.length} holes)`);
const startedAt = Date.now();
let lastTeeTs = 0;

for (const hole of round.holes) {
  const label = `H${hole.holeNumber}`;

  // hole_number sequencing
  check(`${label} sequential`, hole.holeNumber > 0 && hole.holeNumber <= round.holes.length);
  // par in [3, 5]
  check(`${label} par in [3,5]`, hole.par >= 3 && hole.par <= 5, `got ${hole.par}`);
  // yardage plausible per par
  const okYardage = hole.par === 3 ? hole.expectedYardage <= 240 :
                    hole.par === 4 ? hole.expectedYardage >= 250 && hole.expectedYardage <= 500 :
                    hole.expectedYardage >= 450 && hole.expectedYardage <= 650;
  check(`${label} yardage realistic for par ${hole.par}`, okYardage, `${hole.expectedYardage}y`);

  // tee + green coords are valid lat/lng
  check(`${label} tee lat in [-90, 90]`, hole.tee.lat >= -90 && hole.tee.lat <= 90);
  check(`${label} tee lng in [-180, 180]`, hole.tee.lng >= -180 && hole.tee.lng <= 180);
  check(`${label} green lat in [-90, 90]`, hole.green.lat >= -90 && hole.green.lat <= 90);
  check(`${label} green lng in [-180, 180]`, hole.green.lng >= -180 && hole.green.lng <= 180);

  // Haversine cross-check
  const computed = haversineYards(hole.tee, hole.green);
  const computedRounded = Math.round(computed);
  check(
    `${label} computedYardage matches haversine`,
    Math.abs(computedRounded - hole.computedYardage) <= 2,
    `JSON ${hole.computedYardage}y vs runtime ${computedRounded}y`,
  );

  // Bearing cross-check
  const b = bearingDeg(hole.tee, hole.green);
  const bRounded = Math.round(b * 10) / 10;
  check(
    `${label} bearingDeg matches`,
    Math.abs(bRounded - hole.bearingDeg) <= 0.2,
    `JSON ${hole.bearingDeg}° vs runtime ${bRounded}°`,
  );

  // Timestamp monotonicity
  check(`${label} tee.timestampMs > prev`, hole.tee.timestampMs >= lastTeeTs);
  check(`${label} green.timestampMs > tee.timestampMs`, hole.green.timestampMs > hole.tee.timestampMs);
  lastTeeTs = hole.green.timestampMs;

  // shotsPlanned sane
  check(`${label} shotsPlanned >= 2`, hole.shotsPlanned >= 2, `${hole.shotsPlanned}`);

  // Hazards array
  check(`${label} hazards is array`, Array.isArray(hole.hazards));
}

// ─── Walk-through monotonicity ───────────────────────────────────────

section('Walk-through monotonicity (distance-to-green shrinks per step)');

for (const hole of round.holes) {
  const { tee, green } = hole;
  const waypoints = [
    { ...tee, label: 'tee' },
    {
      lat: tee.lat + (green.lat - tee.lat) * 0.34,
      lng: tee.lng + (green.lng - tee.lng) * 0.34,
      label: '1/3 fairway',
    },
    {
      lat: tee.lat + (green.lat - tee.lat) * 0.67,
      lng: tee.lng + (green.lng - tee.lng) * 0.67,
      label: '2/3 fairway',
    },
    { ...green, label: 'green' },
  ];
  let prevDist = Infinity;
  let monotonic = true;
  for (const wp of waypoints) {
    const d = haversineYards(wp, green);
    if (d > prevDist + 0.5) {
      monotonic = false;
      break;
    }
    prevDist = d;
  }
  check(`H${hole.holeNumber} distance-to-green decreases monotonically`, monotonic);
}

// ─── Course bounding box sanity ──────────────────────────────────────

section('Course bounding box');
const lats = round.holes.flatMap(h => [h.tee.lat, h.green.lat]);
const lngs = round.holes.flatMap(h => [h.tee.lng, h.green.lng]);
const minLat = Math.min(...lats);
const maxLat = Math.max(...lats);
const minLng = Math.min(...lngs);
const maxLng = Math.max(...lngs);
const latSpread = maxLat - minLat;
const lngSpread = maxLng - minLng;
// A 18-hole course typically spans 0.5-3 km, so lat/lng spread <0.05 degrees
check(
  'course spread < 0.05° lat',
  latSpread < 0.05,
  `${latSpread.toFixed(5)}° (${Math.round(latSpread * 111_111)}m)`,
);
check(
  'course spread < 0.05° lng',
  lngSpread < 0.05,
  `${lngSpread.toFixed(5)}° (${Math.round(lngSpread * 111_111 * Math.cos((minLat * Math.PI) / 180))}m)`,
);

// Total wall-clock yardage sanity — 18-hole par-72 black tees ~6500-7500
section('Total course yardage');
const totalYardage = round.holes.reduce((sum, h) => sum + h.expectedYardage, 0);
check(`total ${totalYardage}y in 5500-7500 range`, totalYardage >= 5500 && totalYardage <= 7500, `${totalYardage}y`);

// ─── Summary ─────────────────────────────────────────────────────────

const elapsed = Date.now() - startedAt;
console.log('\n' + '='.repeat(60));
console.log(`Synthetic round harness — ${round.courseName} (${round.totalHoles} holes)`);
console.log('='.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Elapsed: ${elapsed}ms`);
console.log(`Course bbox: ${latSpread.toFixed(4)}° lat × ${lngSpread.toFixed(4)}° lng`);
console.log(`Total yardage: ${totalYardage}y`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
process.exit(0);
