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
  /** Why this signal is supposed to change the answer at all. */
  because: string;
  extra?: Record<string, unknown>;
};

const CASES: Case[] = [
  {
    signal: 'weather', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150, '6 iron': 162, '5 iron': 172 } },
    on: { weather: { tempF: 46, windMph: 16, windFromDeg: 270, gustMph: 24, conditions: 'Rain', description: 'light rain', ageMin: 3 } },
    shows: /\b(6|six|5|five)[- ]?(iron)?\b|wind|rain|wet|cold|extra club|more club/i,
    because: 'cold + wet + 16mph is one to two clubs; a bare "smooth 7" there is wrong advice',
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
    on: { clubDistances: { '7 iron': 150, '8 iron': 138, '6 iron': 163 } },
    shows: /\b(7|seven)[- ]?iron\b/i,
    because: 'his real bag, so the club named is HIS club and not a generic one',
  },
  {
    signal: 'dominantMiss / missType', ask: 'what should I hit and where do I aim?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { dominantMiss: 'right', missType: 'slice' },
    shows: /right|slice|left[- ]?cent|favou?r/i,
    because: 'the aim point should allow for HIS miss, not a neutral target',
  },
  {
    signal: 'handedness (left)', ask: 'my ball is short right of the green, how do I play it?',
    on: { handedness: 'left' },
    shows: /left|mirror|opposite|your side/i,
    because: 'every directional call inverts for a lefty; this reached NO brain before today',
  },
  {
    signal: 'currentLocationType (green)', ask: 'what should I hit?',
    on: { currentLocationType: 'green', currentYardage: 18 },
    shows: /putt|roll|stroke|pace|line/i,
    because: 'on the green the answer is a putt read, not a club',
  },
  {
    signal: 'currentStroke', ask: 'what is the play here?',
    on: { currentStroke: 3 },
    shows: /third|3rd|already|lying|from here|next/i,
    because: 'on stroke 3 he must not get a tee briefing off the card',
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
    shows: /reacquir|picking.*(up|back)|signal|getting.*back|one sec/i,
    because: 'the caddie owns the number; it must never hand the question back to the player',
  },
  {
    signal: 'distanceFromTeeYds', ask: 'what have I got left?',
    extra: { clubDistances: { '7 iron': 150 } },
    on: { distanceFromTeeYds: 268 },
    shows: /268|drive|hit that|off the tee|you'?re out/i,
    because: 'Tim asked for the drive confirmed first, then the remaining, then the play',
  },
  {
    signal: 'priorRoundsAtCourse (first visit)', ask: 'I just finished, how did I do?',
    on: { priorRoundsAtCourse: 0, scores: { 1: 5, 2: 4, 3: 6 } },
    shows: /first time|baseline|first round|starting point|never played/i,
    because: 'a first round is a baseline, never "your best score yet"',
  },
  {
    signal: 'experienceContext (starting)', ask: 'why am I slicing my driver?',
    on: { experienceContext: 'starting' },
    shows: /.+/,
    because: 'a beginner needs plain words and one idea, not mechanics',
  },
  {
    signal: 'physicalLimitation', ask: 'what should I hit here?',
    extra: { clubDistances: { '7 iron': 150, '6 iron': 162 } },
    on: { physicalLimitation: 'bad lower back, limited turn today' },
    shows: /back|easier|smooth|comfortable|turn|club up|more club/i,
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
    signal: 'riskMode (aggressive)', ask: 'I have 210 over water to a back pin, go or lay up?',
    extra: { clubDistances: { '3 wood': 215, '7 iron': 150 } },
    on: { riskMode: 'aggressive' },
    shows: /go|send|take it on|have a go|3 wood|three wood/i,
    because: 'risk posture must reach the cloud caddie, not just the on-device read',
  },
  {
    signal: 'nineHoleMode', ask: 'how much have I got left?',
    on: { nineHoleMode: true, currentHole: 5 },
    shows: /four|4|nine|9|back nine|half/i,
    because: 'a nine-hole round is a different shape; "halfway" is wrong at hole 5 of 9',
  },
  {
    signal: 'priorGreenRead', ask: 'how does this putt break?',
    on: { currentLocationType: 'green', currentYardage: 20, priorGreenRead: { feet: 18, slopePct: 2.5, note: 'died left low side' } },
    shows: /last time|before|remember|previous|left|died/i,
    because: 'a saved read from a prior visit is real recall, not a guess',
  },
];

const say = async (body: Record<string, unknown>): Promise<string> => {
  const res = await fetch(`${BASE}/api/kevin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return `__HTTP_${res.status}__`;
  const j = await res.json() as { text?: string };
  return (j.text ?? '').trim();
};

async function main() {
  const cases = only ? CASES.filter(c => c.signal.toLowerCase().includes(only.toLowerCase())) : CASES;
  console.log(`\nDoes each signal CHANGE THE ANSWER? — ${BASE}\n`);
  let ignored = 0;

  for (const c of cases) {
    const base = { ...ON_COURSE, ...(c.extra ?? {}), message: c.ask };
    const withSignal = { ...base, ...c.on };
    const [off, on] = await Promise.all([say(base), say(withSignal)]);

    const moved = c.shows.test(on);
    const alsoWithout = c.shows.test(off);
    const tag = !moved ? 'IGNORED' : alsoWithout ? 'UNPROVEN' : 'INFLUENCES';
    if (!moved) ignored++;

    console.log(`[${tag.padEnd(10)}] ${c.signal}`);
    console.log(`             ask:  "${c.ask}"`);
    console.log(`             with: ${on.slice(0, 150)}`);
    if (!moved || alsoWithout) {
      console.log(`             w/o:  ${off.slice(0, 150)}`);
      console.log(`             why it should matter: ${c.because}`);
    }
    console.log();
  }

  console.log(`${cases.length - ignored}/${cases.length} signals changed the caddie's answer.`);
  console.log('IGNORED  = present, plumbed, and made no difference to what he said — the weather failure mode.');
  console.log('UNPROVEN = the answer matched even WITHOUT the signal, so this case does not prove influence.');
  if (ignored > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
