/**
 * WHAT ONE PLAYER COSTS US.
 *
 * Tim, 2026-08-24: "once we're done with this build I still need to estimate the cost per user."
 * Written the day a $50 Anthropic bill turned out to be the probe harness rather than the players —
 * which is the whole reason to have a number you can check instead of a feeling.
 *
 * Every figure below is measured or defensible, and the ones that are ASSUMPTIONS say so, because a
 * cost model whose inputs you cannot argue with is not a model, it is a wish.
 *
 *   npx tsx scripts/cost-per-user.ts
 *   npx tsx scripts/cost-per-user.ts --rounds=4 --turns=45
 */

// ── Measured on the live server, 2026-08-24 (api/kevin _debug.usage) ────────────────────────────
const SYSTEM_TOKENS = 19_329;   // the cached doctrine block
const MESSAGE_TOKENS = 366;     // per-turn message BEFORE live facts moved into it
const LIVE_FACTS_TOKENS = 900;  // the block moved out of the cached prompt (varies with conditions)
const OUTPUT_TOKENS = 120;      // a caddie answer is short by design

/**
 * ── THE MODEL TABLE ────────────────────────────────────────────────────────────────────────────
 *
 * Tim, 2026-08-26: "we need to always be on the consistent lookout for less expensive agent models…
 * Is it the right agent for us? And is that a move we should make?"
 *
 * So this stopped being a one-model script. Add a row when a model ships, run it, and the answer is
 * a number rather than a feeling.
 *
 * RATES ARE $/MILLION TOKENS AND MUST BE COPIED FROM THE PRICING PAGE, NOT REMEMBERED. A row with
 * `rates: null` prints as UNPRICED rather than guessing — a cost model with an invented input is
 * worse than no cost model, because it looks like evidence. See docs/MODEL-EVALUATION.md for what
 * price does NOT tell you, which for this app is most of the decision.
 */
interface ModelRates { in: number; out: number; cacheRead: number; cacheWrite1h: number }
interface Candidate {
  id: string;
  label: string;
  rates: ModelRates | null;
  note: string;
}

const MODELS: Candidate[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6  (the caddie brain today)',
    rates: { in: 3, out: 15, cacheRead: 0.30, cacheWrite1h: 6 },
    note: 'api/kevin pins tier=quality on EVERY turn — a deliberate 08-23 decision, not an oversight.',
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    rates: null,
    note: 'ALREADY IN PRODUCTION on api/club-path. Intro pricing ran to 2026-08-31; after that the '
        + '2026-08-24 note records it as identical to 4.6 — so confirm before assuming a saving.',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    rates: null,
    note: 'Already the "fast" tier in api/_aiProvider. Measured 2026-08-24 at $0.92/user-month under '
        + 'these same assumptions — the cheapest CLAUDE option by a distance. The question is not '
        + 'price, it is whether it does the club arithmetic.',
  },
];

const CURRENT = MODELS[0];
if (!CURRENT.rates) throw new Error('the current model must be priced');
const { in: IN, out: OUT, cacheRead: CACHE_READ, cacheWrite1h: CACHE_WRITE_1H } = CURRENT.rates;

// TTS: gpt-4o-mini-tts, ~$0.015/min of audio. A caddie line is ~4 seconds.
const TTS_PER_LINE = 0.015 * (4 / 60);
// Whisper transcription: $0.006/min. A player utterance is ~5 seconds.
const STT_PER_TURN = 0.006 * (5 / 60);

const arg = (k: string, d: number) => Number((process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=')[1]) || d;

// ── ASSUMPTIONS — argue with these, not the arithmetic ─────────────────────────────────────────
const roundsPerMonth = arg('rounds', 4);      // a keen amateur; Tim's own figure was ~20 rounds/yr
const turnsPerRound = arg('turns', 40);       // 18 holes, roughly two caddie exchanges a hole
const voiceShare = arg('voice', 0.7);         // fraction of turns spoken rather than typed

function money(n: number): string { return `$${n.toFixed(4)}`; }

// FIRST turn of a round writes the cache; every turn after reads it (1h TTL survives the walk).
const firstTurn = (SYSTEM_TOKENS * CACHE_WRITE_1H + (MESSAGE_TOKENS + LIVE_FACTS_TOKENS) * IN + OUTPUT_TOKENS * OUT) / 1e6;
const laterTurn = (SYSTEM_TOKENS * CACHE_READ + (MESSAGE_TOKENS + LIVE_FACTS_TOKENS) * IN + OUTPUT_TOKENS * OUT) / 1e6;
// What it cost BEFORE the live facts moved out — every turn a fresh 1h write.
const brokenTurn = (SYSTEM_TOKENS * CACHE_WRITE_1H + MESSAGE_TOKENS * IN + OUTPUT_TOKENS * OUT) / 1e6;

const brainPerRound = firstTurn + laterTurn * (turnsPerRound - 1);
const voicePerRound = turnsPerRound * voiceShare * (TTS_PER_LINE + STT_PER_TURN);
const perRound = brainPerRound + voicePerRound;

console.log(`
COST PER USER — SmartPlay Caddie
Assumptions: ${roundsPerMonth} rounds/month · ${turnsPerRound} caddie turns/round · ${Math.round(voiceShare * 100)}% spoken

  One turn, cache WRITE (first of a round)   ${money(firstTurn)}
  One turn, cache READ  (every turn after)   ${money(laterTurn)}
  One turn, BEFORE the cache fix             ${money(brokenTurn)}   <- ${(brokenTurn / laterTurn).toFixed(1)}x worse, every turn

  Brain, per round                           ${money(brainPerRound)}
  Voice (TTS + transcription), per round      ${money(voicePerRound)}
  ─────────────────────────────────────────────────────
  PER ROUND                                  ${money(perRound)}
  PER USER / MONTH                           ${money(perRound * roundsPerMonth)}
  PER USER / YEAR                            ${money(perRound * roundsPerMonth * 12)}

  Same user, had the cache stayed broken     ${money((brokenTurn * turnsPerRound + voicePerRound) * roundsPerMonth)} /month

Not included: SmartMotion pose analysis (on-device MediaPipe, free), elevation and weather lookups
(cached per point / 5 min, negligible), Supabase, and Vercel invocations. Those are real but small
next to per-token spend; revisit if any becomes material.

At a $9.99/mo subscription the brain is roughly ${((perRound * roundsPerMonth) / 9.99 * 100).toFixed(1)}% of revenue per user.
`);

// ── The comparison ─────────────────────────────────────────────────────────────────────────────
const monthlyFor = (r: ModelRates): number => {
  const first = (SYSTEM_TOKENS * r.cacheWrite1h + (MESSAGE_TOKENS + LIVE_FACTS_TOKENS) * r.in + OUTPUT_TOKENS * r.out) / 1e6;
  const later = (SYSTEM_TOKENS * r.cacheRead + (MESSAGE_TOKENS + LIVE_FACTS_TOKENS) * r.in + OUTPUT_TOKENS * r.out) / 1e6;
  return (first + later * (turnsPerRound - 1) + voicePerRound) * roundsPerMonth;
};

console.log('IS IT THE RIGHT MODEL FOR US?  (same assumptions; voice cost identical across rows)\n');
for (const m of MODELS) {
  const price = m.rates ? money(monthlyFor(m.rates)) + '/mo' : 'UNPRICED — fill rates from the pricing page';
  console.log(`  ${m.label.padEnd(38)} ${price}`);
  console.log(`  ${' '.repeat(38)} ${m.note}\n`);
}
console.log(`Price is the easy half. docs/MODEL-EVALUATION.md holds the other half — latency on a caddie
whose value is a 2.5s answer, and whether a cheaper model still does the club arithmetic that took
three prompt rewrites and a move into code to get right on this one.
`);
