#!/usr/bin/env node
/**
 * Phase AW v2 — JOINT matcher for two co-located courses sharing OSM bbox.
 *
 * Problem: Menifee Lakes has Lakes (id=20743) + Palms (id=20620) on the
 * same property. OSM returns 36 greens (18 per course) in one bbox. The
 * single-course matcher cross-pollinates because it grabs whichever green
 * fits the API distance regardless of which course it belongs to.
 *
 * Solution: build a global cost matrix for ALL holes from BOTH courses
 * vs ALL OSM greens, then solve as one assignment problem. Each green is
 * used exactly once across the 36 total holes. The walk-continuity term
 * (green N → tee N+1 within ~80y) naturally clusters each course's
 * holes onto the correct OSM features because intra-course walks are
 * short and inter-course assignments produce long walks.
 *
 * Algorithm:
 *   1. Fetch API holes for course A + course B (36 total).
 *   2. Fetch OSM tees + greens (~36 greens, ~110 tees).
 *   3. For each (hole, tee, green) triple within distance tolerance,
 *      compute base error = |OSM_dist − API_dist|.
 *   4. Solve via greedy with walk-continuity, but RESPECTING course
 *      boundary: hole-A-N's neighbor is hole-A-(N+1), not hole-B-N.
 *   5. Render two CourseHole[] arrays, one per course.
 *
 * Usage:
 *   node scripts/match-osm-joint.mjs <courseIdA> <courseIdB> "<osm query>" [tee]
 *
 * Example:
 *   node scripts/match-osm-joint.mjs 20620 20743 "Menifee Lakes Country Club" White
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const API_URL = process.env.API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? '';
const COURSE_A = process.argv[2];
const COURSE_B = process.argv[3];
const OSM_QUERY = process.argv[4] ?? 'Menifee Lakes Country Club';
const PREFERRED_TEE = (process.argv[5] ?? 'White').toLowerCase();
const USER_AGENT = 'SmartPlayCaddie/AW-joint (+https://github.com/tgustafson75-sketch/smartplay)';

if (!COURSE_A || !COURSE_B) {
  console.error('Usage: node scripts/match-osm-joint.mjs <courseIdA> <courseIdB> "<osm query>" [tee]');
  process.exit(1);
}

const EARTH_M = 6_371_000;
const toRad = d => (d * Math.PI) / 180;

function haversineYards(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return (2 * EARTH_M * Math.asin(Math.sqrt(x))) / 0.9144;
}

function bearingDeg(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function centroid(nodes) {
  if (nodes.length === 0) return null;
  let lat = 0, lng = 0;
  for (const n of nodes) { lat += n.lat; lng += n.lng; }
  return { lat: lat / nodes.length, lng: lng / nodes.length };
}

async function fetchCourse(id) {
  const r = await fetch(`${API_URL}/api/course-proxy?action=detail&id=${id}`);
  const d = await r.json();
  const c = d.course ?? d.data ?? d;
  let tees = Array.isArray(c.tees) ? c.tees : [];
  if (!Array.isArray(c.tees) && c.tees && typeof c.tees === 'object') {
    for (const arr of Object.values(c.tees)) if (Array.isArray(arr)) tees.push(...arr);
  }
  const teeMatch = tees.find(t => (t.tee_name ?? t.name ?? '').toLowerCase() === PREFERRED_TEE);
  const baseTee = teeMatch ?? tees.sort((a, b) => (b.total_yards ?? 0) - (a.total_yards ?? 0))[0];
  return {
    id,
    name: `${c.club_name ?? c.name}${c.course_name && c.course_name !== c.club_name ? ' — ' + c.course_name : ''}`,
    teeName: baseTee.tee_name ?? baseTee.name,
    totalYards: baseTee.total_yards,
    holes: baseTee.holes.map((h, i) => ({
      hole: h.hole_number ?? h.number ?? (i + 1),
      par: h.par ?? 4,
      distance: h.yardage ?? h.yards ?? 0,
    })),
  };
}

console.log(`▶  Course A: ${COURSE_A}`);
console.log(`▶  Course B: ${COURSE_B}`);
console.log(`▶  OSM:      "${OSM_QUERY}"`);
console.log(`▶  Tee:      "${PREFERRED_TEE}"\n`);

console.log('◇ Step 1: Fetch API for both courses…');
const [courseA, courseB] = await Promise.all([fetchCourse(COURSE_A), fetchCourse(COURSE_B)]);
console.log(`  A: "${courseA.name}"  tee=${courseA.teeName} (${courseA.totalYards}y)  ${courseA.holes.length} holes`);
console.log(`  B: "${courseB.name}"  tee=${courseB.teeName} (${courseB.totalYards}y)  ${courseB.holes.length} holes`);

console.log('\n◇ Step 2: Nominatim → bbox…');
const nomRes = await fetch(
  `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(OSM_QUERY)}`,
  { headers: { 'User-Agent': USER_AGENT } },
);
const hits = await nomRes.json();
const top = hits[0];
let bbox;
if (top.boundingbox) {
  const bb = top.boundingbox.map(parseFloat);
  bbox = [bb[0], bb[2], bb[1], bb[3]];
} else {
  const lat = parseFloat(top.lat), lng = parseFloat(top.lon);
  const dLat = 2_000 / 110_540;
  const dLng = 2_000 / (111_320 * Math.cos(toRad(lat)));
  bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}
console.log(`  Bbox: ${bbox.join(', ')}`);

await new Promise(r => setTimeout(r, 1100));

console.log('\n◇ Step 3: Overpass…');
const overpassQ = `
[out:json][timeout:30];
(
  way["golf"="tee"](${bbox.join(',')});
  way["golf"="green"](${bbox.join(',')});
  node["golf"="tee"](${bbox.join(',')});
  node["golf"="green"](${bbox.join(',')});
);
out body;
>;
out skel qt;
`.trim();

const oRes = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
  body: overpassQ,
});
const oData = await oRes.json();

const nodes = new Map();
for (const e of (oData.elements ?? [])) if (e.type === 'node') nodes.set(e.id, { lat: e.lat, lng: e.lon });
function wayPoints(w) { return (w.nodes ?? []).map(id => nodes.get(id)).filter(Boolean); }

const osmTees = [], osmGreens = [];
for (const e of (oData.elements ?? [])) {
  const c = e.type === 'way' ? centroid(wayPoints(e))
           : e.type === 'node' ? { lat: e.lat, lng: e.lon } : null;
  if (!c) continue;
  if (e.tags?.golf === 'tee')   osmTees.push({ id: `${e.type}/${e.id}`, centroid: c, points: e.type === 'way' ? wayPoints(e) : [c] });
  else if (e.tags?.golf === 'green') osmGreens.push({ id: `${e.type}/${e.id}`, centroid: c, points: e.type === 'way' ? wayPoints(e) : [c] });
}
console.log(`  OSM: tees=${osmTees.length}, greens=${osmGreens.length}`);

// ─── Joint scoring ─────────────────────────────────────────────────
// All 36 (or however many) holes go into one assignment problem.
// Each hole gets a list of candidate (tee, green) pairs scored by
// |OSM distance - API distance|. Greens are a shared resource: each
// can be used by at most one hole.

const TOL = (apiDist) => Math.max(25, apiDist * 0.10); // 10% tolerance

// Build per-hole candidate lists
function buildCands(hole) {
  const tol = TOL(hole.distance);
  const cands = [];
  for (const t of osmTees) {
    for (const g of osmGreens) {
      const d = haversineYards(t.centroid, g.centroid);
      const err = Math.abs(d - hole.distance);
      if (err <= tol) cands.push({ tee: t, green: g, dist: d, error: err });
    }
  }
  cands.sort((a, b) => a.error - b.error);
  return cands;
}

const allHoles = [
  ...courseA.holes.map(h => ({ ...h, course: 'A' })),
  ...courseB.holes.map(h => ({ ...h, course: 'B' })),
];

console.log(`\n◇ Step 4: Build candidates for ${allHoles.length} holes…`);
const candsByHole = new Map();
for (const h of allHoles) candsByHole.set(`${h.course}-${h.hole}`, buildCands(h));

// ─── Joint greedy assignment ───────────────────────────────────────
// Walk-continuity is per-course: hole-A-N's previous green is hole-A-(N-1),
// not hole-B-(N-1). So track previous green per course.
console.log('◇ Step 5: Joint assignment (greedy + per-course walk continuity)…\n');

const usedGreens = new Set();
const prevGreen = { A: null, B: null };
const assignments = new Map(); // key → { tee, green, dist, error, walk }

// Process holes in course-interleaved order: A1, B1, A2, B2 ... so that
// per-course walk continuity is respected for both courses concurrently.
const order = [];
const maxLen = Math.max(courseA.holes.length, courseB.holes.length);
for (let i = 0; i < maxLen; i++) {
  if (i < courseA.holes.length) order.push({ ...courseA.holes[i], course: 'A' });
  if (i < courseB.holes.length) order.push({ ...courseB.holes[i], course: 'B' });
}

for (const hole of order) {
  const key = `${hole.course}-${hole.hole}`;
  const cands = candsByHole.get(key) ?? [];
  const prev = prevGreen[hole.course];

  const scored = cands
    .filter(c => !usedGreens.has(c.green.id))
    .map(c => {
      const walk = prev ? haversineYards(prev.centroid, c.tee.centroid) : 0;
      // Per-course walk continuity penalty. Within a course, walks should
      // be <80y. Cross-course walks are typically 200-1000y, so >800y
      // walks are heavily penalized to discourage cross-pollination.
      const walkPenalty = walk < 80 ? 0
        : walk < 200 ? (walk - 80) * 0.5
        : walk < 500 ? 60 + (walk - 200) * 1.0
        : 360 + (walk - 500) * 2.0;
      return { ...c, walk, total: c.error + walkPenalty };
    })
    .sort((a, b) => a.total - b.total);

  if (scored.length === 0) {
    assignments.set(key, { hole, tee: null, green: null, reason: cands.length === 0 ? 'no candidates within tolerance' : 'all candidate greens already taken' });
    continue;
  }
  const best = scored[0];
  usedGreens.add(best.green.id);
  prevGreen[hole.course] = best.green;
  assignments.set(key, { hole, tee: best.tee, green: best.green, dist: best.dist, error: best.error, walk: best.walk });
}

// ─── Report + render ──────────────────────────────────────────────
function reportCourse(course, ckey) {
  const rows = course.holes.map(h => assignments.get(`${ckey}-${h.hole}`));
  const ok = rows.filter(r => r?.green).length;
  const meanWalk = rows.filter(r => r?.green && r.hole.hole > 1).map(r => r.walk).reduce((a, b) => a + b, 0) / Math.max(1, rows.filter(r => r?.green && r.hole.hole > 1).length);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`COURSE ${ckey}: "${course.name}"  (${ok}/${course.holes.length} resolved, mean walk ${Math.round(meanWalk)}y)`);
  console.log(`${'═'.repeat(72)}`);
  console.log('  hole │ par │ API d │ OSM d │ err │ walk │ bearing');
  console.log('  ─────┼─────┼───────┼───────┼─────┼──────┼────────');
  for (const r of rows) {
    if (r?.green) {
      const bear = Math.round(bearingDeg(r.tee.centroid, r.green.centroid));
      console.log(`  ${String(r.hole.hole).padStart(4)} │  ${r.hole.par}  │ ${String(r.hole.distance).padStart(5)} │ ${String(Math.round(r.dist)).padStart(5)} │ ${String(Math.round(r.error)).padStart(3)} │ ${String(Math.round(r.walk)).padStart(4)} │ ${String(bear).padStart(5)}°`);
    } else {
      console.log(`  ${String(r.hole.hole).padStart(4)} │  ${r.hole.par}  │ ${String(r.hole.distance).padStart(5)} │   ─   │  ─  │   ─  │  ─   ${r?.reason ?? ''}`);
    }
  }
  return rows;
}

const rowsA = reportCourse(courseA, 'A');
const rowsB = reportCourse(courseB, 'B');

function renderArray(name, course, rows) {
  console.log(`\n// ── PASTE INTO data/courses.ts: ${name} ──`);
  console.log(`// Source: golfcourseapi id=${course.id} (par/yardage) + OSM (GPS)`);
  console.log(`// Tee: "${course.teeName}" (${course.totalYards}y)`);
  const ok = rows.filter(r => r?.green).length;
  console.log(`// Joint match: ${ok}/${rows.length} resolved (course-interleaved walk continuity)`);
  console.log(`const ${name}: CourseHole[] = [`);
  for (const r of rows) {
    if (r?.green) {
      let front = r.green.centroid, back = r.green.centroid;
      let dF = haversineYards(r.tee.centroid, front);
      let dB = dF;
      for (const p of r.green.points) {
        const d = haversineYards(r.tee.centroid, p);
        if (d < dF) { dF = d; front = p; }
        if (d > dB) { dB = d; back  = p; }
      }
      console.log(
        `  { hole: ${String(r.hole.hole).padStart(2)}, par: ${r.hole.par}, distance: ${r.hole.distance}, front: ${Math.round(dF)}, back: ${Math.round(dB)},\n` +
        `    teeLat: ${r.tee.centroid.lat.toFixed(7)}, teeLng: ${r.tee.centroid.lng.toFixed(7)},\n` +
        `    middleLat: ${r.green.centroid.lat.toFixed(7)}, middleLng: ${r.green.centroid.lng.toFixed(7)},\n` +
        `    frontLat: ${front.lat.toFixed(7)}, frontLng: ${front.lng.toFixed(7)},\n` +
        `    backLat: ${back.lat.toFixed(7)}, backLng: ${back.lng.toFixed(7)},\n` +
        `    note: '', estimated: false },`,
      );
    } else {
      console.log(
        `  { hole: ${String(r.hole.hole).padStart(2)}, par: ${r.hole.par}, distance: ${r.hole.distance}, front: ${r.hole.distance - 15}, back: ${r.hole.distance + 15},\n` +
        `    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,\n` +
        `    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,\n` +
        `    note: '', estimated: true },`,
      );
    }
  }
  console.log('];');
}

renderArray('PALMS_HOLES', courseA, rowsA);
renderArray('LAKES_HOLES', courseB, rowsB);
console.log('\nDone.');
