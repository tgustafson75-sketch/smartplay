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

/**
 * 2026-10-04 (orchestrator phase 3) — the order "device first, network as the fallback" now lives in
 * ONE place, services/swing/analysisOrchestrator.findUploadSwingWindow (behaviour-tested in
 * one-owner-runs-swing-analysis). The swing screen and analyzeSwing used to carry private copies of
 * it; they now ask the finder. What these guard: nobody calls the network locate except the finder
 * and the upload impact-search (which still asks the device first), and the finder keeps the order.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('it is tried BEFORE the network, and never replaces it', () => {
  const finder = strip(read('services/swing/analysisOrchestrator.ts'));

  it('THE ORDER: on-device runs first, inside the one finder', () => {
    const onDev = finder.indexOf('locateSwingWindowOnDevice(clipUri');
    const net = finder.indexOf('await locateSwingWindow(clipUri');
    expect(onDev).toBeGreaterThan(-1);
    expect(net).toBeGreaterThan(-1);
    expect(onDev).toBeLessThan(net);
  });

  it('the network locate is still there, after the device came back empty', () => {
    expect(finder).toMatch(/if \(onDev && onDev\.endSec > onDev\.startSec\) \{[\s\S]{0,300}?return[\s\S]{0,400}?await locateSwingWindow\(clipUri/);
  });
});

describe('it produces timing, never evidence', () => {
  const raw = read('services/swing/onDeviceLocate.ts');
  // Strip comments before asserting — the header legitimately NAMES the helper it refuses to use,
  // and matching that is the prose-guard mistake this suite exists to avoid.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  it('returns only a window and an impact time', () => {
    expect(src).toMatch(/startSec: .*\n\s*endSec: .*\n\s*swingTimeSec:/);
    // nothing here may claim a strike was heard or graded
    for (const forbidden of ['detectionMethod', 'peakDb', 'audio_transient', 'contact']) {
      expect(src).not.toMatch(new RegExp(`${forbidden}\\s*[:=]`));
    }
  });

  it('gives up rather than guessing when the body cannot be seen', () => {
    expect(src).toMatch(/samples\.length < MIN_USABLE_SAMPLES\)\s*(\{[^}]*)?return null/);
    expect(src).toMatch(/if \(!anchors\)\s*(\{[^}]*)?return null/);
  });

  it('never throws — one unreadable frame is a shorter signal, not a failure', async () => {
    // 2026-10-03 — was a source-text match on the old inline loop; the search moved into
    // searchSwingWindow (testable with a reader), so check the BEHAVIOUR: unreadable frames are skipped.
    const { searchSwingWindow } = await import('../../services/swing/onDeviceLocate');
    let n = 0;
    const swing = (t: number) => ({ tMs: t, x: 0.5 + (t > 6000 && t < 7000 ? (t - 6000) / 2000 : 0), y: t > 5500 && t < 6600 ? 0.4 : 0.6 });
    const flaky = async (t: number) => (++n % 4 === 0 ? null : swing(t));
    const w = await searchSwingWindow(14000, flaky);
    expect(n).toBeGreaterThan(12); // it kept reading past the misses (coarse + refine)
    expect(w === null || typeof w.swingTimeSec === 'number').toBe(true);
  });

  it('THE TRAP: it never touches the helper that falls through to a cloud proxy', () => {
    // poseAnalysisApi.poseAtTime is the obvious helper and would have been a bug: when the native
    // module is missing it reaches /api/pose-analysis, so a "locate without the network" would have
    // fired a dozen network calls and been SLOWER than the single vision call it replaced.
    expect(src).not.toMatch(/poseAtTime/);
    expect(src).not.toMatch(/poseAnalysisApi/);
    expect(src).toMatch(/detectPoseFromUri/);
  });

  it('checks the native module is actually there before decoding anything', () => {
    expect(src).toMatch(/getMediaPipeStatus\(\)/);
    expect(src).toMatch(/if \(!status\?\.available\)\s*(\{[^}]*)?return null/);
  });

  it('the budget stops the sweep — a slow device answers from what it has', async () => {
    const { searchSwingWindow } = await import('../../services/swing/onDeviceLocate');
    let now = 0; let reads = 0;
    const slowRead = async (t: number) => { reads++; now += 2_000; return { tMs: t, x: 0.5, y: 0.6 }; };
    await searchSwingWindow(14000, slowRead, () => now);
    // 2s a frame: the 6s coarse budget (from the first good frame) stops the sweep at ~5 of 12, and the
    // 6s refine budget at ~3 more — bounded, instead of 12 coarse + up to 24 refine reads.
    expect(reads).toBeLessThanOrEqual(10);
  });

  it('has a BUDGET — it replaced a slow thing and must not become one', () => {
    expect(src).toMatch(/const BUDGET_MS = 6_000/);
    // 2026-10-03 — the clock is injectable now; prove the budget actually stops the sweep.
    expect(src).toMatch(/if \(clock\(\) > deadline\) break/);
    // and it answers from what it collected rather than discarding the work
    expect(src).toMatch(/samples\.length < MIN_USABLE_SAMPLES\)\s*(\{[^}]*)?return null/);
  });

  it('bails early instead of paying for a dozen hopeless decodes', () => {
    expect(src).toMatch(/consecutiveMisses >= 3 && samples\.length === 0\)\s*(\{[^}]*)?return null/);
  });

  it('reads frames serially — concurrent reads on one file are the SIGSEGV class', () => {
    expect(src).toMatch(/for \(const tMs of times\) \{/);
    expect(src).not.toMatch(/Promise\.all\(/);
  });
});

describe('EVERY surface that asks where the swing is asks the device first', () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((d) => d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  const files = [...walk('app'), ...walk('services'), ...walk('components'), ...walk('hooks')];

  it('the analysis and the upload run ask the ONE finder', () => {
    expect(strip(read('services/poseDetection.ts'))).toMatch(/findUploadSwingWindow\(clipUri, probedDurMs \/ 1000, \{/);
    expect(strip(read('services/swing/orchestrator/uploadRun.ts'))).toMatch(/findUploadSwingWindow\(shot\.clipUri,/);
  });

  it('only the finder and the upload impact-search call the network locate — and both ask the device first', () => {
    // 2026-10-05 — the body read's impact search moved from videoUpload's pose pass to the one shot runner.
    const net = /await (?:\w+\.)?locateSwingWindow\(/;
    const callers = files.filter((f) => net.test(strip(read(f))));
    expect(callers.sort()).toEqual(['services/swing/analysisOrchestrator.ts', 'services/swing/orchestrator/shotDetail.ts']);
    for (const f of callers) {
      const src = strip(read(f));
      expect(src.indexOf('locateSwingWindowOnDevice(')).toBeGreaterThan(-1);
      expect(src.indexOf('locateSwingWindowOnDevice(')).toBeLessThan(src.search(net));
    }
    expect(strip(read('services/swing/orchestrator/shotDetail.ts'))).toMatch(/if \(!loc && !signal\.aborted\) loc = await pd\.locateSwingWindow\(/);
  });
});

describe('the analysis itself locates on-device — every caller benefits', () => {
  const pose = strip(read('services/poseDetection.ts'));
  const finder = strip(read('services/swing/analysisOrchestrator.ts'));

  it('analyzeSwing keeps its plan: the network only for long clips', () => {
    expect(pose).toMatch(/allowNetwork: locatePlan === 'full'/);
  });

  it('the abort reason is still reported when the network locate DOES run', () => {
    expect(pose).toMatch(/onNetworkAbort: \(cause\) => \{ locateDegraded = cause; \}/);
    expect(finder).toMatch(/locateSwingWindow\(clipUri, dur \* 1000, \{ onAbort: opts\.onNetworkAbort \}\)/);
  });

  it('it is a DYNAMIC import — a static edge here would be a needless cycle', () => {
    expect(pose).toMatch(/await import\('\.\/swing\/analysisOrchestrator'\)/);
  });
});
