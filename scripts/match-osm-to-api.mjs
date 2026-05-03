#!/usr/bin/env node
/**
 * Phase AW — match OSM tees/greens to golfcourseapi pars/distances.
 *
 * The auto-pairing problem: OSM has hand-mapped tee + green polygons but
 * no hole numbers (no `ref` tags on Menifee). golfcourseapi has correct
 * pars/distances per hole but no GPS. This script joins them: for each
 * hole's known distance from the API, find the OSM (tee, green) pair
 * whose haversine distance matches within tolerance, with hole-to-hole
 * walk continuity as a tie-breaker (green N should be near tee N+1).
 *
 * Algorithm:
 *   1. Fetch API hole list (par, distance per hole) — pinned tee.
 *   2. Fetch OSM tees + greens in course bbox.
 *   3. Score every (tee, green) pair: |OSM_dist − API_dist|.
 *      Filter pairs outside ±max(25y, 8% of API distance).
 *   4. For each hole in order:
 *        - Pick the unused green that gives the lowest score, preferring
 *          tees near the previous hole's green (walk continuity bonus).
 *        - Mark that green as used. Tees are reusable (multiple colors).
 *   5. Render CourseHole[] with API par + API distance + matched GPS.
 *
 * Usage:
 *   node scripts/match-osm-to-api.mjs <courseId> "<course query for OSM>" [tee_name]
 *
 * Examples:
 *   node scripts/match-osm-to-api.mjs 20620 "Menifee Lakes Country Club" White
 *   node scripts/match-osm-to-api.mjs 20743 "Menifee Lakes Country Club" White
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
const COURSE_ID = process.argv[2];
const OSM_QUERY = process.argv[3] ?? 'Menifee Lakes Country Club';
const PREFERRED_TEE = (process.argv[4] ?? 'White').toLowerCase();
const USER_AGENT = 'SmartPlayCaddie/AW-match (+https://github.com/tgustafson75-sketch/smartplay)';

if (!COURSE_ID) {
  console.error('Usage: node scripts/match-osm-to-api.mjs <courseId> "<osm query>" [tee_name]');
  process.exit(1);
}
if (!API_URL) {
  console.error('ERR: EXPO_PUBLIC_API_URL not set');
  process.exit(1);
}

console.log(`▶  API course id: ${COURSE_ID}`);
console.log(`▶  OSM query:     "${OSM_QUERY}"`);
console.log(`▶  Tee preference: "${PREFERRED_TEE}"\n`);

// ─── Geo math ──────────────────────────────────────────────────────
const EARTH_M = 6_371_000;
const toRad = d => (d * Math.PI) / 180;

function haversineYards(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
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

// ─── Step 1: Fetch API holes ──────────────────────────────────────
console.log('◇ Step 1: Fetch API holes…');
const detailRes = await fetch(`${API_URL}/api/course-proxy?action=detail&id=${COURSE_ID}`);
if (!detailRes.ok) { console.error('API detail failed'); process.exit(1); }
const detailData = await detailRes.json();
const course = detailData.course ?? detailData.data ?? detailData;

let tees = Array.isArray(course.tees) ? course.tees : [];
if (!Array.isArray(course.tees) && course.tees && typeof course.tees === 'object') {
  for (const arr of Object.values(course.tees)) if (Array.isArray(arr)) tees.push(...arr);
}
const teeMatch = tees.find(t => (t.tee_name ?? t.name ?? '').toLowerCase() === PREFERRED_TEE);
const baseTee = teeMatch ?? tees.sort((a, b) => (b.total_yards ?? 0) - (a.total_yards ?? 0))[0];
if (!baseTee?.holes?.length) { console.error('No tee with hole data'); process.exit(1); }

const apiHoles = baseTee.holes.map((h, i) => ({
  hole: h.hole_number ?? h.number ?? (i + 1),
  par: h.par ?? 4,
  distance: h.yardage ?? h.yards ?? 0,
}));
console.log(`  Course: "${course.club_name ?? course.name}" tee="${baseTee.tee_name ?? baseTee.name}" (${baseTee.total_yards ?? '?'}y total)`);
console.log(`  Holes: ${apiHoles.length}\n`);

// ─── Step 2: OSM via Nominatim + Overpass ─────────────────────────
console.log('◇ Step 2: Nominatim → bbox…');
const nomRes = await fetch(
  `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(OSM_QUERY)}`,
  { headers: { 'User-Agent': USER_AGENT } },
);
const hits = await nomRes.json();
if (!hits.length) { console.error('Nominatim returned nothing'); process.exit(1); }
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
console.log(`  Bbox: S=${bbox[0]} W=${bbox[1]} N=${bbox[2]} E=${bbox[3]}`);

await new Promise(r => setTimeout(r, 1100)); // polite

console.log('\n◇ Step 3: Overpass query…');
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
if (!oRes.ok) { console.error('Overpass failed'); process.exit(1); }
const oData = await oRes.json();

const nodes = new Map();
for (const e of (oData.elements ?? [])) if (e.type === 'node') nodes.set(e.id, { lat: e.lat, lng: e.lon });

function wayPoints(way) {
  if (!way.nodes) return [];
  return way.nodes.map(id => nodes.get(id)).filter(Boolean);
}

const osmTees = [];
const osmGreens = [];
for (const e of (oData.elements ?? [])) {
  const c = e.type === 'way' ? centroid(wayPoints(e))
           : e.type === 'node' ? { lat: e.lat, lng: e.lon } : null;
  if (!c) continue;
  if (e.tags?.golf === 'tee') osmTees.push({ id: `${e.type}/${e.id}`, centroid: c, points: e.type === 'way' ? wayPoints(e) : [c] });
  else if (e.tags?.golf === 'green') osmGreens.push({ id: `${e.type}/${e.id}`, centroid: c, points: e.type === 'way' ? wayPoints(e) : [c] });
}
console.log(`  OSM features: tees=${osmTees.length}, greens=${osmGreens.length}\n`);

// ─── Step 3.5: K=2 spatial clustering when feature count >> 18 ─────
// When the OSM bbox covers TWO 18-hole courses (Lakes + Palms in the
// same property), 36 greens get returned. Cluster greens into 2 groups
// via simple k-means (Lloyd's, lat/lng plane); the user picks which
// cluster matches their target course via the CLUSTER env (0 or 1).
// Tees get assigned to the same cluster as their nearest green so the
// matcher only considers same-course pairs and never cross-pollinates.
function kmeans2(points) {
  if (points.length < 4) return [points, []]; // not enough to split
  // Initialize centers at min and max lat (pick the two extremes)
  let c0 = points.reduce((a, b) => a.lat < b.lat ? a : b);
  let c1 = points.reduce((a, b) => a.lat > b.lat ? a : b);
  for (let iter = 0; iter < 30; iter++) {
    const a = [], b = [];
    for (const p of points) {
      const d0 = (p.lat - c0.lat) ** 2 + (p.lng - c0.lng) ** 2;
      const d1 = (p.lat - c1.lat) ** 2 + (p.lng - c1.lng) ** 2;
      if (d0 < d1) a.push(p); else b.push(p);
    }
    if (a.length === 0 || b.length === 0) return [points, []];
    const newC0 = { lat: a.reduce((s, p) => s + p.lat, 0) / a.length, lng: a.reduce((s, p) => s + p.lng, 0) / a.length };
    const newC1 = { lat: b.reduce((s, p) => s + p.lat, 0) / b.length, lng: b.reduce((s, p) => s + p.lng, 0) / b.length };
    const drift = Math.abs(newC0.lat - c0.lat) + Math.abs(newC0.lng - c0.lng) + Math.abs(newC1.lat - c1.lat) + Math.abs(newC1.lng - c1.lng);
    c0 = newC0; c1 = newC1;
    if (drift < 1e-7) break;
  }
  // Final classification with center labels
  const cluster0 = [], cluster1 = [];
  for (const p of points) {
    const d0 = (p.lat - c0.lat) ** 2 + (p.lng - c0.lng) ** 2;
    const d1 = (p.lat - c1.lat) ** 2 + (p.lng - c1.lng) ** 2;
    if (d0 < d1) cluster0.push(p); else cluster1.push(p);
  }
  return [cluster0, cluster1, c0, c1];
}

const CLUSTER = process.env.CLUSTER != null ? parseInt(process.env.CLUSTER, 10) : null;
let clusteredTees = osmTees, clusteredGreens = osmGreens, clusterInfo = null;

if (osmGreens.length >= 27) { // ≥ 1.5× a single course → clustering helps
  const [g0, g1, c0, c1] = kmeans2(osmGreens.map(g => ({ ...g.centroid, ref: g })));
  const greenCluster0 = g0.map(g => g.ref);
  const greenCluster1 = g1.map(g => g.ref);
  console.log(`◇ Step 3.5: K=2 clustering — greens split into ${greenCluster0.length}/${greenCluster1.length} (centers ${c0?.lat?.toFixed(4)}/${c0?.lng?.toFixed(4)} vs ${c1?.lat?.toFixed(4)}/${c1?.lng?.toFixed(4)})`);
  if (CLUSTER == null) {
    console.log(`  Re-run with CLUSTER=0 (north of ${((c0.lat + c1.lat)/2).toFixed(4)}) or CLUSTER=1 to filter to one course.`);
  } else {
    const sel = CLUSTER === 0 ? greenCluster0 : greenCluster1;
    const selSet = new Set(sel.map(g => g.id));
    const selTees = osmTees.filter(t => {
      // Pick the nearest green to determine which cluster this tee belongs to
      let best = null, bestD = Infinity;
      for (const g of osmGreens) {
        const d = haversineYards(t.centroid, g.centroid);
        if (d < bestD) { bestD = d; best = g; }
      }
      return best && selSet.has(best.id);
    });
    clusteredTees = selTees;
    clusteredGreens = sel;
    clusterInfo = { selected: CLUSTER, total: osmGreens.length, kept: sel.length };
    console.log(`  Selected cluster ${CLUSTER}: ${sel.length} greens, ${selTees.length} tees.\n`);
  }
}

// Re-bind for the matcher
const matchTees = clusteredTees;
const matchGreens = clusteredGreens;

// ─── Step 4: Build candidate scores per hole ───────────────────────
console.log('◇ Step 4: Score (tee, green) candidates per hole…');

function scorePair(apiDist, tee, green) {
  const dist = haversineYards(tee.centroid, green.centroid);
  return { dist, error: Math.abs(dist - apiDist) };
}

// For each hole, build a sorted list of (tee, green, error) candidates
// within tolerance.
const TOL = (apiDist) => Math.max(25, apiDist * 0.08);

const candidatesPerHole = apiHoles.map(h => {
  const tol = TOL(h.distance);
  const cands = [];
  for (const t of matchTees) {
    for (const g of matchGreens) {
      const s = scorePair(h.distance, t, g);
      if (s.error <= tol) cands.push({ tee: t, green: g, ...s });
    }
  }
  cands.sort((a, b) => a.error - b.error);
  return { hole: h, candidates: cands };
});

// ─── Step 5: Greedy assignment with walk-continuity bonus ──────────
console.log('◇ Step 5: Greedy assignment with walk-continuity bonus…\n');

const usedGreens = new Set();
const assignments = []; // { hole, tee, green, dist, bearing, error }

let prevGreen = null; // for walk-continuity bonus

for (const { hole, candidates } of candidatesPerHole) {
  if (candidates.length === 0) {
    assignments.push({ hole, tee: null, green: null, dist: null, bearing: null, error: null, reason: 'no candidates within tolerance' });
    continue;
  }

  // Re-score candidates: prefer those whose tee is near the previous
  // green (walk between holes is typically <80y on a routed course).
  const scored = candidates
    .filter(c => !usedGreens.has(c.green.id))
    .map(c => {
      const walk = prevGreen ? haversineYards(prevGreen.centroid, c.tee.centroid) : 0;
      // Walk penalty: heavy past 200y, mild under 80y.
      const walkPenalty = walk < 80 ? 0 : walk < 200 ? (walk - 80) * 0.3 : 80 + (walk - 200) * 0.8;
      return { ...c, walk, total: c.error + walkPenalty };
    })
    .sort((a, b) => a.total - b.total);

  if (scored.length === 0) {
    assignments.push({ hole, tee: null, green: null, dist: null, bearing: null, error: null, reason: 'all candidate greens already used' });
    continue;
  }

  const best = scored[0];
  usedGreens.add(best.green.id);
  prevGreen = best.green;
  assignments.push({
    hole,
    tee: best.tee,
    green: best.green,
    dist: best.dist,
    bearing: bearingDeg(best.tee.centroid, best.green.centroid),
    error: best.error,
    walk: best.walk,
  });
}

// ─── Step 6: Report + render CourseHole[] ─────────────────────────
const ok = assignments.filter(a => a.green);
const failed = assignments.filter(a => !a.green);

console.log(`Resolved ${ok.length}/${assignments.length} holes.`);
if (failed.length) {
  console.log('Unresolved:');
  for (const f of failed) console.log(`  hole ${f.hole.hole} (par ${f.hole.par}, ${f.hole.distance}y): ${f.reason}`);
}

console.log('\nMatch quality:');
console.log('  hole │ par │ API d │ OSM d │ err │ walk │ bearing');
console.log('  ─────┼─────┼───────┼───────┼─────┼──────┼────────');
for (const a of assignments) {
  if (a.green) {
    console.log(`  ${String(a.hole.hole).padStart(4)} │  ${a.hole.par}  │ ${String(a.hole.distance).padStart(5)} │ ${String(Math.round(a.dist)).padStart(5)} │ ${String(Math.round(a.error)).padStart(3)} │ ${String(Math.round(a.walk)).padStart(4)} │ ${String(Math.round(a.bearing)).padStart(5)}°`);
  } else {
    console.log(`  ${String(a.hole.hole).padStart(4)} │  ${a.hole.par}  │ ${String(a.hole.distance).padStart(5)} │   ─   │  ─  │   ─  │  ─`);
  }
}

console.log('\n// ── PASTE INTO data/courses.ts ──');
console.log(`// Source: golfcourseapi id=${COURSE_ID} (par/yardage) + OSM (GPS)`);
console.log(`// Tee: "${baseTee.tee_name ?? baseTee.name}"  (${baseTee.total_yards ?? '?'}y)`);
console.log(`// Resolved: ${ok.length}/${assignments.length} holes via greedy match`);
console.log(`// Front/back: closest/farthest green-polygon points from tee.`);
console.log('const HOLES: CourseHole[] = [');

for (const a of assignments) {
  const h = a.hole;
  if (a.green) {
    // Compute green front/back from polygon points along tee→green axis
    let front = a.green.centroid, back = a.green.centroid;
    let dF = haversineYards(a.tee.centroid, front);
    let dB = dF;
    for (const p of a.green.points) {
      const d = haversineYards(a.tee.centroid, p);
      if (d < dF) { dF = d; front = p; }
      if (d > dB) { dB = d; back  = p; }
    }
    console.log(
      `  { hole: ${String(h.hole).padStart(2)}, par: ${h.par}, distance: ${h.distance}, front: ${Math.round(dF)}, back: ${Math.round(dB)},\n` +
      `    teeLat: ${a.tee.centroid.lat.toFixed(7)}, teeLng: ${a.tee.centroid.lng.toFixed(7)},\n` +
      `    middleLat: ${a.green.centroid.lat.toFixed(7)}, middleLng: ${a.green.centroid.lng.toFixed(7)},\n` +
      `    frontLat: ${front.lat.toFixed(7)}, frontLng: ${front.lng.toFixed(7)},\n` +
      `    backLat: ${back.lat.toFixed(7)}, backLng: ${back.lng.toFixed(7)},\n` +
      `    note: '', estimated: false },`,
    );
  } else {
    console.log(
      `  { hole: ${String(h.hole).padStart(2)}, par: ${h.par}, distance: ${h.distance}, front: ${h.distance - 15}, back: ${h.distance + 15},\n` +
      `    teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0,\n` +
      `    frontLat: 0, frontLng: 0, backLat: 0, backLng: 0,\n` +
      `    note: '', estimated: true },`,
    );
  }
}
console.log('];');
console.log('\nDone.');
