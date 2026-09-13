import * as fs from 'fs';
import * as path from 'path';

const abs = (r: string) => path.resolve(__dirname, '../../', r);
const read = (r: string) => fs.readFileSync(abs(r), 'utf-8');

/**
 * 2026-09-12 (Tim) — "this is the correct resting screen logo."
 *
 * The rest screen was showing mic-caddie.png: the wrong mark, and a bad crop of it — two head
 * profiles bleeding off both edges of a landscape box.
 */
/** Prose naming the thing it forbids is the oldest way a guard in this repo goes green while the
 *  defect stands — it cost four guards in one session on 08-31, and it caught THIS test on the first
 *  run, because the comment explaining the swap names the old asset. Strip comments, then assert.
 *  [[strip-comments-before-a-guard-matches]] [[my-own-comment-defeats-my-own-guard]] */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the rest screen shows the caddie mark', () => {
  const overlay = read('components/round/RestModeOverlay.tsx');
  const code = stripComments(overlay);

  it('points at the caddie mark, not the neon outline', () => {
    expect(code).toMatch(/assets\/icons\/caddie\/rest-caddie\.png/);
    expect(code).not.toMatch(/mic-caddie\.png/);
  });

  /**
   * THE BOX MUST BE SQUARE. The old 240x128 was cut for the landscape outline; under
   * resizeMode="contain" it would render this square mark at 128px tall inside a 240-wide box — the
   * new logo arriving and getting smaller.
   */
  it('renders it in a square box', () => {
    const m = overlay.match(/mark: \{ width: (\d+), height: (\d+)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(m![2]);
  });

  /** Tim: "just dim it out a bit" — a nudge, not a fade. It still has to read from a bag clip. */
  it('is dimmed but still legible', () => {
    const op = overlay.match(/mark: \{[^}]*opacity: ([\d.]+)/);
    expect(op).not.toBeNull();
    const v = Number(op![1]);
    expect(v).toBeLessThan(0.9);
    expect(v).toBeGreaterThanOrEqual(0.6);
  });

  /** The screen's pure #000 is load-bearing: on OLED those pixels are physically off. */
  it('keeps the backdrop pure black', () => {
    expect(overlay).toMatch(/backgroundColor: '#000'/);
  });

  /**
   * THE ASSET ITSELF. The source arrived with the backdrop BAKED IN (hasAlpha: no), which on a pure
   * black screen shows as a lighter square and lights every pixel inside it — against the one job
   * this screen has. Asserted on the PNG bytes, because a comment saying "transparent" is not a
   * transparent file.
   */
  it('the asset has a real alpha channel and a transparent corner', () => {
    const buf = fs.readFileSync(abs('assets/icons/caddie/rest-caddie.png'));
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    // IHDR: width/height at 16..24, colour type at byte 25. 6 = RGBA, 4 = grey+alpha.
    const colourType = buf[25];
    expect([4, 6]).toContain(colourType);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(height);          // square, so the square box frames it exactly
    expect(width).toBeLessThan(1024);    // cropped to content, not the original full frame
    expect(width).toBeGreaterThan(200);  // still enough pixels for a 200pt box at 3x
  });
});
