/**
 * DOES EACH SIGNAL ACTUALLY CHANGE THE ANSWER? — the cycling quality engine.
 *
 * 2026-08-23. Tim: "You're coming up with these major radical fixes too fast where I almost know
 * they're not completely done… we should be looking at this deeply and surgically and saying, is it
 * according to plan? Yes/No. Does it work for the app? Does everything work together? Yes/No. Just a
 * total cycling quality engine, because there's nothing else to build. It's just to fix everything
 * to be right."
 *
 * He is describing the gap that weather fell through. Weather was wired to the brain, deployed, and
 * verified live — asked directly the caddie said "14 gusting 22 out of the west, take an extra club
 * and swing easier." Perfect. And on the actual CLUB CALL, in 48F rain with 14mph gusting 22, it
 * still said "Smooth 7" — one or two clubs light. Wrong advice, delivered confidently, from a signal
 * that was present, understood, and ignored, because the answer doctrine never gave it permission to
 * change the club.
 *
 * Every check that existed would have passed:
 *     tsc / jest / sim   — is it wired?          yes.
 *     payload contract   — does it arrive?       yes.
 *     probe-tools        — does the tool fire?   yes.
 *     ask it directly    — does it understand?   yes.
 *     THIS               — does the ANSWER MOVE? no.
 *
 * So this asks the only question that matters for a signal: put the SAME question to the caddie with
 * and without it, and see whether what he says actually changes. A signal that never moves the answer
 * is decoration, however cleanly it is plumbed.
 *
 *     npx tsx scripts/probe-signal-influence.ts
 *     npx tsx scripts/probe-signal-influence.ts --only=weather
 *
 * IGNORED is not automatically a bug — some signals are meant to be quiet most of the time. Read it
 * as "this signal did not change the caddie's answer for a thing a real player would say", then go
 * and look. That is the same contract as probe-brain-tools, one layer in.
 */
const BASE = process.env.PROBE_API ?? 'https://api.smartplaycaddie.com';
const only = (process.argv.find(a => a.startsWith('--only=')) ?? '').split('=')[1] ?? null;
/**
 * A single sample is not evidence. An LLM answer varies run to run, so one probe can score a
 * working signal IGNORED or a broken one INFLUENCES, and either way the verdict gets acted on.
 * --repeat=N runs each case N times and reports k/N, so a flake reads as a flake.
 */
const repeat = Math.max(1, Number((process.argv.find(a => a.startsWith('--repeat=')) ?? '').split('=')[1]) || 1);

/** Shared on-course footing so every case differs ONLY by the signal under test. */
const ON_COURSE: Record<string, unknown> = {
  firstName: 'Tim', handicap: 14, persona: 'kevin',
  isRoundActive: true, currentHole: 9, currentPar: 4, currentYardage: 150,
  activeCourse: 'Greenhill', skip_tts: true,
};

type Case = {
  signal: string;
  ask: string;
  /** The signal, as it appears in the payload. */
  on: Record<string, unknown>;
  /** What the answer must show when the signal is present. */
  shows: RegExp;
  /**
   * What must NOT appear once the signal is present. Some signals prove themselves by what they
   * REMOVE — a beginner should stop hearing "clubface path" jargon — and a `shows` pattern cannot
   * express that. Without this, the experienceContext case used /.+/ and could never fail.
   */
  absent?: RegExp;
  /** Why this signal is supposed to change the answer at all. */
  because: string;
  extra?: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    signal: 'weather', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150, '6 iron': 162, '5 iron': 172, '4 iron': 181 } },
    // 2026-08-23 — this case sent no bearing and no plays-like, so the caddie could not know the wind
    // was INTO him, and the case demanded a two-club change that only a headwind justifies. It was
    // asking him to guess and then failing him for guessing wrong — which is why it read 0/3, 2/3,
    // 0/3, 2/3 across four runs. On the course the hole IS mapped, so send what the client actually
    // sends: the decomposed wind and the computed playing number.
    on: { weather: {
      tempF: 46, windMph: 16, windFromDeg: 270, gustMph: 24, conditions: 'Rain',
      description: 'light rain', ageMin: 3,
      relative: { alongMph: -16, crossMph: 0, kind: 'into', phrase: '16 into your face' },
      playsLike: { actualYds: 150, playsLikeYds: 176, deltaYds: 26, fromWind: 24, fromTemp: 2, fromWet: 3 },
    } },
    // Was satisfied by the WORD "wind" or "rain". The caddie passed by SAYING "you're into 16mph
    // and wet — smooth seven", which is an acknowledgement with no consequence and still the wrong
    // club. Conditions have to move the CLUB, so only a club change counts.
    // 150 playing 176 is the 4 iron in this bag (172 is the 5). Accept either long iron or explicit
    // club-up language — what must NOT survive is "smooth 7", the club for a number that is not real.
    shows: /\b(4|four|5|five|6|six)[- ]?iron\b|club up|one more club|two more club|extra club/i,
    absent: /\b(7|seven)[- ]?iron\b|smooth (7|seven)\b/i,
    because: 'cold + wet + 16mph into is one to two clubs; naming the wind and still saying "smooth 7" is wrong advice',
  },
  {
    signal: 'hazards (unified_context_block)', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { unified_context_block: 'TROUBLE ON THIS SHOT (measured live from GPS + this hole mapped geometry): Bunker on the right, 130y to reach, 145y to carry it. Safe miss: left-center.' },
    shows: /bunker|sand|left[- ]?cent|carry/i,
    because: 'computer vision measured the carry; the answer should be anchored to it, not to a number',
  },
  {
    signal: 'clubDistances', ask: 'what should I hit here?',
    // Deliberately NOT a standard bag: he only carries 135 in a 7 iron, so 150 is a 5. A generic
    // "150 is a 7 iron" answer then proves the bag was ignored, which the old standard bag could
    // not distinguish — it scored UNPROVEN because the generic answer and the right answer matched.
    on: { clubDistances: { '7 iron': 135, '6 iron': 143, '5 iron': 151, '4 iron': 160 } },
    shows: /\b(5|five)[- ]?iron\b/i,
    absent: /\b(7|seven)[- ]?iron\b/i,
    because: 'the club named must come from HIS carries; at 150 a 135-yard 7 iron is two clubs short',
  },
  {
    signal: 'dominantMiss / missType', ask: 'what should I hit and where do I aim?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { dominantMiss: 'right', missType: 'slice' },
    // Was /right|.../ and "you're RIGHT at your number" matched it — the no-signal answer scored as
    // proof. Require the miss to be USED: an aim shift, or naming his shape.
    // Third rewrite. It scored a textbook answer a failure: "aim at the left edge of the green —
    // your natural miss runs right so give yourself room" moved the target AND named the miss, and
    // matched nothing, because the pattern demanded "aim left" adjacent and "your miss" exactly.
    // Match the SHAPE of a correct answer — the aim moved left, or the miss was named — not one
    // phrasing of it. The no-signal answer ("150 carries you right to the flag") still fails it.
    shows: /aim(?:ing)?[^.]{0,24}\bleft\b|left[- ](edge|side|half|cent)|favou?r[^.]{0,14}\bleft\b|your (natural )?(miss|slice|fade)\b/i,
    because: 'the aim point should allow for HIS miss, not a neutral target',
  },
  {
    signal: 'handedness (left)',
    // Two earlier versions of this case never forced a DIRECTION out of him — a greenside chip is
    // answered with a club and a landing spot, so handedness had nothing to invert and the case
    // could not fail. A slice is the clean mirror: a right-hander's curves away to the RIGHT and he
    // aims left to allow for it; a left-hander's curves to the LEFT, so he must aim RIGHT. Same
    // sentence, opposite answer, and getting it backwards sends the ball further into trouble.
    ask: "I've been slicing it all day — where should I aim off this tee?",
    on: { handedness: 'left' },
    // A left-hander's slice curves to the LEFT, so he aims RIGHT of target. The right-handed
    // default answer — "aim left" — is the exact wrong advice for him, which is why `absent` has to
    // carry half this test: a mirrored call is only correct if the unmirrored one is gone.
    shows: /aim(?:ing)? right|start it right|right (side|edge|half)|favou?r(?:ing)? the right|right of (the )?(target|centre|center|fairway)/i,
    absent: /aim(?:ing)? left|start it left|left (side|edge|half)|favou?r(?:ing)? the left/i,
    because: 'every directional call inverts for a lefty; aiming him left doubles his miss',
  },
  {
    signal: 'currentLocationType (green)', ask: 'what should I hit?',
    on: { currentLocationType: 'green', currentYardage: 18 },
    shows: /putt|roll|stroke|pace|line/i,
    because: 'on the green the answer is a putt read, not a club',
  },
  {
    signal: 'currentStroke',
    // Was "what is the play here?" — at 150 yards the honest answer is a club either way, so the
    // stroke count could not show up and the case tested nothing. Ask the question that needs it.
    ask: 'where do I stand on this hole?',
    on: { currentStroke: 3 },
    // Same failure: "Stroke 3, 150 yards out — smooth 8 iron" is precisely the awareness under test
    // and matched nothing, because the pattern only knew the word "third". The no-signal answer
    // ("150 yards out, par 4, hole 9 — you're on the tee") still fails it, which is the whole point.
    shows: /\bthird\b|\b3rd\b|stroke\s*(3|three)\b|lying (two|2|three|3)|playing your (third|3rd)|two shots? (in|already)/i,
    because: 'he is about to play his third; a caddie who does not know that briefs the hole off the tee',
  },
  {
    signal: 'roundStats', ask: 'how am I doing today?',
    on: { roundStats: { holesPlayed: 8, putts: 19, puttsPerHole: 2.4, threePutts: 3, gir: '2/8', fairways: '3/8', penalties: 1, lastThreeHoles: [{ hole: 6, score: 6, putts: 3 }, { hole: 7, score: 5, putts: 2 }, { hole: 8, score: 6, putts: 3 }] } },
    shows: /putt|three[- ]?putt|3[- ]?putt|green|fairway/i,
    because: 'the caddie should read HOW the round is going, not just the score',
  },
  {
    signal: 'yardageInsight (static_card)', ask: 'exactly how far do I have?',
    on: { yardageInsight: { yardage: 150, source: 'static_card', confidence: 'low', reason: 'GPS soft' } },
    shows: /card|not.*(live|exact)|rough|about|soft|hedge|scorecard|reacquir/i,
    because: 'a card number must not be delivered as a measured one',
  },
  {
    signal: 'gpsLost', ask: 'how far am I?',
    on: { gpsLost: true, currentYardage: null },
    // Was /reacquir|signal|one sec/ with "the caddie owns the number; it must never hand the question
    // back to the player" — which asserts the opposite of how a real caddie behaves, and of what Tim
    // asked for: when he genuinely does not know, he ASKS for the one thing he needs. He answered
    // "no GPS lock and I don't have Greenhill's card data loaded — if you have a marker, give me the
    // number", which is exactly right, and the case scored it a defect. The only thing that actually
    // matters here is that he does NOT invent a yardage, so that is what `absent` tests.
    // FOURTH rewrite, and the third correct answer this case has failed. "No course data on file
    // for Greenhill, so I can't pull a static card number either — I'm working blind until GPS
    // locks" is exactly the behaviour Tim asked for, and no phrase list was ever going to cover the
    // number of ways a person says "I don't know". For THIS signal the effect IS the absence: with
    // no fix he must not state a yardage, and without the signal he does. The whole assertion lives
    // in `absent`, deliberately, and `shows` only requires that he said something at all.
    shows: /\S/,
    absent: /\b\d{2,3}\s*(yards|yds)\b/i,
    because: 'with no fix he must say so and may ask for a marker — what he must never do is state a number he does not have',
  },
  {
    signal: 'distanceFromTeeYds', ask: 'what have I got left?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { distanceFromTeeYds: 268 },
    shows: /268|drive|hit that|off the tee|you'?re out/i,
    because: 'Tim asked for the drive confirmed first, then the remaining, then the play',
  },
  {
    signal: 'priorRoundsAtCourse (first visit)',
    // Was "how did I do?", which is answered from the scorecard alone — the first-visit fact had no
    // reason to appear. Ask the comparison question, which cannot be answered without it.
    ask: 'is that a good score for me at this course?',
    // scores moved to `extra` — they were in `on`, so the two payloads differed by TWO things and
    // the verdict was unattributable. A differential probe is only valid if ONE thing changes.
    extra: { scores: { 1: 5, 2: 4, 3: 6, 4: 5, 5: 7, 6: 4, 7: 5, 8: 6, 9: 5 } },
    on: { priorRoundsAtCourse: 0 },
    shows: /first time|baseline|first (round|look)|starting point|never played|no history|nothing to compare/i,
    because: 'a first round is a baseline, never "your best score yet"',
  },
  {
    signal: 'experienceContext (starting)', ask: 'why am I slicing my driver?',
    on: { experienceContext: 'starting' },
    // The old pattern was /.+/ — it matched any answer, so this case could never fail. A beginner
    // proves itself by what is ABSENT: no path/face-angle vocabulary, no swing-plane mechanics.
    shows: /\b(grip|aim|swing|ball|hands|shoulders|open|closed|left|right)\b/i,
    absent: /clubface (is )?open to|swing path|face angle|attack angle|over[- ]the[- ]top|steep|shallow/i,
    because: 'a beginner needs plain words and one idea, not path-and-face mechanics',
  },
  {
    signal: 'physicalLimitation', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150, '6 iron': 162 } },
    on: { physicalLimitation: 'bad lower back, limited turn today' },
    // "smooth" alone used to pass this, and the answer never mentioned his back — a false PASS.
    shows: /\bback\b|limited turn|club up|more club|\b(6|six)[- ]?iron\b|easier on|protect/i,
    because: 'a bad back changes the CLUB, not just the encouragement',
  },
  {
    signal: 'club_tendencies', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { club_tendencies: ['7 iron: reliable baby fade, carries 150', 'driver: two-way miss, unreliable'] },
    shows: /fade|shape|reliab|your 7|works? right/i,
    because: 'the caddie should know a club has a character, not just a number',
  },
  {
    // 2026-08-24, second fix — at 210 the margin was 25 yards, which is a GO for anybody, so the
    // posture correctly changed nothing and the case proved nothing. Posture only earns its keep on
    // a MARGINAL shot. 225 leaves 10 yards: a fair gamble if you asked to be aggressive, a lay-up
    // if you asked to be safe.
    signal: 'riskMode (aggressive)', ask: 'I have 225 over water to a back pin, go or lay up?',
    // 235 of 3 wood to a 210 carry is a genuine choice. At 215 it was a stretch for ANY posture,
    // so both answers said lay up and the case could not isolate the posture.
    // 2026-08-24 — currentYardage stayed at the base 150 while the question asked about a 210 carry,
    // so every computed fact the caddie was handed (club, margin) described a DIFFERENT shot than
    // the one being asked about. Of course the posture could not move the answer.
    extra: { currentYardage: 225, clubDistances: { '3 wood': 235, '5 iron': 185, '7 iron': 150 } },
    on: { riskMode: 'aggressive' },
    // "3 wood" appeared in the LAY-UP answer too ("your 3-wood carries 235, but…"), so naming the
    // club proved nothing. The decision is the test: he must actually send them.
    shows: /\bgo for it\b|\bthat'?s a go\b|take it on|send it|have a go|going\b|go get it/i,
    absent: /lay ?up|lay it up|zero margin|no margin/i,
    because: 'risk posture must reach the cloud caddie, not just the on-device read',
  },
  {
    signal: 'nineHoleMode', ask: 'how many holes do I have left?',
    // "how much have I got left" was read as YARDAGE. Ask the question actually under test.
    on: { nineHoleMode: true, currentHole: 5 },
    // Was /four|4|nine[- ]?hole|.../ — "Nine holes left" is the WRONG answer and it MATCHED.
    // A pattern the failure satisfies cannot test anything.
    shows: /\bfour\b|\b4\b(?!\d)/i,
    absent: /\b(nine|13|14|thirteen|fourteen)\s+holes?\s+(left|to go|remaining)/i,
    because: 'a nine-hole round is a different shape; "halfway" is wrong at hole 5 of 9',
  },
  {
    signal: 'priorGreenRead', ask: 'how does this putt break?',
    on: { currentLocationType: 'green', currentYardage: 20, priorGreenRead: { feet: 18, slopePct: 2.5, note: 'died left low side' } },
    shows: /last time|before|remember|previous|left|died/i,
    because: 'a saved read from a prior visit is real recall, not a guess',
  },
];

/**
 * One transient connect timeout used to abort the entire run and throw away every verdict already
 * earned — a quality harness that a single network blip can silence is not a quality harness.
 * Retry the sample; if it still will not answer, return a sentinel that no `shows` pattern matches
 * so the case reads as unproven rather than silently passing.
 */
const say = async (body: Record<string, unknown>): Promise<string> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/kevin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return `__HTTP_${res.status}__`;
      const j = await res.json() as { text?: string };
      return (j.text ?? '').trim();
    } catch (e) {
      if (attempt === 2) return `__NETWORK_FAILED__ ${String((e as Error)?.message ?? e)}`;
      await new Promise(r => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
  return '__NETWORK_FAILED__';
};

async function main() {
  const cases = only ? CASES.filter(c => c.signal.toLowerCase().includes(only.toLowerCase())) : CASES;
  console.log(`\nDoes each signal CHANGE THE ANSWER? — ${BASE}\n`);
  let ignored = 0;
  let inconclusive = 0;

  for (const c of cases) {
    const base = { ...ON_COURSE, ...(c.extra ?? {}), message: c.ask };
    const withSignal = { ...base, ...c.on };

    let movedN = 0, alsoWithoutN = 0, lostN = 0;
    let lastOn = '', lastOff = '', firstMissOn = '', firstMissOff = '';
    for (let i = 0; i < repeat; i++) {
      const [off, on] = await Promise.all([say(base), say(withSignal)]);
      lastOn = on; lastOff = off;
      // A sample the network ate is not evidence about the caddie. Counting it as IGNORED reads as
      // "the signal made no difference" and sends you looking for a defect that is not there —
      // which is exactly what it did on its first run.
      if (on.startsWith('__NETWORK_FAILED__') || off.startsWith('__NETWORK_FAILED__')) { lostN++; continue; }
      const m = c.shows.test(on) && (!c.absent || !c.absent.test(on));
      const a = c.shows.test(off) && (!c.absent || !c.absent.test(off));
      if (m) movedN++; else if (!firstMissOn) { firstMissOn = on; firstMissOff = off; }
      if (a) alsoWithoutN++;
    }

    // Majority, not unanimity: a caddie who allows for the miss 2 times in 3 is using the signal.
    // Anything that only lands sometimes is FLAKY — worth knowing, and different from IGNORED.
    const usable = repeat - lostN;
    const moved = usable > 0 && movedN * 2 > usable;
    const alsoWithout = usable > 0 && alsoWithoutN * 2 > usable;
    const flaky = moved && movedN < usable;
    const tag = usable === 0 ? 'NO SIGNAL' : !moved ? 'IGNORED' : alsoWithout ? 'UNPROVEN' : flaky ? 'FLAKY' : 'INFLUENCES';
    if (usable > 0 && !moved) ignored++;
    if (usable === 0) inconclusive++;

    const rate = usable === 0 ? ` (${lostN} lost)` : repeat > 1 ? ` ${movedN}/${usable}${lostN ? ` +${lostN} lost` : ''}` : '';
    console.log(`[${tag.padEnd(10)}]${rate} ${c.signal}`);
    console.log(`             ask:  "${c.ask}"`);
    console.log(`             with: ${(moved ? lastOn : firstMissOn || lastOn).slice(0, 150)}`);
    if (!moved || alsoWithout || flaky) {
      console.log(`             w/o:  ${(moved ? lastOff : firstMissOff || lastOff).slice(0, 150)}`);
      console.log(`             why it should matter: ${c.because}`);
    }
    console.log();
  }

  console.log(`${cases.length - ignored - inconclusive}/${cases.length - inconclusive} signals changed the caddie's answer.` +
    (inconclusive ? `  (${inconclusive} could not be judged — the network ate every sample.)` : ''));
  console.log('IGNORED  = present, plumbed, and made no difference to what he said — the weather failure mode.');
  console.log('UNPROVEN = the answer matched even WITHOUT the signal, so this case does not prove influence.');
  if (ignored > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
