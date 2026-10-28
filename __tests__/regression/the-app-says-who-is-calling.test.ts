/**
 * 2026-10-27 (security audit Section 4) — the app sends its RevenueCat id to OUR API, and only there.
 */
import { installCallerIdentityHeader, setCallerAppUserId, CALLER_ID_HEADER, __resetCallerIdentityForTest } from '../../services/callerIdentity';
import { getApiBaseUrl } from '../../services/apiBase';

const realFetch = globalThis.fetch;
let seen: { url: string; headers: Headers }[];

beforeEach(() => {
  __resetCallerIdentityForTest();
  seen = [];
  globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return { ok: true } as Response;
  }) as never;
  installCallerIdentityHeader();
});
afterAll(() => { globalThis.fetch = realFetch; });

it('every request to our API carries the id once billing knows it', async () => {
  setCallerAppUserId('$RCAnonymousID:abc');
  await fetch(`${getApiBaseUrl()}/api/kevin`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  expect(seen[0].headers.get(CALLER_ID_HEADER)).toBe('$RCAnonymousID:abc');
  expect(seen[0].headers.get('content-type')).toBe('application/json');   // the caller's headers survive
});

it('no other host ever sees it', async () => {
  setCallerAppUserId('$RCAnonymousID:abc');
  await fetch('https://api.mapbox.com/styles/v1/x', {});
  await fetch('https://o1.ingest.us.sentry.io/api/1/store/', {});
  expect(seen.every((r) => !r.headers.has(CALLER_ID_HEADER))).toBe(true);
});

it('before RevenueCat answers, requests go out exactly as before', async () => {
  await fetch(`${getApiBaseUrl()}/api/kevin`, {});
  expect(seen[0].headers.has(CALLER_ID_HEADER)).toBe(false);
});

it('a header the caller set itself is never overwritten', async () => {
  setCallerAppUserId('$RCAnonymousID:abc');
  await fetch(`${getApiBaseUrl()}/api/kevin`, { headers: { [CALLER_ID_HEADER]: 'explicit' } });
  expect(seen[0].headers.get(CALLER_ID_HEADER)).toBe('explicit');
});
