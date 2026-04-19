/**
 * watchSync.ts — Phone-side Galaxy Watch state bridge
 *
 * Transport-agnostic: the phone manages all caddie state; watch integration
 * is injected via setWatchTransport(). Without a transport every operation
 * is a safe no-op — the app works identically watch connected or not.
 *
 * ── What the watch sees ──────────────────────────────────────────────────────
 *   yardage    — current distance to pin         (large display)
 *   hole       — current hole number             (small display)
 *   shotCount  — shots taken this round          (small display)
 *   voiceActive — caddie is speaking / listening (indicator)
 *
 * ── What the watch can trigger ───────────────────────────────────────────────
 *   'mark_shot'     — equivalent to the Mark Shot button on the phone
 *   'trigger_voice' — equivalent to tapping the mic button
 *
 * ── Galaxy Watch 7 integration path ─────────────────────────────────────────
 * The watch companion app (separate Wear OS / Kotlin project) connects via BLE:
 *
 *   1. Install react-native-ble-plx:
 *        npx expo install react-native-ble-plx
 *        npx expo prebuild
 *
 *   2. Implement WatchTransport using BleManager from react-native-ble-plx.
 *      Write state updates to the STATE_CHAR characteristic UUID below.
 *      Subscribe to ACTION_CHAR notifications for watch-initiated actions.
 *
 *   3. Call setWatchTransport(bleTransport) once BLE connects.
 *      Call clearWatchTransport() on disconnect / app background.
 *
 *   Galaxy Watch companion app requirements:
 *     • Advertise a BLE GATT server with service UUID: WATCH_SERVICE_UUID
 *     • STATE_CHAR (writable)  — phone writes JSON: WatchState
 *     • ACTION_CHAR (notify)   — watch notifies JSON: { action: WatchAction }
 *     • Display: large yardage number, hole/shot count, connection indicator
 *     • Two large Tappable tiles: "Mark Shot" and "Ask Caddie"
 *
 * ── Deduplication ────────────────────────────────────────────────────────────
 * Watch actions are gated by ACTION_COOLDOWN_MS (1500 ms) to prevent a watch
 * double-tap from logging two shots. The phone-side handleMarkShot already has
 * its own guard, so this is an extra safety layer at the bridge level.
 *
 * ── State publish rate-limiting ──────────────────────────────────────────────
 * publishWatchState() is debounced to DEBOUNCE_MS (400 ms) to avoid flooding
 * BLE with rapid updates during GPS refresh cycles.
 */

export const WATCH_SERVICE_UUID = '12345678-1234-1234-1234-1234567890AB';
export const STATE_CHAR_UUID    = '12345678-1234-1234-1234-1234567890AC';
export const ACTION_CHAR_UUID   = '12345678-1234-1234-1234-1234567890AD';

// ── Public types ─────────────────────────────────────────────────────────────

export interface WatchState {
  /** Current distance to pin in yards */
  yardage: number;
  /** 1-based hole number (1–18) */
  hole: number;
  /** Total shots taken this round */
  shotCount: number;
  /** True when the caddie voice is listening or speaking */
  voiceActive: boolean;
}

/** Actions the watch can send to the phone */
export type WatchAction = 'mark_shot' | 'trigger_voice';

/**
 * Implement this interface to wire in a real BLE or DataLayer transport.
 * The phone always acts as the source-of-truth; the watch is read-only display
 * plus two action buttons.
 */
export interface WatchTransport {
  /** Push current state to the watch display — fire-and-forget */
  send: (state: WatchState) => void;
  /** Subscribe to actions from the watch. Returns unsubscribe fn. */
  onAction: (callback: (action: WatchAction) => void) => () => void;
  /** Returns true when the watch is actively connected */
  isConnected: () => boolean;
}

// ── Internal state ────────────────────────────────────────────────────────────

let _transport: WatchTransport | null = null;
let _transportUnsubscribe: (() => void) | null = null;
const _actionListeners     = new Set<(action: WatchAction) => void>();
const _connectionListeners = new Set<(connected: boolean) => void>();

let _lastPublished:    WatchState | null = null;
let _publishDebounce:  ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 400;   // coalesce rapid state changes into one BLE write

let _lastActionAt = 0;
const ACTION_COOLDOWN_MS = 1500;  // prevent watch double-tap from marking two shots

// ── Transport management ──────────────────────────────────────────────────────

/**
 * Inject a transport implementation.
 * Call once after BLE connects or the BLE reconnect handler fires.
 * Calling again replaces the previous transport cleanly.
 */
export function setWatchTransport(transport: WatchTransport): void {
  // Tear down any previous transport first
  _transportUnsubscribe?.();
  _transportUnsubscribe = null;
  _transport = transport;

  // Subscribe to actions from the watch
  _transportUnsubscribe = transport.onAction((action) => {
    const now = Date.now();
    if (now - _lastActionAt < ACTION_COOLDOWN_MS) return; // dedup guard
    _lastActionAt = now;
    _actionListeners.forEach((cb) => { try { cb(action); } catch {} });
  });

  // Flush latest known state to the watch immediately on connect
  if (_lastPublished) _sendImmediate(_lastPublished);

  // Notify connection listeners
  _connectionListeners.forEach((cb) => { try { cb(true); } catch {} });
}

/**
 * Remove the current transport.
 * Call on BLE disconnect, app going to background, or round end.
 * Phone continues normally — watch is advisory only.
 */
export function clearWatchTransport(): void {
  _transportUnsubscribe?.();
  _transportUnsubscribe = null;
  _transport = null;
  _connectionListeners.forEach((cb) => { try { cb(false); } catch {} });
}

// ── State publishing ──────────────────────────────────────────────────────────

/**
 * Publish updated caddie state to the watch display.
 * Debounced — rapid GPS / yardage updates are coalesced into one BLE write.
 * Safe no-op when no transport is registered.
 */
export function publishWatchState(state: WatchState): void {
  _lastPublished = state;
  if (!_transport) return;                      // no watch — safe no-op
  if (_publishDebounce) clearTimeout(_publishDebounce);
  _publishDebounce = setTimeout(() => {
    _publishDebounce = null;
    if (_lastPublished && _transport) _sendImmediate(_lastPublished);
  }, DEBOUNCE_MS);
}

// ── Action subscriptions ──────────────────────────────────────────────────────

/**
 * Subscribe to actions coming from the watch (mark_shot, trigger_voice).
 * Returns an unsubscribe function — call it in your useEffect cleanup.
 */
export function onWatchAction(callback: (action: WatchAction) => void): () => void {
  _actionListeners.add(callback);
  return () => _actionListeners.delete(callback);
}

/**
 * Subscribe to watch connection state changes.
 * Returns an unsubscribe function.
 */
export function onWatchConnectionChange(callback: (connected: boolean) => void): () => void {
  _connectionListeners.add(callback);
  return () => _connectionListeners.delete(callback);
}

/** True when a transport is active and reports the watch as connected. */
export function isWatchConnected(): boolean {
  return _transport !== null && _transport.isConnected();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _sendImmediate(state: WatchState): void {
  try {
    _transport?.send(state);
  } catch (e) {
    // Transport errors must never crash the phone app
    console.warn('[watchSync] send error — watch may have disconnected:', e);
    // Treat a send error as disconnect
    clearWatchTransport();
  }
}
