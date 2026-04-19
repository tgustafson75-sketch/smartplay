/**
 * useTips — lightweight contextual tip system.
 *
 * Tips are stored in AsyncStorage so each tip fires only once ever.
 * No state/re-renders occur at the hook level; all checks are async
 * and resolve before the caller decides whether to display anything.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useRef } from 'react';

/**
 * All tip IDs in one place — keeps key names consistent across the app.
 * Extend this list whenever a new tip is needed.
 */
export type TipKey =
  | 'round_start'   // "You can just play. Caddie handles everything."
  | 'target_tap'    // "Tap anywhere to plan your shot."
  | 'shot_detected' // "Caddie just tracked your shot automatically."
  | 'target_nudge'  // "Safer landing zone selected for you."
  | 'putt_mode'     // "Tap ball and hole to read your putt."
  | 'replay';       // "Your round is ready to replay and share."

const PREFIX = 'tip_v1_';

export function useTips() {
  // In-memory guard so we never double-show a tip within the same session
  // even if multiple triggers fire before AsyncStorage resolves.
  const sessionShown = useRef<Set<TipKey>>(new Set());

  /**
   * Returns true if this tip should be shown (never shown before).
   * Returns false immediately for already-shown tips (in-memory guard first).
   */
  const shouldShow = useCallback(async (key: TipKey): Promise<boolean> => {
    if (sessionShown.current.has(key)) return false;
    try {
      const val = await AsyncStorage.getItem(PREFIX + key);
      return val === null;
    } catch {
      return false;
    }
  }, []);

  /**
   * Mark tip as seen — call this immediately before displaying so that
   * any concurrent triggers are also blocked.
   */
  const markShown = useCallback(async (key: TipKey): Promise<void> => {
    sessionShown.current.add(key);
    try {
      await AsyncStorage.setItem(PREFIX + key, '1');
    } catch {
      // Non-critical — session guard still prevents repeat within session
    }
  }, []);

  /**
   * Convenience: check + mark atomically, then invoke callback if new.
   * Usage: checkAndShow('target_tap', () => setActiveTip({ key, text }));
   */
  const checkAndShow = useCallback(
    async (key: TipKey, callback: () => void): Promise<void> => {
      const ok = await shouldShow(key);
      if (!ok) return;
      await markShown(key);
      callback();
    },
    [shouldShow, markShown],
  );

  return { shouldShow, markShown, checkAndShow };
}
