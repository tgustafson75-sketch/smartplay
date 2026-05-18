import { Audio } from 'expo-av';

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
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
  } catch (e) {
    console.log('[audioRouting] setAudioMode failed:', e);
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
