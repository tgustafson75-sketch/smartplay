/**
 * Phase O.5 — Real Bluetooth media-key event bridge.
 *
 * Closes the Phase O honest gap. Uses react-native-track-player to register
 * a media session that captures hardware play/pause events from connected
 * Bluetooth earbuds (AirPods, Galaxy Buds, etc.). Both RemotePlay and
 * RemotePause events route to a single "tap" signal that fires
 * `notifyEarbudTap()` — the existing Phase O orchestration seam.
 *
 * Lifecycle (conflict-handling):
 *   - The media session is registered only while the user is in an active
 *     round OR an active practice surface (Cage Mode setup, PostSessionReview,
 *     Arena landing/runner). Outside those surfaces, we deactivate so that
 *     other media apps (Spotify, podcasts) get the system media controls
 *     unmodified.
 *   - We register a silent "phantom track" because track-player needs an
 *     active queue item to receive remote events. Phantom track is a 1ms
 *     silence file embedded as base64 to avoid asset bundling.
 *   - We never call play() — the track sits paused. The earbud tap is
 *     still received because iOS MPRemoteCommandCenter and Android
 *     MediaSession deliver remote-command callbacks regardless of
 *     playback state, as long as the session is registered.
 *
 * Native build requirement: react-native-track-player is NOT compatible
 * with Expo Go. Tim must run an EAS dev-client build (`eas build --profile
 * development --platform <ios|android>`) once to pick up the new native
 * module. The TypeScript / orchestration layer here is JS-only and ships
 * over the air.
 */

let TrackPlayer: any = null;
let Event: any = null;
let Capability: any = null;
let isRegistered = false;
let setupPromise: Promise<void> | null = null;
let unsubRemotePlay: { remove(): void } | null = null;
let unsubRemotePause: { remove(): void } | null = null;

// Lazy-load track-player so unit tests / web builds don't blow up.
// Pre-beta — verify the native bridge constants are present too. In Expo
// Go (or any build without the native module installed), `Capability.Play`
// is undefined because it derives from a native constant; passing
// undefined into `updateOptions({capabilities})` surfaced as a visible
// "capability of play" error when the user started a round.
//
// Don't sticky-cache failure (no `TrackPlayer = false`): a hot-reload
// after a fresh dev-client install would otherwise stay disabled until
// the next full app launch.
function loadTrackPlayer(): boolean {
  if (TrackPlayer) return true;
  try {
    const mod = require('react-native-track-player');
    const tp = mod.default ?? mod;
    const cap = mod.Capability;
    const evt = mod.Event;
    if (!tp || !cap || cap.Play == null || cap.Pause == null || !evt) {
      // Don't latch — let the next call retry in case a hot-reload picks
      // up a freshly-installed native module.
      return false;
    }
    TrackPlayer = tp;
    Event = evt;
    Capability = cap;
    return true;
  } catch (e) {
    console.log('[mediaKeyBridge] track-player load failed (expected in Expo Go):', e);
    return false;
  }
}

async function ensureSetup(): Promise<void> {
  if (setupPromise) return setupPromise;
  if (!loadTrackPlayer()) return;

  setupPromise = (async () => {
    try {
      await TrackPlayer.setupPlayer({
        // Keep player alive in background so Bluetooth taps still fire when
        // the user has the phone in their pocket mid-round.
        autoHandleInterruptions: false,
      });
      await TrackPlayer.updateOptions({
        capabilities: [Capability.Play, Capability.Pause],
        compactCapabilities: [Capability.Play, Capability.Pause],
        // Notification icon left default; lock-screen art omitted for v1.
      });
    } catch (e) {
      // setupPlayer throws if called twice — safe to ignore.
      console.log('[mediaKeyBridge] setup note:', e);
    }
  })();

  return setupPromise;
}

/**
 * Activate the media session. Call when entering a surface where earbud
 * tap should target SmartPlay (round start, cage setup mount, etc.).
 * Idempotent.
 */
export async function activateMediaSession(): Promise<void> {
  if (isRegistered) return;
  if (!loadTrackPlayer()) return;

  await ensureSetup();

  try {
    // Phantom track — 1ms of silence as a data URI. track-player needs a
    // queue item to keep the remote command center alive. We never play it.
    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: 'smartplay-phantom',
      // Tiny silent MP3 (≈100 bytes decoded). data: URIs work on both platforms.
      url: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA////////////////////////////////////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQCwAAAAAAAAAJxqWgWywAAAAAAAAAAAAAAAAAAAAAA',
      title: 'SmartPlay Caddie',
      artist: 'Listening',
    });

    // Subscribe to both remote events. Bluetooth earbud play/pause taps
    // arrive as one or the other depending on track-player's current
    // playback state — treat both as a single "tap" signal.
    const { notifyEarbudTap } = require('./earbudControl') as typeof import('./earbudControl');

    unsubRemotePlay = TrackPlayer.addEventListener(Event.RemotePlay, () => {
      try { notifyEarbudTap(); } catch (e) { console.log('[mediaKeyBridge] tap fwd err', e); }
    });
    unsubRemotePause = TrackPlayer.addEventListener(Event.RemotePause, () => {
      try { notifyEarbudTap(); } catch (e) { console.log('[mediaKeyBridge] tap fwd err', e); }
    });

    isRegistered = true;
  } catch (e) {
    console.log('[mediaKeyBridge] activate failed:', e);
  }
}

/**
 * Deactivate the media session. Call when leaving the relevant surface
 * (round ends, cage screens unmount). Releases system media controls back
 * to other apps (Spotify, podcasts).
 */
export async function deactivateMediaSession(): Promise<void> {
  if (!isRegistered) return;
  if (!TrackPlayer) return;

  try {
    if (unsubRemotePlay) { unsubRemotePlay.remove(); unsubRemotePlay = null; }
    if (unsubRemotePause) { unsubRemotePause.remove(); unsubRemotePause = null; }
    await TrackPlayer.reset();
  } catch (e) {
    console.log('[mediaKeyBridge] deactivate err:', e);
  } finally {
    isRegistered = false;
  }
}

export function isMediaSessionActive(): boolean {
  return isRegistered;
}
