/**
 * 2026-08-30 (Tim — "auto detect, there are distinct behavior differences right?").
 *
 * Yes, and they are not cosmetic. cartMode retunes shot detection: an 8-second stationary window
 * instead of 4, a 12-metre radius instead of 8, and a read of only the newest speed sample. The
 * wrong mode means missed shots or phantom ones.
 *
 * THREE THINGS OWNED "am I riding" and none of them fixed the setting. shotDetectionService senses
 * it from GPS speed and retunes itself; conversationalLoggingOrchestrator asks isEffectiveCartMode()
 * and suppresses auto-logging; and settings.cartMode — the value every OTHER reader sees — stayed
 * whatever the player last tapped. isEffectiveCartMode also only ever ADDS cart by design, so a
 * player who turned cart on and then walked was corrected nowhere at all.
 *
 * cartModeSuggestion answers this in both directions and was orphaned.
 */

import { cartModeSuggestion, type DetectorReading } from '../../services/walkingDetector';

const reading = (mode: DetectorReading['mode'], confidence: DetectorReading['confidence']): DetectorReading =>
  ({ mode, confidence } as DetectorReading);

describe('the suggestion corrects in BOTH directions', () => {
  it('turns cart ON when the player is clearly riding with it off', () => {
    expect(cartModeSuggestion(false, reading('cart', 'high'))).toBe('enable_cart');
  });

  it('turns cart OFF when the player is clearly walking with it on', () => {
    // The direction isEffectiveCartMode cannot express: it only ever adds cart, never removes it.
    expect(cartModeSuggestion(true, reading('walking', 'high'))).toBe('disable_cart');
  });

  it('says nothing when the setting already matches', () => {
    expect(cartModeSuggestion(true, reading('cart', 'high'))).toBeNull();
    expect(cartModeSuggestion(false, reading('walking', 'high'))).toBeNull();
  });
});

describe('it refuses to guess', () => {
  it('stays silent on a low-confidence reading, however wrong the setting looks', () => {
    // A shaky read must not flip the tuning under the player mid-hole.
    expect(cartModeSuggestion(false, reading('cart', 'low'))).toBeNull();
    expect(cartModeSuggestion(true, reading('walking', 'low'))).toBeNull();
  });

  it('stays silent at rest — standing still is not evidence of either', () => {
    expect(cartModeSuggestion(false, reading('at_rest', 'high'))).toBeNull();
    expect(cartModeSuggestion(true, reading('at_rest', 'high'))).toBeNull();
  });
});

describe('the ticker applies it without asking', () => {
  it('is wired into the tick, and honours an explicit choice', () => {
    // The behaviour that matters is a side effect inside a 30s interval, so this pins the two
    // properties that make it safe rather than re-running the timer: the correction happens on the
    // tick, and a declared transportMode short-circuits it before any write.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/walkingDetector.ts'), 'utf8');
    expect(src).toMatch(/applyDetectedTransport\(_cached\)/);
    expect(src).toMatch(/if \(declared === 'cart' \|\| declared === 'walking'\) return;/);
    // No prompt: the player is never asked to confirm a fact the phone measured.
    expect(src).not.toMatch(/Alert\.alert|confirm\(/);
  });
});
