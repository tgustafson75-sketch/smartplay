import { buildCaddieRequestBody, CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRelationshipStore } from '../../store/relationshipStore';

/**
 * 2026-08-22 (Tim, after 18 holes) — "we can't have two brain paths and two voice paths… I can feel
 * it going back and forth, and you know it's generic, and then the tone of the voice changes a
 * little bit, and the information's more accurate."
 *
 * Two hand-built payloads to ONE endpoint: voice sent 45 fields, the text box 34, only 20 shared.
 * The mic never sent persona/personaIntensity (the tone) and the text box never sent
 * courseIntelligence/yardageInsight (the accuracy).
 */
describe('one payload, so the caddie cannot change character mid-round', () => {
  it('emits a stable key set', () => {
    expect(CADDIE_REQUEST_KEYS.length).toBeGreaterThan(45);
    const a = Object.keys(buildCaddieRequestBody({ message: 'a', language: 'en' })).sort();
    const b = Object.keys(buildCaddieRequestBody({
      message: 'b', language: 'es', image_base64: 'x', responseMode: 'brief',
    })).sort();
    // Same keys regardless of which surface asked, or what it had to hand.
    expect(a).toEqual(b);
    expect(a).toEqual([...CADDIE_REQUEST_KEYS]);
  });

  it('carries BOTH halves of the old split — tone AND course accuracy', () => {
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' });
    for (const k of ['persona', 'personaIntensity', 'golfer_model_snippet']) {
      expect(k in body).toBe(true);        // the mic used to omit these entirely
    }
    for (const k of ['courseIntelligence', 'yardageInsight', 'dominantMiss', 'physicalLimitation',
                     'mentalState', 'patternInsights', 'watchData', 'topObservations']) {
      expect(k in body).toBe(true);        // the text box used to omit these entirely
    }
  });

  /**
   * The anti-silent-fallback check. Every store read is wrapped in try/catch, so a WRONG module path
   * or field name would quietly return null forever and the payload would look fine while carrying
   * nothing — a worse version of the bug being fixed. Three bad paths and six bad field names were
   * caught exactly this way while writing it.
   */
  it('actually resolves real values from the stores, rather than silently nulling', () => {
    usePlayerProfileStore.setState({ name: 'Tim Gustafson', handicap: 14 } as never);
    useRelationshipStore.setState({ roundsTogether: 7, consecutiveBadHoles: 2 } as never);
    useRoundStore.setState({ currentHole: 5, isRoundActive: true, activeCourse: 'Greenhill' } as never);

    const body = buildCaddieRequestBody({ message: 'hi', language: 'en' });
    expect(body.playerName).toBe('Tim Gustafson');
    expect(body.firstName).toBe('Tim');
    expect(body.handicap).toBe(14);
    expect(body.roundsTogether).toBe(7);
    expect(body.consecutiveBadHoles).toBe(2);
    expect(body.currentHole).toBe(5);
    expect(body.isRoundActive).toBe(true);
    expect(body.activeCourse).toBe('Greenhill');
    expect(body.clientHour).toBeGreaterThanOrEqual(0);
  });

  it('a caller with a better value wins, but cannot invent a key', () => {
    const body = buildCaddieRequestBody({
      message: 'hi', language: 'en',
      overrides: { courseContext: 'REAL COURSE BLOCK', notARealField: 'nope' },
    });
    expect(body.courseContext).toBe('REAL COURSE BLOCK');
    expect('notARealField' in body).toBe(false);
  });

  it('never throws, whatever the stores are doing', () => {
    useRoundStore.setState({ currentHole: null, courseHoles: null } as never);
    expect(() => buildCaddieRequestBody({ message: '', language: 'en' })).not.toThrow();
  });
});

describe('both paths actually USE the one builder', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

  /**
   * A builder nobody calls is the exact bug class this whole session has been about: built, correct,
   * and reached by nothing.
   */
  /**
   * 2026-08-26 — THE SHAPE, NOT A FILE LIST (again).
   *
   * This was a hand-written list of two files, and one of them — hooks/useKevin.ts — had been
   * unreachable since CaddieBottomBar took over the text box on 07-24. So half of "one caddie, one
   * payload" was being proved against code that could not run, while the live typed path was never
   * checked at all. A list you maintain by hand rots exactly where you stop looking.
   *
   * So: DISCOVER every module that POSTs to the brain, and require each to go through the shared
   * builder. A new sender is caught the day it is written, not the day someone re-reads this file.
   */
  const EXEMPT: Record<string, string> = {
    'services/apiBase.ts': 'warmup ping — sends { message: "__ping__" }, not a caddie turn',
    'services/voiceWarmup.ts': 'lambda warmup — POSTs { mode: "warmup" } to a path list, no turn',
    'components/OfflineBanner.tsx': 'reachability probe, no conversation',
    'app/ghost-debug.tsx': 'owner-only debug screen for hand-crafted payloads (DEBUG_ROUTES gate)',
    'app/api-debug.tsx': 'owner-only endpoint prober — fixture payloads by design (DEBUG_ROUTES gate)',
    'services/sceneReadService.ts':
      'DELIBERATE, documented in-file: a multimodal scene read already carries an image plus a ' +
      'large system prompt, and injecting only the current hole halves the effective prompt. The ' +
      'union would work against the reason that payload is shaped the way it is.',
  };

  /** Block and line comments removed — a mention of an endpoint is not a call to it. */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.resolve(__dirname, '../../', dir))) {
      const rel = `${dir}/${e}`;
      const abs = path.resolve(__dirname, '../../', rel);
      if (fs.statSync(abs).isDirectory()) out.push(...walk(rel));
      else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
    }
    return out;
  };

  it('every module that POSTs to the brain goes through the one builder', () => {
    const senders = ['hooks', 'services', 'app', 'components']
      .flatMap(walk)
      // Two things this filter had to learn, both on its first run:
      //   - `/api/kevin` exactly, NOT /api/kevin-read — a different endpoint (Haiku over the last
      //     five rounds' shots, no conversational turn) with its own contract.
      //   - COMMENTS DON'T SEND. courseIntelligenceService only mentions /api/kevin in its header,
      //     to say which field it populates; it POSTs to /api/course-intelligence. Matching raw
      //     source made a doc comment look like a brain sender — the same class of mistake this
      //     suite exists to catch, arrived at from the other direction.
      .filter((f) => /\/api\/kevin(?![-\w])/.test(stripComments(read(f))))
      .filter((f) => !EXEMPT[f]);
    // The discovery itself must keep working — an empty list would pass vacuously.
    expect(senders.length).toBeGreaterThanOrEqual(3);
    for (const f of senders) {
      // Either it builds the union itself, or it delegates to caddieBrain.askCaddie(), which does.
      // Both are "through the one builder"; what is forbidden is hand-assembling a second payload.
      const src = read(f);
      const throughTheBuilder = /buildCaddieRequestBody\(/.test(src) || /askCaddie\(/.test(src);
      expect([f, throughTheBuilder]).toEqual([f, true]);
    }
  });

  /**
   * 2026-08-26 — SPREAD-FIRST IS NOT ENOUGH ON ITS OWN.
   *
   * The union going in first only guarantees every KEY is present. The literal that follows still
   * WINS on value, so a surface can hand-roll a worse answer for a key the builder already
   * resolved — and that is exactly what happened to the one number the whole app turns on.
   *
   * caddieRequestBody resolves the working yardage (stated > live GPS > card) into `currentYardage`.
   * useVoiceCaddie overrode it with the raw store field while separately sending the RESOLVED
   * figure in `yardageInsight`, so the caddie-tab mic sent two different numbers for one shot, and
   * api/kevin's headline "DISTANCE REMAINING RIGHT NOW" line was built from the raw one.
   *
   * Every regression test for this exercises the BUILDER, and every one of them passed throughout.
   * So this asserts the CALL SITE: no spreader may re-declare a key the builder already owns and
   * resolves. Listed explicitly rather than "any key", because a few keys genuinely belong to the
   * caller (forceTier, and the extras the builder documents as caller-supplied).
   */
  it('a spreader never re-declares a key the builder already RESOLVES', () => {
    const OWNED_BY_THE_BUILDER = ['currentYardage', 'yardageInsight', 'unified_context_block'];
    for (const f of ['hooks/useVoiceCaddie.ts']) {
      const src = stripComments(read(f));
      const spread = src.indexOf('...buildCaddieRequestBody(');
      expect(spread).toBeGreaterThan(-1);
      // the object literal that follows the spread, to its closing brace
      let depth = 1;
      let i = spread;
      while (depth > 0 && i < src.length) {
        i += 1;
        if ('({['.includes(src[i])) depth += 1;
        else if (')}]'.includes(src[i])) depth -= 1;
      }
      const literal = src.slice(spread, i);
      for (const key of OWNED_BY_THE_BUILDER) {
        expect([f, key, new RegExp(`^\\s*${key}\\s*[,:]`, 'm').test(literal)]).toEqual([f, key, false]);
      }
    }
  });

  it('a spread-in union is spread FIRST so a path cannot omit a key', () => {
    // Spread-last would let a hand-built literal keep winning with a missing field. Only applies to
    // senders that spread; the ones that pass the builder's result directly cannot express the bug.
    const spreaders = ['hooks/useVoiceCaddie.ts'];
    for (const f of spreaders) {
      const src = read(f);
      const body = src.indexOf('body: JSON.stringify({');
      const spread = src.indexOf('...buildCaddieRequestBody(');
      expect(body).toBeGreaterThan(-1);
      expect(spread).toBeGreaterThan(body);
      const firstField = src.indexOf('\n          message,', spread);
      expect(firstField).toBeGreaterThan(spread);
    }
  });
});

/**
 * 2026-08-24 — ONE WORKING NUMBER: the words and the arithmetic must start from the same yardage.
 *
 * Reproduced live against production BEFORE the fix. Card/GPS 180, player's rangefinder 205, bag
 * containing a 3 iron (198) and a 7 wood (205). The caddie answered:
 *
 *     "Three iron — you've got comfortable margin, smooth swing, trust the carry."
 *
 * Seven yards short, with the confidence attached to a number the player had explicitly corrected.
 *
 * Cause: roundStore.currentYardage is the CARD number (set from holeData.distance on every hole
 * change) and it fed both api/kevin's computed club and the plays-like model, while
 * services/yardageResolver — which ranks a user-stated number above live GPS and the card — reached
 * the brain only as `yardageInsight` and shaped the PROSE. So the prompt said "This is THEIR number"
 * beside a computed-club line, stated as settled arithmetic, that covered a different one. A
 * computed fact stated forcefully flattens everything around it, so the wrong number won.
 */
describe('the club and the words start from the same yardage', () => {
  const seedStated = (value: number, cardYards: number) => {
    useRoundStore.setState({
      isRoundActive: true, currentHole: 4, currentYardage: cardYards,
      userStatedYardage: { value, holeAtCapture: 4, asOf: Date.now(), source: 'rangefinder' },
    } as never);
  };

  it("sends the player's stated number, not the stale card number", () => {
    seedStated(205, 180);
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' });
    expect(body.currentYardage).toBe(205);
  });

  it('the distance the caddie quotes and the one it clubs from are the SAME field', () => {
    seedStated(205, 180);
    const body = buildCaddieRequestBody({ message: 'what should I hit', language: 'en' });
    const insight = body.yardageInsight as { yardage?: number; source?: string } | null;
    expect(insight?.source).toBe('user_stated');
    // The whole defect was these two disagreeing.
    expect(body.currentYardage).toBe(insight?.yardage);
  });

  it('falls back to the card when the player has stated nothing — a strict improvement, not a new source', () => {
    useRoundStore.setState({
      isRoundActive: true, currentHole: 4, currentYardage: 180, userStatedYardage: null,
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentYardage).toBe(180);
  });

  it('ignores a stated number captured on a DIFFERENT hole', () => {
    useRoundStore.setState({
      isRoundActive: true, currentHole: 5, currentYardage: 180,
      userStatedYardage: { value: 205, holeAtCapture: 4, asOf: Date.now(), source: 'rangefinder' },
    } as never);
    // A number spoken on hole 4 is meaningless on hole 5 — the resolver already enforces this.
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentYardage).toBe(180);
  });

  it('ignores a STALE stated number (older than the resolver TTL)', () => {
    useRoundStore.setState({
      isRoundActive: true, currentHole: 4, currentYardage: 180,
      userStatedYardage: { value: 205, holeAtCapture: 4, asOf: Date.now() - 10 * 60 * 1000, source: 'rangefinder' },
    } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).currentYardage).toBe(180);
  });
});
