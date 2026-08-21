/**
 * DOES EVERY BRAIN TOOL ACTUALLY FIRE? — one command, against the LIVE brains.
 *
 * 2026-08-20. Tim: "We can't keep hitting these stupid ass breaks. It's a natural caddie and it
 * controls the whole app and we keep missing things."
 *
 * He is describing one failure mode, not many. Three separate tools were declared, typed,
 * dispatched, unit-tested and REACHABLE — and fired zero or almost-zero times in production for
 * months. Every existing check passed the whole time, because every existing check asks a question
 * this class does not answer:
 *
 *     tsc            — does it compile?          all three compiled.
 *     jest / sim     — is it wired correctly?    all three were wired correctly.
 *     parity guards  — is it reachable?          all three were reachable.
 *     THIS           — does it FIRE?             all three did not.
 *
 * Reachability is not behaviour. The only way to know a tool fires is to say something a golfer
 * would say to the deployed brain and look at what comes back, so that is what this does.
 *
 * Run before any release, and after ANY change to a brain prompt or tool description — the model's
 * behaviour can change without a line of our code changing, which is exactly why a static test can
 * never cover this.
 *
 *     npm run probe-tools               # pipecat (turn 1)
 *     npm run probe-tools -- --kevin    # kevin (follow-up turn)
 *
 * A MISS is not automatically a bug — providers stall (the "Give me one sec" warm line), so a miss
 * is retried once and a persistent stall is reported as STALL, not MISS. Read a MISS as "this tool
 * did not fire for a thing a real player would say", then go look.
 */
const BASE = process.env.PROBE_API ?? 'https://api.smartplaycaddie.com';
const useKevin = process.argv.includes('--kevin');
/**
 * 2026-08-21 — probe the CONSOLIDATION shim: same pipecat contract, kevin answering behind it.
 * `npm run probe-tools -- --shim` must match the plain run case for case before the shim is
 * promoted to the default. Comparing the two on the SAME deployment is the whole point — it removes
 * "maybe the model was having an off minute" as an explanation for a difference.
 */
const useShim = process.argv.includes('--shim');
/**
 * 2026-08-21 — probe the CLASSIFIER, not just the brain. Tim: "you've never gotten the 'tap the ear
 * button and say record'… supposedly it works now, it's worked a few times, but I don't use it
 * because I don't trust it."
 *
 * The earbud path does not reach the brain first — it transcribes, runs /api/voice-intent, and acts
 * on THAT. So every brain probe in this file could pass while the hands-free commands he actually
 * uses were broken. And until today that classify waited 22 SECONDS on a cold socket, which is
 * almost certainly why it felt unreliable enough to abandon.
 *
 * Distrust is what unverifiable earns. This makes the hands-free path checkable in one command.
 */
const useIntent = process.argv.includes('--intent');

/** Utterances a player actually says hands-free, and the intent each MUST produce. */
const INTENT_CASES: Array<{ say: string; expect: string; param?: [string, string] }> = [
  { say: 'record my swing',                                 expect: 'open_tool', param: ['tool_name', 'smartmotion'] },
  { say: 'mark the green',                                  expect: 'open_tool', param: ['tool_name', 'mark_green'] },
  { say: 'log an issue, the yardage on three looked wrong',  expect: 'log_issue' },
  { say: 'put me down for a five',                          expect: 'log_score' },
];

async function probeIntents(): Promise<void> {
  console.log(`\nProbing the VOICE CLASSIFIER at ${BASE} — the hands-free / earbud path\n`);
  let bad = 0;
  for (const c of INTENT_CASES) {
    const started = Date.now();
    let got = '(error)';
    let params: Record<string, unknown> = {};
    try {
      const res = await fetch(`${BASE}/api/voice-intent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: c.say }),
      });
      const d = await res.json() as { intent_type?: string; parameters?: Record<string, unknown> };
      got = String(d.intent_type ?? '(none)');
      params = d.parameters ?? {};
    } catch { /* counted as a miss below */ }
    const ms = Date.now() - started;
    const paramOk = !c.param || String(params[c.param[0]] ?? '').includes(c.param[1]);
    const ok = got === c.expect && paramOk;
    if (!ok) bad += 1;
    console.log(`[${ok ? 'PASS ' : 'MISS '}] ${String(ms).padStart(5)}ms ${c.expect.padEnd(12)} "${c.say}"`);
    if (!ok) console.log(`          got ${got} ${JSON.stringify(params)}`);
  }
  console.log(`\n${INTENT_CASES.length - bad}/${INTENT_CASES.length} classified correctly.`);
  if (bad > 0) process.exit(1);
}

/** Each case is a sentence a golfer would actually say, and the tool that MUST result from it. */
/**
 * 2026-08-21 — some asks are only legitimate ON a course, and the caddie is RIGHT to refuse them
 * otherwise. "mark the green here" with no round context got 'You need to be standing at or near the
 * green to mark it' — which is honest, and better than firing blindly at a green you are not at.
 * The probe was asserting the less careful behaviour, so it gets a realistic round context instead
 * of a weaker assertion.
 */
const ON_COURSE = {
  player: { name: 'Tim', handicap: 14 },
  round: { active: true, currentHole: 7, courseName: 'Wachusett', holePar: 4, holeYardage: 150 },
};

const CASES: Array<{ expect: string | null; say: string; ctx?: Record<string, unknown> }> = [
  { expect: 'recommend_club',      say: "I'm 150 yards out, what should I hit" },
  { expect: 'recommend_club',      say: "I've got 165 to the pin into a little wind, what do you like" },
  { expect: 'log_emotional_state', say: 'I am so damn frustrated, I have topped three in a row' },
  { expect: 'log_emotional_state', say: 'honestly I feel great today, everything is clicking' },
  { expect: 'log_shot',            say: 'I striped my drive right down the middle' },
  { expect: 'log_shot',            say: 'I chunked my wedge, came up 20 yards short' },
  { expect: 'log_score',           say: 'put me down for a 6 on this hole' },
  { expect: 'plan_shot',           say: "I'm going to lay up with my 7 iron to about 100" },
  { expect: 'set_reminder',        say: 'remind me to work on my putting Thursday' },
  { expect: 'log_issue',           say: 'log an issue, the yardage on hole 3 looked wrong' },
  { expect: 'mark_green',          say: 'mark the green here', ctx: ON_COURSE },
  { expect: 'switch_caddie',       say: 'switch to Tank' },
  { expect: 'switch_caddie',       say: 'switch me to Harry' },
  { expect: 'zoom_target',         say: 'zoom in on the pin' },
  { expect: 'open_smartfinder',    say: 'open the rangefinder' },
  { expect: 'record_swing',        say: 'record my swing' },
  // NEGATIVES — over-firing is its own defect. Recording advice that was never given, or a shot
  // never hit, poisons the very data the caddie recommends from.
  { expect: null,                  say: 'how far does my 7 iron normally go' },
  { expect: null,                  say: 'what hole are we on' },
  { expect: null,                  say: 'the wind is really picking up out here' },
];

/**
 * 2026-08-21 — MEASURE THE CLOCK, NOT JUST THE ANSWER.
 *
 * Promoting the consolidation shim added a full OpenAI TTS round-trip to every turn — kevin
 * synthesises speech for its own clients, and the shim discarded it. Correctness never changed:
 * this probe stayed 19/19 throughout. But turns got ~1.2s slower, and on a COLD first turn that is
 * the difference between an answer and the offline caddie. Tim hit it within minutes.
 *
 * A suite that only checks WHAT the caddie said cannot see a caddie that got too slow to be heard.
 * So every turn is timed, and the slowest are reported — latency is a correctness property here.
 */
async function ask(say: string, ctx?: Record<string, unknown>): Promise<{ tools: string[]; said: string; stalled: boolean; ms: number }> {
  const url = useKevin ? `${BASE}/api/kevin` : `${BASE}/api/pipecat-turn${useShim ? '?via=kevin' : ''}`;
  // kevin takes a flat body; pipecat takes a nested context. Send each what it understands, so the
  // same scenario is genuinely the same scenario on both.
  const round = (ctx?.round ?? {}) as Record<string, unknown>;
  const body = useKevin
    ? {
        message: say, history: [],
        ...(ctx ? { isRoundActive: round.active, currentHole: round.currentHole, activeCourse: round.courseName, currentPar: round.holePar, currentYardage: round.holeYardage } : {}),
      }
    : { text: say, history: [], ...(ctx ? { context: ctx } : {}) };
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const d = await res.json() as Record<string, unknown>;
  const said = String((useKevin ? d.text : d.response_text) ?? '');
  // kevin answers with a singular toolAction plus an array only when there is more than one.
  const raw = useKevin
    ? [d.toolAction, ...((d.toolActions as unknown[]) ?? [])]
    : ((d.tool_actions as unknown[]) ?? []);
  const tools = raw.filter(Boolean).map(a => String((a as { type?: string }).type ?? ''));
  return { tools: [...new Set(tools)], said, stalled: /ask me again/i.test(said), ms };
}

(async () => {
  if (useIntent) { await probeIntents(); return; }
  const label = useKevin ? 'KEVIN (follow-up turn)' : useShim ? 'SHIM (pipecat contract → kevin)' : 'PIPECAT (turn 1, native)';
  console.log(`\nProbing ${label} at ${BASE}\n`);
  let missed = 0, stalls = 0;
  const timings: number[] = [];
  for (const c of CASES) {
    let r = await ask(c.say, c.ctx);
    // A provider stall is not a tool defect — give it exactly one more go before judging.
    if (r.stalled || (c.expect && !r.tools.includes(c.expect))) r = await ask(c.say, c.ctx);

    const pass = c.expect === null ? r.tools.length === 0 : r.tools.includes(c.expect);
    const tag = pass ? 'PASS' : r.stalled ? 'STALL' : c.expect === null ? 'OVER' : 'MISS';
    if (tag === 'MISS' || tag === 'OVER') missed += 1;
    if (tag === 'STALL') stalls += 1;
    timings.push(r.ms);
    console.log(`[${tag.padEnd(5)}] ${String(r.ms).padStart(5)}ms ${String(c.expect ?? '(nothing)').padEnd(20)} "${c.say}"`);
    if (!pass) console.log(`          got ${JSON.stringify(r.tools)} — "${r.said.slice(0, 70)}"`);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const slowest = sorted[sorted.length - 1] ?? 0;
  console.log(`\n${CASES.length - missed - stalls}/${CASES.length} behaved. ${missed} defect(s), ${stalls} provider stall(s).`);
  // The first call absorbs the cold start, so the MEDIAN is the honest number to watch turn to turn.
  console.log(`Latency: median ${median}ms, slowest ${slowest}ms. A jump here is a regression even at 19/19 —`);
  console.log(`a caddie that answers correctly but too slowly degrades to the offline voice on a cold turn.`);
  if (missed > 0) {
    console.log('A MISS means a real player sentence produced no tool. An OVER means we recorded something that never happened.');
    process.exit(1);
  }
})();
