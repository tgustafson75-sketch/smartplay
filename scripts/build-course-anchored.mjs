#!/usr/bin/env node
/**
 * 2026-07-22 (Tim) — Anchored course builder.
 *
 * OSM has green/tee polygons but no hole numbers, so blind nearest-neighbor pairing
 * scrambles the routing. This script anchors the OSM geometry to GROUND-TRUTH per-hole
 * distances read off the player's GPS-app screenshots (which DO carry the hole number):
 * it assigns each OSM green to its hole by matching the screenshot's green-center distance
 * to the (tee → green) haversine, with hole-to-hole walk continuity as a tie-break, then
 * emits a CourseHole[] using the SCREENSHOT distances (authoritative) + real OSM coords.
 *
 * Anchor JSON shape:
 *   {
 *     "name": "Highland Links",
 *     "query": "Highland Links Truro",
 *     "greensPerLoop": 9,           // 9 unique greens replayed (18-hole = two loops)
 *     "holes": [ { "hole":1, "back":260, "center":249, "front":238, "par":4 }, ... ]
 *   }
 *
 * Usage: node scripts/build-course-anchored.mjs anchors/highland.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversineYards(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R * Math.asin(Math.min(1, Math.sqrt(s)))) / 0.9144;
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function centroid(pts) {
  let la = 0, ln = 0;
  for (const p of pts) { la += p.lat; ln += p.lng; }
  return { lat: la / pts.length, lng: ln / pts.length };
}
/** Extreme green-polygon points along the tee→green bearing: closest = front, farthest = back. */
function greenFrontBack(greenPts, tee) {
  let front = greenPts[0], back = greenPts[0];
  let dF = Infinity, dB = -Infinity;
  for (const p of greenPts) {
    const d = haversineYards(tee, p);
    if (d < dF) { dF = d; front = p; }
    if (d > dB) { dB = d; back = p; }
  }
  return { front, back };
}

async function nominatim(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'smartplay-course-build' } });
  const j = await r.json();
  if (!j.length) throw new Error(`Nominatim: no result for "${q}"`);
  const b = j[0].boundingbox.map(Number); // [S, N, W, E]
  // pad the bbox a touch so edge greens/tees aren't clipped
  const padLat = (b[1] - b[0]) * 0.08, padLng = (b[3] - b[2]) * 0.08;
  return { S: b[0] - padLat, N: b[1] + padLat, W: b[2] - padLng, E: b[3] + padLng, display: j[0].display_name };
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
async function overpass(bb) {
  const q = `[out:json][timeout:25];(way["golf"="green"](${bb.S},${bb.W},${bb.N},${bb.E});way["golf"="tee"](${bb.S},${bb.W},${bb.N},${bb.E}););out geom;`;
  let j = null, lastErr = '';
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2 && !j; attempt++) {
    const url = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'smartplay-course-build' }, body: q });
      if (r.ok) { j = await r.json(); break; }
      lastErr = `${url} → ${r.status}`;
    } catch (e) { lastErr = `${url} → ${e.message}`; }
    await new Promise((res) => setTimeout(res, 1500)); // polite backoff before the next mirror
  }
  if (!j) throw new Error(`Overpass failed: ${lastErr}`);
  const greens = [], tees = [];
  for (const e of j.elements ?? []) {
    if (e.type !== 'way' || !e.geometry) continue;
    const pts = e.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    const rec = { id: e.id, pts, c: centroid(pts) };
    if (e.tags?.golf === 'green') greens.push(rec);
    else if (e.tags?.golf === 'tee') tees.push(rec);
  }
  return { greens, tees };
}

// ─── main ───
const anchorPath = process.argv[2];
if (!anchorPath) { console.error('usage: build-course-anchored.mjs <anchor.json>'); process.exit(1); }
const anchor = JSON.parse(fs.readFileSync(path.resolve(anchorPath), 'utf8'));
const loop = anchor.greensPerLoop ?? anchor.holes.length;

console.log(`▶  ${anchor.name} — anchoring ${anchor.holes.length} holes to OSM`);
const bb = await nominatim(anchor.query);
console.log(`   bbox @ ${bb.display.slice(0, 70)}`);
const { greens, tees } = await overpass(bb);
console.log(`   OSM: ${greens.length} greens, ${tees.length} tees`);
if (greens.length < loop) console.log(`   ⚠ fewer OSM greens (${greens.length}) than loop size (${loop}) — some holes will lack coords`);

// For each hole, its center distance is the anchor. Assign the FIRST-loop holes to greens
// greedily (each green once); later loops reuse the same green by hole number (hole n → n-loop).
const firstLoop = anchor.holes.filter((h) => h.hole <= loop);
const usedGreen = new Set();
const holeGreen = {}; // hole → green rec
let prevGreenC = null;
for (const h of firstLoop) {
  let best = null;
  for (const g of greens) {
    if (usedGreen.has(g.id)) continue;
    // best tee for THIS green at this hole's center distance
    let teeErr = Infinity, bestTee = null;
    for (const t of tees) {
      const err = Math.abs(haversineYards(t.c, g.c) - h.center);
      if (err < teeErr) { teeErr = err; bestTee = t; }
    }
    // walk-continuity: a small bonus for greens near the previous green (nine flows hole-to-hole)
    const walk = prevGreenC ? haversineYards(prevGreenC, g.c) : 0;
    const score = teeErr + (prevGreenC ? Math.min(80, walk) * 0.15 : 0);
    if (!best || score < best.score) best = { g, tee: bestTee, teeErr, score };
  }
  if (best) { usedGreen.add(best.g.id); holeGreen[h.hole] = best.g; prevGreenC = best.g.c; }
}

// Build every hole (all loops): green = its own (loop 1) or the matching earlier-loop hole's green.
const rows = [];
for (const h of anchor.holes) {
  const g = holeGreen[h.hole] ?? holeGreen[((h.hole - 1) % loop) + 1] ?? null;
  let teeC = null, fb = null, osmCenter = null;
  if (g) {
    // pick the tee whose haversine to this green best matches the hole's center distance
    let err = Infinity;
    for (const t of tees) {
      const e = Math.abs(haversineYards(t.c, g.c) - h.center);
      if (e < err) { err = e; teeC = t.c; }
    }
    if (teeC) { fb = greenFrontBack(g.pts, teeC); osmCenter = Math.round(haversineYards(teeC, g.c)); }
  }
  rows.push({ h, g, teeC, fb, osmCenter });
}

// Emit CourseHole[] with SCREENSHOT distances (authoritative) + OSM coords.
console.log(`\n// ── Highland Links — PASTE INTO data/courses.ts ──`);
console.log(`// Distances = player GPS-app screenshots (ground truth). Coords = OSM (Overpass).`);
console.log(`const HOLES: CourseHole[] = [`);
for (const { h, g, teeC, fb, osmCenter } of rows) {
  const gc = g ? g.c : null;
  const f6 = (n) => (n == null ? '0' : n.toFixed(7));
  const note = g ? '' : 'no OSM green matched';
  console.log(`  { hole: ${String(h.hole).padStart(2)}, par: ${h.par ?? 4}, distance: ${h.center}, front: ${h.front}, back: ${h.back},`);
  console.log(`    teeLat: ${f6(teeC?.lat)}, teeLng: ${f6(teeC?.lng)},`);
  console.log(`    middleLat: ${f6(gc?.lat)}, middleLng: ${f6(gc?.lng)},`);
  console.log(`    frontLat: ${f6(fb?.front.lat)}, frontLng: ${f6(fb?.front.lng)},`);
  console.log(`    backLat: ${f6(fb?.back.lat)}, backLng: ${f6(fb?.back.lng)},`);
  console.log(`    note: '${note}', estimated: ${g ? 'false' : 'true'} },`);
}
console.log(`];`);

// Validation: OSM-derived center vs the anchored screenshot center (should be close on a good match).
console.log(`\n// ── VALIDATION (OSM center vs screenshot center) ──`);
let flagged = 0;
for (const { h, osmCenter } of rows) {
  const diff = osmCenter == null ? null : osmCenter - h.center;
  const flag = diff == null ? '⚠ NO GREEN' : Math.abs(diff) > 25 ? `⚠ ${diff > 0 ? '+' : ''}${diff}y` : `ok (${diff > 0 ? '+' : ''}${diff}y)`;
  if (diff == null || Math.abs(diff) > 25) flagged++;
  console.log(`//  H${String(h.hole).padStart(2)}  screenshot ${h.center}y  →  OSM ${osmCenter ?? '—'}y   ${flag}`);
}
console.log(`// ${anchor.holes.length - flagged}/${anchor.holes.length} holes matched within 25y.`);
