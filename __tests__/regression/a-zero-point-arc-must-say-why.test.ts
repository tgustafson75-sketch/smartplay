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
 * 2026-09-19 — THE MIRROR IS GONE. It used to say:
 *
 *   "The server's classifier, mirrored. It cannot be imported — api/club-path.ts constructs an
 *    Anthropic client at module scope... The structural test below is what keeps this copy honest."
 *
 * That was true and it was a third copy of a rule that already had two, and the structural test
 * that kept it honest was a grep. Today the rule lives in services/swing/clubArcGate — pure, no
 * client, no key — and BOTH sides of the wire import it. So this file tests the real function.
 *
 * Verified before the swap: the real classifier returns the same verdict as the mirror did on every
 * case below. The mirror was accurate; it was simply fiction waiting to happen.
 */
import { classifyArc } from '../../services/swing/clubArcGate';

/** The rejection alone — these cases are about the verdict, not the surviving points. */
const classify = (pts: { x: number; y: number }[]) => classifyArc(pts).rejection;

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
    // 2026-09-19 — it no longer DEFINES the classifier, it IMPORTS the shared one. That is the fix.
    expect(api).toMatch(/import \{[^}]*classifyArc[^}]*\} from '\.\.\/services\/swing\/clubArcGate'/);
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

  /**
   * 2026-09-19 — REPLACES "the mirrored thresholds above still match the real ones".
   *
   * That test greppped api/club-path.ts for four literals to keep a copy of the gate honest. There
   * is nothing to keep honest now: neither side owns a copy. Asserting the ABSENCE of a second
   * implementation is strictly stronger than asserting two implementations agree — and it is the
   * property the field report needed, because the one difference between the two copies (this side
   * deduped, the server did not) is what made a routine blurred downswing report as a client/server
   * disagreement. [[two-owners-is-the-root-cause]]
   */
  it('NEITHER side keeps its own copy of the gate', () => {
    for (const f of ['api/club-path.ts', 'services/swing/clubPath.ts']) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src).toMatch(/from '.*clubArcGate'/);
      expect(src).not.toContain('function looksLikeClubArc');
      expect(src).not.toContain('function classifyArc');
      expect(src).not.toContain('MIN_ARC_POINTS = 3');
    }
  });

  /**
   * 2026-09-19 — THE FIELD REPORT, REPRODUCED. A brand-new player's first swing on a Pixel 8a:
   *
   *     clubpath_arc_too_sparse { detected: 2, rejected: "too_few", gate: "client",
   *                               framesSampled: 14, windowMs: 1544, aborted: false }
   *
   * `gate: "client"` said the two gates disagreed. They did not: the model returned three
   * detections, two of them on top of each other through the blurred downswing, and only this side
   * collapsed them before counting. Now both sides count the same set, so the server rejects it
   * first and the log says so.
   */
  it('three detections with a duplicate are too_few on BOTH sides, not a disagreement', () => {
    const withDuplicate = [
      { x: 0.200, y: 0.850 },
      { x: 0.201, y: 0.851 },   // the same read again — a blurred head that did not move between frames
      { x: 0.750, y: 0.300 },
    ];
    const { rejection, points } = classifyArc(withDuplicate);
    expect(points).toHaveLength(2);          // the duplicate collapses
    expect(rejection).toBe('too_few');       // ...and 2 is not an arc, on either side of the wire
  });
});
