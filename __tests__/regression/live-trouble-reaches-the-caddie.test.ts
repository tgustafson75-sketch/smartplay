import { computeHazardIntelligence } from '../../services/hazardIntelligence';
import type { HoleGeometry } from '../../services/courseGeometryService';

/**
 * 2026-08-22 (Tim, after a round at Greenhill) — "generic advice because we're also not reading and
 * using the vision to see what the hole is. It says 'watch out for hazards', not WHERE the hazards
 * are, which is what we spent all last night building."
 *
 * computeHazardIntelligence was extracted from the SmartFinder screen so anything could use it, and
 * then only SmartFinder called it. Playing a round with SmartFinder closed, the caddie had no idea a
 * bunker sat right at 205 — so it said "hit it straight" on a dogleg.
 */
describe('the caddie knows WHERE the trouble is', () => {
  // A bunker ~200y out and clearly RIGHT of the player→green line.
  const player = { lat: 42.3600, lng: -71.7000 };
  const green = { lat: 42.3618, lng: -71.7000 };   // due north
  const bunkerRight = { lat: 42.3616, lng: -71.6994 };

  const geometry = {
    hole: 5,
    tee: player,
    green,
    hazards: [{ label: 'Bunker', location: bunkerRight }],
  } as unknown as HoleGeometry;

  it('a shot playing DUE NORTH still gets a side (bearing 0 is a heading, not a missing value)', () => {
    // `!shotBearingDeg` was a falsy check on a number: bearing 0 collapsed every hazard to 'center',
    // so the caddie could not say "bunker right" on any hole that plays due north.
    const intel = computeHazardIntelligence(player, geometry, null, 0);
    expect(intel!.side).toBe('right');
  });

  it('names a side and a distance rather than "watch out for hazards"', () => {
    const intel = computeHazardIntelligence(player, geometry, null, 0 /* bearing due north */);
    expect(intel).not.toBeNull();
    expect(intel!.side).toBe('right');
    expect(intel!.front).toBeGreaterThan(50);
    expect(Number.isFinite(intel!.front)).toBe(true);
  });

  it('separates REACHING the trouble from CARRYING it — different clubs', () => {
    const intel = computeHazardIntelligence(player, geometry, null, 0);
    expect(intel!.carryToClear).toBeGreaterThanOrEqual(intel!.front);
  });

  it('returns null rather than guessing when there is no geometry or no fix', () => {
    expect(computeHazardIntelligence(null, geometry, null, 0)).toBeNull();
    expect(computeHazardIntelligence(player, null, null, 0)).toBeNull();
  });
});

describe('it reaches the brain through the ONE shared block', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');
  const retrieval = read('services/caddieMemoryRetrieval.ts');

  it('getCaddieContext computes live trouble', () => {
    expect(retrieval).toMatch(/function liveTroubleLine/);
    expect(retrieval).toMatch(/computeHazardIntelligence/);
    expect(retrieval).toMatch(/const trouble = liveTroubleLine\(input\.courseId, input\.hole\)/);
  });

  it('puts the measured fact FIRST, ahead of the learned priors', () => {
    // Everything else in the block is a prior; this is the shot the player is standing over.
    expect(retrieval).toMatch(/lines\.unshift\(trouble\)/);
  });

  it('does not depend on SmartFinder being open — it reads GPS and geometry directly', () => {
    expect(retrieval).toMatch(/gpsManager/);
    expect(retrieval).toMatch(/getHoleGeometry/);
    expect(retrieval).not.toMatch(/smartFinderStore/);
  });

  /**
   * 2026-08-23 — RE-AIMED. This asserted that each brain path calls `getCaddieContext(` itself,
   * which pinned the SPELLING of a call rather than the property that matters. When the five
   * hand-built payloads were collapsed onto services/caddieRequestBody, the paths stopped calling
   * it directly — because the ONE builder now does, once — and this guard went red on the fix.
   *
   * That is the failure mode the 08-22 handoff called out: five separate times a guard asserted the
   * exact behaviour that had to change. The property is "every brain path reaches the block", and a
   * path satisfies it either by composing the block itself or by going through the builder that
   * does. Written that way it still fails for the thing it was built to catch — a NEW brain path
   * that reaches neither.
   */
  it('every brain path reaches this block — directly, or through the one payload builder', () => {
    const builder = read('services/caddieRequestBody.ts');
    expect(builder).toMatch(/getCaddieContext\(/);
    expect(builder).toMatch(/mergeMemoryIntoContext\(/);

    // 2026-08-26 — hooks/useKevin.ts left this list when it left the app: it was the OLD typed-chat
    // path, superseded by CaddieBottomBar on 07-24, and had had no caller for a month. Its stand-in
    // is the surface that actually carries typed questions now — listeningSession, which is also
    // where the watch and hands-free land.
    for (const f of [
      'hooks/useVoiceCaddie.ts',
      'services/listeningSession.ts',
      'services/conversationalBrain.ts',
      'services/intents/inRoundDiagnosticHandler.ts',
      'hooks/usePipecatVoice.ts',
    ]) {
      const src = read(f);
      const composesItself = /getCaddieContext\(/.test(src);
      const usesTheBuilder = /buildCaddieRequestBody\(|askCaddie\(/.test(src);
      expect(composesItself || usesTheBuilder).toBe(true);
    }
  });

  /**
   * THE SHAPE, NOT A FILE LIST.
   *
   * 2026-08-23 — the split Tim kept hearing ("I can feel it going back and forth… it's generic, and
   * then the tone of the voice changes a little bit") was never a flaky model. It was TEN
   * hand-assembled payloads to one brain, each one a different subset of what the app knows, so
   * which caddie he got depended on which surface he asked from. The two hands-free ones — the
   * earbud and the caddie tab — were among the thinnest, and the app's OPENING LINE was the
   * thinnest of all.
   *
   * A file allowlist would not have caught any of them; every one of those files was already
   * "known". So this guards the SHAPE: if a file POSTs a JSON body to /api/kevin, that body must be
   * assembled by the ONE builder. It goes red for a new payload written in a file that already
   * exists — which is exactly how all ten got there. [[no-half-fixes-enforce-every-surface]]
   */
  it('every payload to the brain is assembled by the ONE builder', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.resolve(__dirname, '../../', dir), { withFileTypes: true })
      .flatMap((e) => e.isDirectory()
        ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`))
        : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);

    /**
     * ONE reasoned exception, stated rather than hidden. services/sceneReadService sends a 60-second
     * MULTIMODAL read: an image plus a large system prompt. Its own comment explains that injecting
     * only the current hole "halves the effective prompt size", which is a deliberate trade for that
     * request shape, not an oversight — and unlike the presence path it reads the reply correctly
     * and genuinely works today. If a second exception ever wants to be added, that is the moment to
     * ask whether the rule or the code is wrong.
     */
    const REASONED_EXCEPTIONS = ['services/sceneReadService.ts'];

    /** The span of a `fetch(...)` call: from the paren to its match, so a 200-line body is inside it. */
    const fetchCall = (src: string, from: number): string => {
      let depth = 0;
      for (let i = from; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(from, i + 1); }
      }
      return src.slice(from, from + 4000);
    };

    const offenders: string[] = [];
    for (const f of ['services', 'hooks', 'app', 'components'].flatMap(walk)) {
      if (REASONED_EXCEPTIONS.includes(f)) continue;
      const src = read(f);

      /**
       * Look at the actual CALL SITE, not the file. A file that mentions /api/kevin in a comment
       * while JSON.stringify-ing a body for some other endpoint is not a brain payload — matching
       * at file granularity flagged six innocent files on the first run.
       */
      for (const m of src.matchAll(/fetch\(/g)) {
        const at = m.index ?? 0;
        const call = fetchCall(src, at + 'fetch'.length);
        // `/api/kevin-read` is a different endpoint with its own contract — require a boundary.
        if (!/\/api\/kevin(?![\w-])/.test(call)) continue;
        if (!/JSON\.stringify/.test(call)) continue;
        // A literal {message:'__ping__'} probe proves the Lambda is awake; it is not a turn.
        if (/__ping__/.test(call)) continue;
        // Owner-only debug screens exist to fire deliberately hand-shaped bodies at the API.
        if (/^app\/(api-debug|ghost-debug)\.tsx$/.test(f)) continue;
        // The body may be built into a variable just above the fetch rather than inline, so look
        // back as well as in. Bounded, so it cannot borrow proof from an unrelated call far above.
        const context = src.slice(Math.max(0, at - 1200), at) + call;
        if (/buildCaddieRequestBody|askCaddie/.test(context)) continue;
        offenders.push(`${f} :: ${call.slice(0, 60).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
