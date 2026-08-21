/**
 * ⚠️ SUPERSEDED — DO NOT TRUST THE OLD NOTES BELOW. Corrected 2026-08-21.
 *
 * EARBUD TAPS WORK. This file's previous header said the opposite in bold terms — "NO-OP",
 * "tapping a Bluetooth earbud DOES NOT fire notifyEarbudTap()" — and that was true for exactly
 * three weeks. It described the react-native-track-player approach removed on 2026-05-02
 * (commit 9865fef8, New Arch conflict). The REPLACEMENT landed on 2026-05-24 and nobody came
 * back to correct this text.
 *
 * THE LIVE PATH TODAY:
 *     BT button ──► native BluetoothMediaButton module (plugins/withBluetoothMediaButton.js,
 *                   registered in app.json → SHIPS IN THE BUILD, no external deps: Android
 *                   MediaSession, iOS MediaPlayer/AVFoundation)
 *               ──► DeviceEventEmitter 'onRemoteControl'
 *               ──► services/voiceTriggers.ts
 *               ──► notifyEarbudTap() ──► listeningSession.toggle()
 *
 * Enabled by `earbudTapToTalk`, which DEFAULTS TO TRUE and is synced at boot from
 * app/_layout.tsx. So it is on unless the player turned it off.
 *
 * WHY THIS CORRECTION EXISTS AT ALL: on 2026-08-21 I read the old header, believed it, and told
 * Tim earbud tap "needs a native build" — a feature he has been chasing since the app's second
 * day and which had been working for months. He corrected me in one sentence: "I can tap the ear
 * button, the app reacts."
 *
 * A stale comment is not a harmless comment. This one asserted a capability was missing, and it
 * was believed over the running code. That is the same failure as a guard that pins a defect:
 * a confident claim, never re-verified, outliving the thing it described.
 *
 * WHAT GENUINELY DOES NOT EXIST YET: knowing whether a headset is CONNECTED (as opposed to
 * tapped). BluetoothMediaButtonModule.kt imports android.media.AudioManager and never uses it;
 * exposing isHeadsetConnected() is ~10 lines of Kotlin plus an AVAudioSession equivalent on iOS,
 * and THAT would need a new build. Everything about tapping already ships.
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
