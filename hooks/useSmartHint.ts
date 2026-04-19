/**
 * useSmartHint — show-once contextual hint hook.
 *
 * Usage:
 *   const { hint, showHint } = useSmartHint();
 *
 *   // Trigger when a condition first becomes true:
 *   useEffect(() => {
 *     if (isRoundActive) showHint('course');
 *   }, [isRoundActive]);
 *
 *   // Render:
 *   <SmartHint hint={hint} />
 *
 * Each hint key is recorded in AsyncStorage so it fires at most once,
 * even across app restarts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'smartcaddie_shown_hints';
const AUTO_DISMISS_MS = 3000;

export type HintKey = 'caddie' | 'course' | 'practice' | 'firstMic';

const HINT_TEXT: Record<HintKey, string> = {
  caddie:   'Just tap and ask.',
  course:   'Ask me for a line.',
  practice: 'Want feedback? Record a shot.',
  firstMic: 'Ask me about your shot, the course, or anything.',
};

export function useSmartHint() {
  const [hint, setHint] = useState<string | null>(null);
  const shownRef   = useRef<Partial<Record<HintKey, boolean>>>({});
  const loadedRef  = useRef(false);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load already-shown keys from AsyncStorage once on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) shownRef.current = JSON.parse(raw);
      })
      .catch(() => {})
      .finally(() => { loadedRef.current = true; });
  }, []);

  const persistShown = async (updated: Partial<Record<HintKey, boolean>>) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch { /* non-critical */ }
  };

  /**
   * showHint(key) — displays the hint if it hasn't been shown before.
   * Safe to call repeatedly; fires at most once per key.
   */
  const showHint = useCallback((key: HintKey) => {
    if (!loadedRef.current) return;       // still loading — skip
    if (shownRef.current[key]) return;    // already shown — skip

    // Mark as shown immediately to prevent double-fire
    shownRef.current = { ...shownRef.current, [key]: true };
    void persistShown(shownRef.current);

    setHint(HINT_TEXT[key]);

    // Auto-dismiss after 3 s
    if (dismissRef.current) clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => setHint(null), AUTO_DISMISS_MS);
  }, []);

  /** Manually dismiss (e.g. on user tap) */
  const dismissHint = useCallback(() => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    setHint(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
  }, []);

  return { hint, showHint, dismissHint };
}
