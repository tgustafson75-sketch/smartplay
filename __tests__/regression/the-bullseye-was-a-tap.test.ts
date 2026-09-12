/**
 * 2026-09-12 (Tim) — "Only ask to tap the bullseye if vision did not catch it verifiably."
 * "Not too much supervised — it was too much tap. We need to show what AI does in this space."
 *
 * The ball has been auto-located from the setup frame for a while (locateBallInSetupFrame, one
 * attempt per setup, a drag always wins). The TARGET was still a tap — in a rig whose entire purpose
 * is measurement, with the camera pointed straight at it.
 *
 * "VERIFIABLY" is the load-bearing word. A confidence label is the model's opinion of itself, and
 * thresholding it is a guess about a guess. A bullseye's geometry is knowable, so a detection can be
 * PROVED: the centre must sit between its own edges, the radii must agree, the ring must be a
 * believable size, and the edges must be level. Fail any → the tap stands, and we say which factor
 * the player can change.
 */
import fs from 'fs';
import path from 'path';
import { verifyTarget, targetFailureLine, type TargetScanResult } from '../../services/targetScan';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const good: TargetScanResult = {
  found: true,
  center: { x: 0.50, y: 0.40 },
  edge_left: { x: 0.38, y: 0.40 },
  edge_right: { x: 0.62, y: 0.41 },
  confidence: 'high', notes: '',
};

describe('a detection is proved, not scored', () => {
  it('accepts a clean, symmetric ring', () => {
    const v = verifyTarget(good);
    expect(v.ok).toBe(true);
    expect(v.center).toEqual({ x: 0.5, y: 0.4 });
    expect(v.radiusFrac).toBeCloseTo(0.12, 2);
  });

  it('rejects a centre that is not between its own edges — that is two objects', () => {
    expect(verifyTarget({ ...good, center: { x: 0.30, y: 0.40 } }).reason).toBe('asymmetric');
    expect(verifyTarget({ ...good, center: { x: 0.70, y: 0.40 } }).reason).toBe('asymmetric');
  });

  it('rejects radii that disagree — a lopsided fit found two unrelated things', () => {
    // left radius 0.02, right 0.22 — nothing like one circle
    expect(verifyTarget({ ...good, edge_left: { x: 0.48, y: 0.40 } }).reason).toBe('asymmetric');
  });

  it('rejects edges that are not level — they were requested on one horizontal', () => {
    expect(verifyTarget({ ...good, edge_right: { x: 0.62, y: 0.62 } }).reason).toBe('edges_not_level');
  });

  it('rejects a ring too small to be the target — that is a logo', () => {
    const v = verifyTarget({ ...good, edge_left: { x: 0.49, y: 0.4 }, edge_right: { x: 0.51, y: 0.4 } });
    expect(v.reason).toBe('too_small');
  });

  it('rejects a ring that fills the frame — that is a wall, not a target', () => {
    const v = verifyTarget({ ...good, center: { x: 0.5, y: 0.4 }, edge_left: { x: 0.0, y: 0.4 }, edge_right: { x: 1.0, y: 0.4 } });
    expect(v.reason).toBe('too_large');
  });

  it('a not-found or partial scan is simply not found', () => {
    expect(verifyTarget(null).reason).toBe('not_found');
    expect(verifyTarget({ ...good, found: false }).reason).toBe('not_found');
    expect(verifyTarget({ ...good, edge_right: null }).reason).toBe('not_found');
  });

  it('never returns a centre when it failed — a caller cannot accidentally aim at it', () => {
    for (const bad of [null, { ...good, found: false }, { ...good, center: { x: 0.2, y: 0.4 } }]) {
      const v = verifyTarget(bad as TargetScanResult | null);
      expect(v.ok).toBe(false);
      expect(v.center).toBeNull();
      expect(v.radiusFrac).toBeNull();
    }
  });
});

describe('a failure names the factor the player can change', () => {
  it('every reason produces an actionable line, never a dead end', () => {
    for (const r of ['not_found', 'asymmetric', 'too_small', 'too_large', 'edges_not_level'] as const) {
      const line = targetFailureLine(r);
      expect(line.length).toBeGreaterThan(10);
      expect(line.toLowerCase()).toMatch(/tap/);
    }
    expect(targetFailureLine('too_small')).toMatch(/closer/);
    expect(targetFailureLine('too_large')).toMatch(/back the camera off/);
  });
});

describe('it is wired, and a tap still wins', () => {
  const SM = code('app/swinglab/smartmotion.tsx');

  it('runs once per setup, on the frame the ball locate already grabbed', () => {
    expect(SM).toMatch(/targetLocateTriedRef\.current = true;/);
    expect(SM).toMatch(/ts\.scanForTarget\(b64\)/);
  });

  it('only applies a VERIFIED centre', () => {
    expect(SM).toMatch(/const v = ts\.verifyTarget\(scan\);/);
    expect(SM).toMatch(/if \(v\.ok && v\.center && !cancelled && !userMovedTargetRef\.current\)/);
  });

  it('a player tap outranks the detector for that setup', () => {
    expect(SM).toMatch(/userMovedTargetRef\.current = true;/);
  });

  it('resets per setup so a new session re-tries', () => {
    expect(SM).toMatch(/targetLocateTriedRef\.current = false;/);
  });

  it('the endpoint is routed, or it 404s in production', () => {
    const v = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
    expect(v).toContain('"src": "/api/target-scan"');
    expect(v).toContain('api/target-scan.ts');
  });

  it('the server refuses a partial find rather than handing back half a geometry', () => {
    expect(code('api/target-scan.ts')).toMatch(/parsed\.found === true && center != null && edge_left != null && edge_right != null/);
  });
});
