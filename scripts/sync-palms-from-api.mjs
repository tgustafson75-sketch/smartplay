#!/usr/bin/env node
/**
 * Phase AW — sync Palms / Lakes course data from golfcourseapi via the
 * existing proxy. Read-only: prints code-ready CourseHole[] arrays to
 * stdout for hand-paste into data/courses.ts. No commits, no writes.
 *
 * Usage:
 *   node scripts/sync-palms-from-api.mjs
 *
 * Optional env:
 *   API_URL   — proxy base (defaults to EXPO_PUBLIC_API_URL from .env)
 *   QUERY     — search term (defaults to "Menifee Lakes")
 *   TEE       — preferred tee name (default "White"; falls back to longest)
 *   DEBUG     — set to 1 to dump raw hole shape for field-name discovery
 *
 * Outputs:
 *   1) Search candidates (id, club name, course name, location)
 *   2) For each candidate: par/yardage table + GPS coverage report
 *   3) A pasteable CourseHole[] literal per candidate where geometry exists
 *
 * Exit codes:
 *   0 — success (output rendered, regardless of whether geometry is present)
 *   1 — fetch error / no results / proxy unreachable
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Load .env (no dependency) ─────────────────────────────────────
function loadDotEnv() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* swallow */ }
}
loadDotEnv();

const API_URL = process.env.API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? '';
const QUERY = process.env.QUERY ?? 'Menifee Lakes';
const PREFERRED_TEE = (process.env.TEE ?? 'White').toLowerCase();
const DEBUG = process.env.DEBUG === '1';

if (!API_URL) {
  console.error('ERR: EXPO_PUBLIC_API_URL not set in .env (or pass API_URL=...)');
  process.exit(1);
}

console.log(`▶  Proxy:  ${API_URL}`);
console.log(`▶  Query:  "${QUERY}"\n`);

// ─── Fetch helpers ─────────────────────────────────────────────────
async function fetchJson(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${label} → ${res.status} ${res.statusText}\n${body.slice(0, 400)}`);
    }
    return await res.json();
  } catch (e) {
    console.error(`ERR fetching ${label}:`, e.message ?? e);
    throw e;
  }
}

// ─── Search ────────────────────────────────────────────────────────
const searchUrl = `${API_URL}/api/course-proxy?action=search&q=${encodeURIComponent(QUERY)}`;
console.log(`◇ Search: ${searchUrl}`);
const searchData = await fetchJson(searchUrl, 'search');
const candidates = searchData.courses ?? searchData.data ?? (Array.isArray(searchData) ? searchData : []);

if (candidates.length === 0) {
  console.error(`No candidates returned for "${QUERY}"`);
  process.exit(1);
}

console.log(`\nFound ${candidates.length} candidate(s):\n`);
candidates.forEach((c, i) => {
  const id = c.id ?? '?';
  const club = c.club_name ?? c.name ?? '?';
  const course = c.course_name ?? '';
  const loc = [c.city, c.state_code ?? c.state, c.country].filter(Boolean).join(', ');
  console.log(`  [${i}] id=${id}  ${club}${course && course !== club ? ' — ' + course : ''}  (${loc})`);
});

// ─── Fetch detail + geometry for each candidate ───────────────────
for (const cand of candidates) {
  const id = String(cand.id);
  const label = `${cand.club_name ?? cand.name}${cand.course_name && cand.course_name !== cand.club_name ? ' — ' + cand.course_name : ''}`;
  console.log('\n' + '═'.repeat(72));
  console.log(`▼ ${label}  (id=${id})`);
  console.log('═'.repeat(72));

  // Detail (par/yardage)
  let course;
  try {
    const detailData = await fetchJson(`${API_URL}/api/course-proxy?action=detail&id=${id}`, `detail id=${id}`);
    course = detailData.course ?? detailData.data ?? detailData;
  } catch {
    continue;
  }

  // Tees
  let tees = [];
  if (Array.isArray(course.tees)) {
    tees = course.tees;
  } else if (course.tees && typeof course.tees === 'object') {
    for (const [grp, arr] of Object.entries(course.tees)) {
      if (Array.isArray(arr)) tees.push(...arr.map(t => ({ ...t, _group: grp })));
    }
  }

  console.log(`\nTees (${tees.length}):`);
  tees.forEach((t, i) => {
    const name = t.tee_name ?? t.name ?? `Tee ${i}`;
    const yards = t.total_yards ?? t.yardage ?? '?';
    const par = t.par_total ?? t.par ?? '?';
    const slope = t.slope_rating ?? t.slope ?? '?';
    const rating = t.course_rating ?? t.rating ?? '?';
    const holes = (t.holes ?? []).length;
    console.log(`  [${i}] ${name}  par ${par}  ${yards}y  rating ${rating}/${slope}  (${holes} holes)`);
  });

  // Geometry (GPS)
  let geometry = null;
  try {
    const geoData = await fetchJson(`${API_URL}/api/course-geometry?courseId=${id}`, `geometry id=${id}`);
    geometry = geoData;
  } catch {
    console.log('\n  ⚠ Geometry endpoint failed — no GPS available for this course.');
  }

  if (geometry?.holes?.length) {
    const withTee = geometry.holes.filter(h => h.tee).length;
    const withGreen = geometry.holes.filter(h => h.green).length;
    const withFront = geometry.holes.filter(h => h.green_front).length;
    const withBack = geometry.holes.filter(h => h.green_back).length;
    console.log(`\nGeometry coverage: ${geometry.holes.length} holes`);
    console.log(`  tee:         ${withTee}/${geometry.holes.length}`);
    console.log(`  green:       ${withGreen}/${geometry.holes.length}`);
    console.log(`  green_front: ${withFront}/${geometry.holes.length}`);
    console.log(`  green_back:  ${withBack}/${geometry.holes.length}`);
  } else {
    console.log('\n  ⚠ Geometry returned no holes.');
  }

  // ── Render code-ready CourseHole[] ────────────────────────────
  // Prefer the user-chosen tee (TEE env, default "White"); fall back to
  // the longest tee if no exact match exists.
  const teeMatch = tees.find(t => (t.tee_name ?? t.name ?? '').toLowerCase() === PREFERRED_TEE);
  const sortedTees = tees.slice().sort((a, b) => (b.total_yards ?? 0) - (a.total_yards ?? 0));
  const baseTee = teeMatch ?? sortedTees[0];

  if (DEBUG && baseTee?.holes?.[0]) {
    console.log('\n  [DEBUG] First raw hole:\n   ', JSON.stringify(baseTee.holes[0], null, 2).split('\n').join('\n    '));
  }
  if (!baseTee || !Array.isArray(baseTee.holes) || baseTee.holes.length === 0) {
    console.log('\n  ⚠ No tee with hole data — cannot render CourseHole[].');
    continue;
  }

  const geoByHole = new Map();
  if (geometry?.holes) for (const h of geometry.holes) geoByHole.set(h.hole_number, h);

  const lines = [];
  lines.push(`\n// ── PASTE INTO data/courses.ts ──`);
  lines.push(`// Source: golfcourseapi id=${id}, tee="${baseTee.tee_name ?? baseTee.name}" (${baseTee.total_yards ?? '?'}y)`);
  lines.push(`// Geometry coverage: see report above. Holes without GPS keep 0/0 placeholders.`);
  lines.push(`const HOLES: CourseHole[] = [`);

  baseTee.holes.forEach((rh, idx) => {
    // Hole number — API field varies; fall back to 1-based index.
    const n = rh.hole_number ?? rh.number ?? rh.hole ?? (idx + 1);
    const par = rh.par ?? 4;
    const distance = rh.yardage ?? rh.yards ?? 0;
    // Front/back distance heuristics: if not in API, fall back to ±15y of distance.
    const front = Math.max(0, distance - 15);
    const back = distance + 15;
    const g = geoByHole.get(n);
    const tLat = g?.tee?.lat ?? 0;
    const tLng = g?.tee?.lng ?? 0;
    const mLat = g?.green?.lat ?? 0;
    const mLng = g?.green?.lng ?? 0;
    const fLat = g?.green_front?.lat ?? 0;
    const fLng = g?.green_front?.lng ?? 0;
    const bLat = g?.green_back?.lat ?? 0;
    const bLng = g?.green_back?.lng ?? 0;
    const estimated = !(tLat && mLat); // missing GPS = data is incomplete

    lines.push(
      `  { hole: ${String(n).padStart(2)}, par: ${par}, distance: ${distance}, front: ${front}, back: ${back},\n` +
      `    teeLat: ${tLat}, teeLng: ${tLng}, middleLat: ${mLat}, middleLng: ${mLng},\n` +
      `    frontLat: ${fLat}, frontLng: ${fLng}, backLat: ${bLat}, backLng: ${bLng},\n` +
      `    note: '', estimated: ${estimated} },`,
    );
  });
  lines.push(`];`);
  console.log(lines.join('\n'));
}

console.log('\n' + '═'.repeat(72));
console.log('Done. Pick the candidate that matches your course, copy its CourseHole[] block,');
console.log('and replace the corresponding constant in data/courses.ts.');
