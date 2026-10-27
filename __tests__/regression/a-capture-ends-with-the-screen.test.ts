/**
 * 2026-10-27 — SmartMotion capture-half audit C1, C3, C4, C6, driven as the races they were.
 *
 * The screen cannot be mounted in jest, so its "is this still wanted after that await?" rule lives in
 * services/capture/captureLife and the screen consults it after every await. These run the same
 * sequences the field could: a stop landing while Record is still opening the meter, Record tapped
 * mid club-scan, leaving during "Analyzing…", a failed capture with a go-again queued.
 */
import { createCaptureLife, CAPTURE_FAILURE_MESSAGE } from '../../services/capture/captureLife';

const deferred = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => { resolve = r; });
  return { p, resolve };
};

describe('C3 — Stop while Record is still opening', () => {
  it('THE REPORT: the start that resumes after a Stop abandons itself; nothing records hidden', async () => {
    const life = createCaptureLife();
    const meter = deferred();
    let cameraStarted = false;
    let meterCancelled = false;

    const start = (async () => {
      const tok = life.beginStart();
      await meter.p;                                  // startMeteredRecording
      if (!life.startStillWanted(tok)) { meterCancelled = true; return; }
      cameraStarted = true;                           // recordAsync
      life.commitStart(tok);
    })();

    // Stop lands now: the screen sees a start in flight, not a recording.
    expect(life.isStarting()).toBe(true);
    life.cancelStart();
    meter.resolve();
    await start;

    expect(cameraStarted).toBe(false);
    expect(meterCancelled).toBe(true);
    expect(life.isStarting()).toBe(false);
  });

  it('two starts racing (a tap and a voice "record"): only the newer one records', async () => {
    const life = createCaptureLife();
    const a = life.beginStart();
    const b = life.beginStart();
    expect(life.startStillWanted(a)).toBe(false);
    expect(life.startStillWanted(b)).toBe(true);
  });

  it('a start that resumes after the screen is gone does not record', () => {
    const life = createCaptureLife();
    const tok = life.beginStart();
    life.end();
    expect(life.startStillWanted(tok)).toBe(false);
  });

  it('an undisturbed start records and is no longer "starting"', () => {
    const life = createCaptureLife();
    const tok = life.beginStart();
    expect(life.startStillWanted(tok)).toBe(true);
    life.commitStart(tok);
    expect(life.isStarting()).toBe(false);
  });
});

describe('C4 — a club scan never runs into a recording', () => {
  it('Record during the 3-2-1: the scan takes no photo and says nothing', () => {
    const life = createCaptureLife();
    const scan = life.beginScan(false)!;
    expect(scan).not.toBeNull();
    life.beginStart();                                // the player tapped Record
    expect(life.scanStillWanted(scan, false)).toBe(false);
  });

  it('a scan whose photo came back after recording began does not apply or speak its result', () => {
    const life = createCaptureLife();
    const scan = life.beginScan(false)!;
    expect(life.scanStillWanted(scan, true)).toBe(false); // recordingPromise set
  });

  it('a scan cannot begin while a capture is starting or recording', () => {
    const life = createCaptureLife();
    expect(life.beginScan(true)).toBeNull();
    life.beginStart();
    expect(life.beginScan(false)).toBeNull();
  });

  it('a scan left alone still completes', () => {
    const life = createCaptureLife();
    const scan = life.beginScan(false)!;
    expect(life.scanStillWanted(scan, false)).toBe(true);
  });
});

describe('C1 — leaving during "Analyzing…"', () => {
  it('the swing is still saved and read, but nothing speaks, listens or navigates for a screen that is gone', () => {
    const life = createCaptureLife();
    life.end();
    expect(life.followUps({ swingCount: 1, putt: false })).toEqual({ narrateSet: false, announceDone: false });
    expect(life.followUps({ swingCount: 4, putt: false })).toEqual({ narrateSet: false, announceDone: false });
    expect(life.isAlive()).toBe(false);               // gates the putt read and the Smart Tempo return
  });

  it('on the screen: a set is narrated, a single swing announces the session', () => {
    const life = createCaptureLife();
    expect(life.followUps({ swingCount: 4, putt: false })).toEqual({ narrateSet: true, announceDone: false });
    expect(life.followUps({ swingCount: 1, putt: false })).toEqual({ narrateSet: false, announceDone: true });
    expect(life.followUps({ swingCount: 1, putt: true })).toEqual({ narrateSet: false, announceDone: false });
  });

  it('remounting (dev double-mount) revives it', () => {
    const life = createCaptureLife();
    life.end();
    life.mount();
    expect(life.isAlive()).toBe(true);
  });
});

describe('C6 — a failed capture is said, and does not leave a go-again armed', () => {
  it('THE REPORT: go-again queued during the read, the capture fails → the next review does not auto-save and re-record', () => {
    const life = createCaptureLife();
    life.queueGoAgain();
    const msg = life.captureFailed('no_file');
    expect(msg).toBe(CAPTURE_FAILURE_MESSAGE.no_file);
    expect(msg.length).toBeGreaterThan(0);
    expect(life.takeQueuedGoAgain()).toBe(false);
  });

  it('a new start drops a stale queued go-again', () => {
    const life = createCaptureLife();
    life.queueGoAgain();
    life.beginStart();
    expect(life.hasQueuedGoAgain()).toBe(false);
  });

  it('a queued go-again fires once', () => {
    const life = createCaptureLife();
    life.queueGoAgain();
    expect(life.takeQueuedGoAgain()).toBe(true);
    expect(life.takeQueuedGoAgain()).toBe(false);
  });

  it('the camera refusing to start has its own message', () => {
    expect(createCaptureLife().captureFailed('camera_refused')).toBe(CAPTURE_FAILURE_MESSAGE.camera_refused);
  });
});
