/**
 * 2026-09-05 — NO TEST MAY REACH THE NETWORK.
 *
 * Tim woke up to thirteen "ROUND TRACE — Menifee Lakes Palms" emails from a tester who does not
 * exist. Nobody played those rounds: `__tests__/regression/auto-sim-round-plays-the-real-pipeline`
 * calls the REAL endRound(), endRound() fire-and-forgets sendRoundTrace(), and the `logic` project
 * had no setup file — so Node's global fetch was live and services/apiBase resolved to PRIMARY_HOST
 * (production) because EXPO_PUBLIC_API_URL is unset under jest. One `npm test` mailed him a fake
 * round trace and fired SEVEN paid /api/kevin-read calls against the live inference budget.
 *
 * That test was careful — it already stubbed roundPrefetch, recapGenerator and courseGeometryService,
 * every network-shaped thing its author tripped over. Being careful was not enough, and it cannot be:
 * the next test to call a real store method inherits whatever that store fans out to today. So the
 * gate belongs at the socket, not in each test's mock list. [[no-half-fixes-enforce-every-surface]]
 *
 * WHY REJECT RATHER THAN RESOLVE. A stub that returns `{ok: true}` teaches a test that a send
 * succeeded when nothing was sent, which is how a diagnostic ends up "verified" against a call that
 * never happened. A rejection is the honest shape of "there is no network here", and it is the shape
 * every one of these fire-and-forget senders already handles (walking off 18 with no signal).
 *
 * WHY THE SWAP HAPPENS AT MODULE LOAD, not only in beforeEach. Several tests capture
 * `const realFetch = global.fetch` at module scope and restore it in afterEach. If the real fetch is
 * still installed when they load, their teardown RE-ARMS it, and anything still queued fires at
 * production in the gap before the next beforeEach — which is exactly how one /api/course-geometry
 * escaped from the geometry-starvation suite. Replacing it before any test module loads means the
 * value they capture and restore is this blocker.
 */
const ALLOWED_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const u = (input as { url?: unknown }).url;
    if (typeof u === 'string') return u;
  }
  return String(input);
}

const blocker = (input: unknown, init?: unknown): Promise<never> => {
  const url = urlOf(input);
  if (ALLOWED_HOST.test(url)) {
    // A locally-hosted fixture server is fine; production is not.
    return Promise.reject(new Error(`No local server is running for ${url}`));
  }
  const method = (init && typeof init === 'object' ? (init as { method?: string }).method : null) ?? 'GET';
  return Promise.reject(new Error(
    `BLOCKED: a test tried to reach the live network — ${method} ${url}\n` +
    'Tests must never call production. Mock the service that fetches (see the mocks at the top of\n' +
    '__tests__/regression/auto-sim-round-plays-the-real-pipeline.test.ts), or stub global.fetch in\n' +
    'the test itself. See __tests__/setupNoNetwork.ts for why this gate exists.',
  ));
};

(globalThis as { fetch?: unknown }).fetch = blocker as unknown as typeof fetch;

// ...and re-arm between cases, in case a test replaced fetch and never restored it.
beforeEach(() => {
  (globalThis as { fetch?: unknown }).fetch = blocker as unknown as typeof fetch;
});
