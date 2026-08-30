/**
 * services/audioRoutingService.ts — is the caddie's voice going into a headset, or into the air?
 *
 * The listening session uses this to decide whether it is safe to speak: earbuds connected → yes;
 * phone speaker → suppress and caption instead, unless the player explicitly enabled "Voice on phone
 * speaker" in Settings.
 *
 * 2026-08-29 — THIS HEADER USED TO DESCRIBE A FILE THAT DOES NOT EXIST. It claimed the service
 * "subscribes to expo-av audio session changes", that the native detail was "abstracted by expo-av
 * at managed-workflow level", and that it "polls every 2s ... falls back to a best-effort detection
 * via Audio.getPermissionsAsync". None of that was ever true here: there is no polling, no expo-av
 * subscription, and no permissions-based fallback. Anyone reading the file to find out why route
 * detection was unreliable would have gone looking for a 2-second timer that was never written.
 * [[grep-guards-cant-see-dead-code]]
 *
 * What is actually true, as of the 08-29 build:
 *
 *   - `detectRoute()` configures the audio mode, then ASKS the native module once.
 *   - `startRouteWatch()` + the `onAudioRouteChanged` event keep it current afterwards —
 *     AVAudioSession.routeChangeNotification on iOS, AudioManager.AudioDeviceCallback on Android.
 *   - Everything degrades to the manual Settings toggle when the native method is absent, which is
 *     every build before this one.
 *
 * An unknown route is left alone rather than forced to 'phone_speaker': overriding a player's
 * explicit choice with a guess is worse than not knowing.
 */

export type AudioRoute = 'phone_speaker' | 'wired' | 'bluetooth' | 'unknown';

type Listener = (route: AudioRoute) => void;

let currentRoute: AudioRoute = 'unknown';
const listeners: Set<Listener> = new Set();
let audioModeConfigured = false;
let routeWatchStarted = false;

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
      | {
          getAudioRoute?: () => Promise<{ route?: string; headsetConnected?: boolean }>;
          startRouteWatch?: () => Promise<boolean>;
        }
      | undefined;
    if (mod?.getAudioRoute) {
      const r = await mod.getAudioRoute();
      applyNativeRoute(r);
    }
    /**
     * 2026-08-29 — READING THE ROUTE ONCE IS NOT DETECTING IT.
     *
     * The read above ran exactly once, on first subscribe, so the app learned the route at app start
     * and never again. Players put earbuds in on the first tee, not in the car park — so the caddie
     * spent the round deciding whether to talk out loud from an answer that was already stale, and
     * the only way to correct it was the manual toggle this was supposed to replace.
     *
     * Both platforms have always broadcast route changes. Subscribing is the whole fix.
     */
    if (mod?.startRouteWatch && !routeWatchStarted) {
      routeWatchStarted = true;
      const started = await mod.startRouteWatch().catch(() => false);
      if (started) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DeviceEventEmitter } = require('react-native') as typeof import('react-native');
        DeviceEventEmitter.addListener('onAudioRouteChanged', (payload: unknown) => {
          applyNativeRoute(payload as { route?: string });
        });
      }
    }
  } catch (e) {
    console.log('[audioRouting] route detection unavailable (pre-build client):', e);
  }
}

/**
 * One mapper for both the one-shot read and the change event — they carry the same payload shape
 * from both platforms deliberately, so there is no second place for the mapping to drift.
 */
function applyNativeRoute(r: { route?: string } | null | undefined): void {
  const mapped: AudioRoute =
    r?.route === 'bluetooth' ? 'bluetooth'
    : r?.route === 'wired' ? 'wired'
    : r?.route === 'speaker' ? 'phone_speaker'
    : 'unknown';
  if (mapped !== 'unknown') setRouteForOverride(mapped);
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
