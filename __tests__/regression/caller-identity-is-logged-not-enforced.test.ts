/**
 * 2026-10-27 (security audit Section 4) — caller identity on paid routes, PHASE 1: LOG ONLY.
 *
 * Every paid route goes through api/_inferLimit.allowInference, which now identifies the caller from
 * `x-rc-app-user-id` via RevenueCat (api/_callerIdentity). In this phase every request is still served,
 * whatever the verdict. Enforcement is ONE line: ENFORCE_CALLER_IDENTITY = true.
 */
import { verifyCaller, ENFORCE_CALLER_IDENTITY, __resetCallerIdentityForTest } from '../../api/_callerIdentity';
import { allowInference } from '../../api/_inferLimit';

const realFetch = global.fetch;
let rcAnswers: Record<string, unknown>;
let rcCalls = 0;

function req(id?: string, ip = '1.2.3.4') {
  return { headers: { 'x-forwarded-for': ip, ...(id ? { 'x-rc-app-user-id': id } : {}) }, socket: {} } as never;
}
function res() {
  const r = { code: 200, status(c: number) { r.code = c; return r; }, json() { return r; } };
  return r;
}

beforeEach(() => {
  __resetCallerIdentityForTest();
  rcCalls = 0;
  rcAnswers = {};
  process.env.REVENUECAT_SECRET_KEY = 'sk_test';
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('sentry.io')) return { ok: true } as Response;
    rcCalls++;
    const id = decodeURIComponent(String(url).split('/subscribers/')[1] ?? '');
    const body = rcAnswers[id];
    if (body === undefined) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as never;
});
afterAll(() => { global.fetch = realFetch; delete process.env.REVENUECAT_SECRET_KEY; });

describe('the verdict', () => {
  it('an active smartplay_caddie_pro entitlement is pro', async () => {
    rcAnswers['$RCAnonymousID:abc'] = { subscriber: { entitlements: { smartplay_caddie_pro: { expires_date: new Date(Date.now() + 86_400_000).toISOString() } } } };
    expect(await verifyCaller(req('$RCAnonymousID:abc'))).toBe('pro');
  });

  it('an expired one, or none, is no_entitlement', async () => {
    rcAnswers.lapsed = { subscriber: { entitlements: { smartplay_caddie_pro: { expires_date: '2020-01-01T00:00:00Z' } } } };
    rcAnswers.free = { subscriber: { entitlements: {} } };
    expect(await verifyCaller(req('lapsed'))).toBe('no_entitlement');
    expect(await verifyCaller(req('free'))).toBe('no_entitlement');
  });

  it('no header is missing_id; a malformed one is invalid_id; neither asks RevenueCat', async () => {
    expect(await verifyCaller(req())).toBe('missing_id');
    expect(await verifyCaller(req('has space'))).toBe('invalid_id');
    expect(rcCalls).toBe(0);
  });

  it('without the secret key nothing is asked and the answer is unverified', async () => {
    delete process.env.REVENUECAT_SECRET_KEY;
    expect(await verifyCaller(req('someone'))).toBe('unverified');
    expect(rcCalls).toBe(0);
  });

  it('answers are cached for the window — one RevenueCat call per id', async () => {
    rcAnswers.cached = { subscriber: { entitlements: {} } };
    await verifyCaller(req('cached'));
    await verifyCaller(req('cached'));
    expect(rcCalls).toBe(1);
  });
});

describe('log only: every request is still served', () => {
  it('the switch is off in this phase', () => {
    expect(ENFORCE_CALLER_IDENTITY).toBe(false);
  });

  it('a caller with no id, a bad id, or no entitlement all get through', async () => {
    rcAnswers.free = { subscriber: { entitlements: {} } };
    for (const id of [undefined, 'has space', 'free']) {
      const r = res();
      expect(await allowInference(req(id, `10.0.0.${Math.floor(Math.random() * 250)}`), r as never, 'bag-scan')).toBe(true);
      expect(r.code).toBe(200);
    }
  });
});
