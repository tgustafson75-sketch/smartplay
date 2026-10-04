/**
 * 2026-10-04 (sweep) — a stage that has been cancelled or overran its budget must stop WRITING.
 *
 * The engine aborts a stage's signal, but the read and the pose pass are long functions that write
 * to the swing store at ~25 points across many awaits; an aborted stage kept going and wrote a stale
 * window, verdict or status over the run that replaced it. Rather than thread a check before every
 * write, those functions take the store through this handle: reads pass through, and every mutator
 * becomes a no-op once the signal is aborted — checked at CALL time, so a handle captured before a
 * long await still goes quiet when the stage is abandoned mid-way.
 */
import { useSwingSessionStore } from '../../../store/swingSessionStore';

type SwingStore = ReturnType<typeof useSwingSessionStore.getState>;

/**
 * The store's READ functions — every other function on it changes state and goes quiet on abort. An
 * allow-list of readers, not a pattern of writers: the pattern missed `expandUploadIntoSwings`, so an
 * over-budget read could still split a session into shots after its run had failed (re-review 10-04).
 */
const READERS = new Set(['getClubProfile']);

export function liveSessionStore(signal?: AbortSignal | null): SwingStore {
  if (!signal) return useSwingSessionStore.getState();
  return new Proxy({} as SwingStore, {
    get(_t, key) {
      const st = useSwingSessionStore.getState() as unknown as Record<string | symbol, unknown>;
      const v = st[key];
      if (typeof v === 'function' && typeof key === 'string' && !READERS.has(key)) {
        return (...args: unknown[]) => {
          if (signal.aborted) return undefined;
          return (v as (...a: unknown[]) => unknown).apply(useSwingSessionStore.getState(), args);
        };
      }
      return v;
    },
  });
}
