/**
 * 2026-09-12 — THE HIGH-FPS ENGINE COULD LEAVE THE PLAYER WITH NO CAMERA AT ALL.
 *
 * smartmotion picks the capture engine with a lazy require, and that require failing (a build that
 * never linked vision-camera) already falls back to expo-camera. But once the module IS linked, the
 * parent has committed to the vision branch — and SwingVisionCamera's own `if (!device) return null`
 * then renders NOTHING. Blank frame, no recording, on a screen whose entire job is to record.
 *
 * That is strictly worse than the 30fps engine it replaced, and it is the failure that matters most
 * as the default moves toward vision-camera: Tim, 2026-09-12 — "we have already proven it works
 * better at 60… most if not all phones now have 60fps."
 *
 * The fallback is reported from an EFFECT, not from render. Calling a parent's setState during
 * render is a React warning at best and a loop at worst.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CAM = code('components/capture/SwingVisionCamera.tsx');
const SM = code('app/swinglab/smartmotion.tsx');

describe('a device-less vision camera hands control back', () => {
  it('the component reports it rather than rendering an empty frame silently', () => {
    expect(CAM).toMatch(/onUnavailable\?: \(\) => void/);
    expect(CAM).toMatch(/if \(!device\) onUnavailable\?\.\(\)/);
  });

  it('reports from an effect, never during render', () => {
    const at = CAM.indexOf('onUnavailable?.()');
    expect(at).toBeGreaterThan(-1);
    const before = CAM.slice(Math.max(0, at - 200), at);
    expect(before).toMatch(/useEffect\(\(\) => \{/);
  });

  it('still returns null after reporting — it genuinely cannot render', () => {
    expect(CAM).toMatch(/if \(!device\) return null;/);
  });
});

describe('smartmotion falls back for the rest of the session', () => {
  it('an unavailable vision engine drops it out of the selection', () => {
    expect(SM).toMatch(/if \(!useVisionCamera \|\| visionUnavailable\) return null;/);
    expect(SM).toMatch(/\}, \[useVisionCamera, visionUnavailable\]\);/);
  });

  it('wires the callback so the flag can actually be set', () => {
    expect(SM).toMatch(/onUnavailable=\{\(\) => \{/);
    expect(SM).toMatch(/setVisionUnavailable\(true\)/);
  });

  it('the opt-out is component state, NOT the persisted engine toggle', () => {
    /**
     * Persisting it would permanently downgrade a 120fps phone after one transient failure, and the
     * player would have no idea why their swings got coarser. It must re-try next mount.
     */
    expect(SM).toMatch(/useState\(false\)/);
    expect(SM).not.toMatch(/setUseVisionCamera\(false\)/);
  });

  it('the pre-existing missing-module fallback is untouched', () => {
    // A build that never linked vision-camera must still quietly use expo-camera.
    expect(SM).toMatch(/require\('\.\.\/\.\.\/components\/capture\/SwingVisionCamera'\)/);
    expect(SM).toMatch(/catch \{/);
  });
});

describe('the fps floor still means something', () => {
  it('MIN_TRACE_FPS gates the drawn trace on a KNOWN fps', () => {
    expect(SM).toMatch(/capturedFps != null && capturedFps < MIN_TRACE_FPS/);
  });

  it('and only the vision engine publishes one, which is why it knows', () => {
    expect(CAM).toMatch(/setCapturedFps\(fps \?\? null\)/);
    // expo-camera has no frame-rate control and reports nothing — so null means "unknown", not 30.
    expect(code('services/capture/captureFlags.ts')).toMatch(/MIN_TRACE_FPS = 60/);
  });
});
