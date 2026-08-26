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
  // FRESH questions, never sent before — a repeat matches its own earlier entry inside the 1h TTL
  // and reads as a hit that proves nothing.
  { label: 'turn 1 — fresh question (a WRITE is expected)', body: { ...ON_COURSE, message: 'is this one playing longer than it looks' } },
  { label: 'turn 2 — DIFFERENT fresh question', body: { ...ON_COURSE, message: 'where do I not want to be here' } },
  { label: 'turn 3 — different fresh question AND the shot moved', body: { ...ON_COURSE, currentYardage: 118, currentStroke: 2, message: 'am I better short or long' } },
  { label: 'turn 4 — different fresh question, later in the hole', body: { ...ON_COURSE, currentYardage: 42, currentStroke: 3, message: 'talk me through this little one' } },
];

(async () => {
  console.log(`cache behaviour across a live round — ${BASE}\n`);
  for (const t of turns) {
    const res = await fetch(`${BASE}/api/kevin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t.body),
    });
    const j = await res.json().catch(() => null) as { _debug?: { usage?: Record<string, number>; systemLen?: number; systemFp?: number } } | null;
    const u = j?._debug?.usage;
    if (!u) { console.log(`${t.label}\n  no usage returned (status ${res.status})\n`); continue; }
    console.log(`${t.label}`);
    console.log(`  cacheRead=${u.cacheRead}  cacheWrite=${u.cacheWrite}  in=${u.input}  out=${u.output}`);
    console.log(`  systemLen=${j?._debug?.systemLen}  systemFp=${j?._debug?.systemFp}\n`);
  }
  console.log('READ large + WRITE ~0 on turns 2 and 3 = the round is paying cached rates.');
  console.log('WRITE large every turn = the prefix still moves; a 1h write costs 2x.');
})();
