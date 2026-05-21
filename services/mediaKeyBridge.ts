/**
 * Phase O.5 → Phase AC reality check.
 *
 * STATE TODAY: NO-OP. react-native-track-player was removed (Kotlin /
 * New-Arch incompatibility with reanimated v4 — see commit 9865fef). The
 * package isn't in node_modules, so `loadTrackPlayer()` always returns
 * false and `activateMediaSession()` / `deactivateMediaSession()` silently
 * exit. No native media-key listener exists in the build.
 *
 * Consequence: tapping a Bluetooth earbud DOES NOT fire `notifyEarbudTap()`.
 * The settings toggle is disabled (see app/settings.tsx) and labelled
 * "Coming soon" until a native listener lands. On-screen tap (Kevin badge
 * on the Caddie tab → handleMicPress in useVoiceCaddie) is the working
 * fallback.
 *
 * The orchestration layer (listeningSession.ts) is fully wired — it just
 * needs a real source. When we ship the native listener (separate phase),
 * the only required change is calling `notifyEarbudTap()` from its
 * callback. No consumer-site changes.
 *
 * Path forward (deferred to its own phase):
 *   - Android: write a small Kotlin module that subscribes to MediaSession
 *     transport controls or registers a MediaButtonReceiver, and call into
 *     a JS bridge that fires notifyEarbudTap().
 *   - iOS: MPRemoteCommandCenter.shared().togglePlayPauseCommand
 *   - Or: revisit react-native-track-player once it ships New-Arch
 *     support; then this file's loadTrackPlayer() body becomes the wire.
 */

// 2026-05-21 — Consolidation 4: track-player-loader notes gated.
import { devLog } from './devLog';

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
    devLog('[mediaKeyBridge] track-player load failed (expected in Expo Go):', e);
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
      devLog('[mediaKeyBridge] setup note:', e);
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
      console.log('[audit:earbud] media key fired (RemotePlay/Pause)');
      try { notifyEarbudTap(); } catch (e) { console.log('[mediaKeyBridge] tap fwd err', e); }
    });
    unsubRemotePause = TrackPlayer.addEventListener(Event.RemotePause, () => {
      console.log('[audit:earbud] media key fired (RemotePlay/Pause)');
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
