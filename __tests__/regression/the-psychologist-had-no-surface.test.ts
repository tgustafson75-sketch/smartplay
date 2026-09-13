/**
 * 2026-09-13 (Tim — "Mental must be audited") — THE MENTAL DATA ARRIVED AND THE MENTAL VOICE COULD
 * NOT BE SELECTED.
 *
 * The carried audit item turned out to be half-done, and the done half was the half that already had
 * guards. `mentalState` derivation and `mentalPatterns` evidence both reach the payload and are
 * covered by mental-state-derived.test.ts and the-mental-coach-had-no-evidence.test.ts. What nothing
 * covered was the ROLE.
 *
 * `caddieRequestBody.register` picks the caddie's register from the active surface:
 *
 *     if (s === 'cage' || s === 'swing_library' || s === 'swing_detail') return 'coach';
 *     if (s === 'arena' || s === 'recap') return 'psychologist';
 *     return 'caddie';
 *
 * `ActiveSurface` names eight values. Exactly FOUR were ever registered by a screen — caddie, cage,
 * drill_detail, drill_session. So:
 *
 *   · BOTH psychologist branches were dead. `constants/dialogTemplates/psychologistTemplates` was
 *     authored and unreachable, and the recap — the one screen where a player says "that round got
 *     away from me" — answered in the on-course TACTICAL register, mid-round voice, about a round
 *     that had already finished.
 *   · The coach register worked in Cage Mode and NOWHERE ELSE in SwingLab, because swing_library and
 *     swing_detail were never registered either.
 *
 * `'arena'` is NOT the fix: Tim confirmed it is a v1 leftover parked for 3.0 (TopGolf-at-home built
 * on Cage — see docs/v1.2-deferred.md). That left `'recap'` as the psychologist's one live route.
 *
 * [[smartplay-defect-class-unwired-halves]] [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';
import { precheckLocalIntent } from '../../services/localIntentPrecheck';
import { retrieveKB } from '../../services/knowledgeBase/retrieve';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/** Every value the ActiveSurface union admits, read off the type so it cannot go stale. */
const SURFACES = (() => {
  const src = code('services/activeSurfaceRegistry.ts');
  const block = src.slice(src.indexOf('export type ActiveSurface'), src.indexOf('type SurfaceListener'));
  return [...block.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1]);
})();

/** Every surface any screen actually registers. */
const REGISTERED = (() => {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) {
        for (const m of code(rel).matchAll(/setActiveSurface\('([a-z_]+)'\)/g)) out.add(m[1]);
      }
    }
  };
  walk('app'); walk('components');
  return out;
})();

/**
 * Deliberately dormant, with the decision written down somewhere a reader will find it. A surface may
 * only sit here if a doc explains why — otherwise "parked" is indistinguishable from "forgotten",
 * which is the state all four of these were in this morning.
 */
const PARKED: Record<string, string> = {
  arena: 'docs/v1.2-deferred.md',
  drill_session: 'docs/v1.2-deferred.md',
};

describe('every surface the role resolver branches on is reachable, or parked on purpose', () => {
  it('the union is read from the source and is not empty', () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(8);
    expect(SURFACES).toContain('recap');
    expect(SURFACES).toContain('arena');
  });

  it('no surface is silently unregistered — each one is set by a screen or parked in a doc', () => {
    const orphaned = SURFACES.filter((s) => !REGISTERED.has(s) && !PARKED[s]);
    expect(orphaned).toEqual([]);
  });

  it('Fix G gates on the surface Cage Mode actually registers', () => {
    /**
     * `normalizeKind` gated on 'drill_session' alone, with a comment asserting Cage Mode set it. Cage
     * Mode sets 'cage'. The branch never fired, so a bare "record" in Cage Mode fell through to
     * 'shot' and failed with "you're not in a round yet" — the precise failure Fix G was written to
     * prevent, live again for months behind a comment that explained it away.
     */
    const h = code('services/intents/mediaHandlers.ts');
    expect(h).toMatch(/surface === 'cage' \|\| surface === 'drill_session'/);
    expect(REGISTERED.has('cage')).toBe(true);
  });

  it("a parked surface's reason actually exists and names it", () => {
    for (const [surface, doc] of Object.entries(PARKED)) {
      const text = read(doc);
      expect(text.toLowerCase()).toContain(surface);
      // and it must say what it is waiting for, not merely mention the word
      expect(text).toMatch(/3\.0|deferred|parked/i);
    }
  });

  it('the recap registers its surface — the psychologist\'s one live route', () => {
    const recap = code('app/recap/[round_id].tsx');
    expect(recap).toMatch(/setActiveSurface\('recap'\)/);
    // and releases it conditionally, so a screen focused before this blur is not wiped
    expect(recap).toMatch(/clearActiveSurface\('recap'\)/);
    expect(recap).not.toMatch(/setActiveSurface\(null\)/);
  });

  it('both SwingLab review screens register the coach surface', () => {
    for (const [rel, surface] of [
      ['app/swinglab/library.tsx', 'swing_library'],
      ['app/swinglab/swing/[swing_id].tsx', 'swing_detail'],
    ] as const) {
      const src = code(rel);
      expect(src).toMatch(new RegExp(`setActiveSurface\\('${surface}'\\)`));
      expect(src).toMatch(new RegExp(`clearActiveSurface\\('${surface}'\\)`));
    }
  });

  it('every register the resolver can return is now reachable from some screen', () => {
    /**
     * The property, derived from the resolver itself rather than restated: read the surfaces each
     * branch tests, and require that at least one of them is registered somewhere.
     */
    const resolver = code('services/caddieRequestBody.ts');
    const block = resolver.slice(resolver.indexOf('register: safe('), resolver.indexOf('screen_context'));
    const branches = [...block.matchAll(/if \(([^)]+)\) return '(\w+)';/g)].map(([, cond, role]) => ({
      role,
      surfaces: [...cond.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    }));
    expect(branches.map((b) => b.role).sort()).toEqual(['coach', 'psychologist']);
    for (const b of branches) {
      expect(b.surfaces.some((s) => REGISTERED.has(s))).toBe(true);
    }
  });
});

describe('a player can say the mental thing out loud and be heard', () => {
  const SAYS = [
    "I'm nervous on this tee", 'I keep choking when it matters', 'I choked', 'I lost my confidence',
    'I am tilted', 'I keep getting angry', 'I had a meltdown', "I can't concentrate",
    'I have the yips', 'putting yips', "I'm scared", 'I get tight over short putts',
    'that round got away from me', 'I need to calm down', 'I lose focus',
  ];

  it.each(SAYS)('"%s" is never intercepted before the brain', (u) => {
    expect(precheckLocalIntent(u)).toBeNull();
  });

  it.each(SAYS)('"%s" retrieves mental knowledge, not swing-mechanics noise', (u) => {
    const hits = retrieveKB(u, { max: 3 }) as { id: string; module: string }[];
    const mental = hits.filter((h) => h.module === 'mental_game' || h.module === 'psychology');
    expect(mental.length).toBeGreaterThan(0);
  });

  it('the words players actually use exist SOMEWHERE in the mental modules', () => {
    /**
     * Before today: "choke" appeared in the whole knowledge base only as "choke down" (a grip), and
     * "yips" — the most famous mental affliction in golf — appeared NOWHERE. A curated reference the
     * player cannot reach with their own vocabulary is a reference they do not have.
     */
    const bag = (code('services/knowledgeBase/modules/mentalGame.ts')
      + code('services/knowledgeBase/modules/psychology.ts')).toLowerCase();
    for (const w of ['chok', 'yips', 'tilt', 'angry', 'scared', 'meltdown', 'rattled', 'concentrat', 'confident']) {
      expect(bag).toContain(w);
    }
  });
});

describe('an apostrophe is not a word boundary', () => {
  /**
   * `norm()` replaced every non-alphanumeric with a SPACE, so "can't" became "can t" while an alias
   * spelled `'cant let go of a bad shot'` stayed "cant". 45 curated aliases across the KB could never
   * be matched by a real transcript — Deepgram writes the apostrophe. One of them was
   * `'whats the smart play'`, the app's own tagline.
   */
  const CONTRACTED: [string, string][] = [
    ["I can't let go of a bad shot", 'mental_game'],
    ["I'm so nervous on the first tee", 'mental_game'],
    ["what's a good routine", 'mental_game'],
  ];

  it.each(CONTRACTED)('"%s" reaches its curated entry', (utterance, moduleName) => {
    const hits = retrieveKB(utterance, { max: 3 }) as { module: string }[];
    expect(hits.some((h) => h.module === moduleName)).toBe(true);
  });

  it('the app tagline reaches its course-management entry despite the apostrophe', () => {
    const hits = retrieveKB("what's the smart play", { max: 3 }) as { id: string }[];
    expect(hits.length).toBeGreaterThan(0);
  });

  it('both spellings of a contraction land on the same entries', () => {
    const withApostrophe = (retrieveKB("I can't concentrate", { max: 3 }) as { id: string }[]).map((h) => h.id);
    const without = (retrieveKB('I cant concentrate', { max: 3 }) as { id: string }[]).map((h) => h.id);
    expect(withApostrophe).toEqual(without);
  });

  it('and "i am" folds onto "im", so an alias written either way is reachable', () => {
    const spelled = (retrieveKB('I am tilted', { max: 3 }) as { id: string }[]).map((h) => h.id);
    const contracted = (retrieveKB("I'm tilted", { max: 3 }) as { id: string }[]).map((h) => h.id);
    expect(spelled).toEqual(contracted);
    expect(spelled.length).toBeGreaterThan(0);
  });
});
