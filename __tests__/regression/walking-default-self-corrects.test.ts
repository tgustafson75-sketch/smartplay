/**
 * 2026-09-13 (Tim) — "The premise is most players are in carts than walking... Once the golfer who
 * forgets to set is moving in a cart in a way walking could never support, we adjust in the
 * background quietly."
 *
 * That is exactly what the app was written to do, and exactly what it had never once done.
 *
 * THREE THINGS HAD TO BE TRUE for a walking default to be safe, and none of them were:
 *
 *   1. The detector must be allowed to act on GPS alone. Health Connect is disabled for 1.0, so
 *      `hasHealthData` is always false and every reading came from the GPS-only branch — which
 *      graded itself 'low', and `cartModeSuggestion` opens with `if (confidence === 'low') return
 *      null`. The grade was honest for the old line: CART_MIN_MPS is 1.2 m/s (~2.7 mph), BELOW a
 *      brisk walk at 1.3–1.5 m/s. The fix is the threshold, not the grade.
 *
 *   2. "Did the player choose?" must be answerable. Both detectors guarded with "we only fill an
 *      UNSET one" and then tested `transportMode === 'walking' || === 'cart'` — a type with no
 *      third value, initialised to 'walking'. Always true. walkingDetector returned on its first
 *      line every tick; shotDetectionService pinned itself to a default nobody picked.
 *
 *   3. A declaration must reach the setting everyone reads. Picking "Cart" on the Play tab wrote
 *      roundStore.transportMode and left settings.cartMode saying walking.
 *
 * [[a-guard-can-enforce-a-stale-premise]] [[a-toggle-that-does-nothing-for-the-default-user]]
 */
import fs from 'fs';
import path from 'path';
import { cartModeSuggestion, type DetectorReading } from '../../services/walkingDetector';
import { CART_SPEED_MS } from '../../services/movementModeDetector';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const reading = (over: Partial<DetectorReading>): DetectorReading => ({
  mode: 'cart',
  confidence: 'medium',
  windowSteps: 0,
  windowGpsSpeedMps: 4,
  hasHealthData: false,
  healthSnapshot: null,
  ...over,
} as DetectorReading);

describe('a walking default is safe because the round corrects it', () => {
  it('GPS-only cart is actionable — the whole loop hinged on this one grade', () => {
    expect(cartModeSuggestion(false, reading({ confidence: 'medium' }))).toBe('enable_cart');
    // and 'low' still vetoes, so the ambiguous band cannot flip anything
    expect(cartModeSuggestion(false, reading({ confidence: 'low' }))).toBeNull();
  });

  it('the no-health branch grades fast movement medium, and the brisk-walk band low', () => {
    const src = code('services/walkingDetector.ts');
    expect(src).toMatch(/windowGpsSpeedMps > CART_SPEED_MS[\s\S]{0,160}confidence = 'medium'/);
    expect(src).toMatch(/windowGpsSpeedMps > CART_MIN_MPS[\s\S]{0,160}confidence = 'low'/);
  });

  it('the cart threshold has ONE owner, and it is above anything a human walks', () => {
    // A brisk walk is 1.3–1.5 m/s. The divider must sit clear of that, not under it.
    expect(CART_SPEED_MS).toBeGreaterThan(2.5);
    expect(code('services/walkingDetector.ts')).toMatch(/CART_SPEED_MS.*from '\.\/movementModeDetector'/);
  });

  it('walking is never auto-disabled from GPS alone — a crawling cart looks like a walk', () => {
    expect(cartModeSuggestion(true, reading({ mode: 'walking', confidence: 'low' }))).toBeNull();
  });

  it('"did they choose" is a flag, because the value can never answer it', () => {
    expect(code('store/roundStore.ts')).toMatch(/transportDeclared: boolean;/);
    expect(code('store/roundStore.ts')).toMatch(/transportDeclared: false,/);
    for (const f of ['services/walkingDetector.ts', 'services/shotDetectionService.ts']) {
      expect(code(f)).toMatch(/transportDeclared/);
      expect(code(f)).not.toMatch(/declared === 'cart' \|\| declared === 'walking'/);
    }
  });

  it('declaring on the Play tab reaches settings.cartMode, which is what everyone else reads', () => {
    const rs = code('store/roundStore.ts');
    expect(rs).toMatch(/setTransportMode: \(m\) => \{[\s\S]{0,400}transportDeclared: true/);
    expect(rs).toMatch(/setCartMode\?\.\(m === 'cart'\)/);
  });

  it('the shipped default is walking', () => {
    expect(code('store/settingsStore.ts')).toMatch(/cartMode: false,/);
  });

  it('a SPOKEN "cart mode off" counts as declared, so detection will not undo it', () => {
    /**
     * 2026-09-13, second pass. Both detectors honour transportDeclared and never override it — but
     * only the Play tab set it, so a spoken choice could be corrected back a minute later by the
     * very detector that exists to respect explicit choices. Found by sweeping for OTHER writers
     * after fixing the first one. [[guard-scoped-to-one-repo-certifies-the-sibling]]
     */
    const h = code('services/intents/changeSettingHandler.ts');
    expect(h).toMatch(/setTransportMode\(v \? 'cart' : 'walking'\)/);
  });

  it('the correction stays silent — no prompt, ever', () => {
    expect(code('services/walkingDetector.ts')).not.toMatch(/Alert\.alert|confirm\(/);
  });
});
