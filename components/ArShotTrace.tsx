/**
 * 2026-05-22 — AR Shot Trace router (Pass 3).
 *
 * Public surface for the AR overlay. Reads services/arRenderCapability
 * once on mount and renders the best available backend:
 *   - 'three_gl' → components/ArShotTraceOverlay3D (true 3D via fiber/native)
 *   - 'skia'     → ArShotTraceOverlay (SVG today; Skia tier reserved
 *                  for a follow-up commit)
 *   - 'svg'      → components/ArShotTraceOverlay (Pass 1 SVG)
 *   - 'none'     → renders nothing
 *
 * The 3D backend is lazy-imported so the SVG-only path doesn't pull
 * three.js + fiber into the initial bundle on devices that won't use
 * them. Suspense fallback renders the SVG overlay during the dynamic
 * import so the user never sees a blank screen during the swap.
 *
 * Callers stay agnostic — same props shape as ArShotTraceOverlay; the
 * router just picks the renderer:
 *
 *   <ArShotTrace
 *     width={W}
 *     height={H}
 *     cameraPose={pose.available ? pose : null}
 *     quality="balanced"
 *     onBeat={(b, t) => { ... }}
 *   />
 *
 * Override the backend explicitly via the `backend` prop — useful for
 * QA + the Settings → Dev → "Force AR backend" picker.
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import ArShotTraceOverlay, {
  type ArShotTraceOverlayProps,
} from './ArShotTraceOverlay';
import {
  detectArCapability,
  type ArBackend,
} from '../services/arRenderCapability';

const ArShotTraceOverlay3D = lazy(() => import('./ArShotTraceOverlay3D'));

export interface ArShotTraceProps extends ArShotTraceOverlayProps {
  /** Force a specific backend instead of auto-detecting. Use 'svg' to
   *  always render the lightweight fallback regardless of installed
   *  packages — handy for low-battery / thermal-throttle scenarios. */
  backend?: ArBackend;
}

export default function ArShotTrace(props: ArShotTraceProps) {
  const { backend, ...overlayProps } = props;
  const [chosen, setChosen] = useState<ArBackend>('svg');

  useEffect(() => {
    if (backend) {
      setChosen(backend);
      return;
    }
    const cap = detectArCapability();
    setChosen(cap.best_backend);
  }, [backend]);

  if (chosen === 'none') return null;

  if (chosen === 'three_gl') {
    return (
      <Suspense fallback={<ArShotTraceOverlay {...overlayProps} />}>
        <ArShotTraceOverlay3D {...overlayProps} />
      </Suspense>
    );
  }

  // 'skia' tier falls through to SVG today. The capability probe in
  // services/arRenderCapability.ts already detects Skia presence so a
  // future commit can wire ArShotTraceOverlaySkia here without changing
  // any caller code.
  return <ArShotTraceOverlay {...overlayProps} />;
}
