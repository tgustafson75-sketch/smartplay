/**
 * 2026-09-01 — PERSONA EXTRACTION HAS ONE OWNER, AND THIS IS ITS CONTRACT.
 *
 * Twelve api/* routes each hand-rolled `typeof body.persona === 'string' ? body.persona :
 * voiceGender`. Every copy was correct when audited — which is the argument for consolidating, not
 * against it. Correctness spread over fourteen identical copies is correctness on loan, and the
 * failure is silent: the caddie just answers as Kevin. [[two-owners-is-the-root-cause]]
 *
 * These cases are the behaviour those fourteen copies HAD, pinned before the move so a later edit to
 * personaInputFrom cannot quietly change what every route answers.
 */
import { personaInputFrom, getCaddieNameFor, getCharacterSpecFor, getCaddieName, getCharacterSpec } from '../../lib/persona';

describe('personaInputFrom', () => {
  it('prefers a persona string over voiceGender', () => {
    expect(personaInputFrom({ persona: 'serena', voiceGender: 'male' })).toBe('serena');
    expect(getCaddieNameFor({ persona: 'harry', voiceGender: 'female' })).toBe('Harry');
  });

  it('falls back to voiceGender when persona is absent', () => {
    expect(personaInputFrom({ voiceGender: 'female' })).toBe('female');
    expect(getCaddieNameFor({ voiceGender: 'female' })).toBe('Serena');
    expect(getCaddieNameFor({ voiceGender: 'male' })).toBe('Kevin');
  });

  it('ignores a non-string persona rather than trusting it', () => {
    expect(personaInputFrom({ persona: 42, voiceGender: 'female' })).toBe('female');
    expect(personaInputFrom({ persona: null, voiceGender: 'female' })).toBe('female');
    expect(personaInputFrom({ persona: { name: 'serena' }, voiceGender: 'female' })).toBe('female');
  });

  it('lets an UNRECOGNISED persona string win and resolve to Kevin — it does not fall through to gender', () => {
    // This is the whole precedence decision. A client that sent a persona has stated an intent;
    // reinterpreting it as a gender is how a retired persona once became Kevin-with-Serena's-voice.
    expect(personaInputFrom({ persona: 'tank', voiceGender: 'female' })).toBe('tank');
    expect(getCaddieNameFor({ persona: 'tank', voiceGender: 'female' })).toBe('Kevin');
  });

  it('handles a missing or empty body the way the legacy default did', () => {
    expect(personaInputFrom(null)).toBeUndefined();
    expect(personaInputFrom(undefined)).toBeUndefined();
    expect(getCaddieNameFor(null)).toBe('Kevin');
    expect(getCaddieNameFor({})).toBe('Kevin');
  });

  it('resolves custom to the custom name', () => {
    expect(getCaddieNameFor({ persona: 'custom' })).toBe('My Caddie');
  });

  it('matches what the hand-rolled expression produced, case for case', () => {
    const handRolled = (body: { persona?: unknown; voiceGender?: unknown }) => {
      const voiceGender = (body.voiceGender as 'male' | 'female' | undefined) ?? 'male';
      return typeof body.persona === 'string' ? (body.persona as string) : voiceGender;
    };
    const bodies: { persona?: unknown; voiceGender?: unknown }[] = [
      { persona: 'kevin', voiceGender: 'male' },
      { persona: 'serena', voiceGender: 'male' },
      { persona: 'harry', voiceGender: 'female' },
      { persona: 'custom' },
      { persona: 'tank', voiceGender: 'female' },
      { voiceGender: 'female' },
      { voiceGender: 'male' },
      { persona: 7, voiceGender: 'female' },
      {},
    ];
    for (const b of bodies) {
      // `?? 'male'` is how the routes spell the legacy default at the call site.
      const now = personaInputFrom(b) ?? 'male';
      expect(getCaddieName(now)).toBe(getCaddieName(handRolled(b)));
      expect(getCharacterSpec(now)).toBe(getCharacterSpec(handRolled(b)));
    }
  });

  it('getCharacterSpecFor returns the persona\'s own spec, not a shared one', () => {
    expect(getCharacterSpecFor({ persona: 'serena' })).not.toBe(getCharacterSpecFor({ persona: 'harry' }));
    expect(getCharacterSpecFor({ persona: 'serena' })).toBe(getCharacterSpec('serena'));
  });
});
