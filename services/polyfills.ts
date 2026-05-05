// Hermes runtime polyfills.
// Imported once from app/_layout.tsx so every fetch() call site that uses
// AbortSignal.timeout(ms) keeps working on devices whose Hermes build
// predates the static AbortSignal.timeout() factory (Chromium 103+ / Node 17.3+).
// Without this, calls like
//   fetch(url, { signal: AbortSignal.timeout(6_000) })
// throw "AbortSignal.timeout is not a function (it is undefined)" on cold launch
// (observed on Galaxy Z Fold dev-client, Phase 100 verification).

// Build a TimeoutError reason that works on Hermes (no DOMException) AND
// on browsers/Node (full DOMException available). Hermes throws
// "ReferenceError: Property 'DOMException' doesn't exist" if you new it
// up directly. The plain Error fallback is what AbortController.abort
// accepts as a reason — fetch() callers handling AbortError still see a
// signal.aborted === true, just without the DOMException class identity.
function buildTimeoutReason(): unknown {
  try {
    if (typeof DOMException !== 'undefined') {
      return new DOMException('TimeoutError', 'TimeoutError');
    }
  } catch {
    // ReferenceError on Hermes — fall through to Error fallback.
  }
  const err = new Error('TimeoutError');
  (err as Error & { name: string }).name = 'TimeoutError';
  return err;
}

if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== 'function') {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(buildTimeoutReason()), ms);
    return ctrl.signal;
  };
}
