/**
 * 2026-09-29 — THE SWING CAMERA RECORDS 60 BY DEFAULT, 120 ONLY WHEN ASKED, NEVER ABOVE 1080p, AND
 * NEVER CRASHES ON A DEVICE WITHOUT THE FORMAT.
 *
 * The old selection asked every phone for 120fps and then took the LARGEST resolution — a 4K clip on
 * a 4K60 phone, a dark 120fps clip indoors. The choice is now the pure selectCaptureFormat, so every
 * device shape can be proved here instead of on a phone nobody has.
 */
import { selectCaptureFormat } from '../../services/capture/captureFormat';
import { HIGH_SPEED_CAPTURE_FPS, MIN_TRACE_FPS, TARGET_CAPTURE_FPS } from '../../services/capture/captureFlags';
import { useCaptureEngineStore } from '../../store/captureEngineStore';

const f = (w: number, h: number, maxFps: number, minFps = 1) => ({ videoWidth: w, videoHeight: h, maxFps, minFps, id: `${w}x${h}@${minFps}-${maxFps}` });

// A modern flagship: 4K60, 1080p up to 240 (slow-mo), 1080p 60, 720p 240.
const FLAGSHIP = [f(3840, 2160, 60), f(1920, 1080, 60), f(1920, 1080, 240, 120), f(1920, 1080, 120), f(1280, 720, 240)];
// A budget phone: 1080p 30 only, 720p 60.
const BUDGET = [f(1920, 1080, 30), f(1280, 720, 60)];
// An old phone: 30fps everywhere.
const OLD = [f(1920, 1080, 30), f(1280, 720, 30)];

describe('the default is 60, capped at 1080p', () => {
  it('the target and the trace floor agree', () => {
    expect(TARGET_CAPTURE_FPS).toBe(60);
    expect(HIGH_SPEED_CAPTURE_FPS).toBe(120);
    expect(MIN_TRACE_FPS).toBe(60);
  });

  it('a 4K60 phone records 1080p60, not 4K60', () => {
    const c = selectCaptureFormat(FLAGSHIP, { highSpeedOptIn: false });
    expect(c.fps).toBe(60);
    expect(c.format!.id).toBe('1920x1080@1-60');
  });

  it('prefers the most detail that reaches 60 — a budget phone takes 720p60 over 1080p30', () => {
    const c = selectCaptureFormat(BUDGET, { highSpeedOptIn: false });
    expect(c.fps).toBe(60);
    expect(c.format!.id).toBe('1280x720@1-60');
  });
});

describe('120 only when the player opted in AND the device can', () => {
  it('opted in on a capable phone → 1080p at 120, from a format that can run at 120', () => {
    const c = selectCaptureFormat(FLAGSHIP, { highSpeedOptIn: true });
    expect(c.fps).toBe(120);
    expect(c.format!.videoHeight).toBe(1080);
    expect(c.format!.minFps).toBeLessThanOrEqual(120);
    expect(c.highSpeedAvailable).toBe(true);
  });

  it('not opted in on the same phone → 60, never the slow-mo format', () => {
    const c = selectCaptureFormat(FLAGSHIP, { highSpeedOptIn: false });
    expect(c.fps).toBe(60);
    expect(c.format!.minFps).toBeLessThanOrEqual(60);
  });

  it('opted in on a phone that cannot → quietly 60, and the toggle is not offered', () => {
    const c = selectCaptureFormat(BUDGET, { highSpeedOptIn: true });
    expect(c.fps).toBe(60);
    expect(c.highSpeedAvailable).toBe(false);
  });

  it('a 120 that only exists above 1080p does not count', () => {
    expect(selectCaptureFormat([f(3840, 2160, 120), f(1920, 1080, 60)], { highSpeedOptIn: true }).highSpeedAvailable).toBe(false);
  });
});

describe('graceful on devices without the format', () => {
  it('a 30fps-only phone gets 30 — the existing low-fps notice then says what that costs', () => {
    const c = selectCaptureFormat(OLD, { highSpeedOptIn: true });
    expect(c.fps).toBe(30);
    expect(c.format!.id).toBe('1920x1080@1-30');
  });

  it('never picks a slow-motion-only mode as the fallback when a normal one exists', () => {
    const c = selectCaptureFormat([f(1920, 1080, 30), f(1280, 720, 240, 120)], { highSpeedOptIn: false });
    expect(c.fps).toBe(30);
    expect(c.format!.id).toBe('1920x1080@1-30');
  });

  it('every format above 1080p → still a camera (uses what it has)', () => {
    const c = selectCaptureFormat([f(3840, 2160, 30)], { highSpeedOptIn: false });
    expect(c.fps).toBe(30);
    expect(c.format).not.toBeNull();
  });

  it('no formats, or garbage formats → no format and no fps, never a throw', () => {
    for (const bad of [[], null, undefined, [f(0, 0, 60)], [{ videoWidth: NaN, videoHeight: 1080, maxFps: 60 }]]) {
      const c = selectCaptureFormat(bad as never, { highSpeedOptIn: true });
      expect(c).toEqual({ format: null, fps: null, highSpeedAvailable: false });
    }
  });

  it('the requested fps is always inside the chosen format range', () => {
    for (const set of [FLAGSHIP, BUDGET, OLD]) for (const optIn of [true, false]) {
      const c = selectCaptureFormat(set, { highSpeedOptIn: optIn });
      expect(c.fps!).toBeLessThanOrEqual(c.format!.maxFps);
      expect(c.fps!).toBeGreaterThanOrEqual(c.format!.minFps);
    }
  });
});

describe('the 120 opt-in is a persisted preference, default OFF', () => {
  it('defaults off', () => {
    expect(useCaptureEngineStore.getInitialState().highSpeedOptIn).toBe(false);
  });

  it('is persisted; whether this device CAN do it, and the reviewed clip, are not', () => {
    const partialize = useCaptureEngineStore.persist.getOptions().partialize!;
    const saved = partialize({
      ...useCaptureEngineStore.getState(), highSpeedOptIn: true, highSpeedAvailable: true, reviewingClip: { fps: 30 },
    }) as Record<string, unknown>;
    expect(saved.highSpeedOptIn).toBe(true);
    expect('highSpeedAvailable' in saved).toBe(false);
    expect('reviewingClip' in saved).toBe(false);
  });

  it('an older persisted record (no field) reads as off', () => {
    const migrate = useCaptureEngineStore.persist.getOptions().migrate!;
    const out = migrate({ useVisionCamera: true, chosenByUser: true }, 2) as Record<string, unknown>;
    expect(out.highSpeedOptIn ?? false).toBe(false);
  });
});
