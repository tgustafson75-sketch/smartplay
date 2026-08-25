/**
 * 2026-08-25 — DOES THE 1-HOUR CACHE ACTUALLY READ DURING A ROUND?
 *
 * The 08-24 verification measured cacheRead 19188 / cacheWrite 0 and concluded the cache was fixed.
 * That turn had NO ACTIVE ROUND, so the on-course branch of the system prompt rendered as nothing
 * and changing the yardage changed no bytes — it proved the fix in the only situation where the
 * defect cannot appear. This measures the case that actually matters.
 *
 * Three turns on a LIVE round: identical, identical, then one with a different yardage and stroke.
 * Turn 2 shows whether the prefix is stable at all. Turn 3 shows whether per-shot movement still
 * busts it. cacheRead is the number; cacheWrite near zero after turn 1 is the goal.
 *
 *   npx tsx scripts/probe-cache-in-round.ts
 */
const BASE = process.env.API_BASE ?? 'https://api.smartplaycaddie.com';

const ON_COURSE = {
  firstName: 'Tim', handicap: 14, persona: 'kevin',
  isRoundActive: true, currentHole: 9, currentPar: 4, currentYardage: 150,
  activeCourse: 'Greenhill', skip_tts: true,
};

type Turn = { label: string; body: Record<string, unknown> };

const turns: Turn[] = [
  // The REALISTIC round: a different question every turn, and the shot moving underneath it.
  // This is the shape that always missed before the KB addendum came off the cached prompt.
  { label: 'turn 1 — first turn of the round (a WRITE is expected here)', body: { ...ON_COURSE, message: 'what do you think here?' } },
  { label: 'turn 2 — DIFFERENT question', body: { ...ON_COURSE, message: 'and how about the wind?' } },
  { label: 'turn 3 — different question AND the shot moved', body: { ...ON_COURSE, currentYardage: 118, currentStroke: 2, message: 'what now?' } },
  { label: 'turn 4 — different question again, later in the hole', body: { ...ON_COURSE, currentYardage: 42, currentStroke: 3, message: 'how should I play this one?' } },
];

(async () => {
  console.log(`cache behaviour across a live round — ${BASE}\n`);
  for (const t of turns) {
    const res = await fetch(`${BASE}/api/kevin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t.body),
    });
    const j = await res.json().catch(() => null) as { _debug?: { usage?: Record<string, number> } } | null;
    const u = j?._debug?.usage;
    if (!u) { console.log(`${t.label}\n  no usage returned (status ${res.status})\n`); continue; }
    console.log(`${t.label}`);
    console.log(`  cacheRead=${u.cacheRead}  cacheWrite=${u.cacheWrite}  in=${u.input}  out=${u.output}\n`);
  }
  console.log('READ large + WRITE ~0 on turns 2 and 3 = the round is paying cached rates.');
  console.log('WRITE large every turn = the prefix still moves; a 1h write costs 2x.');
})();
