/**
 * 2026-09-01 (adversarial audit; Tim's call: "timing only, never geometry").
 *
 * poseMotion.wristCentroid was baselined DO NOT WIRE — "the trace is clubhead-or-nothing and a wrist
 * fallback was deliberately removed; wiring this would reintroduce a fixed defect". That prohibition
 * is real and it stays. What it forbids is DRAWING a wrist path as if it were the clubhead.
 *
 * Deciding WHICH FOUR SECONDS the clubhead detector searches is a different thing. Impact is the
 * fastest moment of a swing, so the hand-speed peak is a measurement, and it is the only anchor
 * available when the network locate aborts — which Tim's log shows happening twice in one afternoon
 * (dead_host), dropping the analysis to a whole-clip fallback with no labelled positions at all.
 *
 * So the rule is narrowed rather than deleted, and enforced here instead of in a baseline comment:
 * the wrist may produce a TIME. It may never produce a POINT.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const screen = fs.readFileSync(path.join(root, 'app/swinglab/swing/[swing_id].tsx'), 'utf8');

describe('the wrist may inform timing', () => {
  it('impact falls back to the motion-derived anchor when nothing is labelled', () => {
    expect(screen).toMatch(/deriveSwingAnchors\(samples\)/);
    expect(screen).toMatch(/anchors && Number\.isFinite\(anchors\.impactMs\) \? anchors\.impactMs : null/);
  });

  it('and only after the labelled P6_impact frame is tried first', () => {
    const memo = screen.slice(screen.indexOf('const poseImpactMs'), screen.indexOf('const poseImpactMs') + 2200);
    expect(memo.indexOf("position === 'P6_impact'")).toBeLessThan(memo.indexOf('deriveSwingAnchors'));
  });

  it('it produces a NUMBER of milliseconds, nothing else', () => {
    const memo = screen.slice(screen.indexOf('const poseImpactMs'), screen.indexOf('const poseImpactMs') + 2200);
    expect(memo).toMatch(/tMs: fr\.timestampMs, x: c\.x, y: c\.y/); // x/y go IN
    expect(memo).toMatch(/anchors\.impactMs/);                       // only a time comes OUT
  });
});

describe('the wrist may NEVER become geometry', () => {
  it('THE PROHIBITION: wrist data is used in exactly one place — the impact anchor', () => {
    const uses = [...screen.matchAll(/wristCentroid\(/g)];
    expect(uses.length).toBe(1);
    const memoStart = screen.indexOf('const poseImpactMs');
    const memoEnd = screen.indexOf('}, [poseFrames]);', memoStart);
    expect(uses[0].index!).toBeGreaterThan(memoStart);
    expect(uses[0].index!).toBeLessThan(memoEnd);
  });

  it('the arc is never set from pose, wrist or motion data', () => {
    for (const m of screen.matchAll(/setClubArcPoints\(([^)]*)\)/g)) {
      expect(m[1]).not.toMatch(/wrist|pose|anchor|motion/i);
    }
  });

  it('the trace still comes from the clubhead detector, or from nothing', () => {
    expect(screen).toMatch(/detectClubPath/);
    expect(screen).toMatch(/setClubArcPoints\(null\)/); // it is allowed to show nothing
  });

  it('poseMotion itself exposes no drawing helper that could be mistaken for a trace', () => {
    const pm = fs.readFileSync(path.join(root, 'services/swing/poseMotion.ts'), 'utf8');
    expect(pm).not.toMatch(/export function .*(Path|Arc|Trace|Points)\s*\(/);
  });
});
