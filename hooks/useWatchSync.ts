/**
 * useWatchSync — Wires live caddie state into the watchSync service.
 *
 * Responsibilities:
 *  • Publishes yardage + hole + shotCount + voiceActive to the watch
 *    (debounced inside watchSync — no BLE flooding)
 *  • Registers callbacks so watch actions call the same phone-side handlers
 *    as the on-screen buttons (dedup is in both watchSync and handleMarkShot)
 *  • Tracks watch connection state for optional UI indicators
 *  • Cleans up all subscriptions on unmount
 *
 * Usage (caddie.tsx):
 *   const { watchConnected } = useWatchSync({
 *     yardage:       displayDistance ?? 0,
 *     onMarkShot:    handleMarkShot,
 *     onTriggerVoice: triggerVoice,   // optional
 *   });
 */

import { useEffect, useRef, useState } from 'react';
import { useRoundStore } from '../store/roundStore';
import {
  publishWatchState,
  onWatchAction,
  onWatchConnectionChange,
  isWatchConnected,
  type WatchAction,
} from '../services/watchSync';

interface WatchSyncOptions {
  /** Current distance to pin in yards (local caddie screen state) */
  yardage: number;
  /** Fired when the watch sends a 'mark_shot' action */
  onMarkShot?: () => void;
  /** Fired when the watch sends a 'trigger_voice' action */
  onTriggerVoice?: () => void;
  /** True when the caddie voice pipeline is active (listening / speaking) */
  voiceActive?: boolean;
}

export function useWatchSync({
  yardage,
  onMarkShot,
  onTriggerVoice,
  voiceActive = false,
}: WatchSyncOptions): { watchConnected: boolean } {
  const currentHole = useRoundStore((s) => s.currentHole);
  const shots       = useRoundStore((s) => s.shots);

  const [watchConnected, setWatchConnected] = useState<boolean>(isWatchConnected);

  // Keep stable refs for callbacks — avoids re-subscribing on every render
  const onMarkShotRef      = useRef(onMarkShot);
  const onTriggerVoiceRef  = useRef(onTriggerVoice);
  onMarkShotRef.current     = onMarkShot;
  onTriggerVoiceRef.current = onTriggerVoice;

  // ── Publish state whenever any tracked value changes ──────────────────────
  useEffect(() => {
    publishWatchState({
      yardage,
      hole:        currentHole,
      shotCount:   shots.length,
      voiceActive,
    });
  }, [yardage, currentHole, shots.length, voiceActive]);

  // ── Subscribe to watch actions (stable — registered once) ─────────────────
  useEffect(() => {
    const unsub = onWatchAction((action: WatchAction) => {
      if (action === 'mark_shot')     onMarkShotRef.current?.();
      if (action === 'trigger_voice') onTriggerVoiceRef.current?.();
    });
    return unsub;
  }, []); // intentionally empty — refs keep callbacks current

  // ── Track connection state ─────────────────────────────────────────────────
  useEffect(() => {
    // Sync initial state — transport may already be connected
    setWatchConnected(isWatchConnected());
    const unsub = onWatchConnectionChange((connected) => setWatchConnected(connected));
    return unsub;
  }, []);

  return { watchConnected };
}
