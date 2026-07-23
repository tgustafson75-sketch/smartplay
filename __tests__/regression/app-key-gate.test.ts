/**
 * Shared inference-endpoint auth gate. requireAppKey / isAppKeyValid are the single choke point every
 * gated paid-inference route (image-edit today, more to come) checks the app key through. This test
 * locks the contract: the exact key passes, everything else 401s, and the check is header-driven — so
 * a refactor can't silently loosen the gate (which would re-open the "curl loop bills image-gen"
 * abuse the gate exists to stop).
 */
import { isAppKeyValid, requireAppKey } from '../../api/_appKey';

const KEY = 'spc_share_k1_2f8d61b4c07a49e3a1d5e9f60b3c7a29';
const reqWith = (v: unknown) => ({ headers: { 'x-app-key': v } }) as never;

function fakeRes() {
  const state: { code: number | null; body: unknown } = { code: null, body: null };
  const res = {
    status(c: number) { state.code = c; return res; },
    json(b: unknown) { state.body = b; return res; },
  };
  return { res: res as never, state };
}

describe('app-key gate — isAppKeyValid', () => {
  it('accepts the exact shared key', () => {
    expect(isAppKeyValid(reqWith(KEY))).toBe(true);
  });

  it('rejects a wrong key, a truncated key, empty, and a missing header', () => {
    expect(isAppKeyValid(reqWith('spc_share_k1_deadbeefdeadbeefdeadbeefdeadbeef'))).toBe(false);
    expect(isAppKeyValid(reqWith(KEY.slice(0, -1)))).toBe(false); // one char short
    expect(isAppKeyValid(reqWith(KEY + 'x'))).toBe(false);        // one char long
    expect(isAppKeyValid(reqWith(''))).toBe(false);
    expect(isAppKeyValid(reqWith(undefined))).toBe(false);
    expect(isAppKeyValid({ headers: {} } as never)).toBe(false);
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(isAppKeyValid(reqWith(`  ${KEY}  `))).toBe(true);
  });
});

describe('app-key gate — requireAppKey', () => {
  it('returns true and writes nothing when authorized', () => {
    const { res, state } = fakeRes();
    expect(requireAppKey(reqWith(KEY), res)).toBe(true);
    expect(state.code).toBeNull();
  });

  it('returns false and writes a 401 when unauthorized', () => {
    const { res, state } = fakeRes();
    expect(requireAppKey(reqWith('nope'), res)).toBe(false);
    expect(state.code).toBe(401);
    expect(state.body).toEqual({ error: 'unauthorized' });
  });
});
