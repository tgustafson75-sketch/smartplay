/**
 * 2026-05-22 — Refresh GPS action.
 *
 * Single shared handler for every "Refresh GPS / Where am I?" button.
 * Bumps GPS to active mode for a fresh fix, runs force-mode hole
 * reconciliation, and surfaces the result as a toast. SmartFinder,
 * Cockpit, and any other surface that wants a Refresh button imports
 * THIS — keeps toast copy + haptics consistent across screens.
 *
 * Defensive: every dependency is dynamic-imported so this module can be
 * imported from any UI layer without forcing GPS / toast / Haptics to
 * load when the user never taps Refresh.
 */

import { useRoundStore } from '../store/roundStore';
import type { GpsFix } from './gpsManager';

export interface RefreshGpsResult {
  toast_text: string;
  applied: boolean;
  confidence: number;
  hole_number: number;
}

/**
 * Tap-handler ready: call from onPress directly. Returns the result so
 * callers can do additional UI (e.g., flash a confirmation dot) if they
 * want; the standard toast feedback is already fired internally.
 */
export async function refreshGpsAndReconcile(): Promise<RefreshGpsResult> {
  // Haptic — Medium feedback at the moment of tap so the user knows the
  // gesture registered before any async work resolves.
  try {
    const Haptics = await import('expo-haptics');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  } catch { /* non-fatal */ }

  // Bump GPS to active so the next fix is a high-accuracy read. This is
  // the same path the voice intent system uses for distance queries.
  try {
    const gps = await import('./gpsManager');
    gps.bumpToActive('user_refresh_gps');
  } catch { /* non-fatal */ }

  // 2026-06-04 — Force an actual fresh fix before hole reconciliation.
  // The prior implementation reconciled immediately after bumping the
  // GPS mode, which could still operate on the last cached fix. That was
  // enough to change state sometimes, but not enough to guarantee a real
  // refresh for the user.
  let freshFix: GpsFix | null = null;
  try {
    const gps = await import('./gpsManager');
    freshFix = await gps.forceRefreshGps();
  } catch { /* non-fatal */ }

  const result = useRoundStore.getState().reconcileHole();

  // SmartVision synergy: when the hole actually changed, force a fresh
  // GPS mark so SmartFinder yardages + VectorHoleView player-dot project
  // against the NEW hole's geometry immediately (instead of waiting for
  // the next 4s poll). setCurrentHole already triggered re-render via
  // currentHole subscribers; this extra step closes the yardage-drift
  // window during the transition.
  if (result.applied) {
    try {
      const bus = await import('./positionMarkBus');
      void bus.forceMarkPosition().catch(() => undefined);
    } catch { /* non-fatal */ }
  }

  // Build the toast text from the reconcile result. Priority order:
  //   1. Accuracy warning — the actionable "step into open sky" message.
  //   2. Applied — we snapped to a new hole; surface the confidence.
  //   3. Stayed but checked — quiet confirmation so the user knows the
  //      action did something (not a silent no-op).
  let toast_text: string;
  if (result.accuracy_warning) {
    toast_text = result.accuracy_warning;
  } else if (result.applied) {
    toast_text = `Snapped to hole ${result.hole_number} · ${result.confidence}% confidence`;
  } else if (freshFix) {
    toast_text = `Fresh fix locked${freshFix.accuracy_m != null ? ` (${Math.round(freshFix.accuracy_m)}m)` : ''}.`;
  } else if (result.confidence > 0) {
    toast_text = `Confirmed hole ${result.hole_number} · ${result.confidence}% confidence`;
  } else {
    toast_text = result.reason;
  }

  try {
    const toastMod = await import('../store/toastStore');
    toastMod.useToastStore.getState().show(toast_text);
  } catch { /* non-fatal */ }

  return {
    toast_text,
    applied: result.applied,
    confidence: result.confidence,
    hole_number: result.hole_number,
  };
}
