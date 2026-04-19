/**
 * bleCaddieTransport.ts — BLE WatchTransport implementation for Galaxy Watch 7
 *
 * Implements the WatchTransport interface (watchSync.ts) using react-native-ble-plx.
 * The phone acts as the BLE CENTRAL (client). The Galaxy Watch companion app
 * acts as the BLE PERIPHERAL (server) advertising the service defined below.
 *
 * ── Protocol ─────────────────────────────────────────────────────────────────
 *
 *   Service UUID : WATCH_SERVICE_UUID   (from watchSync.ts)
 *
 *   STATE_CHAR   (Write Without Response, or Write)
 *     Phone → Watch  |  JSON-encoded WatchState
 *     e.g. {"yardage":145,"hole":7,"shotCount":4,"voiceActive":false}
 *
 *   ACTION_CHAR  (Notify)
 *     Watch → Phone  |  JSON-encoded action
 *     e.g. {"action":"mark_shot"}  |  {"action":"trigger_voice"}
 *
 * ── Galaxy Watch companion app (Wear OS / Kotlin) ─────────────────────────────
 *
 *   1. Create a Wear OS project in Android Studio.
 *   2. Add BluetoothLeAdvertiser in a foreground Service.
 *   3. Advertise a GATT server with the three UUIDs above:
 *        val SERVICE_UUID   = UUID.fromString("12345678-1234-1234-1234-1234567890AB")
 *        val STATE_CHAR_UUID  = UUID.fromString("12345678-1234-1234-1234-1234567890AC")
 *        val ACTION_CHAR_UUID = UUID.fromString("12345678-1234-1234-1234-1234567890AD")
 *   4. On STATE_CHAR write: parse JSON → update Compose UI (yardage, hole, shots).
 *   5. ACTION_CHAR setup:
 *        - Add the CCCD (Client Characteristic Configuration Descriptor) so the phone
 *          can subscribe to notifications.
 *        - On "Mark Shot" tile tap:  notifyCharacteristic with {"action":"mark_shot"}
 *        - On "Ask Caddie" tile tap: notifyCharacteristic with {"action":"trigger_voice"}
 *   6. Watch UI (Compose for Wear OS):
 *        - Full-screen tile showing the yardage in 72sp bold white
 *        - Hole number + shot count in 20sp below
 *        - Row of two large buttons: [MARK SHOT] [ASK CADDIE]
 *        - Small dot indicator: green = connected, grey = searching
 *
 * ── Phone-side lifecycle ──────────────────────────────────────────────────────
 *   useWatchBle() (hooks/useWatchBle.ts) drives this module:
 *     1. On mount + BT enabled → scan for the watch service UUID
 *     2. On device found → stop scan → connect → discover → subscribe ACTION_CHAR
 *     3. On connect → createBleCaddieTransport(device) → setWatchTransport(transport)
 *     4. On BT off / app background / disconnect → clearWatchTransport() + optional reconnect
 *
 * ── Platform notes ────────────────────────────────────────────────────────────
 *   Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT runtime permissions required.
 *   iOS: NSBluetoothAlwaysUsageDescription in app.json infoPlist.
 *   Web: BLE not available — all calls are no-ops on Platform.OS === 'web'.
 */

import { Platform } from 'react-native';
import type { Device, Subscription as BleSubscription } from 'react-native-ble-plx';
import type { WatchTransport, WatchAction } from './watchSync';
import {
  WATCH_SERVICE_UUID,
  STATE_CHAR_UUID,
  ACTION_CHAR_UUID,
} from './watchSync';

// BLE is not available on web — guard every entry point
const IS_NATIVE = Platform.OS !== 'web';

/**
 * Lazily import BleManager only on native platforms.
 * This avoids a Metro / web-bundle error since react-native-ble-plx has no
 * web shim and would fail to resolve in the web entry bundle.
 */
let _BleManagerClass: typeof import('react-native-ble-plx').BleManager | null = null;
let _bleManager: import('react-native-ble-plx').BleManager | null = null;

function getBleManager(): import('react-native-ble-plx').BleManager | null {
  if (!IS_NATIVE) return null;
  if (_bleManager) return _bleManager;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _BleManagerClass = require('react-native-ble-plx').BleManager;
    _bleManager = new _BleManagerClass!();
    return _bleManager;
  } catch (e) {
    console.warn('[bleCaddieTransport] react-native-ble-plx not available:', e);
    return null;
  }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

/** Encode a JS object to Base64 for BLE characteristic write */
function encodeJson(obj: object): string {
  const json = JSON.stringify(obj);
  // btoa works in Hermes (React Native)
  return btoa(unescape(encodeURIComponent(json)));
}

/** Decode a Base64 BLE notification to a JS object */
function decodeJson<T>(base64: string | null): T | null {
  if (!base64) return null;
  try {
    const json = decodeURIComponent(escape(atob(base64)));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// ── Transport factory ─────────────────────────────────────────────────────────

/**
 * Create a WatchTransport backed by a live BLE Device connection.
 * Call this once the device is connected and characteristics are discovered.
 * The transport holds a reference to the device; calling send() writes
 * STATE_CHAR; action notifications come in via subscribeToAction().
 */
export function createBleCaddieTransport(device: Device): WatchTransport {
  let _connected  = true;
  let _notifySub: BleSubscription | null = null;
  const _actionListeners = new Set<(action: WatchAction) => void>();

  // Subscribe to ACTION_CHAR notifications (watch → phone)
  try {
    _notifySub = device.monitorCharacteristicForService(
      WATCH_SERVICE_UUID,
      ACTION_CHAR_UUID,
      (error, characteristic) => {
        if (error) {
          // Device disconnected or notification error — mark as disconnected
          console.log('[bleCaddieTransport] notification error (device likely disconnected):', error.message);
          _connected = false;
          _notifySub = null;
          return;
        }
        const payload = decodeJson<{ action?: string }>(characteristic?.value ?? null);
        const action = payload?.action as WatchAction | undefined;
        if (action === 'mark_shot' || action === 'trigger_voice') {
          _actionListeners.forEach((cb) => { try { cb(action); } catch {} });
        }
      },
    );
  } catch (e) {
    console.warn('[bleCaddieTransport] failed to subscribe to ACTION_CHAR:', e);
  }

  const transport: WatchTransport = {
    send(state) {
      if (!_connected) return;
      const encoded = encodeJson(state);
      device
        .writeCharacteristicWithoutResponseForService(
          WATCH_SERVICE_UUID,
          STATE_CHAR_UUID,
          encoded,
        )
        .catch((e) => {
          // Write error = likely disconnected
          console.log('[bleCaddieTransport] write error:', e?.message ?? e);
          _connected = false;
        });
    },

    onAction(callback) {
      _actionListeners.add(callback);
      return () => _actionListeners.delete(callback);
    },

    isConnected() {
      return _connected;
    },
  };

  return transport;
}

// ── Scan + connect orchestrator ───────────────────────────────────────────────

/** Milliseconds between automatic reconnection attempts after disconnect */
const RECONNECT_DELAY_MS = 5000;
/** How long to scan before giving up */
const SCAN_TIMEOUT_MS    = 15000;

export interface BleConnectOptions {
  /** Called once a transport is ready — wire it to setWatchTransport() */
  onConnect:    (transport: WatchTransport) => void;
  /** Called when the connection is lost — wire it to clearWatchTransport() */
  onDisconnect: () => void;
}

/**
 * startWatchScan — begins scanning for the Galaxy Watch and connects when found.
 *
 * Returns a cleanup function:  call it on unmount / app background.
 * Handles reconnect automatically on disconnect.
 * All errors are caught and logged — never throws.
 */
export function startWatchScan(options: BleConnectOptions): () => void {
  if (!IS_NATIVE) return () => {};

  const manager = getBleManager();
  if (!manager) return () => {};

  let _cancelled  = false;
  let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function _connectToDevice(device: Device): Promise<void> {
    try {
      const connected = await device.connect({ autoConnect: true });
      const discovered = await connected.discoverAllServicesAndCharacteristics();

      // Verify the watch service is present
      const services = await discovered.services();
      const watchService = services.find(
        (s) => s.uuid.toLowerCase() === WATCH_SERVICE_UUID.toLowerCase(),
      );
      if (!watchService) {
        console.warn('[bleCaddieTransport] Connected device missing SmartPlay watch service');
        await device.cancelConnection().catch(() => {});
        return;
      }

      console.log('[bleCaddieTransport] Galaxy Watch connected:', device.name ?? device.id);
      const transport = createBleCaddieTransport(discovered);
      options.onConnect(transport);

      // Monitor disconnect
      discovered.onDisconnected((_error, _dev) => {
        console.log('[bleCaddieTransport] Galaxy Watch disconnected');
        options.onDisconnect();
        if (!_cancelled) {
          _reconnectTimer = setTimeout(() => {
            if (!_cancelled) _scan();
          }, RECONNECT_DELAY_MS);
        }
      });
    } catch (e) {
      console.warn('[bleCaddieTransport] connection failed:', (e as Error)?.message ?? e);
      if (!_cancelled) {
        _reconnectTimer = setTimeout(() => {
          if (!_cancelled) _scan();
        }, RECONNECT_DELAY_MS);
      }
    }
  }

  function _scan(): void {
    if (_cancelled) return;
    console.log('[bleCaddieTransport] Scanning for Galaxy Watch...');

    // Scan only for devices advertising our service UUID
    manager!.startDeviceScan(
      [WATCH_SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (_cancelled) return;
        if (error) {
          console.warn('[bleCaddieTransport] scan error:', error.message);
          // BT turned off or permission denied — stop scanning
          manager!.stopDeviceScan();
          return;
        }
        if (device) {
          manager!.stopDeviceScan();
          void _connectToDevice(device);
        }
      },
    );

    // Auto-stop scan after timeout to save battery
    setTimeout(() => {
      if (!_cancelled) {
        manager!.stopDeviceScan();
        console.log('[bleCaddieTransport] Scan timed out — will retry in', RECONNECT_DELAY_MS / 1000, 's');
        _reconnectTimer = setTimeout(() => {
          if (!_cancelled) _scan();
        }, RECONNECT_DELAY_MS);
      }
    }, SCAN_TIMEOUT_MS);
  }

  _scan();

  // Cleanup — call this to stop scanning and cancel reconnect loop
  return () => {
    _cancelled = true;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    try { manager!.stopDeviceScan(); } catch {}
  };
}

/**
 * destroyBleManager — release the BleManager singleton.
 * Call once on app unmount (not typically needed in a normally running app).
 */
export function destroyBleManager(): void {
  try { _bleManager?.destroy(); } catch {}
  _bleManager = null;
}
