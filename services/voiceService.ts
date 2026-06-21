import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import * as Speech from 'expo-speech';
import { File, Paths } from 'expo-file-system';
import { noteAudioActivity } from './audioLifecycle';
import { logVoiceSilentFail, logVoiceError, logTranscribeError } from './voiceErrorLog';
// 2026-06-07 (audit) — wire TTS into the circuit breaker so spoken replies
// short-circuit under weak signal instead of burning the full 12s timeout
// then going silent. Feeds the reactive connectivity signal too.
import { isDegraded as cbIsDegraded, recordSuccess as cbRecordSuccess, recordFailure as cbRecordFailure } from './voiceCircuitBreaker';
import { reportOnline as cbReportOnline, reportNetworkFailure as cbReportNetworkFailure } from '../store/connectivityStore';
import { useConversationLog } from '../store/conversationLogStore';
// 2026-05-30 — Fix FX: voice/network circuit-breaker. After 3 consecutive
// fetch failures within 30s on any of /api/voice, /api/kevin, or
// /api/transcribe, that endpoint is marked degraded for 60s and we
// short-circuit subsequent attempts without firing the actual fetch.
// Saves the radio-wake cost during weak-signal stretches.

// ─── AUDIO MODE MANAGEMENT ────────────────
// Phase V.7 — serialize setAudioModeAsync calls. Without a queue, rapid
// recording↔speech swaps (earbud tap during TTS, listening session opener
// → mic → response) could race the underlying iOS/Android audio singleton
// and downgrade routing (e.g. drop to phone earpiece mid-utterance).

let audioModeQueue: Promise<void> = Promise.resolve();

// 2026-06-01 — Fix GC: per-call timeout on Audio.setAudioModeAsync.
// Verifiable defect this closes: native audio-mode calls can hang
// (audio-focus contention, OS deadlock — real on both iOS and Android).
// The prior queue had no timeout; one hung call would poison the chain
// permanently, and every subsequent setAudioModeSerial caller would
// await a never-resolving promise. Symptom: tap-to-talk freezes on
// the 2nd or 3rd attempt (1st succeeds, then one call hangs, queue
// dead). captureUtterance + configureAudioForSpeech + every other
// audio path goes through this queue, so a single hang takes down
// the whole voice stack.
//
// Fix: race each Audio.setAudioModeAsync against a 3s timeout. On
// timeout, log loudly and let the queue move on with the requested
// mode possibly unapplied — the next call will reapply. The queue
// stays alive. No happy-path scenario changes: 3s is well above the
// ~5-50ms a healthy setAudioModeAsync takes.
const AUDIO_MODE_CALL_TIMEOUT_MS = 3_000;

// 2026-06-01 — Fix GJ: export setAudioModeSerial so audioLifecycle's
// goCold() can route through the SAME serial queue. Before this,
// goCold called Audio.setAudioModeAsync directly, racing every
// configureAudioForSpeech / configureAudioForRecording call going
// through the queue. If goCold won the race mid-playback (app
// backgrounded or trust→quiet), the audio session flipped to
// playsInSilentModeIOS:false underneath an active mp3 → silence
// mid-utterance. Single queue = no race.
export const setAudioModeSerial = (mode: Parameters<typeof Audio.setAudioModeAsync>[0]): Promise<void> => {
  audioModeQueue = audioModeQueue
    .catch(() => { /* drop prior failure */ })
    .then(() => Promise.race([
      Audio.setAudioModeAsync(mode),
      new Promise<void>((_resolve, reject) =>
        setTimeout(() => reject(new Error('setAudioModeAsync timeout')), AUDIO_MODE_CALL_TIMEOUT_MS),
      ),
    ]))
    .then(() => undefined)
    .catch((err) => {
      // Swallow the timeout/error so the queue stays alive for the
      // NEXT caller. Worst case: audio mode is one call behind reality,
      // and the next caller will reapply. Log loudly so the hang is
      // visible in logcat — provable when it happens.
      // 2026-06-15 (audit) — include err.name: some Android OEMs throw a
      // non-standard error with an empty .message, which logged as a blank line.
      console.log('[voice] setAudioModeSerial swallowed error to keep queue alive:', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    });
  return audioModeQueue;
};

export const configureAudioForRecording =
  async (): Promise<void> => {
    try {
      await setAudioModeSerial({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        // Audit follow-up (2026-05-13) — iOS-specific interruption
        // policy. DoNotMix while recording: if Spotify/podcast is
        // playing, iOS pauses it so the mic captures clean audio
        // instead of background music. interruption{Begin,End}
        // events are handled by the OS automatically given this mode.
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
      currentAudioMode = 'record';
    } catch (err) {
      console.log('[voice] configure record error:', err);
    }
  };

// 2026-06-05 — Single source of truth for mic-record options.
// captureUtterance (this file) and the manual-tap path in
// hooks/useVoiceCaddie.ts both import this; the prior duplicate
// in useVoiceCaddie was identical but invited drift. 16kHz mono
// 32kbps matches Whisper's native input format and is ~4× smaller
// than expo-av's HIGH_QUALITY preset with no transcription accuracy
// loss. Metering ON so captureUtterance's silence-VAD callback
// receives `metering` dB values.
export const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.LOW,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

// 2026-05-25 — Fix A: silence-VAD thresholds.
// metering returns dB level; quieter = more negative. Typical room
// ambient is ~ -55 dB, normal speech ~ -25 to -10 dB. A threshold of
// -40 dB cleanly separates "user talking" from "user silent." If three
// continuous seconds of below-threshold readings come in AND the user
// has spoken at least once (so we don't auto-stop on dead silence
// before they start), end the recording early.
const SILENCE_DB_THRESHOLD = -40;
// 2026-06-13 (Tim) — SNAP on silence. 4000ms made the caddie feel slow to react
// ("doesn't snap silence well") vs an instant-feeling reference app. Dropped to
// 1200ms so it endpoints quickly when you stop talking — still ~3-4x a normal
// inter-word gap, so it doesn't cut a brief word-search pause. This is the single
// snap knob: lower (~900) = snappier/risk cutting slow pausers; higher (~1800) =
// safer/laggier. All captureUtterance callers inherit.
// 2026-06-16 (Tim — "listens too long, as fast a flow as possible") — 1200 → 900.
// Still ~2.5–3x a normal inter-word gap (typical word-search pauses are 300–600ms),
// so it snaps right after you stop without clipping a brief mid-thought pause. The
// adaptive noise floor keeps background sound from holding the window open.
const SILENCE_TIMEOUT_MS = 900;
const SPEECH_DETECT_DB = -30; // higher bar to confirm "they spoke at least once"

// 2026-06-16 (Tim — "first tap to talk in background noise fails") — adaptive
// noise floor, the same idea as Smart Motion's rolling strike floor. The fixed
// -40/-30 thresholds above assume a ~-55 dB quiet room. With ANY real background
// sound (TV, range, wind, traffic, a room of people) the ambient sits ABOVE -40,
// so noise kept refreshing lastLoudAt and the silence-VAD NEVER tripped — the
// capture ran the full timeout, then transcribed a long noisy clip and Kevin got
// garbage / no usable response on the first tap. We now estimate the live ambient
// floor and lift the speech + silence thresholds RELATIVE to it, clamped to the
// absolute floors so a genuinely quiet room behaves EXACTLY as before (the fix can
// only ever make it MORE robust, never less sensitive).
const NOISE_FLOOR_INIT_DB = -50;     // sane ambient default before we've sampled
const NOISE_FLOOR_MIN_DB = -60;      // ignore the -160 "no-signal" sentinel reads
const NOISE_FLOOR_FALL_ALPHA = 0.15; // settle down to a quieter ambient in ~1.5s
const NOISE_FLOOR_RISE_ALPHA = 0.02; // rise slowly so the user's speech can't inflate it
const SILENCE_MARGIN_DB = 12;        // voice must clear ambient by this to count as "still talking"
const SPEECH_MARGIN_DB = 18;         // and by this to confirm "they spoke at least once"

/**
 * Record audio for up to {timeoutMs}, transcribe, and return the text.
 * Returns null on permission denial, recording failure, transcription
 * error, or external cancellation via {@link stopCapture}.
 */
let currentRecording: Audio.Recording | null = null;
// 2026-06-15 (Tim — "racing somewhere earlier in the chain") — ATOMIC re-entry
// guard. currentRecording is only set AFTER the async createAsync() resolves, so
// two callers (VAD auto-fire + a manual tap, or the earbud listen path firing
// alongside a follow-up loop) could BOTH reach Audio.Recording.createAsync()
// before either marks the mic busy → the OS throws "Only one Recording object
// can be active at a time" and the turn is lost. This flag is set synchronously
// at function entry (before any await), so the second concurrent call bails
// immediately. Reset in a finally so every exit path clears it.
let captureInProgress = false;
let captureCancelled = false;
// 2026-06-06 — Distinct from captureCancelled: this means "user
// explicitly ended the capture (tap during a follow-up listen) — DO
// transcribe what was recorded." captureCancelled discards the audio;
// captureEarlyStop preserves it. Set via endCaptureEarly() from
// useVoiceCaddie's handleMicPress when the user taps during an
// in-flight captureUtterance.
let captureEarlyStop = false;

export const stopCapture = async (): Promise<void> => {
  captureCancelled = true;
  const r = currentRecording;
  currentRecording = null;
  if (r) {
    try { await r.stopAndUnloadAsync(); } catch { /* ignore */ }
  }
};

/**
 * 2026-06-06 — True when a captureUtterance() call is currently
 * recording. Used by handleMicPress to detect tap-during-follow-up
 * so it can route to endCaptureEarly() instead of starting a parallel
 * recording (which would race the audio session and lose the user's
 * follow-up turn).
 */
export const isCapturing = (): boolean => currentRecording !== null;

/**
 * 2026-06-06 — End the in-flight captureUtterance EARLY but still
 * transcribe whatever was recorded. Mirrors the silence-VAD's "user
 * stopped talking, run with what we have" behavior — but triggered by
 * a tap. Lets the user choose between waiting for silence OR tapping
 * when done; both produce the same result. No-op when nothing is
 * recording.
 */
export const endCaptureEarly = (): void => {
  if (!currentRecording) return;
  captureEarlyStop = true;
};

export const captureUtterance = async (
  timeoutMs: number,
  apiUrl: string,
  language: 'en' | 'es' | 'zh' = 'en',
): Promise<string | null> => {
  // 2026-06-15 (Tim) — atomic re-entry guard (see captureInProgress decl). A
  // second concurrent capture would crash the audio session ("Only one Recording
  // object"); bail quietly so the in-flight capture owns the mic.
  if (captureInProgress) {
    console.log('[voice] captureUtterance ignored — a capture is already in progress');
    return null;
  }
  captureInProgress = true;
  let recording: Audio.Recording | null = null;
  captureCancelled = false;
  captureEarlyStop = false;
  try {
    noteAudioActivity('capture');
    // 2026-06-16 (Tim — "did the speech leak into its mouth") — silence ANY in-flight
    // caddie speech (cloud sound + device-TTS fallback) BEFORE opening the mic, so the
    // recording never captures the caddie talking over the user (echo / self-record),
    // and the audio session flips cleanly from speaker → record with nothing playing.
    // Centralized HERE so every captureUtterance caller is covered (the follow-up loop
    // already did this; the ~8 other callers did not). Also gives clean barge-in: a tap
    // mid-response stops the caddie and listens. Unconditional + idempotent — isSpeaking()
    // only tracks the cloud sound, NOT the device-TTS fallback, so always call
    // stopSpeaking() (it covers both subsystems and is a near-noop when nothing plays).
    try { await stopSpeaking(); } catch { /* best-effort */ }
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return null;
    await configureAudioForRecording();

    // 2026-05-25 — Fix A: track silence + speech-onset via metering.
    // hasSpoken flips true once a metering reading exceeds the (adaptive)
    // speech threshold. lastLoudAt tracks the most recent above-threshold
    // sample. The wait loop below breaks early when (hasSpoken AND
    // silence sustained ≥ SILENCE_TIMEOUT_MS).
    // 2026-06-16 — thresholds are now lifted relative to a live ambient floor
    // (noiseFloorDb) so background noise can't masquerade as "still talking".
    let hasSpoken = false;
    let lastLoudAt = Date.now();
    let noiseFloorDb = NOISE_FLOOR_INIT_DB;

    const r = await Audio.Recording.createAsync(
      RECORDING_OPTIONS,
      (status) => {
        if (!status.isRecording) return;
        const metering = (status as { metering?: number }).metering;
        if (typeof metering !== 'number') return;
        // Adaptive ambient floor: fall fast toward a quieter level, rise slowly
        // (the user's speech raises readings only briefly, so the slow rise keeps
        // the floor tracking the TRUE ambient between/around words). Clamp the
        // input so a -160 dropout can't crash the floor.
        const m = Math.max(metering, NOISE_FLOOR_MIN_DB);
        const alpha = m < noiseFloorDb ? NOISE_FLOOR_FALL_ALPHA : NOISE_FLOOR_RISE_ALPHA;
        noiseFloorDb += (m - noiseFloorDb) * alpha;
        // Effective thresholds = ambient + margin, but never more sensitive than
        // the original fixed floors (so a quiet room is byte-for-byte prior behavior).
        const effSpeechDb = Math.max(SPEECH_DETECT_DB, noiseFloorDb + SPEECH_MARGIN_DB);
        const effSilenceDb = Math.max(SILENCE_DB_THRESHOLD, noiseFloorDb + SILENCE_MARGIN_DB);
        if (metering > effSpeechDb) hasSpoken = true;
        if (metering > effSilenceDb) lastLoudAt = Date.now();
      },
      100, // 100ms update interval — cheap and responsive
    );
    recording = r.recording;
    currentRecording = recording;

    // 2026-06-05 — Mic warm-up gap. Audio.Recording.createAsync fuses
    // prepare+start; on some Android OEMs (Samsung especially) the
    // first 50-150ms of audio is partial or zero-amplitude while the
    // mic stream stabilizes. 100ms sleep before the VAD loop reads
    // metering avoids treating that warm-up silence as "user is quiet"
    // and also keeps the file from being trivially-tiny on a fast
    // tap-stop sequence.
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    lastLoudAt = Date.now();

    // Wait up to timeoutMs OR until stopCapture flips the flag OR
    // silence-VAD trips early (Fix A) OR user taps to end early
    // (2026-06-06 — endCaptureEarly path).
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !captureCancelled && !captureEarlyStop) {
      await new Promise(resolve => setTimeout(resolve, 100));
      // Silence-VAD early stop: only after user has actually spoken
      // (avoid auto-stop on dead silence before they start) AND
      // sustained quiet for ≥ SILENCE_TIMEOUT_MS.
      if (hasSpoken && Date.now() - lastLoudAt >= SILENCE_TIMEOUT_MS) {
        break;
      }
    }

    if (captureCancelled) {
      currentRecording = null;
      try { await recording.stopAndUnloadAsync(); } catch { /* already stopped */ }
      return null;
    }

    currentRecording = null;
    // 2026-06-05 — Capture duration BEFORE stopAndUnloadAsync so the
    // status read still works; after unload, getStatusAsync returns
    // an unloaded status with no durationMillis. We use it below to
    // skip transcribe for stray double-taps that produced <300ms of
    // audio.
    let durationMs: number | null = null;
    try {
      const preStopStatus = await recording.getStatusAsync();
      const d = (preStopStatus as { durationMillis?: number }).durationMillis;
      if (typeof d === 'number') durationMs = d;
    } catch { /* non-fatal; fall through to file-size check */ }
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (!uri) return null;

    // 2026-06-05 — Validate the recorded audio before paying for a
    // Whisper round-trip. A stray double-tap or a mic that never opened
    // produces a tiny / empty .m4a; POSTing it returns 502 from
    // /api/transcribe and surfaces a "Network hiccup" toast that the
    // user reads as a bug. Both gates are silent skips (return null,
    // treated as "user said nothing" upstream).
    if (durationMs != null && durationMs < 300) {
      console.log('[voice] capture too short (', durationMs, 'ms), skipping transcribe');
      return null;
    }
    try {
      const FS = await import('expo-file-system/legacy');
      const info = await FS.getInfoAsync(uri);
      const size = (info as { size?: number }).size ?? 0;
      if (!info.exists || size < 1024) {
        console.log('[voice] capture file too small (<1KB), skipping transcribe');
        return null;
      }
      // 2026-06-06 — Vercel platform request-body limit is 4.5 MB.
      // Tim's Echo Hills round hit FUNCTION_PAYLOAD_TOO_LARGE on
      // /api/transcribe. Cap at 3.5 MB client-side to leave headroom
      // for multipart overhead and avoid the opaque 413 response from
      // Vercel's edge. At 16kHz mono 32kbps AAC (RECORDING_OPTIONS),
      // 45s is ~180KB so this is generous — only fires if some OEM
      // ignored the bitrate setting or auto-stop didn't engage.
      if (size > 3.5 * 1024 * 1024) {
        console.log('[voice] capture file too large (', size, 'bytes), skipping transcribe to avoid Vercel 413');
        logTranscribeError(null, `audio_too_large_${size}_bytes`, { size, source: 'captureUtterance_max_size' });
        return null;
      }
    } catch (e) {
      // Non-fatal — if the file-info probe itself throws, fall through
      // to the transcribe attempt. Whisper's own error path will
      // surface the failure if the file is genuinely broken.
      console.log('[voice] file size probe failed (continuing):', e);
    }

    const formData = new FormData();
    formData.append('audio', { uri, type: 'audio/m4a', name: 'audio.m4a' } as unknown as Blob);
    formData.append('language', language);

    const controller = new AbortController();
    // 2026-06-11 — bumped 12s → 20s. Telemetry (transcribe_http "Aborted",
    // Jun 10–11) showed the client abort firing before a cold/slow Whisper
    // Lambda responded — the request was killed client-side, not server-side.
    // Whisper + Gemini fallback can take 8–15s on a cold function or weak
    // cellular; 20s clears that without leaving a truly-dead request hanging.
    const cancelTimer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(apiUrl + '/api/transcribe', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).finally(() => clearTimeout(cancelTimer));

    if (!res.ok) {
      // Surface the upstream failure through the same /owner-logs Voice
      // tab as the main processAudioUri path. Without this, captureUtterance
      // (used by follow-up listen loops + ambiguity clarifications) would
      // silently return null and the user would see no breadcrumb.
      const body = await res.text().catch(() => null);
      logTranscribeError(res.status, body, { source: 'captureUtterance' });
      return null;
    }
    const data = await res.json() as { text?: string };
    const text = (data.text ?? '').trim();
    // 2026-06-13 — ingest the user's turn into the conversation log (learning
    // input + recall). Best-effort, never blocks the transcript return.
    if (text) { try { useConversationLog.getState().logUser(text, Date.now()); } catch { /* non-fatal */ } }
    return text || null;
  } catch (err) {
    console.log('[voice] captureUtterance error:', err);
    logVoiceError('capture_utterance', err);
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch { /* ignore */ }
    }
    currentRecording = null;
    return null;
  } finally {
    // Always release the re-entry guard, on every exit path.
    captureInProgress = false;
  }
};

// Phase BM — memoize last-applied audio mode so back-to-back speak calls
// don't pay the 50-150ms setAudioModeAsync cost on every utterance.
// configureAudioForRecording flips this to 'record' so the next speech
// path correctly re-applies.
let currentAudioMode: 'speech' | 'record' | null = null;

export const configureAudioForSpeech =
  async (): Promise<void> => {
    // 2026-05-26 — Fix DO: REMOVED the `if (currentAudioMode === 'speech')
    // return` short-circuit. This was the opener silence root cause:
    // audioLifecycle.goCold (idle 90s / backgrounded / trust=Quiet) calls
    // Audio.setAudioModeAsync({ playsInSilentModeIOS: false,
    // staysActiveInBackground: false, ... }) to put the OS audio session
    // into a permissive default. But voiceService's currentAudioMode flag
    // is a SEPARATE module-level state that stayed at 'speech' from a
    // previous configure. Next speak() short-circuited the reconfig,
    // OS session was still in goCold's default state, Sound.createAsync
    // played silently. UI showed 'Kevin is speaking' (speaking-state
    // flag was set) but no audio. Tim's exact symptom.
    //
    // Cost of always configuring: ~10ms per speak (setAudioModeAsync is
    // fast). Worth eliminating the race entirely.
    try {
      await setAudioModeSerial({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });
      currentAudioMode = 'speech';
    } catch (err) {
      console.log('[voice] configure speech error — leaving mode flag stale for retry:', err);
    }
  };

// 2026-06-16 (Tim — "fix the first-turn slowness") — warm the MIC / audio-capture
// pipeline once, OFF the user's path. The first Audio.Recording after app launch pays
// a cold OS audio-HAL + mic kernel-stream init (the "first ask is a beat slower" cost);
// a tiny throwaway record start+stop pre-pays it so the user's first real tap is warm.
// This is the capture-side analogue of the network prewarmVoice heartbeat — a true
// warm-up, NOT a sleep band-aid. Safe by construction: runs at most once per process,
// only when mic permission is ALREADY granted (never prompts), never while the caddie
// is speaking or a real capture is live, fully best-effort (never throws/blocks), and
// restores speaker mode after so the next TTS/opener is unaffected.
let micPipelinePrimed = false;
export async function primeMicPipeline(): Promise<void> {
  if (micPipelinePrimed) return;
  try {
    const perm = await Audio.getPermissionsAsync();
    if (!perm.granted) return;                 // can't prime without permission — retry later
    if (isSpeaking() || isCapturing()) return; // don't fight TTS / a live capture — retry later
    micPipelinePrimed = true;                  // commit only once we're actually priming
    await configureAudioForRecording();
    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    try { await recording.stopAndUnloadAsync(); } catch { /* no-op */ }
    console.log('[voice] mic pipeline primed (first-tap warm)');
  } catch (e) {
    console.log('[voice] mic prime skipped (non-fatal):', e);
  } finally {
    // Leave the session back in speaker mode so the next opener/TTS isn't stuck in record.
    try { await configureAudioForSpeech(); } catch { /* no-op */ }
  }
}

// ─── SINGLETON SPEECH STATE ───────────────
// Module-level state shared across all components and hook instances.
// A new speechId is issued on every speak() or stopSpeaking() call;
// any in-flight operation whose id is stale self-terminates.
//
// Phase BM — speak serial queue. The speechId check alone has a race window
// between `Audio.Sound.createAsync` returning and the post-check unload —
// during that microtask the new sound has already started playback, which
// surfaces as two voices for ~50ms at round-start when briefing + handoff
// fire in true parallel. The queue funnels every public speak entry point
// through a single in-flight slot so createAsync calls are strictly ordered.

let speakQueue: Promise<void> = Promise.resolve();
// Phase BM — every stopSpeaking call bumps this generation; queued
// (not-yet-running) bodies snapshot it at enqueue time and skip if it has
// moved by the time they get to run. Prevents a chained briefing → handoff
// pair from continuing after the user taps to interrupt mid-briefing.
let speakGeneration = 0;

// 2026-06-16 (Tim — "old voices leaking from prior steps" on navigation) — stamp
// when the most-recent utterance actually STARTED (queue body runs, not enqueue).
// app/_layout.tsx reads this on route change: it stops stale carry-over speech but
// leaves a JUST-started line alone (intentional speak-then-navigate: tool opens,
// SmartFinder fire a short line right before router.push).
let lastSpeakStartedAt = 0;
export const getLastSpeakStartedAt = (): number => lastSpeakStartedAt;

const enqueueSpeak = (body: () => Promise<void>): Promise<void> => {
  const enqueuedAt = speakGeneration;
  speakQueue = speakQueue
    .catch(() => { /* drop prior failure */ })
    .then(() => {
      if (enqueuedAt !== speakGeneration) return; // stopSpeaking fired after enqueue
      lastSpeakStartedAt = Date.now();
      return body();
    })
    .then(() => undefined);
  return speakQueue;
};

const SPEAK_TIMEOUT_MS = 30_000;

// Phase V.7 — derive playback timeout from utterance length so longer
// briefings (~90 words / ~36s of audio) aren't sliced by the 30s cap while
// short caddie one-liners still fail fast on stuck playback. ~13 chars/sec
// is a conservative TTS rate; add 8s headroom, clamp [30s, 120s].
const playbackTimeoutForText = (text: string): number => {
  const estimatedMs = (text.length / 13) * 1000 + 8_000;
  return Math.min(120_000, Math.max(30_000, Math.ceil(estimatedMs)));
};

// Phase V.7 — derive playback timeout from a known clip duration. Used by
// playLocalFile (filler clips with duration_ms) and speakFromBase64 (after
// decoding, status.durationMillis is known). Falls back to 30s if duration
// is unknown.
const playbackTimeoutForDuration = (durationMs: number | null | undefined): number => {
  if (!durationMs || durationMs <= 0) return SPEAK_TIMEOUT_MS;
  return Math.min(120_000, Math.max(5_000, Math.ceil(durationMs + 2_000)));
};

// Phase V.7 — single source of truth for TTS gating. Returns false when
// voice is disabled, audio is routed to the phone speaker without the
// user opting in, or the user is at L1 Quiet AND this is scripted/proactive
// speech. L1 still allows USER-INITIATED responses (mic-tap → answer)
// because the user explicitly invited Kevin to talk. Without that carve-
// out the L1 badge would be a dead button.
//
// Pass { userInitiated: true } from any speak() call that's a direct reply
// to a user mic-tap or hero-moment confirmation. Default false treats the
// utterance as scripted (briefing, opener, filler, proactive, summary).
type SpeakOpts = { userInitiated?: boolean };

// PGA HOPE follow-up (A5) — read the active persona's intensity dial and
// convert to playback volume. Floor at 0.3 so the slider never silences
// the caddie entirely (use voiceEnabled=false for that). 100 → 1.0,
// 50 → ~0.55, 0 → 0.3.
const currentPlaybackVolume = (): number => {
  try {
    const settingsMod = require('../store/settingsStore');
    const s = settingsMod.useSettingsStore.getState();
    const persona = s.caddiePersonality as 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';
    const dial = s.personaIntensity?.[persona];
    let base = 1.0;
    if (typeof dial === 'number') {
      const clamped = Math.max(0, Math.min(100, dial));
      // 2026-05-28 — Fix FD: floor bumped 0.3 → 0.5. Even with the
      // setter+migration floor at 30 on the dial itself, a 30 dial
      // mapped to 30% playback can read as inaudible on a phone
      // speaker in a loud room. 0.5 is the "always actually hearable"
      // floor. Users mute entirely via voiceEnabled, not the dial.
      base = Math.max(0.5, clamped / 100);
    }
    // Phase BI — when the user's custom caddie is active, "tone down" by
    // multiplying volume by 0.85. Combined with the rate bump below this
    // gives the personal caddie a noticeably different presence.
    const profileMod = require('../store/playerProfileStore');
    const p = profileMod.usePlayerProfileStore.getState();
    // 2026-06-11 (audit 4c) — portrait moved to customCaddieMediaStore; read it
    // there, fall back to the legacy profile field.
    const mediaMod = require('../store/customCaddieMediaStore');
    const portrait = mediaMod.useCustomCaddieMediaStore.getState().customCaddiePortraitB64 ?? p.customCaddiePortraitB64;
    if (p.useCustomCaddie && portrait) base *= 0.85;
    return base;
  } catch {
    return 1.0;
  }
};

// Phase BI — slight rate bump for the custom caddie. expo-av's setRateAsync
// with shouldCorrectPitch=true keeps Kevin's voice timbre while playing
// faster, satisfying "sped up" without raising into chipmunk territory.
const currentPlaybackRate = (): number => {
  try {
    const profileMod = require('../store/playerProfileStore');
    const p = profileMod.usePlayerProfileStore.getState();
    const mediaMod = require('../store/customCaddieMediaStore');
    const portrait = mediaMod.useCustomCaddieMediaStore.getState().customCaddiePortraitB64 ?? p.customCaddiePortraitB64;
    if (p.useCustomCaddie && portrait) return 1.08;
  } catch {}
  return 1.0;
};

// Apply rate to a freshly-created Sound. Failure is non-fatal — the audio
// just plays at 1.0× instead of 1.08×, which is still correct behavior.
const applyCustomRate = async (sound: Audio.Sound): Promise<void> => {
  const rate = currentPlaybackRate();
  if (rate === 1.0) return;
  try {
    await sound.setRateAsync(rate, true);
  } catch (e) {
    console.log('[voice] setRateAsync failed', e);
  }
};

const isVoiceAllowed = (opts?: SpeakOpts): boolean => {
  // 2026-05-26 — Fix CZ: log EVERY denial reason. Tim spent hours
  // chasing silent voice failures because this gate returned false
  // with no breadcrumb. Now any speak() that gets gated leaves a
  // grep-able log entry: '[voice] gate denied: <reason>'.
  try {
    const settingsMod = require('../store/settingsStore');
    const routingMod = require('./audioRoutingService');
    const trustMod = require('../store/trustLevelStore');
    const settings = settingsMod.useSettingsStore.getState();
    if (!settings.voiceEnabled) {
      console.log('[voice] gate denied: voiceEnabled=false', { userInitiated: !!opts?.userInitiated });
      return false;
    }
    const trustLevel = trustMod.useTrustLevelStore.getState().level;
    if (trustLevel === 1 && !opts?.userInitiated) {
      console.log('[voice] gate denied: trustLevel=1 (Quiet) and !userInitiated');
      return false;
    }
    // 2026-05-30 — Fix FY: Local Mode gate. Mirrors the trustLevel=1
    // behavior but ON BY USER CHOICE rather than as a side-effect of
    // the trust slider. Suppresses proactive utterances (opener,
    // fillers, presence, follow-up loop replies) while letting
    // userInitiated:true through (mic-tap responses, hero confirms).
    // Independent of trustLevel so a user can be in Companion mode +
    // Local Mode (active responses, no proactive chatter) — that's
    // the combination Tim wants as the testable baseline.
    if (settings.localMode === true && !opts?.userInitiated) {
      console.log('[voice] gate denied: localMode=true and !userInitiated');
      return false;
    }
    const route = routingMod.getCurrentRoute();
    if (route === 'phone_speaker' && !settings.voiceOnPhoneSpeaker) {
      console.log('[voice] gate denied: phone_speaker route + voiceOnPhoneSpeaker=false');
      return false;
    }
    return true;
  } catch (e) {
    // 2026-05-26 — Fix CZ: BLOCK on guard failure (was: allow).
    // Returning true on a broken guard meant voice fired
    // unconditionally if the store import cycle ever broke. Blocking
    // is the safer default — and we now log the actual error so a
    // store-bootstrap regression is immediately visible.
    console.log('[voice] gate ERROR — blocking speech:', e instanceof Error ? e.message : String(e));
    return false;
  }
};

let currentSound: Audio.Sound | null = null;
let currentSpeechId = 0;
let currentAbortController: AbortController | null = null;

const speechSubscribers = new Set<(speaking: boolean) => void>();

const notifySpeaking = (speaking: boolean) =>
  speechSubscribers.forEach(cb => cb(speaking));

export const subscribeToSpeaking = (
  cb: (speaking: boolean) => void,
): (() => void) => {
  speechSubscribers.add(cb);
  return () => speechSubscribers.delete(cb);
};

// PGA HOPE follow-up (A2) — current spoken-text caption. Set whenever
// speak() / speakFromBase64() begins playback; cleared on stopSpeaking()
// and on natural completion. Subscribers (CaptionStrip) render the line
// while audio is playing for hearing-impaired users.
let currentCaption: string | null = null;
const captionSubscribers = new Set<(text: string | null) => void>();

// 2026-05-22 — Last-spoken-line cache for the hands-free orchestrator's
// double-tap-to-replay action. Captures every line we START to speak,
// regardless of whether it completes or is interrupted. Survives across
// playback cycles so a user can double-tap five seconds after a line
// finishes to hear it again.
let lastSpokenLine: string | null = null;

const notifyCaption = (text: string | null) => {
  currentCaption = text;
  // Cache non-null lines as the most-recent spoken text.
  if (text && text.trim().length > 0) lastSpokenLine = text;
  captionSubscribers.forEach(cb => cb(text));
};

// 2026-06-11 (audit) — show a caption for a fixed window then auto-clear, for
// surfaces that play a BUNDLED clip (not speak()) and so don't drive the caption
// themselves — e.g. the persona handoff, which plays the bundled opener so the
// switch is never silent. Only clears if the caption is still the one we set
// (a real speak() that starts meanwhile owns the caption and won't be cleared).
let flashCaptionTimer: ReturnType<typeof setTimeout> | null = null;
export const flashCaption = (text: string, ms = 3000): void => {
  if (flashCaptionTimer) { clearTimeout(flashCaptionTimer); flashCaptionTimer = null; }
  notifyCaption(text);
  flashCaptionTimer = setTimeout(() => {
    flashCaptionTimer = null;
    if (currentCaption === text) notifyCaption(null);
  }, ms);
};

export const getCurrentCaption = (): string | null => currentCaption;

/** 2026-05-22 — Hands-free double-tap replay surface. Returns the most
 *  recent text we tried to speak (whether it completed or was cut off).
 *  null when nothing has been spoken this session. */
export const getLastSpokenLine = (): string | null => lastSpokenLine;

export const subscribeToCaption = (
  cb: (text: string | null) => void,
): (() => void) => {
  captionSubscribers.add(cb);
  return () => captionSubscribers.delete(cb);
};

// ─── STOP ─────────────────────────────────

export const stopSpeaking = async (): Promise<void> => {
  currentSpeechId++;
  speakGeneration++;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {}
    currentSound = null;
  }
  // 2026-06-13 — cancel the device-TTS fallback too (re-added safely: a plain
  // Speech.stop() with no timer, unlike the crash-y reverted version).
  if (usingDeviceFallback) {
    try { Speech.stop(); } catch {}
    usingDeviceFallback = false;
  }
  notifySpeaking(false);
  notifyCaption(null);
};

export const isSpeaking = (): boolean => currentSound !== null;

// 2026-06-13 — OFFLINE / network-fail spoken fallback (Tim's Lakes round went
// MUTE on weak signal — ~18 speak_catch "Network request failed"). When /api/voice
// can't be reached, speak the line on the DEVICE so the caddie isn't a dead void.
// expo-speech is ALREADY in the binary (~14.0.8) so this ships OTA — the earlier
// revert was a dynamic-require + a 6s catch-path timer crashing, BOTH avoided here
// (static import at top, no timers, clean handlers). The device voice is robotic,
// but spoken-and-useful beats silent. Best-effort: never throws.
const SPEECH_LANG: Record<'en' | 'es' | 'zh', string> = { en: 'en-US', es: 'es-ES', zh: 'zh-CN' };
let usingDeviceFallback = false;

// 2026-06-14 (Tim — "robotic FEMALE voice that wasn't Kevin") — the device-TTS
// fallback used the OS DEFAULT voice, which on many phones is female. So when the
// server voice failed, a male caddie (Kevin/Harry/Tank) suddenly spoke in a
// wrong-gender robotic voice. expo-speech has no gender API, but it DOES accept a
// specific `voice` identifier + a `pitch`. We (a) try to pick a voice whose
// name/identifier matches the requested gender for the language, and (b) deepen
// the pitch when a male voice is wanted but none was matchable — so even the
// default voice lands closer to the persona instead of jarringly female.
const MALE_VOICE_TOKENS = ['male', 'daniel', 'arthur', 'aaron', 'fred', 'rishi', 'gordon', 'oliver', 'alex', 'tom', 'reed', 'rocko', 'eddy', 'diego', 'jorge', 'juan', 'carlos'];
const FEMALE_VOICE_TOKENS = ['female', 'samantha', 'karen', 'moira', 'tessa', 'victoria', 'susan', 'allison', 'ava', 'zoe', 'nicky', 'fiona', 'monica', 'paulina', 'marisol', 'tingting', 'sinji'];
let cachedDeviceVoices: { identifier?: string; name?: string; language?: string }[] | null = null;
let deviceVoicesLoading: Promise<void> | null = null;
function ensureDeviceVoicesLoaded(): void {
  if (cachedDeviceVoices !== null || deviceVoicesLoading) return;
  deviceVoicesLoading = (async () => {
    try {
      const v = await Speech.getAvailableVoicesAsync();
      cachedDeviceVoices = Array.isArray(v) ? v : [];
    } catch { cachedDeviceVoices = []; }
  })();
}
/** Best-effort: a voice identifier whose name matches `gender` for `language`, or undefined. */
function pickDeviceVoice(gender: 'male' | 'female', language: 'en' | 'es' | 'zh'): string | undefined {
  if (!cachedDeviceVoices || cachedDeviceVoices.length === 0) return undefined;
  const langPrefix = language; // expo Voice.language is e.g. 'en-US' / 'es-ES' / 'zh-CN'
  const wanted = gender === 'male' ? MALE_VOICE_TOKENS : FEMALE_VOICE_TOKENS;
  const avoid = gender === 'male' ? FEMALE_VOICE_TOKENS : MALE_VOICE_TOKENS;
  const inLang = cachedDeviceVoices.filter(v => (v.language ?? '').toLowerCase().startsWith(langPrefix));
  const pool = inLang.length ? inLang : cachedDeviceVoices;
  // Prefer a voice whose name/identifier clearly matches the wanted gender and
  // doesn't contain an opposite-gender token.
  const match = pool.find(v => {
    const hay = `${v.name ?? ''} ${v.identifier ?? ''}`.toLowerCase();
    return wanted.some(t => hay.includes(t)) && !avoid.some(t => hay.includes(t));
  });
  return match?.identifier;
}

async function deviceSpeakFallback(text: string, language: 'en' | 'es' | 'zh', myId: number, gender: 'male' | 'female' = 'male'): Promise<void> {
  if (!text || myId !== currentSpeechId) return;
  ensureDeviceVoicesLoaded();
  // 2026-06-15 (audit) — ensure SPEAKER playback mode before device-TTS. If we fell
  // back right after a captureUtterance, the audio session can still be in RECORD
  // mode and the device voice would play into the mic (the caddie goes silent).
  try { await configureAudioForSpeech(); } catch { /* best-effort; speak anyway */ }
  if (myId !== currentSpeechId) return; // preempted during the audio-mode switch
  // 2026-06-16 (Tim — "two voices racing") — stop any in-flight cloud/mp3 sound
  // (a separate subsystem from expo-speech) before the device voice starts, so the
  // robotic fallback can't overlap a cloud line / the opener. Mirrors the Speech.stop
  // the cloud/mp3 paths now do, giving full mutual exclusion.
  if (currentSound) {
    try { await currentSound.stopAsync(); await currentSound.unloadAsync(); } catch {}
    currentSound = null;
  }
  if (myId !== currentSpeechId) return; // re-check after the async stop, right before speaking
  try {
    Speech.stop(); // cancel any prior device utterance before starting a new one
    usingDeviceFallback = true;
    notifySpeaking(true);
    notifyCaption(text);
    const voiceId = pickDeviceVoice(gender, language);
    // Deepen a wanted-male voice when we couldn't match an actual male voice, so a
    // default female OS voice doesn't read a male caddie's line. Neutral otherwise.
    const pitch = voiceId ? 1.0 : (gender === 'male' ? 0.85 : 1.0);
    console.log('[voice] device-TTS fallback speaking (server unreachable) —', gender, voiceId ? `voice=${voiceId}` : `pitch=${pitch}`, '—', text.slice(0, 60));
    Speech.speak(text, {
      language: SPEECH_LANG[language] ?? 'en-US',
      ...(voiceId ? { voice: voiceId } : {}),
      pitch,
      onDone: () => { usingDeviceFallback = false; if (myId === currentSpeechId) { notifySpeaking(false); notifyCaption(null); } },
      onStopped: () => { usingDeviceFallback = false; },
      onError: () => { usingDeviceFallback = false; if (myId === currentSpeechId) { notifySpeaking(false); notifyCaption(null); } },
    });
  } catch (e) {
    usingDeviceFallback = false;
    if (myId === currentSpeechId) { notifySpeaking(false); notifyCaption(null); }
    console.log('[voice] device-TTS fallback failed:', e);
  }
}

// 2026-06-19 (Tim — dead-zone testing: "local mode does nothing, doesn't respond or
// anything") — speak a failure NOTICE straight through the DEVICE voice (expo-speech),
// bypassing the cloud /api/voice attempt entirely. Used when we ALREADY KNOW the network
// is down (transcribe aborted / fetch failed) so the caddie audibly says "no signal"
// instead of silently rendering a text bubble the user can't see while driving. Honors
// [[caddie-failsafe-no-walls]]: always SAY something, even with zero signal. No cloud
// round-trip, so no doomed-fetch wait.
export async function speakDeviceNotice(
  text: string,
  language: 'en' | 'es' | 'zh' = 'en',
  gender: 'male' | 'female' = 'male',
): Promise<void> {
  if (!text) return;
  currentSpeechId++;
  await deviceSpeakFallback(text, language, currentSpeechId, gender);
}

// ─── PLAY LOCAL FILE (filler clips) ──────
// Same singleton semantics as speak/speakFromBase64 — naturally cancelled
// when the real response calls either of those functions.

export const playLocalFile = async (
  source: string | number,
  knownDurationMs?: number,
  opts?: SpeakOpts,
): Promise<void> => enqueueSpeak(async () => {
  // Phase V.7 — same Quiet/route guard as speak() so filler clips don't
  // play when voice is disabled or routed to the phone speaker.
  if (!isVoiceAllowed(opts)) return;

  currentSpeechId++;
  const myId = currentSpeechId;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {}
    currentSound = null;
  }
  // 2026-06-16 (Tim — "two voices racing") — the OPENER plays through here
  // (playLocalFile of a bundled mp3). It was racing a device-TTS greeting fallback
  // (the robotic voice) because they're separate subsystems. Cancel device-TTS too.
  try { Speech.stop(); } catch {}

  notifySpeaking(true);
  await configureAudioForSpeech();

  try {
    // 2026-06-06 — accept both URI strings (filler clips written to
    // cache by getCaddieClip) AND require()'d asset module numbers
    // (pre-rendered ack clips bundled at build time via Phase 4.4's
    // quickAckClips manifest). Audio.Sound.createAsync's first arg
    // is AVPlaybackSource = { uri: string } | number | Asset.
    const playbackSource = typeof source === 'number' ? source : { uri: source };
    const { sound, status } = await Audio.Sound.createAsync(
      playbackSource,
      { shouldPlay: true, volume: currentPlaybackVolume() },
    );

    if (myId !== currentSpeechId) {
      await sound.unloadAsync().catch(() => {});
      return;
    }

    currentSound = sound;
    await applyCustomRate(sound);

    // Phase V.7 — prefer the actual decoded duration; fall back to caller-
    // provided knownDurationMs (e.g. measured at clip-generation time).
    const measuredMs = status.isLoaded ? status.durationMillis ?? null : null;
    const timeoutMs = playbackTimeoutForDuration(measuredMs ?? knownDurationMs ?? null);

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((s) => {
          // Sound externally unloaded (typically by stopSpeaking() to
          // make room for the real response). Resolve immediately so the
          // serialized speak-queue can advance to the next body instead
          // of waiting for the full clip-duration timeout below — that
          // wait was producing up-to-5s of perceived dead air between
          // filler and the real reply.
          if (!s.isLoaded) {
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
            }
            resolve();
            return;
          }
          if (s.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
            }
            resolve();
          }
        });
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (myId === currentSpeechId) {
            currentSound = null;
            notifySpeaking(false);
          }
          resolve();
        }, timeoutMs)
      ),
    ]);

  } catch (err) {
    if (myId === currentSpeechId) {
      currentSound = null;
      notifySpeaking(false);
    }
    console.log('[voice] playLocalFile error:', err);
  }
});

// ─── SPEAK FROM BASE64 ────────────────────

export const speakFromBase64 = async (base64: string, opts?: SpeakOpts): Promise<void> => enqueueSpeak(async () => {
  // Phase V.7 — guard for parity with speak() / playLocalFile.
  if (!isVoiceAllowed(opts)) return;

  currentSpeechId++;
  const myId = currentSpeechId;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {}
    currentSound = null;
  }
  // 2026-06-16 (Tim — "two voices racing") — cancel any in-flight device-TTS too
  // (separate subsystem from currentSound). One voice at a time across both.
  try { Speech.stop(); } catch {}

  notifySpeaking(true);
  await configureAudioForSpeech();

  // 2026-06-14 (audit — perf) — write the base64 audio straight to disk with
  // NATIVE base64 decoding (expo-file-system) instead of the old atob()+charCodeAt
  // byte-loop, which ran on the JS thread right before playback (jank scaling with
  // response length). Same proven path as poseDetection's frame persist.
  const FS = await import('expo-file-system/legacy');
  const uri = `${FS.cacheDirectory}kevin_voice_${Date.now()}.mp3`;
  try {
    await FS.writeAsStringAsync(uri, base64, { encoding: FS.EncodingType.Base64 });
    // Yield a macrotask so the OS filesystem view settles before createAsync reads
    // the URI — prevents the rare stale-read "[voice] timeout" on some Android devices.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (myId !== currentSpeechId) return;

    const { sound, status } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: currentPlaybackVolume() },
    );

    if (myId !== currentSpeechId) {
      await sound.unloadAsync().catch(() => {});
      return;
    }

    currentSound = sound;
    await applyCustomRate(sound);

    // Phase V.7 — derive timeout from actual decoded duration so longer
    // brain responses (60-90 words) aren't sliced by a hard 30s cap.
    const measuredMs = status.isLoaded ? status.durationMillis ?? null : null;
    const timeoutMs = playbackTimeoutForDuration(measuredMs);

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((s) => {
          if (!s.isLoaded) {
            // Externally unloaded (stopSpeaking) — release the queue.
            void FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
            }
            resolve();
            return;
          }
          if (s.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            void FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
            }
            resolve();
          }
        });
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log('[voice] speakFromBase64 timeout');
          if (myId === currentSpeechId) {
            currentSound = null;
            notifySpeaking(false);
          }
          resolve();
        }, timeoutMs)
      ),
    ]);

  } catch (err) {
    if (myId === currentSpeechId) {
      currentSound = null;
      currentAbortController = null;
      notifySpeaking(false);
    }
    console.log('[voice] speakFromBase64 error:', err);
  }
});

// ─── TTS HETERONYM PREPROCESS ─────────────
// 2026-05-25 — ElevenLabs reads "record" as the NOUN (RE-cord, like a
// vinyl record) instead of the verb (re-CORD), which is wrong in
// nearly every caddie context ("record a swing", "record your shot").
// Substitute the verb form to "capture" before TTS — same meaning,
// unambiguous pronunciation. Only triggers on English (other locales
// have their own verb form). Word-boundary regex avoids hitting
// "records" / "recorded" / "recording" — those are typically
// pronounced correctly because the -ed/-ing/-s endings cue the verb
// form for the TTS model. If we ever hit a heteronym beyond "record",
// add it to HETERONYM_FIXES.
const HETERONYM_FIXES: ReadonlyArray<[RegExp, string]> = [
  // record (verb) → capture. \b word-boundary, case-insensitive,
  // skip the inflected forms.
  [/\brecord\b(?!ed|ing|s)/gi, 'capture'],
  [/\bRecord\b(?!ed|ing|s)/g, 'Capture'],
  // 2026-05-25 — Fix AL: "par 3s" / "par 4s" / "par 5s" → "par
  // threes" / "par fours" / "par fives". ElevenLabs reads "3s" as
  // "three S" (saying the letter S). Substitute the spelled-out
  // plural so the caddie sounds natural.
  [/\bpar\s*3s\b/gi, 'par threes'],
  [/\bpar\s*4s\b/gi, 'par fours'],
  [/\bpar\s*5s\b/gi, 'par fives'],
];

function preprocessTtsText(text: string, language: 'en' | 'es' | 'zh'): string {
  if (language !== 'en') return text;
  let out = text;
  for (const [re, sub] of HETERONYM_FIXES) out = out.replace(re, sub);
  return out;
}

// ─── SPEAK ────────────────────────────────

export const speak = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh' = 'en',
  apiUrl: string,
  opts?: SpeakOpts,
): Promise<void> => enqueueSpeak(async () => {
  // Phase V.7 — shared guard (formerly inlined here).
  if (!isVoiceAllowed(opts)) return;
  // 2026-06-13 — ingest the caddie's line into the conversation log (learning
  // input + the "save those stretches" recall target). speakChunked feeds full
  // sentences through here; lastCaddieText() rejoins a chunked run. Best-effort.
  try { useConversationLog.getState().logCaddie(text, Date.now()); } catch { /* non-fatal */ }

  // Claim ownership: bump speechId and cancel anything in-flight.
  currentSpeechId++;
  const myId = currentSpeechId;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {}
    currentSound = null;
  }
  // 2026-06-16 (Tim — "two voices racing") — also cancel any in-flight DEVICE-TTS
  // (expo-speech). It's a SEPARATE audio subsystem from currentSound (Audio.Sound),
  // so bumping speechId + unloading the sound did NOT stop a robotic fallback that
  // was mid-sentence — a cloud line (or the opener mp3) then played on top of it.
  // Stopping Speech here enforces one-voice-at-a-time across both subsystems.
  try { Speech.stop(); } catch {}

  notifySpeaking(true);
  // PGA HOPE follow-up (A2) — broadcast caption text for the duration
  // of the utterance. Cleared on natural completion or stopSpeaking.
  notifyCaption(text);
  noteAudioActivity('tts');
  // 2026-05-26 — Fix DS: full-trace logging on the speak() critical
  // path. Tim's opener silence has been chased through 5 fixes
  // without a definitive log line proving where it fails. Now every
  // step prints with the text head + speech id so the NEXT silent
  // run shows the exact step that failed silently.
  console.log('[voice] speak body entered — text=', text.slice(0, 50), 'myId=', myId);
  await configureAudioForSpeech();
  console.log('[voice] speak past configureAudioForSpeech — myId=', myId);

  // 2026-05-26 — Fix DY: Personal-caddie user-recorded clip override.
  // BEFORE we hit /api/voice for TTS, check if the user has a clip
  // recorded for this exact phrase (catalog match — see
  // services/customCaddieClips.ts). When useCustomCaddie is ON and a
  // clip exists, play it as the caddie voice for this line and bail
  // out of the TTS path entirely. Anything outside the catalog (most
  // lines, all conversational responses) falls through to /api/voice
  // unchanged — additive, no regression to the default path.
  let customClipUri: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile = require('../store/playerProfileStore').usePlayerProfileStore.getState();
    if (profile?.useCustomCaddie) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const clipLookup = require('./customCaddieClips') as typeof import('./customCaddieClips');
      const maybeUri = clipLookup.lookupClipUri(text, profile.customCaddieClips ?? null);
      // 2026-05-27 — Fix EC: verify the file ACTUALLY exists before
      // committing to the override. Without this probe, a stale URI
      // (file deleted by OS / orphaned by a partial record / sandbox
      // path moved on rebuild) would still take over the speech turn,
      // Sound.createAsync would throw inside playLocalFile, the catch
      // below would return, and the user would hear NOTHING for that
      // line. Tim's report 2026-05-27: "I see his messages but cannot
      // hear him talk." Probing now lets us fall through to TTS
      // cleanly when the recording is gone. Cheap (~1ms) and only
      // runs when useCustomCaddie is ON.
      if (maybeUri && maybeUri.startsWith('file://')) {
        try {
          const FS = await import('expo-file-system/legacy');
          const info = await FS.getInfoAsync(maybeUri);
          if (info.exists) {
            customClipUri = maybeUri;
          } else {
            console.log('[voice] custom-caddie clip URI present but file missing — falling through to TTS:', maybeUri);
          }
        } catch (e) {
          console.log('[voice] custom-caddie clip existence probe failed — falling through to TTS:', e);
        }
      } else if (maybeUri) {
        // Non-file:// URIs we can't probe locally; trust them.
        customClipUri = maybeUri;
      }
    }
  } catch (e) {
    console.log('[voice] custom-caddie lookup failed (non-fatal):', e);
  }
  if (customClipUri) {
    console.log('[voice] custom-caddie clip override — playing local file for:', text.slice(0, 40));
    // Release the speaking/caption state we claimed; playLocalFile
    // bumps its own speech id and sets its own caption/speaking. Drop
    // ours so the transition is clean (no double-notify).
    notifyCaption(null);
    notifySpeaking(false);
    try {
      await playLocalFile(customClipUri, undefined, opts);
    } catch (e) {
      // File existed at probe but playback still threw — unusual but
      // possible (corrupt header / format mismatch). Log + return; the
      // recovery is re-record. We do NOT fall through to TTS here
      // because playLocalFile already bumped currentSpeechId and
      // reclaiming would race the next speak() call.
      console.log('[voice] custom-caddie clip playback failed (turn ends; re-record to fix):', e);
      // 2026-06-05 — Surface to /owner-logs Voice tab so beta testers
      // can see custom-clip playback failures without ADB. Every other
      // silent-fail path in speak() already logs here; this was the
      // last gap.
      logVoiceSilentFail('custom_caddie_clip_playback_failed', {
        speechId: myId,
        error: e instanceof Error ? e.message : String(e),
        textHead: text.slice(0, 60),
      });
    }
    return;
  }

  // Persona is the source-of-truth selector for ElevenLabs voice routing.
  // Read from settings store at request time (dynamic require avoids a
  // module-load cycle since voiceService is imported very early). Declared
  // ABOVE the outer try so the catch's device-TTS fallback speaks the SAME
  // persona-derived gender (not the stale caller param) on a network failure.
  let persona: string | null = null;
  let effectiveGender = gender;
  try {
    persona = require('../store/settingsStore').useSettingsStore.getState().caddiePersonality ?? null;
    if (persona === 'serena') effectiveGender = 'female';
    else if (persona === 'kevin' || persona === 'harry' || persona === 'tank') effectiveGender = 'male';
    else if (persona === 'custom') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const g = require('../store/playerProfileStore').usePlayerProfileStore.getState().customCaddieGender;
      if (g === 'male' || g === 'female') effectiveGender = g;
    }
  } catch { /* ignore */ }

  try {
    const abortController = new AbortController();
    currentAbortController = abortController;
    // 2026-06-11 — bumped 12s → 20s. Telemetry (speak_catch "Network request
    // failed", Jun 10–11) included client-side aborts of the TTS fetch when a
    // cold /api/voice Lambda or weak cellular pushed the round-trip past 12s.
    // A silent handoff/greeting was the visible symptom. 20s matches transcribe.
    const voiceTimeout = setTimeout(() => abortController.abort(), 20_000);

    // (persona + effectiveGender already derived above so the catch's device-TTS
    //  fallback agrees. WRONG-VOICE-FOR-A-TURN fix: live persona, not stale param.)
    // 2026-05-27 — Fix EX: snapshot the playback volume + rate NOW so
    // the TTS request, log, first createAsync, retry createAsync, and
    // applyRate all use the SAME persona's intensity dial. Prior code
    // re-read currentPlaybackVolume() at each callsite — if the user
    // switched persona during the ~3s fetch window, voice ID came back
    // for persona A but volume read persona B's dial. Mismatched output.
    const snapshotVolume = currentPlaybackVolume();
    const snapshotRate = currentPlaybackRate();

    // 2026-05-24 — Derive ElevenLabs model_id from language at the
    // client and pass it through. Server still falls back to a
    // language-based default if model_id is absent, so this is purely
    // additive — older / future callers that omit model_id still work.
    // The fix this unlocks: detected-language Spanish/Chinese now
    // routes to eleven_multilingual_v2 instead of being read
    // monolingual_v1 with an English accent.
    const ttsModel = language === 'en' ? 'eleven_monolingual_v1' : 'eleven_multilingual_v2';

    // Circuit breaker: if /api/voice is degraded, skip the fetch entirely
    // so we don't burn the 12s timeout then go silent. The caption text
    // still rendered upstream; we just don't pay the dead radio cost.
    if (cbIsDegraded('voice')) {
      clearTimeout(voiceTimeout);
      currentAbortController = null;
      logVoiceSilentFail('speak_circuit_degraded', { speechId: myId, textHead: text.slice(0, 60) });
      // Breaker open = we're offline. Don't go mute — speak it on the device.
      await deviceSpeakFallback(text, language, myId, effectiveGender);
      return;
    }

    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: preprocessTtsText(text, language), gender: effectiveGender, language, persona, model_id: ttsModel }),
      signal: abortController.signal,
    }).finally(() => clearTimeout(voiceTimeout));

    // Bail if a newer speak() or stopSpeaking() fired while we were fetching.
    // 2026-05-26 — Fix DD: log the bail. Without this, opener silence
    // (caused by ANY hook firing stopSpeaking during the 3s setTimeout
    // window) leaves no breadcrumb. Now every preempted speak prints
    // exactly which generation got bumped — diagnosable in one log line.
    if (myId !== currentSpeechId) {
      console.log('[voice] speak preempted after fetch — myId=', myId, 'currentSpeechId=', currentSpeechId, 'text=', text.slice(0, 60));
      logVoiceSilentFail('speak_preempted_after_fetch', { speechId: myId, currentSpeechId, textHead: text.slice(0, 60) });
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }
    currentAbortController = null;

    if (!response.ok) {
      // 2026-05-26 — Fix CZ: emit full error body when /api/voice
      // returns non-ok so server-side issues (401 ElevenLabs, 429
      // quota, 500 OpenAI) surface in client logs. Previously only
      // the status code was logged — meaningless without context.
      const errBody = await response.text().catch(() => '<unreadable>');
      console.log('[voice] speak API error:', response.status, response.statusText, '— body:', errBody.slice(0, 300));
      logVoiceSilentFail('speak_api_error', { speechId: myId, status: response.status, error: errBody.slice(0, 300) });
      cbRecordFailure('voice');
      // Server TTS errored (quota / 5xx) — fall back to the device voice.
      await deviceSpeakFallback(text, language, myId, effectiveGender);
      return;
    }
    // Got bytes from the server → online; clear the breaker window.
    cbRecordSuccess('voice');
    cbReportOnline();

    const arrayBuffer = await response.arrayBuffer();
    if (myId !== currentSpeechId) {
      console.log('[voice] speak preempted after arrayBuffer — myId=', myId, 'currentSpeechId=', currentSpeechId);
      logVoiceSilentFail('speak_preempted_after_arraybuffer', { speechId: myId, currentSpeechId });
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }

    // 2026-05-24 — Raised from 100 → 1000 bytes. The 100-byte threshold
    // was permissive enough that an ElevenLabs error-blob masquerading
    // as audio (quota / invalid model_id × voice / unsupported-language
    // combos for ES/ZH) slipped through as "audio" and played silently.
    // Server-side now rejects those before they reach us, but keep a
    // matching client-side guard so any future server regression still
    // surfaces clearly in the log instead of silent failure.
    if (arrayBuffer.byteLength < 1000) {
      console.log('[voice] speak: suspiciously small audio payload — silent', {
        bytes: arrayBuffer.byteLength,
        language,
        text_head: text.slice(0, 40),
      });
      logVoiceSilentFail('speak_small_payload', { speechId: myId, bytes: arrayBuffer.byteLength, language, textHead: text.slice(0, 40) });
      // Bad/empty audio blob — fall back to the device voice instead of going silent.
      await deviceSpeakFallback(text, language, myId, effectiveGender);
      return;
    }

    const uint8 = new Uint8Array(arrayBuffer);
    const audioFile = new File(Paths.cache, `kevin_voice_${Date.now()}.mp3`);
    // Audit follow-up (2026-05-13) — see speakFromBase64 above. Macrotask
    // boundary after sync write so the audio subsystem sees a consistent
    // FS state when createAsync reads the URI.
    audioFile.write(uint8);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (myId !== currentSpeechId) {
      console.log('[voice] speak preempted after file-write — myId=', myId, 'currentSpeechId=', currentSpeechId);
      logVoiceSilentFail('speak_preempted_after_file_write', { speechId: myId, currentSpeechId });
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }

    console.log('[voice] speak about to createAsync — myId=', myId, 'bytes=', arrayBuffer.byteLength);
    // 2026-05-27 — Fix EG: try-load-then-retry. Wrap the first
    // createAsync; if the returned status is loaded but the OS audio
    // session won't actually emit (isLoaded=true with durationMillis=0
    // / undefined, OR a not-loaded result), unload + force-reconfigure
    // the audio mode + retry ONCE. This addresses the recurring "text
    // shows + 'talking' state on + no audio" pattern: the underlying
    // cause is the OS session occasionally accepting a load but refusing
    // to play (post-mic-record state hangover, audio route hiccup,
    // ducking from another app, etc.).
    let sound: Audio.Sound;
    let status: Awaited<ReturnType<typeof Audio.Sound.createAsync>>['status'];
    {
      const first = await Audio.Sound.createAsync(
        { uri: audioFile.uri },
        { shouldPlay: true, volume: snapshotVolume },
      );
      sound = first.sound;
      status = first.status;
      const loaded = (status as { isLoaded?: boolean }).isLoaded === true;
      const dur = (status as { isLoaded?: boolean; durationMillis?: number }).durationMillis ?? 0;
      console.log('[voice] speak Sound.createAsync — myId=', myId,
        'isLoaded=', loaded, 'durationMillis=', dur, 'volume=', snapshotVolume, 'bytes=', arrayBuffer.byteLength);
      const looksDead = !loaded || dur === 0;
      if (looksDead) {
        console.log('[voice] speak first load looked dead — unloading and retrying with forced audio reset', { isLoaded: loaded, dur });
        try { await sound.unloadAsync(); } catch {}
        // Force the OS audio session back into speech mode in case the
        // mode flag was stale (Fix DO already removed the short-circuit
        // but the OS session can still drift from setAudioModeAsync
        // failures on Android). Idempotent + cheap.
        currentAudioMode = null;
        await configureAudioForSpeech();
        if (myId !== currentSpeechId) {
          console.log('[voice] speak retry preempted before second createAsync — myId=', myId, 'currentSpeechId=', currentSpeechId);
          logVoiceSilentFail('speak_retry_preempted', { speechId: myId, currentSpeechId });
          notifyCaption(null);
          notifySpeaking(false);
          return;
        }
        const second = await Audio.Sound.createAsync(
          { uri: audioFile.uri },
          { shouldPlay: true, volume: snapshotVolume },
        );
        sound = second.sound;
        status = second.status;
        const loaded2 = (status as { isLoaded?: boolean }).isLoaded === true;
        const dur2 = (status as { isLoaded?: boolean; durationMillis?: number }).durationMillis ?? 0;
        console.log('[voice] speak retry Sound.createAsync — myId=', myId,
          'isLoaded=', loaded2, 'durationMillis=', dur2);
        if (!loaded2 || dur2 === 0) {
          console.log('[voice] speak retry STILL dead — giving up on this utterance (likely OS audio session denied playback)');
          logVoiceSilentFail('speak_dead_load_giving_up', { speechId: myId, isLoaded: loaded2, durationMillis: dur2, bytes: arrayBuffer.byteLength, textHead: text.slice(0, 60) });
          try { await sound.unloadAsync(); } catch {}
          notifyCaption(null);
          notifySpeaking(false);
          return;
        }
      }
    }

    // Bail if ownership was taken during createAsync.
    if (myId !== currentSpeechId) {
      console.log('[voice] speak preempted after Sound.createAsync — myId=', myId, 'currentSpeechId=', currentSpeechId);
      logVoiceSilentFail('speak_preempted_after_createasync', { speechId: myId, currentSpeechId });
      await sound.unloadAsync().catch(() => {});
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }

    currentSound = sound;
    // 2026-05-27 — Fix EX: inline the rate-apply with the snapshot so
    // a mid-flight persona switch can't desync rate from voice ID.
    if (snapshotRate !== 1.0) {
      try { await sound.setRateAsync(snapshotRate, true); }
      catch (e) { console.log('[voice] setRateAsync failed', e); }
    }

    // 2026-05-27 — Fix EG: position-advances heartbeat. 500ms after
    // createAsync claims it's playing, poll the position once. If
    // positionMillis is still 0 AND status reports isPlaying=true, the
    // OS audio session loaded the file but isn't actually emitting
    // audio — log it loudly so the next silence is provable from one
    // logcat line. Non-fatal (audio may catch up); pure diagnostic.
    setTimeout(() => {
      // Only probe if WE still own this utterance (don't tail a stopped
      // speech generation).
      if (myId !== currentSpeechId) return;
      sound.getStatusAsync().then((s) => {
        if (!s.isLoaded) return;
        const pos = s.positionMillis ?? 0;
        if (pos === 0 && s.isPlaying) {
          console.log('[voice] HEARTBEAT WARN: 500ms after play start, positionMillis=0 (audio loaded but not advancing). myId=', myId, 'durationMillis=', s.durationMillis);
        }
      }).catch(() => undefined);
    }, 500);

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) {
            // Externally unloaded (stopSpeaking) — release the queue.
            try { audioFile.delete(); } catch {}
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
              notifyCaption(null);
            }
            resolve();
            return;
          }
          if (status.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            try { audioFile.delete(); } catch {}
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
              notifyCaption(null);
            }
            resolve();
          }
        });
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log('[voice] speak timeout');
          if (myId === currentSpeechId) {
            currentSound = null;
            notifySpeaking(false);
            notifyCaption(null);
          }
          resolve();
        }, playbackTimeoutForText(text))
      ),
    ]);

  } catch (err) {
    // 2026-06-06 EMERGENCY REVERT — Phase 1 device-TTS fallback removed.
    // Tim's app was white-screening + closing mid-thinking after this
    // commit shipped. Sentry caught nothing (suggests native crash or
    // async exception escaping JS error reporting). Most likely culprit:
    // the require('expo-speech') dynamic-require call OR the 6s
    // setTimeout caption-clear in the catch path. Restoring the
    // original d06e37f-shape catch: clean cleanup, log, return.
    // Device-TTS rebuild deferred to new APK with expo-speech native
    // baked in (where we can confirm the path doesn't crash).
    if (myId === currentSpeechId) {
      currentSound = null;
      currentAbortController = null;
      notifySpeaking(false);
      notifyCaption(null);
    }
    if (!(err instanceof Error && err.name === 'AbortError')) {
      console.log('[voice] speak error:', err);
      logVoiceSilentFail('speak_catch', { speechId: myId, error: err instanceof Error ? err.message : String(err) });
      const emsg = err instanceof Error ? err.message : String(err);
      cbRecordFailure('voice');
      // Only a genuine connectivity failure marks you offline — not a client-side
      // abort (timeout) or server error. "Network request failed" = real signal loss.
      if (/network request failed|connection refused|network error/i.test(emsg)) cbReportNetworkFailure();
      // THE Lakes-round fix: a real fetch failure (no signal) no longer goes
      // mute — speak the line on the device instead. (AbortError = a newer
      // utterance preempted us; that correctly stays silent.)
      await deviceSpeakFallback(text, language, myId, effectiveGender);
    }
  }
});

// 2026-06-13 — warmVoice: fire a tiny, throttled prewarm at the /api/voice
// serverless function the moment a spoken read becomes IMMINENT (analysis /
// recap / summary generation START). gpt-4o-mini-tts returns nothing until the
// WHOLE clip is generated, so a COLD function adds a multi-second tax on TOP of
// generation — exactly Tim's "delay between getting a report and the caddie
// reading it." Warming WHILE the report text is still being produced means the
// function is hot when the real speak() fires. Fire-and-forget, never throws,
// self-throttled (45s) so back-to-back triggers don't spam the endpoint. The
// audio is drained and discarded — never played, never touches the speak queue.
let lastVoiceWarmAt = 0;
export const warmVoice = (apiUrl: string): void => {
  const now = Date.now();
  if (now - lastVoiceWarmAt < 45_000) return; // already warm recently
  if (cbIsDegraded('voice')) return;          // don't poke a known-down endpoint
  lastVoiceWarmAt = now;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  fetch(apiUrl + '/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Single char: spins the function + OpenAI TTS connection at ~zero cost.
    body: JSON.stringify({ text: '.', gender: 'male', language: 'en' }),
    signal: ctrl.signal,
  })
    .then((res) => { void res.arrayBuffer().catch(() => {}); }) // drain + drop, never play
    .catch(() => { /* best-effort; warmth failures are silent */ })
    .finally(() => clearTimeout(t));
};

// 2026-06-13 — speakChunked: cut TIME-TO-FIRST-WORD on long reads (swing reports,
// round recaps, cage summaries). Because gpt-4o-mini-tts emits nothing until the
// ENTIRE clip is generated, a paragraph makes the caddie sit silent for seconds.
// For long text we split on sentence boundaries and speak the FIRST sentence on
// its own (short → fast first audio), then the remainder in ~2-sentence groups —
// so the read STARTS quickly instead of after the whole thing renders. Short text
// (the common case — a hole number, a one-liner) is delegated straight to speak()
// unchanged, preserving the proven single path for everything already snappy.
// Sequential via the existing speak() queue, so ordering is automatic; a barge-in
// (stopSpeaking bumps speakGeneration) cancels the REST of the report, not just
// the current sentence.
const CHUNK_MIN_CHARS = 180; // below this a single shot is already fast — don't chunk
export const speakChunked = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh' = 'en',
  apiUrl: string,
  opts?: SpeakOpts,
): Promise<void> => {
  const trimmed = (text ?? '').trim();
  if (trimmed.length <= CHUNK_MIN_CHARS) {
    return speak(trimmed, gender, language, apiUrl, opts);
  }
  // Split into sentences, keeping terminal punctuation + any trailing quote/bracket.
  const sentences = trimmed
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?\s*|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [trimmed];
  if (sentences.length <= 1) {
    return speak(trimmed, gender, language, apiUrl, opts); // run-on with no boundary
  }
  // First chunk = first sentence alone (fast first word); remainder batched in
  // pairs so we don't pay a fetch per sentence.
  const chunks: string[] = [sentences[0]];
  for (let i = 1; i < sentences.length; i += 2) {
    chunks.push(sentences.slice(i, i + 2).join(' '));
  }
  const startGen = speakGeneration; // snapshot — a barge-in (stopSpeaking) moves this
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0 && speakGeneration !== startGen) break; // interrupted → stop the report
    await speak(chunks[i], gender, language, apiUrl, opts);
  }
};
