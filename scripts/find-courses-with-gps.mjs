#!/usr/bin/env node
/**
 * Phase AW companion — sweep golfcourseapi for courses with GPS coverage.
 * Searches a list of nearby SoCal candidates and reports geometry coverage
 * (tee + green + green_front + green_back) per course. Goal: find a local
 * course we can use as a SmartVision demo / "elite" path.
 *
 * Usage:
 *   node scripts/find-courses-with-gps.mjs
 *
 * Optional env:
 *   API_URL  — proxy base (defaults to EXPO_PUBLIC_API_URL)
 *   QUERIES  — comma-separated overrides (default: SoCal candidate set)
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

const API_URL = process.env.API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? '';
if (!API_URL) {
  console.error('ERR: EXPO_PUBLIC_API_URL not set');
  process.exit(1);
}

// Default candidate set — popular / well-known SoCal public courses near
// Menifee. Expand as needed via QUERIES env (comma-separated).
const DEFAULT_QUERIES = [
  'Menifee Lakes',
  'Pechanga',
  'SCGA',
  'Cross Creek',
  'Soboba',
  'Hidden Valley',
  'Murrieta',
  'Bear Creek',
  'Tijeras Creek',
  'Robinson Ranch',
  'Coyote Hills',
  'Rancho California',
  'Aliso Viejo',
  'Tustin Ranch',
  'Strawberry Farms',
  'Pelican Hill',
  'Torrey Pines',
];

const QUERIES = process.env.QUERIES
  ? process.env.QUERIES.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_QUERIES;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

console.log(`▶  Sweeping ${QUERIES.length} queries for courses with GPS coverage…\n`);

const results = []; // { id, name, coverage }

for (const q of QUERIES) {
  let candidates = [];
  try {
    const data = await fetchJson(`${API_URL}/api/course-proxy?action=search&q=${encodeURIComponent(q)}`);
    candidates = data.courses ?? data.data ?? (Array.isArray(data) ? data : []);
  } catch (e) {
    console.log(`  [search "${q}"] failed: ${e.message}`);
    continue;
  }

  for (const cand of candidates.slice(0, 5)) { // top 5 per query
    const id = String(cand.id ?? '');
    if (!id || results.some(r => r.id === id)) continue; // dedupe

    const name = `${cand.club_name ?? cand.name ?? '?'}${cand.course_name && cand.course_name !== cand.club_name ? ' — ' + cand.course_name : ''}`;
    const loc = [cand.city, cand.state_code ?? cand.state].filter(Boolean).join(', ');

    let geo;
    try {
      geo = await fetchJson(`${API_URL}/api/course-geometry?courseId=${id}`);
    } catch {
      results.push({ id, name, loc, coverage: { tee: 0, green: 0, gf: 0, gb: 0, holes: 0 }, error: 'geometry fetch failed' });
      continue;
    }

    const holes = geo?.holes ?? [];
    const cov = {
      holes: holes.length,
      tee: holes.filter(h => h.tee).length,
      green: holes.filter(h => h.green).length,
      gf: holes.filter(h => h.green_front).length,
      gb: holes.filter(h => h.green_back).length,
    };
    results.push({ id, name, loc, coverage: cov });

    // Progress dot so user knows it's alive
    process.stdout.write('.');
  }
}

console.log('\n');

// Sort: full GPS coverage first, then partial, then none
results.sort((a, b) => {
  const aScore = a.coverage.tee + a.coverage.green + a.coverage.gf + a.coverage.gb;
  const bScore = b.coverage.tee + b.coverage.green + b.coverage.gf + b.coverage.gb;
  return bScore - aScore;
});

const fullCoverage = results.filter(r => r.coverage.holes > 0 && r.coverage.tee === r.coverage.holes && r.coverage.green === r.coverage.holes);
const partialCoverage = results.filter(r => r.coverage.tee + r.coverage.green > 0 && !fullCoverage.includes(r));
const noCoverage = results.filter(r => !fullCoverage.includes(r) && !partialCoverage.includes(r));

console.log('═'.repeat(72));
console.log(`FULL GPS COVERAGE (tee + green on every hole) — ${fullCoverage.length}`);
console.log('═'.repeat(72));
if (fullCoverage.length === 0) console.log('  (none)');
fullCoverage.forEach(r => {
  console.log(`  id=${r.id}  ${r.name}  (${r.loc})`);
  console.log(`    holes ${r.coverage.holes}, tee ${r.coverage.tee}, green ${r.coverage.green}, F ${r.coverage.gf}, B ${r.coverage.gb}`);
});

console.log('\n' + '═'.repeat(72));
console.log(`PARTIAL GPS COVERAGE — ${partialCoverage.length}`);
console.log('═'.repeat(72));
if (partialCoverage.length === 0) console.log('  (none)');
partialCoverage.forEach(r => {
  console.log(`  id=${r.id}  ${r.name}  (${r.loc})`);
  console.log(`    holes ${r.coverage.holes}, tee ${r.coverage.tee}, green ${r.coverage.green}, F ${r.coverage.gf}, B ${r.coverage.gb}`);
});

console.log('\n' + '═'.repeat(72));
console.log(`NO GPS COVERAGE — ${noCoverage.length} (par/yardage only)`);
console.log('═'.repeat(72));
noCoverage.forEach(r => console.log(`  id=${r.id}  ${r.name}  (${r.loc})`));

console.log('\nDone.');
