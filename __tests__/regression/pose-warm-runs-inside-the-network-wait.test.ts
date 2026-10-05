/**
 * 2026-08-31 (OPEN-ITEMS §10) — the pose/biomech pass did not overlap the vision call. It waited
 * for all of it.
 *
 * Strictly serial: extract vision frames → POST /api/swing-analysis (the long pole) → flip to
 * 'review' → ONLY THEN decode the clip again for pose. The whole network wait was dead time with
 * the decoder idle. I had told Tim these ran concurrently, reasoning from the fact that they live in
 * separate effects; they do not — the biomech effect returns early unless `phase === 'review'`, and
 * runAnalysis nulls `videoDurationMs` at its start, so it was doubly blocked.
 *
 * The warm now starts the identical extraction as soon as the POST is in flight. THE ENTIRE VALUE
 * OF THAT DEPENDS ON ONE THING: the key it writes must be the key the review read looks up. A warm
 * that misses is strictly WORSE than no warm — it pays for a decode and then pays again.
 *
 * That is what this file pins, and the duration case is the one that would really have happened.
 */
import { poseExtractInputsFor } from '../../services/swing/poseExtractKey';

const seg = (o: Partial<{ startMs: number; endMs: number; strikeMs: number | null; synthesized: boolean }>) =>
  ({ index: 0, startMs: 0, endMs: 2000, strikeMs: null, synthesized: false, ...o } as never);

// 2026-10-05 — the warm and its key are gone with the second pose pass they served: every saved swing's
// body read is the orchestrator's shot run, ordered after the read (see the-club-stage-must-wait-for-pose).
// The window/anchor rule below still decides what a capture calls a measured strike.
describe('the window/anchor helper both paths share', () => {
  it('windows to the selected swing when the segment is long enough', () => {
    const { poseWindow } = poseExtractInputsFor([seg({ startMs: 500, endMs: 2500 })], 0);
    expect(poseWindow).toEqual({ startMs: 500, endMs: 2500 });
  });

  it('falls back to the whole clip for a too-short segment', () => {
    const { poseWindow } = poseExtractInputsFor([seg({ startMs: 0, endMs: 300 })], 0);
    expect(poseWindow).toBeNull();
  });

  it('falls back to the whole clip when the selected swing does not exist', () => {
    expect(poseExtractInputsFor([], 0).poseWindow).toBeNull();
    expect(poseExtractInputsFor([seg({})], 4).poseWindow).toBeNull();
  });

  it('anchors to a real strike but NEVER to the synthesized 0.6·duration guess', () => {
    expect(poseExtractInputsFor([seg({ strikeMs: 1400 })], 0).acousticImpactMs).toBe(1400);
    expect(poseExtractInputsFor([seg({ strikeMs: 1400, synthesized: true })], 0).acousticImpactMs).toBeNull();
  });
});
