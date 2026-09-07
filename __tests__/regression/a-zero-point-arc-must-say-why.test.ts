/**
 * 2026-09-06 (Tim, from a live Sentry event at Menifee Lakes, hole 1, mid-round):
 *
 *     analysis_error: clubpath_arc_too_sparse { points: 0, aborted: false, windowMs: 4000 }
 *
 * `aborted: false` means the server ANSWERED — this was not a timeout. It returned an arc it had
 * decided not to trust, and the rejection is correct: an implausible set must come back as all-null
 * so no client draws a wrong club.
 *
 * What was wrong is that FOUR different failures all reached the field as the same `points: 0`:
 *
 *   none     — nothing came back at all
 *   too_few  — 1-2 points; the model could not see the head. A CAPTURE problem (light, angle, fps).
 *   cluster  — several points collapsed to a blob. A MIS-DETECTION (ball, grip, background object).
 *   scatter  — several points that zig-zag instead of sweeping. Also a mis-detection.
 *
 * `too_few` sends you to the camera. `cluster` and `scatter` send you to the prompt. The log said
 * "0 points" for all of them, so it pointed at the wrong suspect at least half the time — on a
 * feature Tim has chased for weeks ("the swing arc I've yet to ever see").
 *
 * These lock the classifier's boundaries, because a mislabel is worse than the old silence: it is
 * confident and wrong.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * The server's classifier, mirrored. It cannot be imported — api/club-path.ts constructs an
 * Anthropic client at module scope, so importing it in a test would need a key and would make a
 * network client for a pure-geometry assertion. The structural test below is what keeps this copy
 * honest: it fails if the real thresholds move.
 */
const MIN_ARC_POINTS = 3;
type Rejection = 'none' | 'too_few' | 'cluster' | 'scatter';

function efficient(pts: { x: number; y: number }[], a: number, b: number): boolean {
  let len = 0;
  for (let i = a + 1; i <= b; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (len <= 1e-6) return false;
  return Math.hypot(pts[b].x - pts[a].x, pts[b].y - pts[a].y) / len >= 0.45;
}

function classify(pts: { x: number; y: number }[]): Rejection | null {
  if (pts.length === 0) return 'none';
  if (pts.length < MIN_ARC_POINTS) return 'too_few';
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (Math.max(spanX, spanY) < 0.10 || spanX + spanY < 0.13) return 'cluster';
  return efficient(pts, 0, pts.length - 1) ? null : 'scatter';
}

describe('a rejected arc names its own failure', () => {
  it('nothing at all → none', () => {
    expect(classify([])).toBe('none');
  });

  it('one or two points → too_few, the CAPTURE problem', () => {
    expect(classify([{ x: 0.2, y: 0.8 }])).toBe('too_few');
    expect(classify([{ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.2 }])).toBe('too_few');
  });

  it('a tight blob → cluster, the MIS-DETECTION problem', () => {
    // Three confident reads all sitting on the ball: real points, wrong object.
    expect(classify([
      { x: 0.50, y: 0.80 }, { x: 0.52, y: 0.81 }, { x: 0.51, y: 0.82 }, { x: 0.53, y: 0.80 },
    ])).toBe('cluster');
  });

  it('a wide zig-zag → scatter, not cluster', () => {
    // Spans the frame (so it clears the span gate) but doubles back at every step — the
    // grip + ball + background-object shape the efficiency gate was written for.
    expect(classify([
      { x: 0.10, y: 0.90 }, { x: 0.90, y: 0.10 }, { x: 0.12, y: 0.88 },
      { x: 0.88, y: 0.12 }, { x: 0.14, y: 0.86 },
    ])).toBe('scatter');
  });

  it('a real sweep is NOT rejected', () => {
    // A quarter-circle from ball up to the top: what a good detection looks like.
    const arc = Array.from({ length: 8 }, (_, i) => {
      const t = (i / 7) * (Math.PI / 2);
      return { x: 0.20 + 0.55 * Math.sin(t), y: 0.85 - 0.60 * (1 - Math.cos(t)) };
    });
    expect(classify(arc)).toBeNull();
  });
});

describe('the reason survives all the way to the log', () => {
  it('the server classifies and returns it rather than a bare all-null', () => {
    const api = read('api/club-path.ts');
    expect(api).toContain('function classifyArc');
    expect(api).toContain('rejected: { reason: rejection');
    // Behaviour must be UNCHANGED: an implausible set is still all-null so nothing draws a wrong club.
    expect(api).toContain('positions: frames.map(() => null)');
  });

  it('the client carries the server reason instead of re-deriving it from all-nulls', () => {
    const c = read('services/swing/clubPath.ts');
    expect(c).toContain("gate: 'server'");
    // The client has its OWN mirror of the gate; when that one fires it must say so too, because a
    // client-only rejection means the two gates disagree, which is itself worth seeing.
    expect(c).toContain("gate: 'client'");
  });

  it('the call site logs reason, detected and gate — not just a bare count', () => {
    const screen = read('app/swinglab/swing/[swing_id].tsx');
    const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('rejected: r?.rejected?.reason');
    expect(code).toContain('detected: r?.rejected?.detected');
    expect(code).toContain('gate: r?.rejected?.gate');
  });

  it('the mirrored thresholds above still match the real ones', () => {
    // If these move in api/club-path.ts and not here, every boundary case above is testing fiction.
    const api = read('api/club-path.ts');
    expect(api).toContain('const MIN_ARC_POINTS = 3;');
    expect(api).toContain('< 0.10) return');
    expect(api).toContain('< 0.13) return');
    expect(api).toContain('>= 0.45;');
  });
});
