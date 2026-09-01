/**
 * 2026-08-31 (Tim, from the field: "swing trace is a little off", logged alongside
 * `clubpath_arc_too_sparse ... windowMs: 11640`).
 *
 * A DETECTED SWING SEGMENT IS 4,000ms — 2,500 before the strike and 1,500 after
 * (swingSegmentation PRE_STRIKE_MS / POST_STRIKE_MS). His window was ELEVEN AND A HALF SECONDS.
 *
 * With no segment, `clipEndSeconds` is null and the club-path effect falls through to the whole clip
 * duration. So it hunted a clubhead across eleven seconds of walk-up, waggle and follow-through, and
 * assembled an arc out of whatever it found in all of it. Same defect the analysis frame sampler had
 * to fix for itself, and the same one the share link had to fix — sampling the CLIP instead of the
 * SWING. Third time this shape has appeared.
 *
 * The window is re-centred using the SAME pre/post the segmenter uses, so there is one rule rather
 * than a second opinion about how long a swing is.
 */

/** The shipped narrowing rule, exercised directly — see the note about mirrored tests below. */
const MAX_SWING_WINDOW_MS = 6000;
const PRE_MS = 2500, POST_MS = 1500;
function narrow(rawStartMs: number, rawEndMs: number, strikeMs: number | null) {
  const tooWide = rawEndMs - rawStartMs > MAX_SWING_WINDOW_MS;
  const startMs = tooWide && strikeMs != null ? Math.max(rawStartMs, strikeMs - PRE_MS) : rawStartMs;
  const endMs = tooWide && strikeMs != null ? Math.min(rawEndMs, strikeMs + POST_MS) : rawEndMs;
  return { startMs, endMs, width: endMs - startMs };
}

describe('the club path searches the swing, not the whole clip', () => {
  it("THE REPORT: an 11.6s window collapses to a swing's worth around the strike", () => {
    const r = narrow(0, 11640, 7000);
    expect(r.width).toBe(4000);
    expect(r.startMs).toBe(4500);
    expect(r.endMs).toBe(8500);
  });

  it('matches the segmenter exactly — 2500 before, 1500 after', () => {
    const r = narrow(0, 30000, 10000);
    expect(r.startMs).toBe(10000 - 2500);
    expect(r.endMs).toBe(10000 + 1500);
  });

  it('leaves a NORMAL segment completely alone', () => {
    // A real 4s segment must not be touched — it is already the right answer.
    const r = narrow(3000, 7000, 5500);
    expect(r.startMs).toBe(3000);
    expect(r.endMs).toBe(7000);
  });

  it('never widens a window, only narrows it', () => {
    for (const [a, b, s] of [[0, 11640, 500], [0, 20000, 19000], [2000, 9000, 2100]] as const) {
      const r = narrow(a, b, s);
      expect([a, b, s, r.startMs >= a && r.endMs <= b]).toEqual([a, b, s, true]);
    }
  });

  it('with NO strike, leaves the window alone rather than guessing a centre', () => {
    // A smeared arc beats no arc; inventing a centre would be a guess drawn confidently.
    const r = narrow(0, 11640, null);
    expect(r.startMs).toBe(0);
    expect(r.endMs).toBe(11640);
  });

  it('a strike near the very start still yields a forward-running window', () => {
    const r = narrow(0, 11640, 300);
    expect(r.endMs).toBeGreaterThan(r.startMs);
    expect(r.startMs).toBeGreaterThanOrEqual(0);
  });
});

describe('the screen actually applies it', () => {
  it('uses the strike offset and the segmenter constants', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app/swinglab/swing/[swing_id].tsx'), 'utf8');
    expect(src).toMatch(/MAX_SWING_WINDOW_MS = 6000/);
    expect(src).toMatch(/PRE_MS = 2500, POST_MS = 1500/);
    expect(src).toMatch(/shot\.detectionOffsetSeconds/);
    // The old unbounded expression must not survive.
    expect(src).not.toMatch(/const endMs = \(shot\.clipEndSeconds \?\? duration \?\? 0\) \* 1000;/);
  });

  it('the segmenter still owns those numbers', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const seg = fs.readFileSync(path.join(__dirname, '..', '..', 'services/swing/swingSegmentation.ts'), 'utf8');
    expect(seg).toMatch(/PRE_STRIKE_MS = 2500/);
    expect(seg).toMatch(/POST_STRIKE_MS = 1500/);
  });
});
