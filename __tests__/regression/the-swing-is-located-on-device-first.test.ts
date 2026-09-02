/**
 * 2026-09-01 — Tim: "hard to show a wow factor when you have to wait probably more than a minute",
 * and his log the same afternoon: `swing_locate_fallback · cause dead_host · elapsed_ms 9034`, twice.
 *
 * When a clip carries no trimmed swing window, the review path asked a vision model where the swing
 * was: coarse frames uploaded, cold Lambda, 25s client budget. Several seconds of dead time on a good
 * day; on a bad one it aborts and the analysis samples the WHOLE clip, which is the "body mechanics
 * run before the swing even starts" complaint and the head of the chain that ends in an empty trace.
 *
 * A swing is the fastest thing in the clip. deriveSwingAnchors has read start/top/impact/end off the
 * hand-speed signal since 07-21; the missing half was only ever the I/O, and poseAtTime already turns
 * a video time into an on-device pose frame (~100-300ms). So the locate is a dozen thumbnails and
 * some arithmetic.
 */
import fs from 'fs';
import path from 'path';
import { sampleTimesMs, LOCATE_FRAME_COUNT } from '../../services/swing/onDeviceLocate';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('the sample plan covers the swing without sampling the button press', () => {
  it('returns the requested number of times, in order', () => {
    const t = sampleTimesMs(12_000);
    expect(t).toHaveLength(LOCATE_FRAME_COUNT);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it('trims both ends — the record transient lives there and drags the derived start early', () => {
    const dur = 12_000;
    const t = sampleTimesMs(dur);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(dur);
  });

  it('never samples outside the clip, at any duration', () => {
    for (const dur of [6_000, 11_640, 26_000, 120_000]) {
      for (const ms of sampleTimesMs(dur)) {
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(dur);
      }
    }
  });

  it('refuses a degenerate duration rather than inventing times', () => {
    for (const bad of [0, -1, NaN, Infinity]) expect(sampleTimesMs(bad)).toEqual([]);
  });
});

describe('it is tried BEFORE the network, and never replaces it', () => {
  const screen = read('app/swinglab/swing/[swing_id].tsx');

  it('THE ORDER: on-device runs first', () => {
    const onDev = screen.indexOf('locateSwingWindowOnDevice');
    const net = screen.indexOf("await import('../../../services/poseDetection');\n            const loc = await locateSwingWindow");
    expect(onDev).toBeGreaterThan(-1);
    expect(net).toBeGreaterThan(-1);
    expect(onDev).toBeLessThan(net);
  });

  it('the network locate is still there — this adds a path, it does not remove one', () => {
    expect(screen).toMatch(/const loc = await locateSwingWindow\(analyzeUri, durationMs\)/);
    // and it only runs when on-device produced nothing
    const after = screen.slice(screen.indexOf('locateSwingWindowOnDevice'));
    expect(after).toMatch(/if \(!swingWindow\) \{[\s\S]{0,400}?locateSwingWindow\(analyzeUri/);
  });
});

describe('it produces timing, never evidence', () => {
  const src = read('services/swing/onDeviceLocate.ts');

  it('returns only a window and an impact time', () => {
    expect(src).toMatch(/startSec: .*\n\s*endSec: .*\n\s*swingTimeSec:/);
    // nothing here may claim a strike was heard or graded
    for (const forbidden of ['detectionMethod', 'peakDb', 'audio_transient', 'contact']) {
      expect(src).not.toMatch(new RegExp(`${forbidden}\\s*[:=]`));
    }
  });

  it('gives up rather than guessing when the body cannot be seen', () => {
    expect(src).toMatch(/samples\.length < MIN_USABLE_SAMPLES\) return null/);
    expect(src).toMatch(/if \(!anchors\) return null/);
  });

  it('never throws — one unreadable frame is a shorter signal, not a failure', () => {
    expect(src).toMatch(/catch \{\s*\n\s*continue;/);
  });

  it('reads frames serially — concurrent reads on one file are the SIGSEGV class', () => {
    expect(src).toMatch(/for \(const tMs of times\) \{/);
    expect(src).not.toMatch(/Promise\.all\(/);
  });
});
