/**
 * 2026-05-23 — React hook wrapping `subscribeUnifiedContext`.
 *
 * Surfaces (SmartVision live-strategy panel, SmartMotion grounded
 * context chip, lie-analysis "see what you see" surface) call this
 * hook to get the latest fused context (GPS + hole geometry + active
 * vision frame + recent shots + player profile) and re-render on
 * every new vision frame.
 *
 * Returns `null` until the first composition lands (≈ one round-trip
 * to all the underlying stores + helpers); consumers should branch
 * on null to render a "warming up" state vs the rich-context state.
 *
 * Cleanup: the subscription unsubscribes on unmount automatically.
 *
 * Defensive: any failure inside `getUnifiedVisionContext` returns a
 * coherent "nothing-active" envelope rather than throwing — the hook
 * never throws.
 */

import { useEffect, useState } from 'react';
import {
  subscribeUnifiedContext,
  type UnifiedVisionContext,
} from '../services/unifiedVisionContext';

export function useUnifiedVisionContext(): UnifiedVisionContext | null {
  const [ctx, setCtx] = useState<UnifiedVisionContext | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeUnifiedContext((next) => {
      setCtx(next);
    });
    return unsubscribe;
  }, []);

  return ctx;
}
