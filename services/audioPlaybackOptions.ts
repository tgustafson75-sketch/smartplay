/**
 * ONE OWNER for the initial status every `Audio.Sound` is loaded with.
 *
 * 2026-09-22 — Sentry, Android, FATAL, ongoing since 1.0.0 (1), route `/greeting`:
 *
 *     IllegalStateException: Player is accessed on the wrong thread.
 *       Current thread: 'pool-4-thread-1'  Expected thread: 'main'
 *     com.google.android.exoplayer2.ExoPlayerImpl:2597 in verifyApplicationThread
 *
 * The mechanism, read out of node_modules rather than guessed:
 *
 *  1. expo-av builds the sound player with `.setLooper(Looper.getMainLooper())`
 *     (`player/SimpleExoPlayerData.java:93`), so ExoPlayer's application thread is MAIN.
 *  2. None of the sound entry points — `loadForSound` / `setStatusForSound` / `unloadForSound`
 *     (`AVModule.kt:57-73`) — declare `.runOnQueue(Queues.MAIN)`. expo-modules-core therefore
 *     runs them on `Queues.DEFAULT` → `appContext.modulesQueue`, a background pool
 *     (`functions/AsyncFunctionComponent.kt:62`). That is the `pool-N-thread-M` in the report.
 *  3. The progress ticker binds `new Handler()` — the NO-ARG constructor, which captures
 *     `Looper.myLooper()` of whichever thread happened to schedule it
 *     (`progress/AndroidLooperTimeMachine.kt:8`). Its ticks then call `getStatus()`, which
 *     touches ExoPlayer, from that thread.
 *
 * Why it is fatal rather than a rejected promise: a throw inside `callUserImplementation` is
 * caught and rejected (`AsyncFunctionComponent.kt:46-52`), and our callers all `.catch(() => {})`.
 * A throw from a Handler tick is outside that try/catch, so it reaches the
 * UncaughtExceptionHandler — which is exactly the mechanism Sentry reports.
 *
 * expo-av knows: `SimpleExoPlayerData.java:131` carries the TODO
 * "Find a way to fix IllegalStateException: SimpleExoPlayer is accessed on the wrong thread."
 *
 * The fix that does not need a native build: `androidImplementation: 'MediaPlayer'` selects
 * `MediaPlayerData` instead (`player/PlayerData.java:218-223`), which contains ZERO thread
 * assertions. It is a documented expo-av option, and it rides an OTA — so it reaches the
 * build-27 installs that are crashing today.
 *
 * PROBES KEEP ExoPlayer ON PURPOSE. `poseDetection` / `puttFrameExtractor` / `videoUpload` load
 * a Sound only to read `durationMillis` off a .mov/.mp4, and ExoPlayer reads more containers than
 * MediaPlayer does. They also never call `setOnPlaybackStatusUpdate`, so the progress ticker in
 * step 3 never starts (`PlayerData.java:275-278` requires a status listener) — they cannot reach
 * this crash. Narrowing them to MediaPlayer would trade a bug they do not have for a regression
 * on the analysis path.
 *
 * HONEST LIMIT: the Android frames name expo-av and ExoPlayer, not our JS, so this is the
 * mechanism that produces the reported exception — not proof that this call site produced it.
 * It is also a documented option applied to a path that only ever plays mp3, so it costs nothing
 * if the crash turns out to be something else. [[state-what-you-measured-not-what-you-intended]]
 */

import { Platform } from 'react-native';
import type { AVPlaybackStatusToSet } from 'expo-av';

/**
 * Initial status for a Sound we are going to PLAY. Every playback load site must go through
 * this — `__tests__/audioPlaybackOptions.guard.test.ts` fails the build on a bare
 * `Audio.Sound.createAsync` / `loadAsync` anywhere else.
 */
export const playbackSoundOptions = (
  status: AVPlaybackStatusToSet = {},
): AVPlaybackStatusToSet =>
  Platform.OS === 'android'
    ? { ...status, androidImplementation: 'MediaPlayer' }
    : status;

/**
 * Initial status for a Sound loaded only to measure a file (duration probes). Deliberately
 * stays on ExoPlayer — see the PROBES note above. Exists so the guard can tell a considered
 * exception from an oversight.
 */
export const probeSoundOptions = (
  status: AVPlaybackStatusToSet = {},
): AVPlaybackStatusToSet => status;
