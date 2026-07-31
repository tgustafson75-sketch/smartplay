/**
 * 2026-07-30 (Tim — "Show me around on the SwingLab tab, and basics on all main tabs"). Reusable trigger
 * for a main tab's basics tour. Shows the tab's short TourOverlay:
 *   - once on first visit, within the first few app opens (shouldShowTab), and
 *   - on demand when the user taps Settings → "Show me around" (relaunchTour bumps relaunchNonce +
 *     clears the per-tab seen flags), even if this tab is already mounted (tabs don't re-mount).
 * Marks the tab seen when the tour is dismissed so it doesn't repeat.
 */
import { useEffect, useRef, useState } from 'react';
import { useOnboardingTourStore } from '../store/onboardingTourStore';

export function useTabTour(tab: string): { showTour: boolean; endTour: () => void } {
  const [showTour, setShowTour] = useState(false);
  const relaunchNonce = useOnboardingTourStore((s) => s.relaunchNonce);
  // Initialize to the current nonce so mounting doesn't count as a relaunch (only a later bump does).
  const seenNonceRef = useRef(relaunchNonce);

  // First visit within the auto-show window → show this tab's basics once.
  useEffect(() => {
    try { if (useOnboardingTourStore.getState().shouldShowTab(tab)) setShowTour(true); } catch { /* non-fatal */ }
  }, [tab]);

  // Explicit "Show me around" replay — fire only on an actual bump, so an already-mounted tab re-shows.
  useEffect(() => {
    if (relaunchNonce !== seenNonceRef.current) {
      seenNonceRef.current = relaunchNonce;
      setShowTour(true);
    }
  }, [relaunchNonce]);

  const endTour = () => {
    setShowTour(false);
    try { useOnboardingTourStore.getState().markTabSeen(tab); } catch { /* non-fatal */ }
  };

  return { showTour, endTour };
}
