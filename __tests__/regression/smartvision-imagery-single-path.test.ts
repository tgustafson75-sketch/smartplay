/**
 * 2026-08-11 (Tim) — "since we've gotten rid of bundled courses, do we get rid of the static setting
 * in SmartVision? and it's always satellite, but it goes live and updates when you're in a live round."
 *
 * Yes — and the reason is stronger than tidiness. The toggle read as "photo vs map", but every
 * bundled "static" hole is ITSELF a cropped aerial photo (verified by eye: pembroke-pines, palms and
 * mariners-point are clean aerials with no third-party UI). So the two sides were never different
 * kinds of picture — only different vintages. The setting's entire power was to hand the user a
 * staler image, and pre-round it did that silently: the imagery effect RETURNED on
 * `curatedAvailable` before the hole's coordinates were even computed, so all 27 courses with
 * bundled photos could never show a live tile until a round started.
 *
 * SmartVision is satellite now. The 459 bundled photos stay, demoted to what they're genuinely best
 * at: an instant, offline-safe fallback for a hole we have no coordinates for.
 *
 * These lock the ORDER of that chain, which is the fix. A test that merely checked the toggle was
 * gone would pass even if the photo still pre-empted the live tile.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../app/smartvision.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../../store/settingsStore.ts'), 'utf8');

describe('SmartVision has one imagery path, not a setting', () => {
  it('no longer reads the imagery mode anywhere', () => {
    expect(src).not.toContain('s.smartVisionImagery');
    expect(src).not.toContain('setSmartVisionImagery');
    // The old branching vocabulary must be gone with it — these are how the stale image won.
    expect(src).not.toContain("imageryMode !== 'gps'");
    expect(src).not.toContain("imageryMode !== 'curated'");
  });

  it('has no Static/Satellite control', () => {
    expect(src).not.toContain('setImageryMode(showingStatic');
    expect(src).not.toContain('(tap to switch)');
  });

  it('keeps the persisted setting declared so old snapshots still rehydrate', () => {
    // Deleting the key outright would make every persisted settings blob in the wild fail its shape.
    expect(settings).toContain('smartVisionImagery');
    expect(settings).toContain('@deprecated 2026-08-11');
  });
});

describe('the live tile leads and the photo is the fallback', () => {
  const effect = src.slice(src.indexOf('// Imagery selection'), src.indexOf('// ── Derived projection'));

  it('does not return on a bundled photo before coordinates are known', () => {
    // THE bug: `if (curatedAvailable && imageryMode !== 'gps') { setImageUri(null); return; }` sat
    // above the coordinate resolution, so a photo pre-empted a live tile that was perfectly possible.
    expect(effect).not.toMatch(/if \(curatedAvailable[^)]*\) \{\s*setImageUri\(null\);\s*setLoading\(false\);\s*return;/);
  });

  it('resolves coordinates BEFORE deciding what to show', () => {
    const coords = effect.indexOf('const effectiveGreen =');
    const decision = effect.indexOf('if (effectiveGreen && courseId) {');
    expect(coords).toBeGreaterThan(-1);
    expect(decision).toBeGreaterThan(coords);
  });

  it('takes the live tile whenever the hole has coordinates — pre-round included', () => {
    // The old condition was `(isRoundActive || !curatedAvailable) && ... && effectiveGreen`.
    expect(effect).toContain('if (effectiveGreen && courseId) {');
    expect(effect).not.toContain('(isRoundActive || !curatedAvailable)');
  });

  it('falls back to the bundled photo only when there are no coordinates', () => {
    const live = effect.indexOf('if (effectiveGreen && courseId) {');
    const curated = effect.indexOf('} else if (curatedAvailable) {');
    expect(curated).toBeGreaterThan(live);
    expect(effect).toContain("setImagerySource('curated')");
  });

  it('still ends at an honest empty state rather than a green screen', () => {
    expect(effect).toContain("setImagerySource('none')");
    expect(src).toContain('Waiting on your location to drop the satellite aerial');
  });

  it('clears the previous hole tile so no wrong-hole image can flash', () => {
    const start = src.indexOf('setLoading(true);');
    const head = src.slice(start, src.indexOf('void (async () => {', start));
    expect(head).toContain('setImageUri(null);');
    expect(head).toContain('setGeometry(null);');
  });
});

describe('the photo-specific rendering follows the fallback, not a setting', () => {
  it('calibration/projection treats the photo as curated only when it IS the imagery', () => {
    // preferCurated drives tee/pin anchoring — a curated photo needs calibration, a tile needs GPS
    // projection. Keying it off the old setting anchored markers wrongly whenever they disagreed.
    expect(src).toContain("const preferCurated = !!curatedImage && imagerySource === 'curated';");
  });

  it('the edge vignette (tuned for photos) only paints over a photo', () => {
    expect(src).toContain('{preferCurated && (<>');
  });

  it('reports which imagery you are seeing without pretending to be a control', () => {
    expect(src).toContain("{imagerySource === 'curated' ? (");
    expect(src).toContain('accessibilityRole="text"');
  });
});
