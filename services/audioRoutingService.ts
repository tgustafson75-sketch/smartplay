/**
 * Phase O — Audio routing monitor.
 *
 * Tracks whether audio is currently routing through Bluetooth/wired headset
 * vs the phone's built-in speaker. Phase O's listening session uses this to
 * decide whether Kevin's voice is safe to play (earbuds connected → yes;
 * phone speaker → suppress + show notification per spec, unless the user
 * explicitly enabled "Voice on phone speaker" in settings).
 *
 * Implementation: subscribes to expo-av audio session changes. The native
 * detail (iOS AVAudioSession.routeChangeNotification, Android
 * AudioManager.ACTION_HEADSET_PLUG + Bluetooth profile) is abstracted by
 * expo-av at managed-workflow level. For richer detection (distinguishing
 * "earbuds with mic" from "speakers without mic"), a future custom native
 * module would expose CMHeadphoneMotionManager / Bluetooth class data.
 *
 * KNOWN LIMITATION: in Expo managed workflow, expo-av exposes audio session
 * state but not granular route-change events. This service polls every 2s
 * for the configured audio mode and falls back to a "best-effort" detection
 * via Audio.getPermissionsAsync + checking allowsRecordingIOS state.
 * Future: replace polling with native event listener via custom module.
 */

export type AudioRoute = 'phone_speaker' | 'wired' | 'bluetooth' | 'unknown';

type Listener = (route: AudioRoute) => void;

let currentRoute: AudioRoute = 'unknown';
const listeners: Set<Listener> = new Set();
let audioModeConfigured = false;

/**
 * Returns the most recently detected audio route.
 */
export function getCurrentRoute(): AudioRoute {
  return currentRoute;
}

/**
 * Subscribe to route changes. Returns an unsubscribe function.
 */
export function subscribeRouteChanges(listener: Listener): () => void {
  listeners.add(listener);
  if (!audioModeConfigured) {
    audioModeConfigured = true;
    void detectRoute();
  }
  return () => {
    listeners.delete(listener);
  };
}

async function detectRoute() {
  // Configure audio mode once on first subscribe. Done synchronously
  // here (no polling); no-op when called repeatedly.
  //
  // 2026-06-03 — Route through voiceService.setAudioModeSerial instead
  // of calling Audio.setAudioModeAsync directly. Previously, this
  // direct call (fired from CaptionStrip mount at root layout) could
  // land inside any active speak() / playLocalFile() window and
  // downgrade audio routing mid-utterance via the underlying audio
  // singleton — the exact race documented in voiceService.ts:45-63.
  // Same dynamic-require pattern as audioLifecycle.goCold (avoids the
  // circular dep with voiceService).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const voiceMod = require('./voiceService') as typeof import('./voiceService');
    await voiceMod.setAudioModeSerial({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
  } catch (e) {
    console.log('[audioRouting] setAudioMode failed:', e);
  }

  /**
   * 2026-08-25 — ACTUALLY DETECT THE ROUTE. Parked since 08-21 as "highest daily value".
   *
   * Everything above this point CONFIGURES audio and returns; nothing ever asked what the audio was
   * coming out of. The only writer of currentRoute was the manual Settings toggle, so a player with
   * earbuds in had to tell the app so. The native module now answers from AudioManager (Android) /
   * AVAudioSession (iOS) — both have always known.
   *
   * Degrades silently to the manual toggle on any build without the native method, which is every
   * build before this one. An unknown route is left alone rather than forced to 'phone_speaker':
   * overriding a player's explicit choice with a guess would be worse than not knowing.
   */
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as typeof import('react-native');
    const mod = (NativeModules as Record<string, unknown>).BluetoothMediaButton as
      | { getAudioRoute?: () => Promise<{ route?: string; headsetConnected?: boolean }> }
      | undefined;
    if (mod?.getAudioRoute) {
      const r = await mod.getAudioRoute();
      const mapped: AudioRoute =
        r?.route === 'bluetooth' ? 'bluetooth'
        : r?.route === 'wired' ? 'wired'
        : r?.route === 'speaker' ? 'phone_speaker'
        : 'unknown';
      if (mapped !== 'unknown') setRouteForOverride(mapped);
    }
  } catch (e) {
    console.log('[audioRouting] route detection unavailable (pre-build client):', e);
  }
}

/**
 * Manual route override — used by Settings ("Voice on phone speaker" toggle)
 * and by future native module bridges that pipe real route-change events.
 */
export function setRouteForOverride(route: AudioRoute): void {
  if (route !== currentRoute) {
    currentRoute = route;
    listeners.forEach(l => { try { l(route); } catch (e) { console.log('[audioRouting] listener err', e); } });
  }
}
