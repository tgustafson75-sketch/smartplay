/**
 * 2026-10-15 (John Lonero, beta tester, Cross Creek GC, Temecula — build 31, bundle 01a10f45):
 *
 *   analysis_error: course_search_failed · query: Cross creek · reason: Course search unavailable — check connection
 *   analysis_error: course_locate_failed · reason: timeout · lat: 33.5 · lng: -117.23
 *
 * Our server answered the same search in 0.7s that afternoon, with Cross Creek in the results. The
 * app told him to check his connection with no evidence his connection was the problem — and if he had
 * full 5G, that is us blaming the player for our failure.
 *
 * Now a transport failure asks hosts that are NOT ours (Apple's captive check, Google's 204). Only a
 * proven no-internet blames the connection; a working internet puts the blame on us.
 */
const mockAddAppEvent = jest.fn();
jest.mock('../../store/issueLogStore', () => ({
  useIssueLogStore: { getState: () => ({ addAppEvent: mockAddAppEvent }) },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/', getInfoAsync: async () => ({ exists: false }),
  makeDirectoryAsync: async () => {}, readAsStringAsync: async () => '', writeAsStringAsync: async () => {},
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: async () => null, setItem: async () => {} },
}));

import { searchCourses } from '../../services/golfCourseApi';
import { locateNearbyCourses } from '../../services/courseDownloadEngine';
import { probeReachability, _resetReachabilityForTests } from '../../services/reachability';
import { useConnectivityStore } from '../../store/connectivityStore';

type World = { ours: 'down' | 'up'; internet: 'up' | 'down' | 'portal' | 'slow' };
let clock = 1_000_000;
const APPLE_OK = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';
const PORTAL = '<html><head><title>Hotel Wi-Fi Login</title></head><body>Sign in</body></html>';

function install(w: World): jest.Mock {
  const f = jest.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://captive.apple.com/')) {
      if (w.internet === 'slow') clock += 3000; // a 200-byte page taking 3s
      if (w.internet === 'down') throw new TypeError('Network request failed');
      return new Response(w.internet === 'portal' ? PORTAL : APPLE_OK, { status: 200 });
    }
    if (url.startsWith('https://www.gstatic.com/generate_204')) {
      if (w.internet === 'slow') throw new TypeError('timed out');
      if (w.internet === 'down') throw new TypeError('Network request failed');
      return w.internet === 'portal' ? new Response(PORTAL, { status: 200 }) : new Response(null, { status: 204 });
    }
    // Everything else is OUR backend.
    if (w.ours === 'down' || w.internet !== 'up') throw new TypeError('Network request failed');
    if (url.includes('course-locate')) return new Response(JSON.stringify({ courses: [{ name: 'Cross Creek Golf Club' }] }), { status: 200 });
    return new Response(JSON.stringify({ courses: [{ id: 'nzprff2g', club_name: 'Cross Creek Golf Club', course_name: 'Cross Creek Golf Club', location: { city: 'Temecula', state: 'CA' } }] }), { status: 200 });
  });
  global.fetch = f as unknown as typeof fetch;
  return f;
}

const errorOf = (rows: { _error?: string }[]) => rows.find((r) => r._error)?._error ?? '';
const failedEvent = (stage: string) =>
  mockAddAppEvent.mock.calls.find((c) => c[0] === stage && c[2] === 'analysis_error')?.[1] as Record<string, unknown> | undefined;

let nowSpy: jest.SpyInstance<number, []>;
beforeEach(() => {
  clock = 1_000_000;
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  _resetReachabilityForTests();
  mockAddAppEvent.mockReset();
  useConnectivityStore.setState({ isOnline: true, consecutiveFailures: 0 });
});

afterEach(() => nowSpy.mockRestore());

describe('course search failure message', () => {
  it('THE BUG: internet works, our server does not → never tells the player to check their connection', async () => {
    install({ ours: 'down', internet: 'up' });
    const msg = errorOf(await searchCourses('Cross Creek'));
    expect(msg).not.toMatch(/connection(?! is fine)|signal|internet right now/i);
    expect(msg).toMatch(/on our end/i);
    expect(failedEvent('course_search_failed')).toMatchObject({ net: 'internet_ok' });
    expect(useConnectivityStore.getState().isOnline).toBe(true);
  });

  it('no internet at all (three operators unreachable) → says so, and raises the offline banner', async () => {
    install({ ours: 'down', internet: 'down' });
    const msg = errorOf(await searchCourses('Cross Creek'));
    expect(msg).toMatch(/isn’t reaching the internet/);
    expect(msg).not.toMatch(/signal/i); // we can prove "no internet", never "weak signal"
    expect(failedEvent('course_search_failed')).toMatchObject({ net: 'offline' });
    expect(useConnectivityStore.getState().isOnline).toBe(false);
  });

  it('a Wi-Fi sign-in page intercepting the controls → captive, not "no signal"', async () => {
    install({ ours: 'down', internet: 'portal' });
    expect(errorOf(await searchCourses('Cross Creek'))).toMatch(/Wi-Fi needs you to sign in/);
    expect(failedEvent('course_search_failed')).toMatchObject({ net: 'captive' });
  });

  it('weak signal (control answers, but takes seconds) → "very slow", not "our end", not "no internet"', async () => {
    install({ ours: 'down', internet: 'slow' });
    const msg = errorOf(await searchCourses('Cross Creek'));
    expect(msg).toMatch(/very slow/);
    expect(msg).not.toMatch(/on our end|isn’t reaching/);
    expect(failedEvent('course_search_failed')).toMatchObject({ net: 'slow' });
    expect(useConnectivityStore.getState().isOnline).toBe(true); // slow is not offline
  });

  it('every no-internet message says what still works', async () => {
    install({ ours: 'down', internet: 'down' });
    expect(errorOf(await searchCourses('Cross Creek'))).toMatch(/Yardages and scoring still work/);
  });

  it('a working search proves online and clears a stale banner', async () => {
    install({ ours: 'up', internet: 'up' });
    useConnectivityStore.setState({ isOnline: false, consecutiveFailures: 5 });
    const rows = await searchCourses('Cross Creek');
    expect(rows[0].club_name).toBe('Cross Creek Golf Club');
    expect(useConnectivityStore.getState().isOnline).toBe(true);
  });

  it('a burst of failed searches (one per keystroke) probes the controls once', async () => {
    const f = install({ ours: 'down', internet: 'up' });
    for (const q of ['Cro', 'Cross', 'Cross c']) await searchCourses(q);
    const appleCalls = f.mock.calls.filter((c) => String(c[0]).startsWith('https://captive.apple.com/'));
    expect(appleCalls).toHaveLength(1);
  });
});

describe('course locate failure', () => {
  it('records whether the phone had internet when the lookup failed', async () => {
    install({ ours: 'down', internet: 'up' });
    const res = await locateNearbyCourses(33.5, -117.23);
    expect(res.failure).not.toBeNull();
    expect((res as { net?: string }).net).toBe('internet_ok');
    expect(failedEvent('course_locate_failed')).toMatchObject({ net: 'internet_ok' });
  });
});

describe('offline banner', () => {
  it('three failed calls to OUR backend with the internet up do NOT claim "no internet"', async () => {
    install({ ours: 'down', internet: 'up' });
    const s = useConnectivityStore.getState();
    s.reportNetworkFailure(); s.reportNetworkFailure(); s.reportNetworkFailure();
    await probeReachability();
    await Promise.resolve();
    expect(useConnectivityStore.getState().isOnline).toBe(true);
  });

  it('three failed calls with the internet genuinely down DO raise it', async () => {
    install({ ours: 'down', internet: 'down' });
    const s = useConnectivityStore.getState();
    s.reportNetworkFailure(); s.reportNetworkFailure(); s.reportNetworkFailure();
    await probeReachability();
    await Promise.resolve();
    expect(useConnectivityStore.getState().isOnline).toBe(false);
  });
});

describe('reachability re-ask (review 10-15)', () => {
  it('controls that fail FAST once (radio just resumed) are asked again before calling it offline', async () => {
    let calls = 0;
    global.fetch = jest.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('https://captive.apple.com/')) {
        calls += 1;
        if (calls === 1) throw new TypeError('The network connection was lost.');
        return new Response(APPLE_OK, { status: 200 });
      }
      throw new TypeError('The network connection was lost.');
    }) as unknown as typeof fetch;
    const r = await probeReachability();
    expect(r.verdict).toBe('internet_ok');
    expect(calls).toBe(2);
  });
});

describe('issue log diagnostics', () => {
  it('the emailed snapshot carries the verdict, so the next report answers "app or signal?" itself', async () => {
    install({ ours: 'down', internet: 'up' });
    await probeReachability();
    const { collectDiagnosticSnapshot, formatSnapshotForEmail } = require('../../services/diagnosticSnapshot');
    const text: string = formatSnapshotForEmail(await collectDiagnosticSnapshot());
    expect(text).toMatch(/Network:.*internet internet_ok/);
  });
});
