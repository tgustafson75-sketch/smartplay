/**
 * 2026-10-28 (Brain review F7) — askCaddie must say WHY there was no answer.
 *
 * It returned a bare null for its own timeout and for a real failure alike, so no caller could tell
 * "the server is still working on (and billing) this turn" from "it failed fast, try again". The
 * real askCaddie and conversationalBrainTurn run here against a fetch that never answers (our timer
 * fires) and one that answers 500 at once (a real failure); only the first may be reported as a
 * timeout. The earbud route's use of the flag is driven in
 * an-earbud-turn-we-timed-out-is-not-billed-twice.test.ts.
 */
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true }));
jest.mock('../../services/caddieRequestBody', () => ({ buildCaddieRequestBody: (x: Record<string, unknown>) => ({ ...x }) }));
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', markEndpointWarmed: jest.fn() }));
jest.mock('../../services/adviceFreshness', () => ({ markAdviceTurnStart: jest.fn() }));
jest.mock('../../services/userTurnClock', () => ({ getUserTurnEpoch: () => 1 }));
jest.mock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ language: 'en' }) } }));

import { askCaddie } from '../../services/caddieBrain';
import { conversationalBrainTurn } from '../../services/conversationalBrain';

/** A fetch that only ever ends when its signal aborts — the server is "still working". */
const hangingFetch = jest.fn((_u: string, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
  init?.signal?.addEventListener('abort', () => {
    const e = new Error('Aborted'); e.name = 'AbortError'; rej(e);
  });
}));
const failingFetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));

afterEach(() => { delete (global as { fetch?: unknown }).fetch; });

describe('F7 — a phone-side timeout is reported, not silently folded into "failed"', () => {
  it('askCaddie: our timer fired → onNoAnswer("timeout")', async () => {
    (global as { fetch?: unknown }).fetch = hangingFetch;
    const reasons: string[] = [];
    const turn = await askCaddie({ message: 'what club', timeoutMs: 20, onNoAnswer: (r: string) => reasons.push(r) } as never);
    expect(turn).toBeNull();
    expect(reasons).toEqual(['timeout']);
  });

  it('askCaddie: a fast server failure → onNoAnswer("failed"), never "timeout"', async () => {
    (global as { fetch?: unknown }).fetch = failingFetch;
    const reasons: string[] = [];
    const turn = await askCaddie({ message: 'what club', timeoutMs: 5_000, onNoAnswer: (r: string) => reasons.push(r) } as never);
    expect(turn).toBeNull();
    expect(reasons).toEqual(['failed']);
  });

  it('askCaddie: the caller shushed it → "aborted", not "timeout"', async () => {
    (global as { fetch?: unknown }).fetch = hangingFetch;
    const ctrl = new AbortController();
    const reasons: string[] = [];
    const p = askCaddie({ message: 'what club', timeoutMs: 5_000, signal: ctrl.signal, onNoAnswer: (r: string) => reasons.push(r) } as never);
    ctrl.abort();
    expect(await p).toBeNull();
    expect(reasons).toEqual(['aborted']);
  });

  it('THE BUG: conversationalBrainTurn marks a timed-out turn so the earbud route can skip its retry', async () => {
    (global as { fetch?: unknown }).fetch = hangingFetch;
    const r = await conversationalBrainTurn('what club', { timeoutMs: 20 });
    expect(r.text).toBeNull();
    expect((r as { timedOut?: boolean }).timedOut).toBe(true);
  });

  it('conversationalBrainTurn: a fast failure is NOT marked timed out (the retry stays)', async () => {
    (global as { fetch?: unknown }).fetch = failingFetch;
    const r = await conversationalBrainTurn('what club', { timeoutMs: 5_000 });
    expect(r.text).toBeNull();
    expect((r as { timedOut?: boolean }).timedOut).toBeFalsy();
  });
});
