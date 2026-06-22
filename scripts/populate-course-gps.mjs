#!/usr/bin/env node
/**
 * GolfTraxx GPS scraper — pull tee + green coordinates for any course.
 *
 * GolfTraxx has satellite GPS data for essentially every US course.
 * This script fetches a course's full-layout page, extracts the JavaScript
 * marker data (gc=green center, gf=green front, gb=green back, tt=tips tee),
 * and emits a ready-to-paste CourseHole[] block.
 *
 * Usage (single course):
 *   node scripts/populate-course-gps.mjs --name "Menifee Lakes Palms" --zip 92584 --city Menifee --state CA
 *
 * Usage (all known courses in COURSES_TO_POPULATE):
 *   node scripts/populate-course-gps.mjs --all
 *
 * Output: TypeScript snippet to paste into data/courses.ts.
 */

const COURSES_TO_POPULATE = [
  { id: 'palms',           name: 'Menifee Lakes Palms',         zip: '92584', city: 'Menifee',      state: 'CA', holes: 18 },
  { id: 'lakes',           name: 'Menifee Lakes Lakes',         zip: '92584', city: 'Menifee',      state: 'CA', holes: 18 },
  { id: 'rancho-california', name: 'Rancho California Golf Club', zip: '92595', city: 'Winchester',  state: 'CA', holes: 18 },
  { id: 'crystal-springs', name: 'Crystal Springs Golf Course',  zip: '94010', city: 'Burlingame',  state: 'CA', holes: 18 },
  { id: 'sunnyvale',       name: 'Sunnyvale Golf Course',        zip: '94086', city: 'Sunnyvale',   state: 'CA', holes: 18 },
  { id: 'san-jose-muni',   name: 'San Jose Municipal Golf Course', zip: '95148', city: 'San Jose', state: 'CA', holes: 18 },
  { id: 'mariners-point',  name: 'Mariners Point Golf Center',   zip: '94404', city: 'Foster City', state: 'CA', holes: 9  },
  { id: 'echo-hills',      name: 'Echo Hills Golf Course',       zip: '92543', city: 'Hemet',       state: 'CA', holes: 9  },
  { id: 'westlake-cc-nj',  name: 'Westlake Country Club',        zip: '08527', city: 'Jackson',     state: 'NJ', holes: 18 },
];

// ─── Extraction ──────────────────────────────────────────────────────────────

function extractMarkers(html) {
  // Pull all inline script text
  const scriptBlocks = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) scriptBlocks.push(m[1]);
  const src = scriptBlocks.join('\n');

  const results = [];
  const parts = src.split(/initMarker\(/);
  for (let i = 1; i < parts.length; i++) {
    const after = parts[i];
    const before = parts[i - 1];

    const typeMatch = after.match(/^'([a-z]+)'/);
    if (!typeMatch) continue;
    const type = typeMatch[1];
    if (!['gc', 'gf', 'gb', 'tt'].includes(type)) continue;

    const holeMatch = after.match(/'(\d+)'\s*\)/);
    const hole = holeMatch ? parseInt(holeMatch[1], 10) : null;

    const coordMatch = before.match(/LatLng\(parseFloat\(([\d.]+)\),\s*parseFloat\((-[\d.]+)\)\)[^)]*$/s);
    if (!coordMatch) continue;

    results.push({ type, hole, lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) });
  }
  return results;
}

function buildHoleMap(markers, expectedHoles) {
  // Markers come in order: gc, gf, gb (no hole label), then tt (with hole label).
  // Group by position: every gc/gf/gb before a tt belongs to that tt's hole.
  const holes = {};
  let pending = {};

  for (const m of markers) {
    if (m.type === 'gc') pending.gc = m;
    else if (m.type === 'gf') pending.gf = m;
    else if (m.type === 'gb') pending.gb = m;
    else if (m.type === 'tt' && m.hole !== null) {
      const h = m.hole;
      if (h > expectedHoles) { pending = {}; continue; } // guard against extra markers
      const teeIsGreen = pending.gc && Math.abs(m.lat - pending.gc.lat) < 0.000001
        && Math.abs(m.lng - pending.gc.lng) < 0.000001;

      holes[h] = {
        teeLat:    teeIsGreen ? 0 : m.lat,
        teeLng:    teeIsGreen ? 0 : m.lng,
        middleLat: pending.gc?.lat ?? 0,
        middleLng: pending.gc?.lng ?? 0,
        frontLat:  pending.gf?.lat ?? 0,
        frontLng:  pending.gf?.lng ?? 0,
        backLat:   pending.gb?.lat ?? 0,
        backLng:   pending.gb?.lng ?? 0,
        teeDataError: teeIsGreen,
      };
      pending = {};
    }
  }
  return holes;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchGolfTraxx(name, zip, city, state) {
  const params = new URLSearchParams({
    coursename: name,
    zipcode: zip,
    city,
    state,
    static: 'true',
  });
  const url = `https://golftraxx.com/full-layout?${params}`;
  console.error(`  Fetching: ${url}`);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'no-cache',
      'Referer': 'https://golftraxx.com/',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ─── Output ──────────────────────────────────────────────────────────────────

function emitTypeScript(courseId, holeMap, existingHoles) {
  const lines = [];
  const constName = `${courseId.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).toUpperCase()}_HOLES`;
  const constNameClean = constName.replace(/[^A-Z0-9_]/g, '_');

  for (const h of existingHoles) {
    const g = holeMap[h.hole];
    if (!g) {
      lines.push(`  // HOLE ${h.hole}: no GolfTraxx data found`);
      lines.push(`  { hole: ${String(h.hole).padStart(2)}, par: ${h.par}, distance: ${h.distance}, front: ${h.front}, back: ${h.back}, teeLat: 0, teeLng: 0, middleLat: 0, middleLng: 0, frontLat: 0, frontLng: 0, backLat: 0, backLng: 0, note: '', estimated: ${h.estimated} },`);
      continue;
    }
    const note = g.teeDataError ? "'tee needs field calibration'" : "''";
    const f = (n) => n === 0 ? '0' : n.toFixed(8);
    lines.push(
      `  { hole: ${String(h.hole).padStart(2)}, par: ${h.par}, distance: ${h.distance}, front: ${h.front}, back: ${h.back},` +
      ` teeLat: ${f(g.teeLat)}, teeLng: ${f(g.teeLng)},` +
      ` middleLat: ${f(g.middleLat)}, middleLng: ${f(g.middleLng)},` +
      ` frontLat: ${f(g.frontLat)}, frontLng: ${f(g.frontLng)},` +
      ` backLat: ${f(g.backLat)}, backLng: ${f(g.backLng)},` +
      ` note: ${note}, estimated: false },`
    );
  }

  return `// GPS: GolfTraxx satellite data ${new Date().toISOString().slice(0, 10)}\n` +
    `// Replace the existing ${constNameClean} array with this block.\n` +
    `[\n${lines.join('\n')}\n]`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isAll = args.includes('--all');

let targets = [];
if (isAll) {
  targets = COURSES_TO_POPULATE;
} else {
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const name  = get('--name');
  const zip   = get('--zip');
  const city  = get('--city');
  const state = get('--state');
  const holes = parseInt(get('--holes') ?? '18', 10);
  if (!name || !zip) {
    console.error('Usage: node populate-course-gps.mjs --name "Course Name" --zip 12345 --city CityName --state CA [--holes 9|18]');
    console.error('       node populate-course-gps.mjs --all');
    process.exit(1);
  }
  targets = [{ id: name.toLowerCase().replace(/\s+/g, '-'), name, zip, city: city ?? '', state: state ?? '', holes }];
}

for (const course of targets) {
  console.error(`\n▶ ${course.name} (${course.city}, ${course.state} ${course.zip})`);
  try {
    const html = await fetchGolfTraxx(course.name, course.zip, course.city, course.state);
    const markers = extractMarkers(html);
    console.error(`  Extracted ${markers.length} markers`);

    if (markers.length === 0) {
      console.error('  WARNING: No markers found. Course name/zip may not match GolfTraxx exactly.');
      console.error('  Try searching manually at https://golftraxx.com');
      continue;
    }

    const holeMap = buildHoleMap(markers, course.holes);
    const foundHoles = Object.keys(holeMap).length;
    console.error(`  Found GPS for ${foundHoles}/${course.holes} holes`);

    const teeErrors = Object.entries(holeMap).filter(([, v]) => v.teeDataError).map(([k]) => k);
    if (teeErrors.length > 0) {
      console.error(`  NOTE: Holes ${teeErrors.join(', ')} have tee=gc (GolfTraxx data error — tee set to 0,0)`);
    }

    // Build stub existing holes for output (par/distance unknown without courses.ts import)
    const stubHoles = Array.from({ length: course.holes }, (_, i) => ({
      hole: i + 1, par: 0, distance: 0, front: 0, back: 0, estimated: false,
    }));

    console.log(`\n// ─── ${course.name} (${course.id}) ───`);
    console.log(`// Paste the coordinates below into data/courses.ts`);
    console.log(`// You still need to fill in par/distance/front/back from existing data.`);
    console.log();

    // Emit just the GPS fields per hole (easier to merge with existing data)
    for (let h = 1; h <= course.holes; h++) {
      const g = holeMap[h];
      if (!g) {
        console.log(`  hole ${h}: NO DATA`);
        continue;
      }
      const f = (n) => n === 0 ? '0' : n.toFixed(8);
      const teeNote = g.teeDataError ? ' ← tee error, kept 0,0' : '';
      console.log(`  hole ${h}: tee(${f(g.teeLat)}, ${f(g.teeLng)})${teeNote} green(${f(g.middleLat)}, ${f(g.middleLng)}) F(${f(g.frontLat)}, ${f(g.frontLng)}) B(${f(g.backLat)}, ${f(g.backLng)})`);
    }

  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
  }
}
