/**
 * Phase O — Earbud media-key event listener (2026-05-22 hardened).
 *
 * Event bus that the native media-key bridge (see services/mediaKeyBridge.ts)
 * fires into when the user taps their Bluetooth earbud (AirPods double-tap,
 * Galaxy Buds touch, generic media play/pause). The detection itself lives
 * in mediaKeyBridge.ts; this file exposes the tap stream + tap-pattern
 * classification (single / double / triple / long-press) so consumers
 * (listeningSession, handsFreeOrchestrator) can map patterns to actions.
 *
 * Wire reality check (unchanged from prior pass):
 *   - Real BT-button capture requires a native module. mediaKeyBridge.ts
 *     wires the JS↔native bridge contract. When that bridge fires, taps
 *     stream in here.
 *   - The on-screen "Tap to talk" button + voice intent "Kevin listen"
 *     both call notifyEarbudTap() so the orchestration is exercisable
 *     end-to-end before any native bridge ships.
 *
 * 2026-05-22 additions:
 *   - Tap-pattern classifier (single/double/triple) with quiet-window
 *     debounce so a chain of taps resolves to ONE pattern event.
 *   - Long-press detection via notifyEarbudLongPress() — usually mapped
 *     to "stop talking / repeat that".
 *   - Pattern-aware listener API alongside the legacy single-tap one.
 */

import { devLog } from './devLog';

export type TapPattern = 'single' | 'double' | 'triple' | 'long_press';

type Listener = () => void;
type PatternListener = (pattern: TapPattern) => void;

const tapListeners: Set<Listener> = new Set();
const patternListeners: Set<PatternListener> = new Set();
let enabled = true;
let suppressed = false;

// ─── Tap-pattern timing ─────────────────────────────────────────────────
//   DOUBLE_TAP_WINDOW: classify the chain after this much quiet time.
//     350ms catches deliberate double-taps without dragging single-tap
//     latency too long. AirPods double-tap fires within ~250ms typically.
//   PATTERN_CAP: max taps in a chain we count. 3 = triple. 4th tap is
//     treated as the start of a new chain (with a single).
const DOUBLE_TAP_WINDOW_MS = 350;
const PATTERN_CAP = 3;

let recentTaps: number[] = [];
let classifyTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Public API ──────────────────────────────────────────────────────────

/** Legacy single-tap subscription (kept for back-compat with
 *  listeningSession.ts and any other surface that just wants "a tap
 *  happened"). Fires on EVERY tap, no pattern classification. */
export function subscribeEarbudTap(listener: Listener): () => void {
  tapListeners.add(listener);
  return () => { tapListeners.delete(listener); };
}

/** 2026-05-22 — Pattern-aware subscription. Fires ONCE per resolved
 *  pattern after the quiet window elapses. */
export function subscribeTapPattern(listener: PatternListener): () => void {
  patternListeners.add(listener);
  return () => { patternListeners.delete(listener); };
}

/**
 * Called by the native bridge (or manual "Tap to talk" button) on every
 * tap. Fires the legacy listeners IMMEDIATELY (no debounce — they want
 * "a tap happened") and starts/extends the pattern-classification window.
 */
export function notifyEarbudTap(): void {
  if (!enabled || suppressed) return;

  // Legacy fanout — fire every tap.
  tapListeners.forEach((l) => {
    try { l(); } catch (e) { devLog('[earbudControl] listener err: ' + String(e)); }
  });

  // Pattern classifier — only when at least one pattern listener exists.
  if (patternListeners.size === 0) return;
  recentTaps.push(Date.now());
  if (classifyTimer) clearTimeout(classifyTimer);
  classifyTimer = setTimeout(() => {
    const count = Math.min(PATTERN_CAP, recentTaps.length);
    const pattern: TapPattern = count === 3 ? 'triple' : count === 2 ? 'double' : 'single';
    devLog(`[earbudControl] pattern resolved: ${pattern} (taps=${recentTaps.length})`);
    recentTaps = [];
    classifyTimer = null;
    patternListeners.forEach((l) => {
      try { l(pattern); } catch (e) { devLog('[earbudControl] pattern listener err: ' + String(e)); }
    });
  }, DOUBLE_TAP_WINDOW_MS);
}

/** Called by the native bridge when a long-press is detected. Doesn't
 *  flow through the tap-chain classifier — fires its own pattern. */
export function notifyEarbudLongPress(): void {
  if (!enabled || suppressed) return;
  devLog('[earbudControl] long-press detected');
  patternListeners.forEach((l) => {
    try { l('long_press'); } catch (e) { devLog('[earbudControl] pattern listener err: ' + String(e)); }
  });
}

/**
 * Surface-level suppression — orthogonal to the user enabled setting.
 * Used by Cage Session screen to silence Kevin during active swing
 * capture so a tap doesn't open TTS over a swing in progress. Pop on
 * unmount.
 */
export function setSuppressed(value: boolean): void {
  suppressed = value;
  if (value) devLog('[earbudControl] suppressed');
}

/** Settings toggle wires this. When disabled, taps are silently ignored. */
export function setEnabled(value: boolean): void {
  enabled = value;
  devLog(`[earbudControl] enabled=${value}`);
}

export function isEnabled(): boolean {
  return enabled;
}
