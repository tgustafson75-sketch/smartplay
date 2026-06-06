import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { File, Paths } from 'expo-file-system';
import { noteAudioActivity } from './audioLifecycle';
import { logVoiceSilentFail, logVoiceError, logTranscribeError } from './voiceErrorLog';
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
      console.log('[voice] setAudioModeSerial swallowed error to keep queue alive:', err instanceof Error ? err.message : String(err));
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
// 2026-06-04 — Bumped 2500 → 4000 (within Tim's "3-5s after user stops
// speaking" target). 2.5s was cutting users off mid-thought when they
// paused to choose a word; 4s gives natural breathing room without
// crossing into "user wandered off" territory. All captureUtterance
// callers inherit. Earlier 3000 → 2500 trim is reverted.
const SILENCE_TIMEOUT_MS = 4000;
const SPEECH_DETECT_DB = -30; // higher bar to confirm "they spoke at least once"

/**
 * Record audio for up to {timeoutMs}, transcribe, and return the text.
 * Returns null on permission denial, recording failure, transcription
 * error, or external cancellation via {@link stopCapture}.
 */
let currentRecording: Audio.Recording | null = null;
let captureCancelled = false;

export const stopCapture = async (): Promise<void> => {
  captureCancelled = true;
  const r = currentRecording;
  currentRecording = null;
  if (r) {
    try { await r.stopAndUnloadAsync(); } catch { /* ignore */ }
  }
};

export const captureUtterance = async (
  timeoutMs: number,
  apiUrl: string,
  language: 'en' | 'es' | 'zh' = 'en',
): Promise<string | null> => {
  let recording: Audio.Recording | null = null;
  captureCancelled = false;
  try {
    noteAudioActivity('capture');
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return null;
    await configureAudioForRecording();

    // 2026-05-25 — Fix A: track silence + speech-onset via metering.
    // hasSpoken flips true once a metering reading exceeds
    // SPEECH_DETECT_DB. lastLoudAt tracks the most recent above-threshold
    // sample. The wait loop below breaks early when (hasSpoken AND
    // silence sustained ≥ SILENCE_TIMEOUT_MS).
    let hasSpoken = false;
    let lastLoudAt = Date.now();

    const r = await Audio.Recording.createAsync(
      RECORDING_OPTIONS,
      (status) => {
        if (!status.isRecording) return;
        const metering = (status as { metering?: number }).metering;
        if (typeof metering !== 'number') return;
        if (metering > SPEECH_DETECT_DB) hasSpoken = true;
        if (metering > SILENCE_DB_THRESHOLD) lastLoudAt = Date.now();
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
    // silence-VAD trips early (Fix A).
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !captureCancelled) {
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
      if (!info.exists || ((info as { size?: number }).size ?? 0) < 1024) {
        console.log('[voice] capture file too small (<1KB), skipping transcribe');
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
    const cancelTimer = setTimeout(() => controller.abort(), 12_000);
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
    return text || null;
  } catch (err) {
    console.log('[voice] captureUtterance error:', err);
    logVoiceError('capture_utterance', err);
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch { /* ignore */ }
    }
    currentRecording = null;
    return null;
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

const enqueueSpeak = (body: () => Promise<void>): Promise<void> => {
  const enqueuedAt = speakGeneration;
  speakQueue = speakQueue
    .catch(() => { /* drop prior failure */ })
    .then(() => {
      if (enqueuedAt !== speakGeneration) return; // stopSpeaking fired after enqueue
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
    const persona = s.caddiePersonality as 'kevin' | 'serena' | 'harry' | 'tank';
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
    if (p.useCustomCaddie && p.customCaddiePortraitB64) base *= 0.85;
    return base;
  } catch {
    return 1.0;
  }
};

// 2026-06-05 — Default playback rate bumped 1.0 → 1.15. OpenAI
// gpt-4o-mini-tts speaks slowly by default; 1.15 with
// shouldCorrectPitch=true keeps every persona's timbre while making
// the cadence feel like a real caddie talking, not a robot reading.
// Custom-caddie keeps the additional 1.08× multiplier on top
// (effective ~1.24×) to preserve the user-recorded-voice character.
const DEFAULT_PLAYBACK_RATE = 1.15;
const currentPlaybackRate = (): number => {
  try {
    const profileMod = require('../store/playerProfileStore');
    const p = profileMod.usePlayerProfileStore.getState();
    if (p.useCustomCaddie && p.customCaddiePortraitB64) return DEFAULT_PLAYBACK_RATE * 1.08;
  } catch {}
  return DEFAULT_PLAYBACK_RATE;
};

// Apply rate to a freshly-created Sound. Failure is non-fatal — the audio
// just plays at 1.0× instead of the boosted rate, which is still correct.
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
  notifySpeaking(false);
  notifyCaption(null);
};

export const isSpeaking = (): boolean => currentSound !== null;

// ─── PLAY LOCAL FILE (filler clips) ──────
// Same singleton semantics as speak/speakFromBase64 — naturally cancelled
// when the real response calls either of those functions.

export const playLocalFile = async (
  uri: string,
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

  notifySpeaking(true);
  await configureAudioForSpeech();

  try {
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

  notifySpeaking(true);
  await configureAudioForSpeech();

  try {
    // Decode base64 → Uint8Array
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const audioFile = new File(Paths.cache, `kevin_voice_${Date.now()}.mp3`);
    // Audit follow-up (2026-05-13) — expo-file-system's File.write() is
    // synchronous (returns void), so the old `Promise.resolve(write())`
    // wrapper was a no-op. On some Android devices the audio subsystem
    // can briefly see a stale filesystem view if we read immediately
    // after writing, producing the "[voice] speak timeout" symptom
    // (empty/truncated playback). Yielding to a macrotask boundary
    // gives the OS file system a tick to settle before createAsync
    // reads via URI.
    audioFile.write(bytes);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    if (myId !== currentSpeechId) return;

    const { sound, status } = await Audio.Sound.createAsync(
      { uri: audioFile.uri },
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
            try { audioFile.delete(); } catch {}
            if (myId === currentSpeechId) {
              currentSound = null;
              notifySpeaking(false);
            }
            resolve();
            return;
          }
          if (s.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            try { audioFile.delete(); } catch {}
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

// ─── SPEAK VIA OPENAI TTS (uses proven speakFromBase64 playback path) ───
//
// 2026-06-05 — Greeting silence root cause analysis: speak() and
// speakFromBase64() share IDENTICAL playback code (file write →
// createAsync → didJustFinish wait). speakFromBase64 is proven working
// for Kevin brain replies on the same audio session that goes silent
// for non-Kevin greetings via speak(). The non-playback differences
// (fetch step, custom-clip override, snapshot volume/rate captures,
// 12s abort timeout) are the only candidates for the divergence.
//
// This helper bypasses speak()'s pre-fetch state machine entirely.
// It performs the /api/voice fetch, validates the response, converts
// the arrayBuffer to base64, and hands off to speakFromBase64 — the
// path that demonstrably works for Kevin's brain audio on cold launch.
// Used by the greeting screen for non-Kevin TTS where speak() has
// repeatedly silent-failed despite a verified-healthy server.
export const speakOpenAITTS = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh',
  apiUrl: string,
  opts?: SpeakOpts,
): Promise<void> => {
  if (!isVoiceAllowed(opts)) return;
  if (!apiUrl) {
    console.log('[voice] speakOpenAITTS: no apiUrl — bailing');
    logVoiceSilentFail('speak_openai_no_api_url', { textHead: text.slice(0, 60) });
    return;
  }
  let persona: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    persona = require('../store/settingsStore').useSettingsStore.getState().caddiePersonality ?? null;
  } catch { /* ignore */ }
  const ttsModel = language === 'en' ? 'eleven_monolingual_v1' : 'eleven_multilingual_v2';
  let buf: ArrayBuffer;
  try {
    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: preprocessTtsText(text, language),
        gender,
        language,
        persona,
        model_id: ttsModel,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '<unreadable>');
      console.log('[voice] speakOpenAITTS API error:', response.status, errBody.slice(0, 200));
      logVoiceSilentFail('speak_openai_api_error', { status: response.status, error: errBody.slice(0, 200) });
      return;
    }
    buf = await response.arrayBuffer();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.log('[voice] speakOpenAITTS fetch error:', err);
    logVoiceSilentFail('speak_openai_fetch_error', { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (buf.byteLength < 1000) {
    console.log('[voice] speakOpenAITTS small payload:', buf.byteLength);
    logVoiceSilentFail('speak_openai_small_payload', { bytes: buf.byteLength, textHead: text.slice(0, 60) });
    return;
  }
  // arrayBuffer → base64. Char-by-char build of binary string then
  // btoa is the standard RN-safe pattern (no Buffer global, no
  // TextDecoder needed for binary). 45KB mp3 → ~60KB base64 string;
  // sub-millisecond on a modern phone.
  const u8 = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(u8).toString('base64');
  console.log('[voice] speakOpenAITTS handing off to speakFromBase64 — bytes=', buf.byteLength, 'base64Len=', base64.length, 'persona=', persona);
  await speakFromBase64(base64, opts);
};

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

  try {
    const abortController = new AbortController();
    currentAbortController = abortController;
    const voiceTimeout = setTimeout(() => abortController.abort(), 12_000);

    // Persona is the source-of-truth selector for ElevenLabs voice routing.
    // Read from settings store at request time (dynamic require avoids a
    // module-load cycle since voiceService is imported very early).
    let persona: string | null = null;
    try {
      persona = require('../store/settingsStore').useSettingsStore.getState().caddiePersonality ?? null;
    } catch { /* ignore */ }
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

    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: preprocessTtsText(text, language), gender, language, persona, model_id: ttsModel }),
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
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }

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
      // 2026-05-27 — Fix EH: also clear the caption. Without this, the
      // text caption stayed on screen for the full TTL even though the
      // utterance silently failed — exact match for Tim's recurring
      // "text shows but no audio" report. notifySpeaking(false) alone
      // cleared the talking-state badge but the caption text lingered.
      notifyCaption(null);
      notifySpeaking(false);
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
    // 2026-06-05 — Deep-fix the recurring "splash text shows + no
    // audio" report for non-Kevin personas (Tank/Serena/Harry).
    //
    // PREVIOUS path: createAsync({shouldPlay:true}) → check loaded →
    // retry once if dead → setRateAsync on already-playing sound →
    // wait for didJustFinish. The mid-flight setRateAsync(rate,
    // shouldCorrectPitch=true) on Android occasionally puts MediaCodec
    // into a state where the sound reports isPlaying=true but emits
    // no audio (MediaCodec time-stretch init race on freshly-started
    // playback). Heartbeat at 500ms logged the symptom but didn't
    // recover. /api/voice was verified healthy by direct curl across
    // all four personas (Kevin/Serena/Tank/Harry) returning valid 24kHz
    // mono MP3s in ~1.2s — confirming this is a client-side issue.
    //
    // NEW path: load-then-play with rate applied ATOMICALLY in the
    // initial status. Audio.Sound.createAsync accepts rate +
    // shouldCorrectPitch in AVPlaybackStatusToSet, so the rate is
    // baked into the load — no separate setRateAsync race window.
    // Also adds a position-advance recovery: if 700ms after play
    // start positionMillis is still 0 AND isPlaying, unload and
    // retry ONCE with rate=1.0 (proven-safe fallback that skips
    // setRateAsync entirely). This converts the heartbeat from a
    // diagnostic into an actual recovery path.
    let sound: Audio.Sound;

    // Helper: load + play with optional rate. Returns true if audio
    // verifies as advancing at 700ms; false if it didn't load or didn't
    // advance. Caller decides retry/abandon based on the return.
    const loadAndVerify = async (
      useRate: boolean,
    ): Promise<{ ok: boolean; sound: Audio.Sound | null; reason?: string }> => {
      const initial: Record<string, unknown> = {
        shouldPlay: true,
        volume: snapshotVolume,
      };
      if (useRate && snapshotRate !== 1.0) {
        initial.rate = snapshotRate;
        initial.shouldCorrectPitch = true;
      }
      let s: Audio.Sound;
      let st: Awaited<ReturnType<typeof Audio.Sound.createAsync>>['status'];
      try {
        const created = await Audio.Sound.createAsync(
          { uri: audioFile.uri },
          initial as Parameters<typeof Audio.Sound.createAsync>[1],
        );
        s = created.sound;
        st = created.status;
      } catch (e) {
        console.log('[voice] speak createAsync threw:', e);
        return { ok: false, sound: null, reason: 'createAsync_threw' };
      }
      const loaded = (st as { isLoaded?: boolean }).isLoaded === true;
      const dur = (st as { isLoaded?: boolean; durationMillis?: number }).durationMillis ?? 0;
      console.log('[voice] speak createAsync result — myId=', myId,
        'useRate=', useRate, 'isLoaded=', loaded, 'durationMillis=', dur, 'volume=', snapshotVolume);
      if (!loaded || dur === 0) {
        try { await s.unloadAsync(); } catch {}
        return { ok: false, sound: null, reason: 'dead_load' };
      }
      // Wait 700ms then verify position advanced. 700ms gives MediaCodec
      // enough time to start emitting on slow Android devices while
      // staying short enough that recovery doesn't add perceptible lag.
      await new Promise<void>(resolve => setTimeout(resolve, 700));
      if (myId !== currentSpeechId) {
        try { await s.unloadAsync(); } catch {}
        return { ok: false, sound: null, reason: 'preempted_during_verify' };
      }
      try {
        const probe = await s.getStatusAsync();
        if (probe.isLoaded) {
          const pos = probe.positionMillis ?? 0;
          console.log('[voice] speak 700ms position check — myId=', myId,
            'positionMillis=', pos, 'isPlaying=', probe.isPlaying);
          if (pos === 0) {
            // Loaded but silent — the MediaCodec/setRate race.
            try { await s.unloadAsync(); } catch {}
            return { ok: false, sound: null, reason: 'position_stuck_at_zero' };
          }
        }
      } catch (e) {
        console.log('[voice] speak position probe failed (continuing anyway):', e);
      }
      return { ok: true, sound: s };
    };

    // Attempt 1: with rate (1.15× snappy default).
    let attempt = await loadAndVerify(true);
    if (!attempt.ok && myId === currentSpeechId) {
      console.log('[voice] speak attempt-1 failed —', attempt.reason, '— forcing audio reset + retrying with rate=1.0 fallback');
      logVoiceSilentFail('speak_attempt1_failed_retry', {
        speechId: myId,
        reason: attempt.reason ?? 'unknown',
        bytes: arrayBuffer.byteLength,
        textHead: text.slice(0, 60),
      });
      currentAudioMode = null;
      await configureAudioForSpeech();
      if (myId !== currentSpeechId) {
        console.log('[voice] speak retry preempted before attempt-2 — myId=', myId, 'currentSpeechId=', currentSpeechId);
        logVoiceSilentFail('speak_retry_preempted', { speechId: myId, currentSpeechId });
        notifyCaption(null);
        notifySpeaking(false);
        return;
      }
      // Attempt 2: rate=1.0 (skip setRateAsync entirely). Pure load+play
      // path proven across all devices. Audio plays at base speed; the
      // user hears the line even if rate-stretch is the culprit.
      attempt = await loadAndVerify(false);
    }
    if (!attempt.ok || !attempt.sound) {
      console.log('[voice] speak both attempts failed — giving up. last reason:', attempt.reason);
      logVoiceSilentFail('speak_both_attempts_failed', {
        speechId: myId,
        lastReason: attempt.reason ?? 'unknown',
        bytes: arrayBuffer.byteLength,
        textHead: text.slice(0, 60),
      });
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }
    sound = attempt.sound;

    // Bail if ownership was taken during load+verify.
    if (myId !== currentSpeechId) {
      console.log('[voice] speak preempted after load+verify — myId=', myId, 'currentSpeechId=', currentSpeechId);
      logVoiceSilentFail('speak_preempted_after_createasync', { speechId: myId, currentSpeechId });
      await sound.unloadAsync().catch(() => {});
      notifyCaption(null);
      notifySpeaking(false);
      return;
    }

    currentSound = sound;

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
    if (myId === currentSpeechId) {
      currentSound = null;
      currentAbortController = null;
      notifySpeaking(false);
      notifyCaption(null);
    }
    if (!(err instanceof Error && err.name === 'AbortError')) {
      console.log('[voice] speak error:', err);
      logVoiceSilentFail('speak_catch', { speechId: myId, error: err instanceof Error ? err.message : String(err) });
    }
  }
});
