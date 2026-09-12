/**
 * 2026-09-11 (Tim) — "When he greets it often is a question but he doesn't listen for an answer.
 * That will make it Pinocchio instead of a real boy real quick."
 *
 * Then, having tried it: "BTW he answers first time!!!!! Love it." Followed immediately by the
 * correction that mattered more:
 *
 *   "Unless it's logical don't have caddie ask repeatedly questions that could make it unnatural —
 *    stopping the conversation by having to keep telling the caddie you are good and don't need
 *    anything."
 *
 *   "Logical natural conversation doesn't break L1. It helps it by getting to the point, having the
 *    right dialogue — not close and confuse it with an active listening violation."
 *
 * TWO THINGS THIS FILE PINS, and the second one is a design I got wrong first time.
 *
 * 1. He asks only when he has a REASON — one real gap in their setup — never as a habit. A caddie
 *    who opens every launch with "anything I can help with?" is not being friendly, he is making
 *    you decline him.
 * 2. Trust level does NOT gate listening. I had required level 2, treating Quiet as "do not ask".
 *    Trust governs whether he SPEAKS proactively at all; once he has spoken and asked, refusing to
 *    hear the answer is not restraint, it is the same defect in a lower voice.
 */
import fs from 'fs';
import path from 'path';
import { pickSetupGap, suppressedFrom, GAP_COOLDOWN_MS, MIN_ROUNDS_BEFORE_ASKING, type SetupGapKey } from '../../services/setupGaps';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const brain = strip(read('services/conversationalBrain.ts'));
const caddie = strip(read('app/(tabs)/caddie.tsx'));

const world = (over: Partial<Parameters<typeof pickSetupGap>[0]> = {}) => ({
  registeredClubs: 14, measuredClubs: 14, handicapIndex: 17.1, handicapSet: true,
  homeCourse: 'Menifee Lakes', dominantMiss: 'right', distanceControlSet: true,
  roundsPlayed: 12, suppressed: new Set<SetupGapKey>(), ...over,
});

describe('he only asks when there is something worth asking about', () => {
  it('a fully set-up player is asked NOTHING — this is the whole complaint', () => {
    expect(pickSetupGap(world())).toBeNull();
  });

  it('an empty bag is the one he raises first, because it feeds every club call', () => {
    const g = pickSetupGap(world({ registeredClubs: 0, measuredClubs: 0, handicapSet: false, dominantMiss: null }));
    expect(g?.key).toBe('bag');
  });

  it('raises exactly ONE thing — a list of four is a checklist with a voice', () => {
    const g = pickSetupGap(world({
      registeredClubs: 0, measuredClubs: 0, handicapSet: false, handicapIndex: null,
      dominantMiss: null, distanceControlSet: false, homeCourse: null,
    }));
    expect(g).not.toBeNull();
    expect(typeof g!.key).toBe('string');
  });

  it('says nothing to a brand-new player — a form-first onboarding is what this replaces', () => {
    expect(pickSetupGap(world({ registeredClubs: 0, measuredClubs: 0, roundsPlayed: 0 }))).toBeNull();
  });

  it('and nothing once a gap is inside its cooldown — the anti-nag', () => {
    const w = world({ registeredClubs: 0, measuredClubs: 0, suppressed: new Set<SetupGapKey>(['bag']) });
    expect(pickSetupGap(w)?.key).not.toBe('bag');
  });

  it('the cooldown is long enough that ignoring it means being left alone', () => {
    expect(GAP_COOLDOWN_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('a gap raised just now is suppressed; one raised long ago is not', () => {
    const now = 1_757_000_000_000;
    expect(suppressedFrom({ bag: now - 1000 }, now).has('bag')).toBe(true);
    expect(suppressedFrom({ bag: now - GAP_COOLDOWN_MS - 1 }, now).has('bag')).toBe(false);
  });

  it('never throws on junk, because a caddie that cannot decide should simply not ask', () => {
    expect(() => suppressedFrom({} as never)).not.toThrow();
    expect(() => pickSetupGap({ ...world(), suppressed: new Set() })).not.toThrow();
    expect(MIN_ROUNDS_BEFORE_ASKING).toBeGreaterThan(0);
  });
});

describe('the directive matches what will actually happen', () => {
  it('with a gap, he may raise THAT — in his own words, never a script', () => {
    expect(brain).toMatch(/There is ONE thing worth raising/);
    expect(brain).toMatch(/in your own words — never as a script, never as a list/);
    expect(brain).toMatch(/the mic opens the moment you stop speaking/i);
  });

  it('with no gap he is told not to ask AND not to offer help', () => {
    // "Anything I can help with?" is the exact sentence that makes you decline him every launch.
    expect(brain).toMatch(/Do NOT end with a question, and do not offer help/);
    expect(brain).toMatch(/nothing you need from them right now/);
  });

  it('a caller that forgets the flag gets the silent version, not a question', () => {
    expect(brain).toMatch(/opts\?\.willListen === true/);
  });

  it('and a question is only invited when a gap was actually found', () => {
    expect(brain).toMatch(/willListen && opts\?\.gapHint/);
  });
});

describe('and when he does ask, the mic opens', () => {
  it('willListen is gap-driven, not habit-driven', () => {
    expect(caddie).toMatch(/const willListen = micCanOpen && gap != null/);
  });

  it('TRUST LEVEL DOES NOT GATE LISTENING — Tim corrected this', () => {
    /**
     * "Logical natural conversation doesn't break L1." Trust governs whether he speaks proactively;
     * the gates above the opener already settle that. If this reappears, a Quiet player gets asked
     * a question nothing will hear.
     */
    const at = caddie.indexOf('const micCanOpen');
    const block = caddie.slice(at, at + 400);
    expect(block).not.toMatch(/getTrustLevel/);
  });

  it('but the voice kill switch still gates it — that one is not a preference', () => {
    expect(caddie).toMatch(/isFlagEnabled\('voice_caddie'\)/);
  });

  it('opens the mic ONLY when he really ended on a question', () => {
    expect(caddie).toMatch(/willListen && \/\\\?\\s\*\$\/\.test\(r\.text\.trim\(\)\)/);
  });

  it('goes through toggle(), the one chokepoint carrying the guards', () => {
    expect(caddie).toMatch(/ls\.toggle\(\)/);
    expect(caddie).toMatch(/!ls\.isSessionInFlight\(\)/);
  });

  it('never opens over speech already in flight', () => {
    expect(caddie).toMatch(/&& !isSpeaking\(\)/);
  });

  it('marks the gap raised so next launch does not raise it again', () => {
    expect(caddie).toMatch(/sg\.markGapAsked\(gap\.key\)/);
  });

  it('and a listening failure never takes the opener down with it', () => {
    const at = caddie.indexOf('ls.toggle()');
    expect(caddie.slice(at, at + 200)).toMatch(/catch \(e\)/);
  });
});
