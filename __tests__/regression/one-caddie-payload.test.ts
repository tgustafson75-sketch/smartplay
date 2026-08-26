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

  /**
   * 2026-08-26 — THE KEYS useVoiceCaddie USED TO OWN.
   *
   * When that hook's 58-key literal was collapsed into this builder, the risk was not a crash — it
   * was a SILENT NULL: the builder emits every key always, so a derivation that quietly resolved to
   * null would look identical to a field the player simply hasn't filled in. These are the values
   * the mic path used to compute for itself, asserted against seeded stores so a regression shows
   * up as a failing test rather than as a caddie that has stopped noticing things.
   */
  it('resolves the fields the mic path used to derive for itself', () => {
    usePlayerProfileStore.setState({
      dominantMiss: 'right', goal: 'Break 90', physicalLimitation: 'bad back', personalBest: 84,
    } as never);
    useRelationshipStore.setState({ currentMentalState: 'frustrated', sessionsTogether: 3 } as never);
    useRoundStore.setState({
      isCompetition: true, mode: 'break_90', scores: { 1: 5 },
      holeNotes: { 3: 'wind swirls here' }, isSimRound: true,
    } as never);

    const body = buildCaddieRequestBody({ message: 'what club', language: 'en' }) as Record<string, unknown>;
    expect(body.dominantMiss).toBe('right');
    expect(body.goal).toBe('Break 90');
    expect(body.physicalLimitation).toBe('bad back');
    expect(body.personalBest).toBe(84);
    expect(body.mentalState).toBe('frustrated');
    expect(body.sessionsTogether).toBe(3);
    expect(body.isCompetition).toBe(true);
    expect(body.roundMode).toBe('break_90');
    expect(body.scores).toEqual({ 1: 5 });
    expect(body.holeNotes).toEqual({ 3: 'wind swirls here' });
    expect(body.sim_round).toBe(true);
    // derived by a call the builder makes itself, not by a caller handing it over
    expect(typeof body.persona).toBe('string');
    expect(typeof body.personaIntensity).toBe('number');
    expect(typeof body.clientHour).toBe('number');
  });

  /**
   * 2026-08-26 — an override of `undefined` is not a caller saying anything; it is a value that
   * wasn't there. Assigning it clobbered a resolved value, which made `overrides: { x: maybeX }`
   * quietly destructive exactly when maybeX was absent — the shape the collapsed mic path uses.
   * An explicit null still wins: that IS a caller saying "none".
   */
  it('an undefined override does not clobber a resolved value; an explicit null does', () => {
    useRoundStore.setState({ activeCourse: 'Greenhill' } as never);
    const undef = buildCaddieRequestBody({
      message: 'hi', language: 'en',
      overrides: { activeCourse: undefined },
    }) as Record<string, unknown>;
    expect(undef.activeCourse).toBe('Greenhill');

    const nulled = buildCaddieRequestBody({
      message: 'hi', language: 'en',
      overrides: { activeCourse: null },
    }) as Record<string, unknown>;
    expect(nulled.activeCourse).toBeNull();
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
  /**
   * 2026-08-26 (Tim — "make sure the caddie has full context of everything in the app").
   *
   * The other half of that question. The rest of this suite proves every SENDER goes through the one
   * builder; this proves the RECEIVER actually consumes what the builder emits. A payload key the
   * server destructures and drops is the same half-build as a store the payload never sends — the
   * app computes something, ships it across the wire, and nothing is different at the other end.
   *
   * Comments are stripped first, because api/kevin's prose discusses fields at length and a field
   * DISCUSSED is not a field READ. Twice today a doc comment made dead wiring look alive.
   *
   * "Referenced at least twice" is the bar deliberately: once is the destructure itself.
   */
  it('every key the builder emits is actually consumed by the server', () => {
    const kevin = stripComments(read('api/kevin.ts'));
    const dropped: string[] = [];
    for (const key of CADDIE_REQUEST_KEYS) {
      const hits = kevin.match(new RegExp(`\\b${key}\\b`, 'g'))?.length ?? 0;
      if (hits <= 1) dropped.push(`${key} (x${hits})`);
    }
    expect(dropped).toEqual([]);
  });

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

  /**
   * 2026-08-26 — THIS USED TO ASSERT SPREAD-ORDER. It no longer can, because there is no longer a
   * literal to be ordered against: useVoiceCaddie's 58-key hand-built payload is gone, and what it
   * genuinely owns now goes IN, through `overrides`, rather than being pasted on top.
   *
   * Spread-order was always the weaker property anyway. It guaranteed every KEY was present while
   * leaving each caller free to re-answer it — which is exactly how the resolved working yardage
   * lost to the raw card number on this surface for two days with every builder test green.
   *
   * So the assertion is now the strong one: after the spread, a sender adds NOTHING. Anything it
   * genuinely owns is threaded in as an input, where the builder's own contract keeps it honest.
   */
  it('a sender adds nothing after the spread — what it owns goes IN, not on top', () => {
    /**
     * Returns the TOP-LEVEL entries of the object literal passed to JSON.stringify that contains
     * the builder spread. A spread reads as "...", anything else is a re-declared key.
     *
     * The first version of this walked forward from the spread counting braces, starting at the
     * "." with depth 1 — so the count was off by the builder call's own paren and the walk sailed
     * past the literal to an outer brace. `tail` came back as "}" and it passed VACUOUSLY. Caught
     * by break-testing it: re-adding a key produced no failure. A guard that cannot fail is worse
     * than no guard, because it is also a claim.
     */
    const topLevelEntries = (src: string): string[] => {
      const anchor = src.indexOf('...buildCaddieRequestBody(');
      expect(anchor).toBeGreaterThan(-1);
      const open = src.lastIndexOf('{', anchor);
      let depth = 0;
      let i = open;
      const entries: string[] = [];
      let buf = '';
      for (; i < src.length; i += 1) {
        const c = src[i];
        if ('({['.includes(c)) { depth += 1; if (depth === 1) continue; }
        else if (')}]'.includes(c)) { depth -= 1; if (depth === 0) break; }
        if (depth === 1 && c === ',') { entries.push(buf.trim()); buf = ''; continue; }
        if (depth >= 1) buf += c;
      }
      if (buf.trim()) entries.push(buf.trim());
      return entries.filter(Boolean);
    };

    for (const f of ['hooks/useVoiceCaddie.ts']) {
      const entries = topLevelEntries(stripComments(read(f)));
      const declared = entries.filter((e) => !e.startsWith('...'));
      expect([f, declared]).toEqual([f, []]);
      // and the spread must actually be there — an empty literal would otherwise pass
      expect(entries.some((e) => e.startsWith('...buildCaddieRequestBody'))).toBe(true);
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
