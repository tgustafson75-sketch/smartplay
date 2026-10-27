import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * SmartMotion's periodic SILENT club scan (2026-06-11, Tim: "every ~3 cycles"): a completed recording marks a
 * scan due; it fires once the screen is back in setup — never during the hands-free auto-record relaunch
 * (pendingStartRef), and it yields to/from an in-flight scan.
 *
 * 2026-10-27 (Phase SB4x, review "capture #2") — and never over a GUIDED scan (the player's Scan club, in its
 * 3-2-1 countdown). Both share one scan epoch (captureLife.beginScan), so a silent scan starting then
 * cancelled the guided one: the framing box vanished with no picker and no word. A guided scan starting
 * inside the 500 ms clears the timer, and the timer re-checks before it fires.
 */
export function useAutoClubScan(input: {
  phase: string;
  dueRef: MutableRefObject<boolean>;
  scanningClub: boolean;
  guidedScanActive: boolean;
  pendingStartRef: MutableRefObject<boolean>;
  fire: () => void;
}): void {
  const { phase, dueRef, scanningClub, guidedScanActive, pendingStartRef, fire } = input;
  const guidedRef = useRef(guidedScanActive);
  guidedRef.current = guidedScanActive;
  useEffect(() => {
    if (phase !== 'setup' || !dueRef.current || scanningClub || guidedScanActive || pendingStartRef.current) return;
    dueRef.current = false;
    const t = setTimeout(() => { if (!guidedRef.current) fire(); }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, scanningClub, guidedScanActive, fire]);
}
