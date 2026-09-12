/**
 * 2026-09-12 — RAISING A PERSISTED DEFAULT REACHES NOBODY.
 *
 * Tim: "we have already proven it works better at 60, and if I am not mistaken that is like
 * minimum… most if not all phones now have 60fps." So DEFAULT_USE_VISION_CAMERA goes true.
 *
 * THE TRAP. `useVisionCamera` is persisted. Every device that has ever opened the app already has
 * `false` on disk — not because anyone chose expo-camera, but because that was the compile-time
 * default and persist wrote it out. Raising the default alone would have changed the behaviour of
 * exactly ZERO existing players, while shipping green, passing every gate, and looking done.
 *
 * A DEFAULT READ BACK AS A CHOICE is a defect this project has paid for before — it sent a whole
 * audit in the wrong direction. [[nobody-chose-cage-the-default-did]]
 *
 * The fix is to record the difference: `chosenByUser` is set only by an explicit flip, and the v2
 * migration adopts the new default for everyone who never expressed a preference while preserving
 * the owner's A/B choice the moment they make one.
 */
import fs from 'fs';
import path from 'path';
import { DEFAULT_USE_VISION_CAMERA, MIN_TRACE_FPS, PREFERRED_CAPTURE_FPS } from '../../services/capture/captureFlags';
import { useCaptureEngineStore } from '../../store/captureEngineStore';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const STORE = code('store/captureEngineStore.ts');

/**
 * THE REAL migration, pulled off the live persist options — not a copy.
 *
 * 2026-09-12: this file first MIRRORED the rule here, and the break-test caught it. Replacing the
 * shipped migration with a passthrough left all eleven tests green, because they were exercising the
 * mirror. A guard that re-implements its subject cannot fail when the subject rots, which is the
 * whole failure mode this project keeps paying for. [[break-test-every-guard-you-write]]
 */
const migrate = (persisted: Record<string, unknown>, version: number) => {
  const fn = useCaptureEngineStore.persist.getOptions().migrate;
  if (!fn) throw new Error('no migrate on the persist options — the v2 migration is gone');
  return fn(persisted, version) as Record<string, unknown>;
};

describe('the engine default is actually on', () => {
  it('vision-camera is the default', () => {
    expect(DEFAULT_USE_VISION_CAMERA).toBe(true);
  });

  it('and the fps floor it makes meaningful is unchanged', () => {
    expect(MIN_TRACE_FPS).toBe(60);
    expect(PREFERRED_CAPTURE_FPS).toBeGreaterThanOrEqual(MIN_TRACE_FPS);
  });
});

describe('an unchosen value on disk adopts the new default', () => {
  it('a v1 record flips, because nobody chose it', () => {
    expect(migrate({ useVisionCamera: false }, 1).useVisionCamera).toBe(true);
  });

  it('and is marked unchosen, so it keeps following the default in future', () => {
    expect(migrate({ useVisionCamera: false }, 1).chosenByUser).toBe(false);
  });

  it('a v2 record is left completely alone — that one IS a preference', () => {
    const chosen = { useVisionCamera: false, chosenByUser: true };
    expect(migrate(chosen, 2)).toEqual(chosen);
  });

  it('the migration cannot run twice and re-flip a later opt-out', () => {
    const after = migrate(migrate({ useVisionCamera: false }, 1) as Record<string, unknown>, 2);
    expect(after.useVisionCamera).toBe(true);
    const optedOut = { useVisionCamera: false, chosenByUser: true };
    expect(migrate(optedOut, 2).useVisionCamera).toBe(false);
  });
});

describe('only a human sets chosenByUser', () => {
  it('both explicit setters mark it', () => {
    expect(STORE).toMatch(/setUseVisionCamera: \(on\) => set\(\{ useVisionCamera: on, chosenByUser: true \}\)/);
    expect(STORE).toMatch(/toggleVisionCamera: \(\) => set\(\{ useVisionCamera: !get\(\)\.useVisionCamera, chosenByUser: true \}\)/);
  });

  it('the initial state does NOT — that is the whole distinction', () => {
    expect(STORE).toMatch(/useVisionCamera: DEFAULT_USE_VISION_CAMERA,\s*chosenByUser: false,/);
  });

  it('it is persisted, or the distinction is lost on the next launch', () => {
    expect(STORE).toMatch(/partialize: \(s\) => \(\{[\s\S]{0,200}?chosenByUser: s\.chosenByUser/);
  });

  it('the version was actually bumped, or the migration never runs', () => {
    expect(STORE).toMatch(/version: 2,/);
  });

  it('capturedFps stays OUT of the persisted shape — it is a property of this device and format', () => {
    const at = STORE.indexOf('partialize:');
    expect(STORE.slice(at, at + 220)).not.toMatch(/capturedFps/);
  });
});
