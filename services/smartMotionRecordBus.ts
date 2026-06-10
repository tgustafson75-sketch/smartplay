/**
 * 2026-06-09 — Smart Motion hands-free record bus.
 *
 * Lets active-listening voice commands ("caddie, record" / "start" / "stop")
 * drive the Smart Motion capture without the user touching the screen: stand
 * at the range, say start, hit for a minute, say stop (or let the 60s window
 * auto-wrap), review, then go again.
 *
 * Design: the SMART MOTION SCREEN owns the start/stop logic. A voice command
 * just emits a nudge on this bus; the screen decides what to do based on its
 * current phase (toggle: if recording → stop, else → start). That keeps the
 * behavior robust even if the classifier can't perfectly tell "start" from
 * "stop" — one recognized capture phrase always does the right thing.
 *
 * The `active` flag tells voice handlers whether the Smart Motion screen is
 * mounted, so "record my swing" controls the open window instead of trying to
 * open a new capture surface.
 */

export type SmartMotionCommand = 'start' | 'stop' | 'toggle' | 'scanClub';

type Listener = (cmd: SmartMotionCommand) => void;

const listeners: Set<Listener> = new Set();
let active = false;

/** Subscribe to record commands. Returns an unsubscribe fn. */
export function subscribeSmartMotionCommand(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Emit a record command to the mounted Smart Motion screen (if any). */
export function emitSmartMotionCommand(cmd: SmartMotionCommand): void {
  for (const cb of listeners) {
    try { cb(cmd); } catch (e) { console.log('[smartMotionRecordBus] listener error:', e); }
  }
}

/** The Smart Motion screen calls this on mount/unmount so voice handlers know
 *  whether a capture surface is live. */
export function setSmartMotionActive(v: boolean): void { active = v; }

/** True when the Smart Motion screen is mounted and can take a voice command. */
export function isSmartMotionActive(): boolean { return active; }
