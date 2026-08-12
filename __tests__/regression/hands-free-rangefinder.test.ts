/**
 * 2026-08-12 — the hands-free rangefinder, finally connected to itself.
 *
 * Tim asked for this on 2026-07-22 ("SmartFinder auto-detect / wrap SmartVision around it"). The
 * endpoint was written that day, the maths (computeHeightRangedDistance) was written and unit
 * tested, and the two were never connected to each other or to a screen. An adversarial sweep found
 * /api/measure-scan with zero client callers and the maths referenced only by its own test file — a
 * whole feature living in a test. Tim's call: wire it before launch.
 *
 * WHY IT'S WORTH THE WIRING, beyond being unfinished: SmartFinder's live read is the camera-TILT
 * rangefinder, which is unreliable exactly where golf targets are — near the horizon, where a
 * fraction of a degree of pitch error moves the projected point hundreds of yards. Tim, 2026-06-23:
 * "moving the target never gets accurate, defaults to 250 or 10." The plausibility gate added then
 * can only SUPPRESS a bad number; it can never produce a good one.
 *
 * Height ranging has no such failure mode. It uses no pitch, no heading and no GPS — only how tall
 * a flagstick (2.13m) or a person (1.75m) appears in frame.
 */
import fs from 'fs';
import path from 'path';
import { computeHeightRangedDistance } from '../../services/rangefinder';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const sf = read('app/smartfinder.tsx');
const svc = read('services/measureScan.ts');

describe('the maths still answers correctly (it was always fine — just unreachable)', () => {
  const FLAG = 2.13;

  it('a flagstick filling more of the frame is nearer', () => {
    const near = computeHeightRangedDistance({ top_y_normalized: 0.35, base_y_normalized: 0.65, real_height_m: FLAG });
    const far = computeHeightRangedDistance({ top_y_normalized: 0.48, base_y_normalized: 0.52, real_height_m: FLAG });
    expect(near.distance_yards).toBeLessThan(far.distance_yards);
    expect(near.unmeasurable).toBe(false);
  });

  it('reports LOW confidence when the reference is too small to trust', () => {
    // Below ~0.8 degrees the read is detection-noise sensitive. The wiring declines these.
    const tiny = computeHeightRangedDistance({ top_y_normalized: 0.4995, base_y_normalized: 0.5005, real_height_m: FLAG });
    expect(tiny.confidence).toBe('low');
  });

  it('refuses to measure when the endpoints coincide', () => {
    expect(computeHeightRangedDistance({ top_y_normalized: 0.5, base_y_normalized: 0.5, real_height_m: FLAG }).unmeasurable).toBe(true);
  });
});

describe('the client half exists and fails closed', () => {
  it('posts to the endpoint that had no callers', () => {
    expect(svc).toContain("/api/measure-scan");
    expect(svc).toContain('export async function scanForMeasureReference');
  });

  it('treats a half-answer as not-found rather than half-trusting it', () => {
    // A "found" result missing an endpoint or a height is how a fabricated distance reaches screen.
    expect(svc).toContain('if (!j.found || !okPt(j.top) || !okPt(j.base) || !(Number(j.real_height_m) > 0)) return NOT_FOUND;');
  });

  it('never throws — any failure leaves the existing read alone', () => {
    expect(svc).toContain('} catch {\n    return NOT_FOUND;\n  }');
    expect(svc).toContain('if (!res.ok) return NOT_FOUND;');
  });
});

describe('SmartFinder actually calls it', () => {
  it('imports the maths that used to be test-only', () => {
    expect(sf).toContain("import { computeDistance, computeHeightRangedDistance } from '../services/rangefinder';");
  });

  it('can capture a frame — the CameraView ref lives in the parent', () => {
    expect(sf).toContain('const captureFrameBase64 = useCallback(async (): Promise<string | null>');
    expect(sf).toContain('captureFrameBase64={captureFrameBase64}');
    expect(sf).toContain('captureFrameBase64?: () => Promise<string | null>;');
  });

  it('runs the scan off a real tap', () => {
    expect(sf).toContain('void runHeightRangeScan();');
  });

  it('CORRECTS the tilt read rather than replacing the flow', () => {
    // The tilt number is already on screen; a slow or failed scan simply leaves it there.
    expect(sf).toContain('if (!scan.found || !scan.top || !scan.base || !scan.real_height_m) return;');
    expect(sf).toContain("if (ranged.unmeasurable || ranged.confidence === 'low') return;");
  });

  it('drops a stale scan when a newer tap has started one', () => {
    // Without this, a slow scan of an old frame could overwrite a fresh read.
    expect(sf).toContain('const token = ++heightScanRef.current;');
    expect(sf).toContain('if (token !== heightScanRef.current) return;');
  });

  it('tells the user what it ranged off, and clears that on a new tap', () => {
    // An unexplained better number reads like the same old guess; a stale label is worse.
    expect(sf).toContain('Ranged off {heightRangeRef ===');
    expect(sf).toContain('setHeightRangeRef(null); // a new tap is a fresh tilt read until a scan says otherwise');
  });
});
