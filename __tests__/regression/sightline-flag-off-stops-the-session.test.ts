/**
 * 2026-10-10 — the glasses kill switch must KILL: turning `glasses_enabled` off stops a running glasses
 * session, not just new starts. Before this, watchSightline only ever started.
 */
const removed = jest.fn();
const mw = {
  register: jest.fn(),
  getRegistrationState: jest.fn(() => 'REGISTERED'),
  requestCameraPermission: jest.fn(async () => 'GRANTED'),
  startSession: jest.fn(async () => undefined),
  stopSession: jest.fn(),
  startStream: jest.fn(async () => undefined),
  stopStream: jest.fn(),
  capturePhoto: jest.fn(async () => 'file:///x.jpg'),
  addListener: jest.fn(() => ({ remove: removed })),
};
let mockGate = true;
const flagListeners: (() => void)[] = [];

jest.mock('../../glasses-modules/meta-wearables', () => ({ metaWearables: () => mw }));
jest.mock('../../services/glassesGate', () => ({ isGlassesSurfaceEnabled: () => mockGate }));
jest.mock('../../store/flagStore', () => ({
  useFlagStore: { subscribe: (cb: () => void) => { flagListeners.push(cb); return () => {}; } },
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
const flipFlag = (on: boolean) => { mockGate = on; flagListeners.forEach((cb) => cb()); };

describe('flag off stops a running glasses session', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); flagListeners.length = 0; mockGate = true; });

  it('gate true → session up; flag off → stopSession exactly once, listeners removed, no glasses reads', async () => {
    const sl = await import('../../services/sightline');
    sl.watchSightline();
    await tick();
    expect(mw.startSession).toHaveBeenCalledTimes(1);
    expect(sl.glassesSessionActive()).toBe(true);

    flipFlag(false);
    expect(mw.stopSession).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(mw.addListener.mock.calls.length);
    expect(sl.glassesSessionActive()).toBe(false);
    expect(await sl.readThroughGlasses()).toBe(false);

    flipFlag(false);   // a second flag change while off does nothing more
    expect(mw.stopSession).toHaveBeenCalledTimes(1);
  });

  it('flag back on restarts cleanly', async () => {
    const sl = await import('../../services/sightline');
    sl.watchSightline();
    await tick();
    flipFlag(false);
    flipFlag(true);
    await tick();
    expect(mw.startSession).toHaveBeenCalledTimes(2);
    expect(sl.glassesSessionActive()).toBe(true);
  });

  it('flag off while the session is still starting → it is stopped when it comes up', async () => {
    let resolve!: () => void;
    mw.startSession.mockImplementationOnce(() => new Promise<undefined>((r) => { resolve = () => r(undefined); }));
    const sl = await import('../../services/sightline');
    sl.watchSightline();
    flipFlag(false);
    resolve();
    await tick();
    expect(mw.stopSession).toHaveBeenCalledTimes(1);
    expect(sl.glassesSessionActive()).toBe(false);
  });
});
