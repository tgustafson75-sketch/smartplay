/**
 * useWatchBle — Drives the BLE scan / connect lifecycle for Galaxy Watch 7.
 *
 * Responsibilities:
 *  • Checks BLE state (powered on, permissions granted) before scanning
 *  • Starts scan via startWatchScan() → on connect calls setWatchTransport()
 *  • On disconnect calls clearWatchTransport() (phone keeps working normally)
 *  • Pauses scan when app goes to background; resumes on foreground
 *  • Cleans up completely on unmount
 *
 * Usage (app/_layout.tsx):
 *   import { useWatchBle } from '../hooks/useWatchBle';
 *   // Inside RootLayout:
 *   useWatchBle();
 *
 * The hook is deliberately side-effect only — it returns nothing because no
 * component needs to render differently based purely on BLE scanning state.
 * Connection status is exposed by isWatchConnected() from watchSync.ts and
 * by useWatchSync's watchConnected boolean (already wired in caddie.tsx).
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { setWatchTransport, clearWatchTransport } from '../services/watchSync';
import { startWatchScan } from '../services/bleCaddieTransport';

export function useWatchBle(): void {
  // No-op on web — react-native-ble-plx is native-only
  if (Platform.OS === 'web') return;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const stopScanRef = useRef<(() => void) | null>(null);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    function startScan() {
      if (stopScanRef.current) return; // already scanning
      stopScanRef.current = startWatchScan({
        onConnect(transport) {
          setWatchTransport(transport);
        },
        onDisconnect() {
          clearWatchTransport();
          // startWatchScan's internal reconnect loop will restart the scan
        },
      });
    }

    function stopScan() {
      stopScanRef.current?.();
      stopScanRef.current = null;
      clearWatchTransport();
    }

    // Start scanning immediately when the hook mounts
    startScan();

    // Pause scan in background (saves battery); resume on foreground
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startScan();
      } else if (nextState === 'background' || nextState === 'inactive') {
        stopScan();
      }
    });

    return () => {
      stopScan();
      subscription.remove();
    };
  }, []); // mount/unmount only
}
