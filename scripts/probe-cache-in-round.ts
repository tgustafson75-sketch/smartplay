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
  // IDENTICAL message on turns 1-2 to isolate the prompt prefix from message-driven selection
  // (the KB addendum is chosen by the question and is CONCATENATED ONTO the cached system prompt).
  { label: 'turn 1 — first turn of the round (expect a WRITE)', body: { ...ON_COURSE, message: 'what do you think here?' } },
  { label: 'turn 2 — SAME message, same round state', body: { ...ON_COURSE, message: 'what do you think here?' } },
  { label: 'turn 3 — same message, SHOT MOVED (new yardage + stroke)', body: { ...ON_COURSE, currentYardage: 118, currentStroke: 2, message: 'what do you think here?' } },
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
