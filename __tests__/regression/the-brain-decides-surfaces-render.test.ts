/**
 * 2026-09-11 — THE BRAIN DECIDES. A SURFACE ASKS AND RENDERS.
 *
 * Tim: "Reaching a decision and touching decisions at multiple points are two different things. It
 * all needs to be totally orchestrated by the Caddie's brain."
 *
 * This is the distinction the earlier fix missed. Composing the shot read's inputs in one place made
 * the WIRING correct — every caller got the same facts. It did not change the SHAPE: there were
 * still nine independent places deciding which club to recommend, now merely well-fed. Feeding nine
 * deciders the same facts is not orchestration, it is nine deciders.
 *
 * The codebase already applies the pattern three times — caddieBrain.askCaddie for conversation,
 * smartAnalysisEngine.analyze for analysis, metaCourseIntelligence for the camera fusion. The fourth
 * was missing and it is the one the app is named for: what do I hit, what is the plan, how am I
 * doing against it.
 *
 * THE INVARIANT: a screen may not compute a club, a plays-like number, or a plan. It calls
 * services/caddieDecision.decideShot and draws the answer. A screen that decides is a second caddie,
 * and the player can tell — that is the "generic, then the tone changes, then the information's more
 * accurate" split, in the visual half of the app rather than the spoken one. [[caddie-brain-lens]]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Every screen and component in the shipped app. */
const SURFACES = (() => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(p.slice(2));
    }
  };
  walk('./app'); walk('./components');
  return out;
})();

/**
 * Functions that DECIDE what the player should do. Not "compute a number" — decide.
 * A screen calling one of these has taken the caddie's job.
 */
const DECIDERS = [
  'composeShotRead',      // the club and the plays-like read
  'composeLiveHolePlan',  // the hole, played backwards
  'planHole',
  'composePlayProfile',   // who this golfer is
  'readOverride',         // have they overruled the call
  'bogeyBudgetLine',      // how they stand against the goal
];

describe('the guard is looking at the real app', () => {
  it('found the screens', () => {
    expect(SURFACES.length).toBeGreaterThan(30);
    expect(SURFACES).toContain('app/smartfinder.tsx');
    expect(SURFACES).toContain('app/smartvision.tsx');
    expect(SURFACES).toContain('app/(tabs)/caddie.tsx');
  });

  it('and the brain exists with the one entrypoint', () => {
    const brain = code('services/caddieDecision.ts');
    expect(brain).toMatch(/export function decideShot\(/);
    // it returns the WHOLE decision, not a club — a surface asking for one part still gets one answer
    for (const k of ['shot', 'plan', 'budget', 'profile', 'override', 'cues']) {
      expect(brain).toMatch(new RegExp(`\\b${k}\\s*:`));
    }
  });
});

describe('no screen decides for itself', () => {
  it.each(DECIDERS)('no surface calls %s', (fn) => {
    const offenders = SURFACES.filter((f) => new RegExp(`\\b${fn}\\s*\\(`).test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('the screens that show a club ask the brain for it', () => {
    for (const f of ['app/smartfinder.tsx', 'app/smartvision.tsx']) {
      expect(code(f)).toMatch(/decideShot\(/);
    }
  });

  it('the plan chip is handed a plan — it does not build one', () => {
    const chip = code('components/HolePlanChip.tsx');
    expect(chip).toMatch(/plan: HolePlan \| null/);
    for (const fn of DECIDERS) expect(chip).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
  });
});

describe('one number, not two that agree', () => {
  /**
   * The subtler half of the same rule. A screen recomputing a number the brain already decided will
   * agree — until one of them is fed something the other is not. Every split in this app started
   * exactly there.
   */
  it('the caddie tab strip renders the brain\'s plays-like', () => {
    const t = code('app/(tabs)/caddie.tsx');
    expect(t).toMatch(/decideShot\(\{[\s\S]{0,240}\}\)\.shot\?\.playsLikeYards/);
  });

  it('SmartFinder\'s strategy lines run on the brain\'s plays-like too', () => {
    expect(code('app/smartfinder.tsx'))
      .toMatch(/const effectiveYards = decision\.shot\?\.playsLikeYards/);
  });

  it('the budget is composed once, from the brain\'s own profile', () => {
    // holePlanLive used to build a SECOND play profile just to produce this one line.
    // Matched on the NAME, not on a call: destructuring it and calling it indirectly is the same
    // second profile, and a `composePlayProfile\(` pattern misses that. Found by break-testing.
    expect(code('services/holePlanLive.ts')).not.toMatch(/\bcomposePlayProfile\b/);
    expect(code('services/caddieDecision.ts')).toMatch(/function composeBudget\(profile: PlayProfile \| null\)/);
  });

  it('and the payload takes the profile from the brain rather than composing its own', () => {
    const body = code('services/caddieRequestBody.ts');
    expect(body).not.toMatch(/\bcomposePlayProfile\b/);
    expect(body).toMatch(/const d = decision;/);
    /**
     * And composed ONCE for the whole payload. Four blocks each called decideShot with identical
     * arguments and each rebuilt the entire decision — the club pick, a depth-first walk of the bag
     * for the plan, the profile, and a pass over the round history — on every caddie turn.
     */
    // Exactly ONE invocation in the whole payload builder.
    expect((body.match(/decideShot\(\{/g) || []).length).toBe(1);
  });
});

describe('the caddie says what the screen shows', () => {
  it('the payload asks the same brain the screens ask', () => {
    // If these ever diverge, the spoken answer and the drawn answer are two decisions again.
    expect(code('services/caddieRequestBody.ts')).toMatch(/decideShot\(/);
  });

  it('the offline path asks it too, so no signal does not mean a second caddie', () => {
    expect(code('services/localStatusResponder.ts')).toMatch(/decideShot\(/);
  });
});

describe('the brain is local and cannot be taken down by one missing fact', () => {
  const brain = code('services/caddieDecision.ts');

  it('is synchronous and does no network of its own', () => {
    // It must be callable from a render path, and it must work with no signal. The cloud brain adds
    // language on top of this; it is never the source of the arithmetic.
    expect(brain).not.toMatch(/\bfetch\(|await |async /);
  });

  it('guards each part separately — an unmapped hole costs the plan, not the club', () => {
    expect((brain.match(/safe\(\(\) =>/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it('takes no required argument, so a surface can ask before it knows anything', () => {
    // The runtime proof that every field comes back present is in one-decision-rendered-twice.
    expect(brain).toMatch(/export function decideShot\(known: CallerKnown = \{ rawYards: null \}\)/);
  });
});
