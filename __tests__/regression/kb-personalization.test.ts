/**
 * KB personalization wiring (deep audit 2026-07-26). cnsPersonalize + appSignals were authored on ~half
 * of every KB entry but nothing read them. Now kbForPrompt tailors an entry to the player's REAL signals
 * and marks entries grounded in a live signal. Guards the HONESTY contract: personalization fires ONLY
 * from real values — an unknown dimension stays generic, never fabricated.
 */
import { kbForPrompt, retrieveKB, type CnsProfile } from '../../services/knowledgeBase/retrieve';
import type { KBEntry } from '../../services/knowledgeBase/schema';

const entry = (over: Partial<KBEntry> = {}): KBEntry => ({
  id: 'test_entry',
  layer: 'full_swing',
  module: 'test',
  topic: 'ball flight',
  aliases: ['slice fix'],
  principle: 'Fix the path before the face.',
  honesty: 'coaching_only',
  ...over,
});

describe('kbForPrompt personalization', () => {
  it('appends a tailoring directive ONLY for a dimension the player has a real value for', () => {
    const e = entry({ cnsPersonalize: ['dominantMiss'] });
    const profile: CnsProfile = { signals: { dominantMiss: 'slice' } };
    const out = kbForPrompt([e], profile);
    expect(out).toContain('tailor to this player');
    expect(out).toContain('dominant miss: slice');
  });

  it('does NOT personalize when the player has no value for that dimension (no fabrication)', () => {
    const e = entry({ cnsPersonalize: ['dominantMiss'] });
    // profile knows the player's bag but NOT their dominant miss → entry stays generic
    const out = kbForPrompt([e], { signals: { bag: 'known' } });
    expect(out).not.toContain('tailor to this player');
    expect(out).toBe('• Fix the path before the face. [coaching_only]');
  });

  it('is unchanged when no profile is supplied (back-compat)', () => {
    const e = entry({ cnsPersonalize: ['dominantMiss'] });
    expect(kbForPrompt([e])).toBe('• Fix the path before the face. [coaching_only]');
  });

  it("shows a dimension flag ('known') as the dimension name, not 'key: known'", () => {
    const e = entry({ cnsPersonalize: ['bag'] });
    const out = kbForPrompt([e], { signals: { bag: 'known' } });
    expect(out).toContain('tailor to this player (bag)');
    expect(out).not.toContain('known');
  });

  it('marks an entry grounded ONLY when its app signal is live for the player', () => {
    const e = entry({ appSignals: ['gps'] });
    expect(kbForPrompt([e], { liveSignals: ['gps'] })).toContain("grounded in the player's gps data");
    // signal not live → no grounding claim
    expect(kbForPrompt([e], { liveSignals: ['tempo'] })).not.toContain('grounded');
    expect(kbForPrompt([e])).not.toContain('grounded');
  });
});

describe('retrieveKB with a profile', () => {
  it('never surfaces an off-topic entry (a no-match query still returns nothing even with a profile)', () => {
    // Pure gibberish — no content words overlap the corpus, so the personalization boost (base>0 only)
    // cannot lift anything. Proves personalization never surfaces an off-topic entry.
    const res = retrieveKB('zzxqwv qwerty asdfgh plmokn', { cnsProfile: { signals: { dominantMiss: 'slice' } } });
    expect(res).toEqual([]);
  });

  it('still returns on-topic results with a profile (smoke)', () => {
    const res = retrieveKB('how do I stop slicing', { cnsProfile: { signals: { dominantMiss: 'slice' } } });
    expect(Array.isArray(res)).toBe(true);
  });
});
