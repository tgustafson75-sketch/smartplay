/**
 * 2026-09-01 — Tim, 08-24: "seems to happen in two stages where you get partial then I tap the screen
 * and it populates more data."
 *
 * The body/biomech effect is gated on videoDurationMs. The only thing that set it, originally, was
 * the review player's onLoad — so BODY, sway, tilt and weight sat empty until the video element
 * loaded, and the tap was what loaded it.
 *
 * That was fixed on 08-24 — in three BRANCHES: range, practice-with-one-swing, and the no-segment
 * fallback. It was never seeded on the multi-swing practice path, nor on ANY course capture. The two
 * commonest SUCCESSFUL captures were still the ones that waited for a tap, which is the shape a
 * branch-by-branch fix always leaves behind.
 *
 * The duration is known free from metering, before any branch runs and before the player mounts.
 */
import fs from 'fs';
import path from 'path';

const sm = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app/swinglab/smartmotion.tsx'),
  'utf8',
);

describe('the duration is known before any branch decides what to do', () => {
  it('THE FIX: it is seeded straight off the metering result', () => {
    expect(sm).toMatch(/meteredDurationMs = durationMs && durationMs > 0 \? durationMs : null;[\s\S]{0,1600}?if \(meteredDurationMs\) setVideoDurationMs\(meteredDurationMs\);/);
  });

  it('and that seed happens BEFORE the mode branches', () => {
    const seed = sm.indexOf('if (meteredDurationMs) setVideoDurationMs(meteredDurationMs);');
    const firstBranch = sm.indexOf("if (stopMode === 'range') {");
    expect(seed).toBeGreaterThan(-1);
    expect(firstBranch).toBeGreaterThan(-1);
    expect(seed).toBeLessThan(firstBranch);
  });

  it('the body read is still gated on the duration — this fix is what satisfies the gate', () => {
    expect(sm).toMatch(/if \(!clipUri \|\| videoDurationMs == null \|\| phase !== 'review'\) return;/);
  });

  it('the per-branch seeds remain — they are harmless and cover the re-entry paths', () => {
    // clipUriParam (an imported clip) never runs the metering stop at all.
    expect((sm.match(/setVideoDurationMs\(durMs\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('a new capture still clears it, so swing B never renders swing A’s duration', () => {
    expect((sm.match(/setVideoDurationMs\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
