/**
 * 2026-08-20 — SmartFinder voice command bus.
 *
 * Tim: "Should be able to tap or ask to zoom the pin flag and get a tight read. We could be so much
 * more connected and intelligent with the structure we have built."
 *
 * The tap half shipped first (double-tap the scene to magnify). This is the ASK half. It mirrors
 * services/smartMotionRecordBus deliberately rather than inventing a second pattern: the SCREEN owns
 * the behaviour and a voice command is only a nudge, so the bus never needs to know what zoom level
 * is currently applied or whether the reticle is locked.
 *
 * The `active` flag is what lets the dispatcher be intelligent about a closed screen: asking to zoom
 * when SmartFinder is not up should OPEN it and then zoom, not silently do nothing — that is the
 * "connected" part of what was asked for.
 */

export type SmartFinderCommand = 'zoomIn' | 'zoomOut' | 'zoomReset';

type Listener = (cmd: SmartFinderCommand) => void;

const listeners: Set<Listener> = new Set();
let active = false;

/** Subscribe to zoom commands. Returns an unsubscribe fn. */
export function subscribeSmartFinderCommand(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function emitSmartFinderCommand(cmd: SmartFinderCommand): void {
  for (const cb of Array.from(listeners)) {
    try { cb(cmd); } catch { /* one bad listener must not stop the others */ }
  }
}

/** True while the SmartFinder screen is mounted (so voice can tell "zoom" from "open and zoom"). */
export function isSmartFinderActive(): boolean { return active; }
export function setSmartFinderActive(next: boolean): void { active = next; }
