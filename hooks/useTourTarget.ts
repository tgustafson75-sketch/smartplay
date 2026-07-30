/**
 * 2026-08-01 (tester — clean spotlights). Attach to a highlightable element so the first-run tour can
 * spotlight its EXACT on-screen bounds. Usage:
 *
 *   const tour = useTourTarget('caddie.mic');
 *   <View ref={tour.ref} onLayout={tour.onLayout}> … </View>
 *
 * measureInWindow gives absolute screen coords (what the full-screen overlay needs). We re-measure on
 * layout and, because a static bar/button lays out once, that's enough — the overlay reads the latest.
 * Unregisters on unmount so a stale rect never spotlights an element that's gone.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { setTourTarget, clearTourTarget } from '../store/tourTargets';

export function useTourTarget(id: string) {
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0 && Number.isFinite(x) && Number.isFinite(y)) {
        setTourTarget(id, { x, y, w, h });
      }
    });
  }, [id]);

  useEffect(() => {
    // A tick after mount so layout has settled even when onLayout is missed (e.g. reparented views).
    const t = setTimeout(measure, 300);
    return () => { clearTimeout(t); clearTourTarget(id); };
  }, [id, measure]);

  return { ref, onLayout: measure, measure };
}
