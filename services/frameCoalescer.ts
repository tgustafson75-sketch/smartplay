/**
 * 2026-11-08 (Sentry SMARTPLAY-CADDIE-MOBILE-8, the swing-review "Maximum update depth" fatal, fifth return).
 *
 * expo-av delivers onPlaybackStatusUpdate as a native event, and the screen used to call setState INSIDE it.
 * Every past fix (memoized source 07-26, change guards 07-29, stable props 08-07, wall-clock throttle 08-08)
 * narrowed ONE trigger for a synchronous event → setState → commit → event chain, and the 11-05 crash came
 * from a new one: the phone waking from sleep with the swing screen open, in the background.
 *
 * This breaks the chain itself. Status ticks only WRITE a patch here. The patch reaches React at most once
 * per animation frame, outside the native event, so no sequence of status events, however many or however
 * re-entrant, can nest updates. Frames do not run in the background, so a backlog collapses into one commit.
 */
export type FrameScheduler = {
  request: (cb: () => void) => number;
  cancel: (handle: number) => void;
};

export type FrameCoalescer<T extends object> = {
  /** Merge a patch; later keys win. Schedules one flush if none is pending. */
  queue: (patch: Partial<T>) => void;
  /** Drop any pending patch and cancel its frame (unmount). */
  cancel: () => void;
};

export function createFrameCoalescer<T extends object>(
  apply: (patch: Partial<T>) => void,
  scheduler: FrameScheduler = {
    request: (cb) => requestAnimationFrame(cb),
    cancel: (h) => cancelAnimationFrame(h),
  },
): FrameCoalescer<T> {
  let pending: Partial<T> = {};
  let handle: number | null = null;
  return {
    queue(patch) {
      pending = { ...pending, ...patch };
      if (handle != null) return;
      handle = scheduler.request(() => {
        handle = null;
        const p = pending;
        pending = {};
        apply(p);
      });
    },
    cancel() {
      if (handle != null) scheduler.cancel(handle);
      handle = null;
      pending = {};
    },
  };
}
