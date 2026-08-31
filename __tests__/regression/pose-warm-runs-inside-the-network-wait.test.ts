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
import { poseExtractKeyFor, poseExtractInputsFor } from '../../services/swing/poseExtractKey';

const seg = (o: Partial<{ startMs: number; endMs: number; strikeMs: number | null; synthesized: boolean }>) =>
  ({ index: 0, startMs: 0, endMs: 2000, strikeMs: null, synthesized: false, ...o } as never);

describe('the warm and the review read compute the same key', () => {
  it('IGNORES the measured duration — the two paths measure it differently on the same file', () => {
    /**
     * The warm probes the file (`probeDurationMs`); the review read uses the player's own
     * `onLoad durationMillis`. On one clip those disagree by a few milliseconds. The old key
     * included the duration, so the warm and the read would have missed each other over
     * measurement noise — decoding twice and costing more than it saved.
     */
    const base = { clipUri: 'file:///clip.mp4', poseWindow: null, selectedSwing: 0, handedness: 'right', acousticImpactMs: null };
    expect(poseExtractKeyFor(base)).toBe(poseExtractKeyFor(base));
    // Same inputs, whatever any duration measurement said — there is nowhere to put it.
    expect(poseExtractKeyFor(base)).not.toContain('undefined');
    expect(poseExtractKeyFor(base)).toBe('file:///clip.mp4|full|0|right|');
  });

  it('still separates the things that genuinely change the frames', () => {
    const base = { clipUri: 'file:///a.mp4', poseWindow: null, selectedSwing: 0, handedness: 'right', acousticImpactMs: null };
    const k = poseExtractKeyFor(base);
    expect(poseExtractKeyFor({ ...base, clipUri: 'file:///b.mp4' })).not.toBe(k);
    expect(poseExtractKeyFor({ ...base, selectedSwing: 1 })).not.toBe(k);
    expect(poseExtractKeyFor({ ...base, handedness: 'left' })).not.toBe(k);
    expect(poseExtractKeyFor({ ...base, acousticImpactMs: 1200 })).not.toBe(k);
    expect(poseExtractKeyFor({ ...base, poseWindow: { startMs: 100, endMs: 900 } })).not.toBe(k);
  });

  it('the warm keying on the RAW uri would have missed — the review reads the persisted copy', () => {
    // Why the warm is started only after persistClipToDocuments resolves.
    const raw = poseExtractKeyFor({ clipUri: 'file:///cache/raw.mp4', poseWindow: null, selectedSwing: 0, handedness: 'right', acousticImpactMs: null });
    const durable = poseExtractKeyFor({ clipUri: 'file:///documents/clip.mp4', poseWindow: null, selectedSwing: 0, handedness: 'right', acousticImpactMs: null });
    expect(raw).not.toBe(durable);
  });
});

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
