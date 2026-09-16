/**
 * 2026-09-16 — Sentry 8ea87ebc: WatchdogTermination, iOS 27.0, build 26, route /scorecard.
 *
 * It could not be investigated, and the reason was structural rather than unlucky. A watchdog
 * termination carries no stack trace — the OS kills the process outright, and Sentry infers the
 * whole event on the NEXT launch from a session that ended without a crash, a graceful exit, or a
 * version change. So the only thing that can make one of these diagnosable is state recorded
 * BEFORE the kill, and the app recorded none: a repo-wide search for `memoryWarning` found zero
 * handlers, so iOS's warning was delivered to nobody.
 *
 * The property this guards is the one that was missing — not "a listener is registered" (a source
 * grep would say that), but "after the device complains, a later event can tell how many times".
 * So this fires real warnings through the real AppState seam and reads what Sentry would have been
 * handed.
 *
 * The '0' case is the one most likely to be "tidied up" later, and it is load-bearing. An event
 * with no `memory_warnings` tag is from a build that was not watching; an event tagged '0' is from
 * a build that watched and saw nothing. Collapsing those two makes every future watchdog event as
 * unreadable as the one that prompted this. [[silence-is-not-an-answer]]
 */

const listeners: Record<string, (() => void)[]> = {};
const mockAddEventListener = jest.fn((event: string, cb: () => void) => {
  (listeners[event] ??= []).push(cb);
  return { remove: () => { listeners[event] = (listeners[event] ?? []).filter(f => f !== cb); } };
});
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: mockAddEventListener },
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));

const mockSetTag = jest.fn();
const mockAddBreadcrumb = jest.fn();
const mockCaptureMessage = jest.fn();
jest.mock('@sentry/react-native', () => ({
  setTag: (...a: unknown[]) => mockSetTag(...a),
  addBreadcrumb: (...a: unknown[]) => mockAddBreadcrumb(...a),
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
}));

/**
 * Imported AFTER the mocks above, deliberately — the module reads AppState and Sentry at import
 * time, and the point of this file is to watch what it hands them. `import/first` is disabled for
 * that reason and not as a tidy-up someone should undo.
 */
// eslint-disable-next-line import/first
import {
  startMemoryPressureTracking,
  stopMemoryPressureTracking,
  memoryWarningCount,
  __resetMemoryPressureForTest,
  MEMORY_WARNINGS_TAG,
} from '../../services/memoryPressure';

/** Everything the OS does to this app, as far as this module is concerned. */
const fireMemoryWarning = () => {
  for (const cb of listeners['memoryWarning'] ?? []) cb();
};

const tagValue = (): string | undefined => {
  const hit = [...mockSetTag.mock.calls].reverse().find(c => c[0] === MEMORY_WARNINGS_TAG);
  return hit?.[1] as string | undefined;
};

beforeEach(() => {
  __resetMemoryPressureForTest();
  for (const k of Object.keys(listeners)) delete listeners[k];
  jest.clearAllMocks();
});

describe('a watchdog kill must arrive carrying whether the device was under pressure', () => {
  it('tags the scope 0 before anything has happened — absent and zero are different facts', () => {
    startMemoryPressureTracking();
    // A watchdog event from a build with no tag at all tells you nothing. This is what makes
    // "we were watching, and the device never complained" a statement the log can make.
    expect(tagValue()).toBe('0');
  });

  it('counts each warning onto the scope, which is what survives into the next launch', () => {
    startMemoryPressureTracking();
    fireMemoryWarning();
    expect(tagValue()).toBe('1');
    fireMemoryWarning();
    fireMemoryWarning();
    expect(tagValue()).toBe('3');
    expect(memoryWarningCount()).toBe(3);
  });

  it('leaves a breadcrumb per warning, with the count and time since launch', () => {
    startMemoryPressureTracking();
    fireMemoryWarning();
    fireMemoryWarning();
    const crumbs = mockAddBreadcrumb.mock.calls.map(c => c[0] as { category?: string; data?: Record<string, unknown> });
    const memory = crumbs.filter(c => c.category === 'memory');
    expect(memory).toHaveLength(2);
    expect(memory[1].data?.count).toBe(2);
    expect(typeof memory[1].data?.sinceLaunchMs).toBe('number');
  });

  it('captures exactly ONE event per launch — a thrashing device reports, but only once', () => {
    startMemoryPressureTracking();
    // Without a capture, a device that warns and then SURVIVES reports nothing at all: tags and
    // breadcrumbs only ever surface attached to some other event.
    fireMemoryWarning();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) fireMemoryWarning();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    // ...but the tag kept counting, so the severity is not lost with the noise.
    expect(tagValue()).toBe('51');
  });

  it('is idempotent — a re-mounted root layout must not double-count every warning', () => {
    startMemoryPressureTracking();
    startMemoryPressureTracking();
    startMemoryPressureTracking();
    fireMemoryWarning();
    expect(memoryWarningCount()).toBe(1);
    expect(tagValue()).toBe('1');
  });

  it('stops listening when stopped', () => {
    startMemoryPressureTracking();
    stopMemoryPressureTracking();
    fireMemoryWarning();
    expect(memoryWarningCount()).toBe(0);
  });

  it('a Sentry that throws cannot take the app down with it', () => {
    // Telemetry that can crash the app is worse than no telemetry, and this runs at boot.
    mockSetTag.mockImplementation(() => { throw new Error('transport down'); });
    mockAddBreadcrumb.mockImplementation(() => { throw new Error('transport down'); });
    mockCaptureMessage.mockImplementation(() => { throw new Error('transport down'); });
    expect(() => {
      startMemoryPressureTracking();
      fireMemoryWarning();
    }).not.toThrow();
    // And it still counted, so the app's own view of pressure survives a broken transport.
    expect(memoryWarningCount()).toBe(1);
  });

  it('an AppState with no memoryWarning event leaves the app exactly as it was', () => {
    mockAddEventListener.mockImplementationOnce(() => { throw new Error('unsupported event'); });
    expect(() => startMemoryPressureTracking()).not.toThrow();
    // Off rather than half-on: the next caller must be able to try again.
    expect(memoryWarningCount()).toBe(0);
  });
});
