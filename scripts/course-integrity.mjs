#!/usr/bin/env node
/**
 * 2026-10-10 (Tim: "Weekly we need to be checking course engine integrity and improvement") — THE WEEKLY
 * COURSE ENGINE CHECK. Run every Sunday before the release slot: `npm run course:check`.
 *
 * READ-ONLY. Reads Course Cloud (smartplay.course_geometry — the merged map every player is served — and
 * course_geometry_reports — every contribution) through the Supabase management API and writes a report
 * to docs/course-health/<date>.md, with the change since the last report. It never writes the database.
 *
 * What it flags (each is a hole a player could be served wrong):
 *   - BAD COORDS      a tee or green at 0,0 / out of range / missing both
 *   - GEOMETRY ≠ CARD tee→green distance far from the card yardage (max(40 yd, 25%)) — a misplaced green
 *                     or tee, or a wrong card
 *   - PAR BAND        a card length outside its par's band (par 3 80-260, par 4 230-500, par 5 380-650 —
 *                     short par 5s from forward tees are real; under 380 is almost always a wrong card)
 *   - FRONT/BACK      green front farther from the tee than green back (front/back swapped)
 *   - HOLE GAPS       a course whose holes are not 1..9 or 1..18 complete
 *   - PRE-CUTOVER AI  AI-vision rows from before the card-check cutover (never served — should be purged)
 *   - LOW-CONF AI     AI-vision holes under 0.5 confidence (served as ESTIMATE — candidates to replace)
 *
 * Token: SUPABASE_ACCESS_TOKEN (env), else ~/smartmanage/.env.local. Project: ctdbnwhmwvcvtmzyipkr.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT = process.env.SMARTPLAY_SUPABASE_PROJECT ?? 'ctdbnwhmwvcvtmzyipkr';
const AI_CUTOVER = '2026-10-05T05:00:00Z';   // api/_courseCloud.AI_SCALE_FIX_AT
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'course-health');

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    const env = fs.readFileSync(path.join(os.homedir(), 'smartmanage', '.env.local'), 'utf8');
    const m = /^SUPABASE_ACCESS_TOKEN=(.*)$/m.exec(env);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* fall through */ }
  console.error('No SUPABASE_ACCESS_TOKEN (env or ~/smartmanage/.env.local). Nothing checked.');
  process.exit(2);
}
const TOKEN = token();

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`query failed ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

// Haversine in SQL, yards.
const HAV = (aLat, aLng, bLat, bLng) => `(2 * 6371000 * asin(sqrt(power(sin(radians((${bLat}) - (${aLat})) / 2), 2) + cos(radians(${aLat})) * cos(radians(${bLat})) * power(sin(radians((${bLng}) - (${aLng})) / 2), 2))) * 1.09361)`;
const BAD = (la, ln) => `(${la} is null or ${ln} is null or abs(${la}) > 90 or abs(${ln}) > 180 or (abs(${la}) < 0.001 and abs(${ln}) < 0.001))`;

// SERVED rows only: AI rows from before the card-check cutover are never served (api/_courseCloud
// isPreScaleAiRow), so they are reported once, as a purge list, and kept out of every other check.
const G = `(select * from smartplay.course_geometry where not (source = 'ai_vision' and updated_at < '${AI_CUTOVER}')) g`;
const GALL = 'smartplay.course_geometry';
const R = 'smartplay.course_geometry_reports';

const checks = {
  totals: `select count(distinct course_id)::int as courses, count(*)::int as holes,
             count(*) filter (where source = 'ai_vision')::int as ai_holes,
             count(*) filter (where source = 'osm')::int as osm_holes,
             count(*) filter (where source = 'bundled')::int as bundled_holes,
             count(*) filter (where source = 'user_walk')::int as walked_holes,
             count(*) filter (where updated_at > now() - interval '7 days')::int as holes_updated_7d,
             (select count(*)::int from ${R} where created_at > now() - interval '7 days') as reports_7d,
             (select count(distinct contributor_hash)::int from ${R} where created_at > now() - interval '7 days') as contributors_7d
           from ${G}`,
  newCourses: `select course_id, min(updated_at) as first_seen, count(*)::int as holes from ${G}
               group by course_id having min(updated_at) > now() - interval '7 days' order by first_seen desc`,
  badCoords: `select course_id, hole, source from ${G}
              where ${BAD('tee_lat', 'tee_lng')} and ${BAD('green_lat', 'green_lng')}
              order by course_id, hole`,
  cardMismatch: `select course_id, hole, par, yardage, source, round(${HAV('tee_lat', 'tee_lng', 'green_lat', 'green_lng')})::int as tee_to_green
                 from ${G}
                 where yardage > 0 and not ${BAD('tee_lat', 'tee_lng')} and not ${BAD('green_lat', 'green_lng')}
                   and abs(${HAV('tee_lat', 'tee_lng', 'green_lat', 'green_lng')} - yardage) > greatest(40, yardage * 0.25)
                 order by course_id, hole`,
  parBand: `select course_id, hole, par, yardage from ${G}
            where yardage > 0 and ((par = 3 and (yardage < 80 or yardage > 260)) or (par = 4 and (yardage < 230 or yardage > 500))
                                   or (par = 5 and (yardage < 380 or yardage > 650)) or (par is not null and par not in (3,4,5,6)))
            order by course_id, hole`,
  frontBack: `select course_id, hole from ${G}
              where not ${BAD('tee_lat', 'tee_lng')} and not ${BAD('green_front_lat', 'green_front_lng')} and not ${BAD('green_back_lat', 'green_back_lng')}
                and ${HAV('tee_lat', 'tee_lng', 'green_front_lat', 'green_front_lng')} > ${HAV('tee_lat', 'tee_lng', 'green_back_lat', 'green_back_lng')} + 3
              order by course_id, hole`,
  holeGaps: `select course_id, count(*)::int as holes, min(hole)::int as first, max(hole)::int as last from ${G}
             group by course_id
             having not ((count(*) = 18 and min(hole) = 1 and max(hole) = 18) or (count(*) = 9 and min(hole) = 1 and max(hole) = 9))
             order by course_id`,
  preCutoverAi: `select course_id, count(*)::int as holes from ${GALL}
                 where source = 'ai_vision' and updated_at < '${AI_CUTOVER}' group by course_id order by course_id`,
  lowConfAi: `select course_id, hole, round(confidence::numeric, 2) as confidence from ${G}
              where source = 'ai_vision' and confidence < 0.5 and updated_at >= '${AI_CUTOVER}' order by course_id, hole`,
};

const today = new Date().toLocaleDateString('en-CA');   // local date (the Sunday it ran)
const results = {};
for (const [name, sql] of Object.entries(checks)) results[name] = await q(sql);

const t = results.totals[0];
const counts = {
  courses: t.courses, holes: t.holes,
  badCoords: results.badCoords.length, cardMismatch: results.cardMismatch.length, parBand: results.parBand.length,
  frontBack: results.frontBack.length, holeGaps: results.holeGaps.length,
  preCutoverAi: results.preCutoverAi.reduce((n, r) => n + r.holes, 0), lowConfAi: results.lowConfAi.length,
};

// Change since the last report.
fs.mkdirSync(OUT_DIR, { recursive: true });
const prev = fs.readdirSync(OUT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${today}.json`).sort().pop();
const prevCounts = prev ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, prev), 'utf8')) : null;
const delta = (k) => (prevCounts && typeof prevCounts[k] === 'number' ? ` (${counts[k] - prevCounts[k] >= 0 ? '+' : ''}${counts[k] - prevCounts[k]})` : '');

const table = (rows) => {
  if (!rows.length) return '_none_\n';
  const cols = Object.keys(rows[0]);
  return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${cols.map((c) => r[c] ?? '').join(' | ')} |`).join('\n')}\n`;
};
const problems = counts.badCoords + counts.cardMismatch + counts.parBand + counts.frontBack + counts.holeGaps + counts.preCutoverAi;

const md = `# Course engine health — ${today}

${problems === 0 ? '**All clear.**' : `**${problems} problem${problems === 1 ? '' : 's'} to look at.**`} ${prev ? `Compared with ${prev.replace('.json', '')}.` : 'First report.'}

| | |
|---|---|
| Courses / holes served | ${t.courses}${delta('courses')} / ${t.holes}${delta('holes')} |
| By source | OSM ${t.osm_holes} · bundled ${t.bundled_holes} · walked ${t.walked_holes} · AI estimate ${t.ai_holes} |
| Last 7 days | ${t.holes_updated_7d} holes updated · ${t.reports_7d} contributions from ${t.contributors_7d} devices |
| Bad coordinates | ${counts.badCoords}${delta('badCoords')} |
| Geometry ≠ card | ${counts.cardMismatch}${delta('cardMismatch')} |
| Par band | ${counts.parBand}${delta('parBand')} |
| Front/back swapped | ${counts.frontBack}${delta('frontBack')} |
| Courses with hole gaps | ${counts.holeGaps}${delta('holeGaps')} |
| Pre-cutover AI holes (never served — purge) | ${counts.preCutoverAi}${delta('preCutoverAi')} |
| Low-confidence AI holes (served as ESTIMATE) | ${counts.lowConfAi}${delta('lowConfAi')} |

## New courses this week
${table(results.newCourses)}
## Geometry ≠ card (tee→green vs card yardage)
${table(results.cardMismatch)}
## Par band
${table(results.parBand)}
## Front/back swapped
${table(results.frontBack)}
## Hole gaps
${table(results.holeGaps)}
## Bad coordinates
${table(results.badCoords)}
## Pre-cutover AI holes
${table(results.preCutoverAi)}
## Low-confidence AI holes
${table(results.lowConfAi)}`;

fs.writeFileSync(path.join(OUT_DIR, `${today}.md`), md);
fs.writeFileSync(path.join(OUT_DIR, `${today}.json`), JSON.stringify(counts, null, 2));
console.log(md.split('\n## ')[0]);
console.log(`\nReport: docs/course-health/${today}.md`);
