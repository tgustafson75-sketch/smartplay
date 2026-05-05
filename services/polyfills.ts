// Hermes runtime polyfills.
// Imported once from app/_layout.tsx so every fetch() call site that uses
// AbortSignal.timeout(ms) keeps working on devices whose Hermes build
// predates the static AbortSignal.timeout() factory (Chromium 103+ / Node 17.3+).
// Without this, calls like
//   fetch(url, { signal: AbortSignal.timeout(6_000) })
// throw "AbortSignal.timeout is not a function (it is undefined)" on cold launch
// (observed on Galaxy Z Fold dev-client, Phase 100 verification).

if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== 'function') {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return ctrl.signal;
  };
}
