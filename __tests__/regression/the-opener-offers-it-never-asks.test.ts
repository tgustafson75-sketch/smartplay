/**
 * 2026-09-12 (Tim) — THE OPENER NEVER ASKS. IT OFFERS.
 *
 * "Just don't start with a question as a rule. Make it more statement based like 'when you are
 *  ready, I am here to help you practice or take that hard work to the course'."
 *
 * THIS SUPERSEDES the 2026-09-11 design, which is worth stating because that one also came from his
 * own report and it also worked. He had said: "when he greets it often is a question but he doesn't
 * listen for an answer — Pinocchio instead of a real boy." The answer then was to arm the mic so the
 * question got heard, and he liked it ("BTW he answers first time!!!!! Love it").
 *
 * It still fixed the wrong half. A question is a DEMAND: you open the app and the first thing that
 * happens is being asked something. A good caddie opens the door and waits; he does not interview
 * you in the car park. Making it a statement also DELETES the failure mode rather than guarding it —
 * nothing arms the mic, so nothing can be left holding it open, which is exactly what bit on
 * 2026-09-12 when the mic warm-up tore down the session the opener had just started.
 *
 * WHAT SURVIVED UNCHANGED: he still raises ONE real setup gap and never a list, still says nothing
 * to a fully set-up player, still leaves a player alone for a fortnight per gap. Tim asked for that
 * on 2026-09-11 and it stands — only the GRAMMAR changed, from a question to an offer.
 *
 * AND THE TRUST GATE IS STILL GONE. I had required level 2, treating Quiet as "do not ask". Tim:
 * "Logical natural conversation doesn't break L1. It helps it by getting to the point, having the
 * right dialogue — not close and confuse it with an active listening violation."
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

describe('the directive tells him to offer, never to ask', () => {
  it('with no gap: an explicit statement rule, with the shape Tim gave', () => {
    expect(brain).toMatch(/Do NOT ask a question/);
    expect(brain).toMatch(/do not end on a question mark/i);
    expect(brain).toMatch(/when you are ready, I am here to help you practise/i);
  });

  it('with a gap: still ONE thing, in his own words, but framed as an OFFER', () => {
    expect(brain).toMatch(/There is ONE thing worth mentioning/);
    expect(brain).toMatch(/in your own words — never as a script, never as a list/);
    expect(brain).toMatch(/Put it as an OFFER, not a question/);
    expect(brain).toMatch(/must NOT end in a question mark/);
  });

  it('neither branch promises that anything is listening', () => {
    // The 2026-09-11 directive said "the mic opens the moment you stop speaking". Nothing arms it
    // now, so saying so would be a promise the app does not keep.
    expect(brain).not.toMatch(/the mic opens the moment you stop speaking/i);
  });

  it('the willListen flag is gone entirely, not merely unused', () => {
    // A parameter that still exists is one a future caller will pass, expecting it to do something.
    expect(brain).not.toMatch(/willListen/);
  });
});

describe('the caddie tab arms nothing', () => {
  it('does not open the mic from the opener', () => {
    expect(caddie).not.toMatch(/ls\.toggle\(\)/);
    expect(caddie).not.toMatch(/willListen/);
  });

  it('still raises the gap, and still marks it so next launch leaves it alone', () => {
    expect(caddie).toMatch(/liveSetupGap\(\)/);
    expect(caddie).toMatch(/sg\.markGapAsked\(gap\.key\)/);
  });

  it('the gap is NOT gated on the mic any more — an offer needs no microphone', () => {
    /**
     * It used to be gated on the voice_caddie flag, because a gap raised as a QUESTION with the mic
     * dead is the Pinocchio defect. As an offer it is worth saying to a player who only ever types —
     * and those are the players least likely to find the setting on their own.
     */
    const at = caddie.indexOf('liveSetupGap');
    const block = caddie.slice(Math.max(0, at - 600), at);
    expect(block).not.toMatch(/isFlagEnabled\('voice_caddie'\)/);
  });

  it('TRUST LEVEL still does not gate any of it — Tim corrected this once already', () => {
    const at = caddie.indexOf('liveSetupGap');
    const block = caddie.slice(Math.max(0, at - 600), at + 200);
    expect(block).not.toMatch(/getTrustLevel/);
  });
});
