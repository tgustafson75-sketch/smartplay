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

/** Each case is a sentence a golfer would actually say, and the tool that MUST result from it. */
const CASES: Array<{ expect: string | null; say: string }> = [
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
  { expect: 'mark_green',          say: 'mark the green here' },
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

async function ask(say: string): Promise<{ tools: string[]; said: string; stalled: boolean }> {
  const url = useKevin ? `${BASE}/api/kevin` : `${BASE}/api/pipecat-turn${useShim ? '?via=kevin' : ''}`;
  const body = useKevin ? { message: say, history: [] } : { text: say, history: [] };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json() as Record<string, unknown>;
  const said = String((useKevin ? d.text : d.response_text) ?? '');
  // kevin answers with a singular toolAction plus an array only when there is more than one.
  const raw = useKevin
    ? [d.toolAction, ...((d.toolActions as unknown[]) ?? [])]
    : ((d.tool_actions as unknown[]) ?? []);
  const tools = raw.filter(Boolean).map(a => String((a as { type?: string }).type ?? ''));
  return { tools: [...new Set(tools)], said, stalled: /ask me again/i.test(said) };
}

(async () => {
  const label = useKevin ? 'KEVIN (follow-up turn)' : useShim ? 'SHIM (pipecat contract → kevin)' : 'PIPECAT (turn 1, native)';
  console.log(`\nProbing ${label} at ${BASE}\n`);
  let missed = 0, stalls = 0;
  for (const c of CASES) {
    let r = await ask(c.say);
    // A provider stall is not a tool defect — give it exactly one more go before judging.
    if (r.stalled || (c.expect && !r.tools.includes(c.expect))) r = await ask(c.say);

    const pass = c.expect === null ? r.tools.length === 0 : r.tools.includes(c.expect);
    const tag = pass ? 'PASS' : r.stalled ? 'STALL' : c.expect === null ? 'OVER' : 'MISS';
    if (tag === 'MISS' || tag === 'OVER') missed += 1;
    if (tag === 'STALL') stalls += 1;
    console.log(`[${tag.padEnd(5)}] ${String(c.expect ?? '(nothing)').padEnd(20)} "${c.say}"`);
    if (!pass) console.log(`          got ${JSON.stringify(r.tools)} — "${r.said.slice(0, 70)}"`);
  }
  console.log(`\n${CASES.length - missed - stalls}/${CASES.length} behaved. ${missed} defect(s), ${stalls} provider stall(s).`);
  if (missed > 0) {
    console.log('A MISS means a real player sentence produced no tool. An OVER means we recorded something that never happened.');
    process.exit(1);
  }
})();
