/**
 * Phase AL — Position Mark event bus.
 *
 * User-triggered "force refresh everything to here" mechanism. When the
 * golfer taps the Mark button (or fires a "Mark this" voice intent),
 * forceMarkPosition() pulls a fresh high-accuracy GPS fix and emits a
 * MarkedPosition event. Every GPS-dependent service subscribes to the
 * bus and refreshes its own state when the event fires.
 *
 * Path A from the spec: pub/sub event, decoupled from each consumer.
 * Adding a new GPS-dependent service later is a one-line subscribe()
 * call; no wiring changes here.
 *
 * Subscribers today (wire site → behavior on mark):
 *   - smartFinderService.setSimulatedFix-like seeding of lastFix so
 *     SmartFinder distances reflect the marked position immediately.
 *   - holeDetection.evaluate() called once with the new fix so a
 *     transition can fire without waiting for the sustained-position
 *     threshold.
 *   - hole-view.tsx re-renders via reactive subscription (subscribe in
 *     the screen's useEffect).
 *
 * Round gate: Mark only succeeds when isRoundActive is true. Outside a
 * round it no-ops with a soft return.
 */

import * as Location from 'expo-location';
import { useRoundStore } from '../store/roundStore';

export interface MarkedPosition {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  timestamp: number;
  /** Hole at the time of mark, for telemetry / hole-detection re-check. */
  hole_at_mark: number | null;
}

type Listener = (mark: MarkedPosition) => void;

const listeners: Set<Listener> = new Set();
let lastMark: MarkedPosition | null = null;

export function subscribeToMark(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getLastMark(): MarkedPosition | null {
  return lastMark;
}

export type MarkResult =
  | { kind: 'ok'; mark: MarkedPosition }
  | { kind: 'no_round' }
  | { kind: 'no_permission' }
  | { kind: 'error'; message: string };

/**
 * The single Mark entry point. UI button taps and voice intents both
 * call this. Returns a structured result so callers can render
 * appropriate user feedback (haptic + toast / alert).
 */
export async function forceMarkPosition(): Promise<MarkResult> {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return { kind: 'no_round' };

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { kind: 'no_permission' };

    // Race against a 6s timeout so a hung GPS doesn't block the UI.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mark_gps_timeout')), 6000),
      ),
    ]);

    const mark: MarkedPosition = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      timestamp: Date.now(),
      hole_at_mark: round.currentHole ?? null,
    };

    lastMark = mark;
    console.log('[mark]', JSON.stringify({
      hole: mark.hole_at_mark,
      accuracy_m: mark.accuracy_m,
      subscriber_count: listeners.size,
    }));

    for (const cb of listeners) {
      try { cb(mark); } catch (e) {
        console.log('[mark] listener error:', e);
      }
    }

    return { kind: 'ok', mark };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[mark] error:', msg);
    return { kind: 'error', message: msg };
  }
}
