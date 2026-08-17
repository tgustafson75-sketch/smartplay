/**
 * 2026-08-17 (Tim — "the watch should be able to pick up motion for that… if it's not wired, I
 * think most of it's already there").
 *
 * It was: the watch's swing pipeline ran end-to-end into watchStore, and SwingSim / Hotel Mode read
 * only the phone gyro. This hook is the join — it turns each NEW watch swing into an IndoorRep and
 * hands it to the screen through the same funnel the phone detector already uses, so neither screen
 * needs to know which IMU a rep came from.
 *
 * Deliberately passive. It subscribes to swings the watch is ALREADY sending and never starts,
 * stops or configures anything: watch capture is armed by the player on the watch itself
 * ("Record swings" in MainActivity), and a drill screen silently switching on a wrist sensor is not
 * something the player asked for. No watch, or watch not capturing → this is inert and the phone
 * gyro path is byte-for-byte what it was.
 *
 * Cross-IMU duplicates (the phone in your hands AND the watch on your wrist both catching one
 * swing) are resolved by the RepDedupe the screen owns — see services/swing/watchRep.
 */

import { useEffect, useRef } from 'react';
import { useWatchStore } from '../store/watchStore';
import { watchSwingToRep } from '../services/swing/watchRep';
import type { IndoorRep, IndoorMode } from '../services/indoorSwing';

export interface UseWatchRepsOptions {
  /** Only listen while the screen is actually armed/recording. */
  enabled: boolean;
  /** Which detector mode the screen is in — carried onto the rep. */
  mode: IndoorMode;
  /** Called with each new watch rep. The screen applies its own dedupe + handling. */
  onRep: (rep: IndoorRep) => void;
}

export function useWatchReps({ enabled, mode, onRep }: UseWatchRepsOptions): void {
  // Latest handler without re-subscribing (the screen's closure changes every render).
  const onRepRef = useRef(onRep);
  onRepRef.current = onRep;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /**
   * The timestamp of the last swing already handed over. watchStore keeps a growing sessionSwings
   * list and overwrites lastSwing, so this is what distinguishes "a new swing arrived" from "this
   * component re-rendered". Seeded when listening starts so swings from BEFORE the player armed
   * this screen — a warm-up on the range, a previous drill — can never be replayed into it as if
   * they had just happened. That seeding is the same class of mistake as the dead 90s freshness
   * guard in SmartMotion: a stale swing attaching itself to the session in front of you.
   */
  const lastHandledAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    lastHandledAtRef.current = useWatchStore.getState().lastSwing?.timestamp ?? 0;

    const unsub = useWatchStore.subscribe((state) => {
      const sw = state.lastSwing;
      if (!sw) return;
      if (sw.timestamp <= lastHandledAtRef.current) return;
      lastHandledAtRef.current = sw.timestamp;
      const rep = watchSwingToRep(sw, modeRef.current);
      // An unreadable watch swing (a waggle with no real times) is discarded, exactly as the phone
      // detector discards an unreadable rep — not surfaced as a bad one.
      if (rep) onRepRef.current(rep);
    });

    return unsub;
  }, [enabled]);
}

export default useWatchReps;
