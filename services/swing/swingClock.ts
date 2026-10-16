/**
 * 2026-10-16 (Lily's 4075 clip: one fault, four times — "FAULT MOMENT 0:06", "THIS SWING · Early
 * Extension 0:04", "Analyze the swing at 0:07", "Position: 7.0s" — under a transport clock reading
 * "0:02 / 0:03").
 *
 * THE ONE CLOCK the swing screen shows times on: the transport deck's, which runs from the start of the
 * located swing window (the virtual crop, 2026-07-30). The other labels printed absolute clip seconds
 * (and the swing row printed the WINDOW START as if it were a moment), so the same instant read as three
 * different times. Every time label on the screen goes through here.
 */
export function swingClockSec(absSec: number, windowStartSec: number): number {
  const s = absSec - (Number.isFinite(windowStartSec) && windowStartSec > 0 ? windowStartSec : 0);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** m:ss on the swing clock. */
export function swingClock(absSec: number, windowStartSec: number): string {
  const s = Math.floor(swingClockSec(absSec, windowStartSec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
