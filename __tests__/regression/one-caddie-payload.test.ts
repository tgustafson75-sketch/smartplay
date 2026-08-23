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
  it.each(['hooks/useVoiceCaddie.ts', 'hooks/useKevin.ts'])('%s spreads the shared union', (f) => {
    const src = read(f);
    expect(src).toMatch(/\.\.\.buildCaddieRequestBody\(/);
    // It must be spread INTO the request body, not merely imported.
    const body = src.indexOf('body: JSON.stringify({');
    const spread = src.indexOf('...buildCaddieRequestBody(');
    expect(body).toBeGreaterThan(-1);
    expect(spread).toBeGreaterThan(body);
  });

  it('the union is spread FIRST so a path cannot omit a key', () => {
    // Spread-last would let a hand-built literal keep winning with a missing field.
    for (const f of ['hooks/useVoiceCaddie.ts', 'hooks/useKevin.ts']) {
      const src = read(f);
      const spread = src.indexOf('...buildCaddieRequestBody(');
      const firstField = src.indexOf('\n          message,', spread);
      expect(firstField).toBeGreaterThan(spread);
    }
  });
});
