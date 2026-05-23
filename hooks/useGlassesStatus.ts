/**
 * 2026-05-23 — React hook for Meta Wearables glasses status.
 *
 * Wraps services/metaWearablesBridge.onGlassesStatusChange so UI
 * surfaces (Settings toggle, SmartMotion / PuttingLab / SmartVision
 * status badges) can render a "Glasses connected" pill without each
 * caller wiring its own subscription + cleanup.
 *
 * Returns the latest GlassesStatus + a `multimodalReady` boolean —
 * derived sugar for surfaces that just want to know "should I show
 * the glasses badge?" without checking individual fields.
 *
 * When the native module isn't present (web / iOS pre-Apple-enrollment
 * / Android pre-DAT-build), the hook returns
 *   { available: false, connected: false, streaming: false, ... }
 * indefinitely. Consumers should branch on `available` before
 * showing any glasses-specific UI.
 */

import { useEffect, useState } from 'react';
import {
  onGlassesStatusChange,
  getGlassesStatusSync,
  type GlassesStatus,
} from '../services/metaWearablesBridge';

export interface UseGlassesStatus extends GlassesStatus {
  /** Sugar — true when the user has glasses paired AND a stream is
   *  actively producing frames. Consumers use this to flip a chip on
   *  ("MULTIMODAL ON") or off. */
  multimodalReady: boolean;
}

export function useGlassesStatus(): UseGlassesStatus {
  const [status, setStatus] = useState<GlassesStatus>(() => getGlassesStatusSync());

  useEffect(() => {
    const unsubscribe = onGlassesStatusChange((next) => {
      setStatus(next);
    });
    return unsubscribe;
  }, []);

  return {
    ...status,
    multimodalReady: status.available && status.connected && status.streaming,
  };
}
