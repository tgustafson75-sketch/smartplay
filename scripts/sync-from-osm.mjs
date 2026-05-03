#!/usr/bin/env node
/**
 * Phase AW — sync course geometry from OpenStreetMap Overpass API.
 *
 * golfcourseapi (even mid-plan) doesn't return GPS for SoCal munis; OSM
 * has hand-mapped golf features for many courses (`leisure=golf_course`,
 * `golf=tee/green/fairway/bunker`). Free, no auth, rate-limited polite
 * (single Overpass query per run).
 *
 * What we extract:
 *   - Course boundary (`leisure=golf_course`) — used for bbox
 *   - Tees (`golf=tee`)   — typically a way (polygon) per teebox
 *   - Greens (`golf=green`) — way (polygon) per green
 *
 * What we infer:
 *   - Tee/green centroid (average of polygon nodes)
 *   - Hole number from OSM `ref` tag if present (e.g. ref=7), else inferred
 *     by spatial sorting along the course's longest axis
 *   - Front/back of green: extreme points of the green polygon along the
 *     tee→green bearing (closest = front, farthest = back)
 *
 * What we DON'T have:
 *   - Par per hole (OSM doesn't tag this) — must come from golfcourseapi
 *   - Yardage per hole (computed from tee→green centroids by haversine)
 *
 * Usage:
 *   node scripts/sync-from-osm.mjs "Menifee Lakes Country Club"
 *
 * Or:
 *   QUERY="Pelican Hill" node scripts/sync-from-osm.mjs
 *
 * Output: CourseHole[] code-ready snippet for data/courses.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  try {
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
  } catch { /* swallow */ }
}
loadDotEnv();

const QUERY = process.argv[2] ?? process.env.QUERY ?? 'Menifee Lakes Country Club';
const USER_AGENT = 'SmartPlayCaddie/AW-sync (+https://github.com/tgustafson75-sketch/smartplay)';

console.log(`▶  Course query: "${QUERY}"`);

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

// ─── Step 1: Nominatim — locate the course bbox ────────────────────
async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

console.log('◇ Step 1: Nominatim lookup…');
const hits = await nominatim(QUERY);
if (hits.length === 0) {
  console.error('No Nominatim results. Try a different query (more or less specific).');
  process.exit(1);
}
console.log(`Found ${hits.length} candidate location(s):`);
hits.forEach((h, i) => console.log(`  [${i}] ${h.display_name}  (osm_${h.osm_type}/${h.osm_id})`));

// Use top hit. If it's a `leisure=golf_course` we use its bbox; otherwise
// we use a 2km bounding box around the lat/lng.
const top = hits[0];
let bbox; // [south, west, north, east]
if (top.boundingbox) {
  bbox = top.boundingbox.map(parseFloat); // [south, north, west, east]
  bbox = [bbox[0], bbox[2], bbox[1], bbox[3]];
} else {
  const lat = parseFloat(top.lat), lng = parseFloat(top.lon);
  const dLat = 2_000 / 110_540;
  const dLng = 2_000 / (111_320 * Math.cos(toRad(lat)));
  bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}
console.log(`  Using bbox: S=${bbox[0]} W=${bbox[1]} N=${bbox[2]} E=${bbox[3]}`);

// Pause to be polite to Nominatim (1 req/sec policy)
await new Promise(r => setTimeout(r, 1100));

// ─── Step 2: Overpass — fetch golf features in bbox ────────────────
const overpassQ = `
[out:json][timeout:30];
(
  way["golf"="tee"](${bbox.join(',')});
  way["golf"="green"](${bbox.join(',')});
  way["leisure"="golf_course"](${bbox.join(',')});
  node["golf"="tee"](${bbox.join(',')});
  node["golf"="green"](${bbox.join(',')});
);
out body;
>;
out skel qt;
`.trim();

console.log('\n◇ Step 2: Overpass query…');
const overpass = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT },
  body: overpassQ,
});
if (!overpass.ok) {
  console.error(`Overpass ${overpass.status}: ${await overpass.text()}`);
  process.exit(1);
}
const oData = await overpass.json();
const elements = oData.elements ?? [];
console.log(`  Got ${elements.length} elements.`);

// Build node lookup
const nodes = new Map();
for (const e of elements) if (e.type === 'node') nodes.set(e.id, { lat: e.lat, lng: e.lon });

// Resolve way nodes
function wayCentroid(way) {
  if (!way.nodes) return null;
  const pts = way.nodes.map(id => nodes.get(id)).filter(Boolean);
  if (pts.length === 0) return null;
  return centroid(pts);
}
function wayPoints(way) {
  if (!way.nodes) return [];
  return way.nodes.map(id => nodes.get(id)).filter(Boolean);
}

// Categorize
const tees = [];
const greens = [];
let courseBoundary = null;

for (const e of elements) {
  if (e.type === 'way') {
    if (e.tags?.golf === 'tee') {
      const c = wayCentroid(e);
      if (c) tees.push({ id: e.id, ref: e.tags.ref ?? null, name: e.tags.name ?? null, centroid: c, points: wayPoints(e), tags: e.tags });
    } else if (e.tags?.golf === 'green') {
      const c = wayCentroid(e);
      if (c) greens.push({ id: e.id, ref: e.tags.ref ?? null, name: e.tags.name ?? null, centroid: c, points: wayPoints(e), tags: e.tags });
    } else if (e.tags?.leisure === 'golf_course') {
      courseBoundary = e;
    }
  } else if (e.type === 'node') {
    if (e.tags?.golf === 'tee') {
      tees.push({ id: e.id, ref: e.tags.ref ?? null, name: e.tags.name ?? null, centroid: { lat: e.lat, lng: e.lon }, points: [{ lat: e.lat, lng: e.lon }], tags: e.tags });
    } else if (e.tags?.golf === 'green') {
      greens.push({ id: e.id, ref: e.tags.ref ?? null, name: e.tags.name ?? null, centroid: { lat: e.lat, lng: e.lon }, points: [{ lat: e.lat, lng: e.lon }], tags: e.tags });
    }
  }
}

console.log(`  Tees: ${tees.length}   Greens: ${greens.length}   Course boundary: ${courseBoundary ? 'yes' : 'no'}`);

if (tees.length === 0 || greens.length === 0) {
  console.error('\n  ⚠ Insufficient OSM coverage — cannot build hole geometry.');
  console.error('  This course is not mapped in OSM (or only partially).');
  process.exit(1);
}

// ─── Step 3: Match tees to greens, infer hole numbers ──────────────
// Strategy:
//   1) If tee/green have `ref` tag (hole number), use that to pair them.
//   2) Otherwise pair each tee to the nearest green NOT already paired
//      (greedy nearest-neighbor matching), then sort holes by distance
//      from the course centroid (rough proxy for routing order).

function parseRef(ref) {
  if (!ref) return null;
  const m = String(ref).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// Tag-based pairing
const refPairs = new Map(); // hole_num → { tee, green }
for (const t of tees) {
  const n = parseRef(t.ref) ?? parseRef(t.name);
  if (n != null) {
    if (!refPairs.has(n)) refPairs.set(n, {});
    refPairs.get(n).tee = t;
  }
}
for (const g of greens) {
  const n = parseRef(g.ref) ?? parseRef(g.name);
  if (n != null) {
    if (!refPairs.has(n)) refPairs.set(n, {});
    refPairs.get(n).green = g;
  }
}

const taggedHoles = [];
for (const [n, p] of refPairs) {
  if (p.tee && p.green) taggedHoles.push({ hole: n, tee: p.tee, green: p.green });
}

let holes;
if (taggedHoles.length >= 9) {
  console.log(`\n◇ Step 3: Using OSM ref tags (${taggedHoles.length} fully-tagged holes).`);
  holes = taggedHoles.sort((a, b) => a.hole - b.hole);
} else {
  console.log(`\n◇ Step 3: Only ${taggedHoles.length} ref-tagged holes; falling back to nearest-neighbor pairing.`);
  // Nearest-neighbor pairing
  const usedG = new Set();
  const pairs = [];
  // Sort tees by distance from course centroid for a stable order
  const allCentroids = [...tees, ...greens].map(x => x.centroid);
  const cc = centroid(allCentroids);
  const teesSorted = tees.slice().sort((a, b) => haversineYards(a.centroid, cc) - haversineYards(b.centroid, cc));
  for (const t of teesSorted) {
    let bestG = null;
    let bestD = Infinity;
    for (const g of greens) {
      if (usedG.has(g.id)) continue;
      // Plausible hole length: 80–600y
      const d = haversineYards(t.centroid, g.centroid);
      if (d < 80 || d > 700) continue;
      if (d < bestD) { bestD = d; bestG = g; }
    }
    if (bestG) {
      usedG.add(bestG.id);
      pairs.push({ tee: t, green: bestG });
    }
  }
  // Number sequentially — user can resequence in editor if needed
  holes = pairs.slice(0, 18).map((p, i) => ({ hole: i + 1, ...p }));
}

// ─── Step 4: Render CourseHole[] ───────────────────────────────────
function greenFrontBack(green, tee) {
  // Project each green polygon point onto the tee→green axis; pick the
  // closest to tee = front, farthest = back. Falls back to the centroid
  // if the green is a single node.
  if (green.points.length < 2) return { front: green.centroid, back: green.centroid };
  let front = green.points[0], back = green.points[0];
  let dFront = haversineYards(tee.centroid, front);
  let dBack = dFront;
  for (const p of green.points) {
    const d = haversineYards(tee.centroid, p);
    if (d < dFront) { dFront = d; front = p; }
    if (d > dBack)  { dBack = d;  back  = p; }
  }
  return { front, back };
}

console.log(`\n  Holes resolved: ${holes.length}\n`);
console.log('// ── PASTE INTO data/courses.ts ──');
console.log(`// Source: OpenStreetMap (Overpass API) for "${QUERY}"`);
console.log(`//   Tees: ${tees.length}, Greens: ${greens.length}, Holes resolved: ${holes.length}`);
console.log(`// par/yardage are NOT in OSM — keep par from golfcourseapi.`);
console.log(`// Distances are computed from tee→green haversine; front/back are`);
console.log(`// the closest/farthest points of the green polygon to the tee.`);
console.log('const HOLES: CourseHole[] = [');
for (const h of holes) {
  const dist = Math.round(haversineYards(h.tee.centroid, h.green.centroid));
  const fb = greenFrontBack(h.green, h.tee);
  const fyd = Math.round(haversineYards(h.tee.centroid, fb.front));
  const byd = Math.round(haversineYards(h.tee.centroid, fb.back));
  // par placeholder — user will overlay golfcourseapi par data
  const par = dist < 240 ? 3 : dist > 480 ? 5 : 4;
  console.log(
    `  { hole: ${String(h.hole).padStart(2)}, par: ${par}, distance: ${dist}, front: ${fyd}, back: ${byd},\n` +
    `    teeLat: ${h.tee.centroid.lat.toFixed(7)}, teeLng: ${h.tee.centroid.lng.toFixed(7)},\n` +
    `    middleLat: ${h.green.centroid.lat.toFixed(7)}, middleLng: ${h.green.centroid.lng.toFixed(7)},\n` +
    `    frontLat: ${fb.front.lat.toFixed(7)}, frontLng: ${fb.front.lng.toFixed(7)},\n` +
    `    backLat: ${fb.back.lat.toFixed(7)}, backLng: ${fb.back.lng.toFixed(7)},\n` +
    `    note: '', estimated: false },`,
  );
}
console.log('];');
console.log('\nDone.');
