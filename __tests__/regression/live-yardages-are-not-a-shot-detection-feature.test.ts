/**
 * 2026-09-10 — THE LIVE-FIX FAN-OUT WAS A SIDE EFFECT OF SHOT DETECTION.
 *
 * `startSmartFinderGpsTracking()` is what feeds `subscribeFixChange`. Its ONLY caller was
 * `shotDetectionService.start()`, which only runs when `autoShotDetection` is true — and that
 * setting defaults FALSE. So on a default install the fan-out never started and every
 * subscribeFixChange consumer received nothing.
 *
 * The consequence that matters: services/watchCaddieBridge subscribes to it for the fix-driven pin
 * yardage push added THIS MORNING for Tim's "the watch yardage is not updating". That fix was inert
 * unless he had also switched Auto Shot Detection on — the watch fell back to its 18-second timer,
 * which is the original complaint. app/smartvision's position marker has no backstop at all; the
 * caddie tab and the cockpit survived only because each carries its own poll.
 *
 * The identical shape is documented in the same file for gpsManager ("the _layout shot-detection
 * subscriber only starts GPS when autoShotDetection is ON (off by default)") — fixed there for the
 * resumed-round case, with the fan-out left behind.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const layout = read('app/_layout.tsx');
const shotDetection = read('services/shotDetectionService.ts');
const smartFinder = read('services/smartFinderService.ts');

describe('live yardages are not a shot-detection feature', () => {
  it('the round-active path starts the fan-out itself', () => {
    // Both branches: the initial already-active case and the inactive→active transition.
    const calls = (layout.match(/startSmartFinderGpsTracking\(\);/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(layout).toMatch(/import \{[^}]*startSmartFinderGpsTracking[^}]*\} from '\.\.\/services\/smartFinderService'/);
  });

  it('it is NOT gated on autoShotDetection', () => {
    // The gate is what made today's watch fix inert. Assert no call sits inside that condition.
    const at = layout.indexOf('startSmartFinderGpsTracking();');
    expect(at).toBeGreaterThan(-1);
    const before = layout.slice(Math.max(0, at - 600), at);
    expect(before).not.toMatch(/autoShotDetection\s*\)\s*\{[^}]*$/);
  });

  it('starting it is idempotent, so two callers cannot double-subscribe', () => {
    expect(smartFinder).toMatch(/export function startSmartFinderGpsTracking\(\): void \{\s*\n\s*if \(gpsUnsub\) return;/);
  });

  it('it stays persistent, so round-end does not drop it', () => {
    // gpsManager clears non-persistent subscribers at round end; without this the fan-out would die
    // after the first round — the audit #1 this comment cites.
    const at = smartFinder.indexOf('export function startSmartFinderGpsTracking');
    expect(smartFinder.slice(at, at + 600)).toMatch(/\{ persistent: true \}/);
  });

  it('the watch still depends on it — this is what the fix protects', () => {
    // If the watch stops using subscribeFixChange, re-read rather than trusting this guard.
    const watch = read('services/watchCaddieBridge.ts');
    expect(watch).toMatch(/fixSub = subscribeFixChange\(/);
  });

  it('shot detection may still start it — that path is harmless and idempotent', () => {
    expect(shotDetection).toMatch(/startSmartFinderGpsTracking\(\);/);
  });
});
