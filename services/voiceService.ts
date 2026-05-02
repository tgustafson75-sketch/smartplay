import { Audio } from 'expo-av';
import { File, Paths } from 'expo-file-system';

// ─── AUDIO MODE MANAGEMENT ────────────────

export const configureAudioForRecording =
  async (): Promise<void> => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (err) {
      console.log('[voice] configure record error:', err);
    }
  };

const CAPTURE_RECORDING_OPTIONS: Audio.RecordingOptions = {
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

/**
 * Record audio for up to {timeoutMs}, transcribe, and return the text.
 * Returns null on permission denial, recording failure, or transcription error.
 */
export const captureUtterance = async (
  timeoutMs: number,
  apiUrl: string,
  language: 'en' | 'es' | 'zh' = 'en',
): Promise<string | null> => {
  let recording: Audio.Recording | null = null;
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return null;
    await configureAudioForRecording();
    const r = await Audio.Recording.createAsync(CAPTURE_RECORDING_OPTIONS);
    recording = r.recording;
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (!uri) return null;

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

    if (!res.ok) return null;
    const data = await res.json() as { text?: string };
    const text = (data.text ?? '').trim();
    return text || null;
  } catch (err) {
    console.log('[voice] captureUtterance error:', err);
    if (recording) {
      try { await recording.stopAndUnloadAsync(); } catch { /* ignore */ }
    }
    return null;
  }
};

export const configureAudioForSpeech =
  async (): Promise<void> => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (err) {
      console.log('[voice] configure speech error:', err);
    }
  };

// ─── SINGLETON SPEECH STATE ───────────────
// Module-level state shared across all components and hook instances.
// A new speechId is issued on every speak() or stopSpeaking() call;
// any in-flight operation whose id is stale self-terminates.

const SPEAK_TIMEOUT_MS = 30_000;

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

// ─── STOP ─────────────────────────────────

export const stopSpeaking = async (): Promise<void> => {
  currentSpeechId++;
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
};

export const isSpeaking = (): boolean => currentSound !== null;

// ─── PLAY LOCAL FILE (filler clips) ──────
// Same singleton semantics as speak/speakFromBase64 — naturally cancelled
// when the real response calls either of those functions.

export const playLocalFile = async (uri: string): Promise<void> => {
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
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, volume: 1.0 },
    );

    if (myId !== currentSpeechId) {
      await sound.unloadAsync().catch(() => {});
      return;
    }

    currentSound = sound;

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
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
        }, 5_000)
      ),
    ]);

  } catch (err) {
    if (myId === currentSpeechId) {
      currentSound = null;
      notifySpeaking(false);
    }
    console.log('[voice] playLocalFile error:', err);
  }
};

// ─── SPEAK FROM BASE64 ────────────────────

export const speakFromBase64 = async (base64: string): Promise<void> => {
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
    audioFile.write(bytes);

    if (myId !== currentSpeechId) return;

    const { sound } = await Audio.Sound.createAsync(
      { uri: audioFile.uri },
      { shouldPlay: true, volume: 1.0 },
    );

    if (myId !== currentSpeechId) {
      await sound.unloadAsync().catch(() => {});
      return;
    }

    currentSound = sound;

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
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
        }, SPEAK_TIMEOUT_MS)
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
};

// ─── SPEAK ────────────────────────────────

export const speak = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh' = 'en',
  apiUrl: string,
): Promise<void> => {
  // Phase O.5 — global TTS safety: respect voiceEnabled + audio-route policy.
  // Single source of truth so consumer sites don't need to repeat the check.
  // Lazy require avoids a circular dependency at module load time.
  try {
    const settingsMod = require('../store/settingsStore');
    const routingMod = require('./audioRoutingService');
    const settings = settingsMod.useSettingsStore.getState();
    if (!settings.voiceEnabled) return;
    const route = routingMod.getCurrentRoute();
    if (route === 'phone_speaker' && !settings.voiceOnPhoneSpeaker) return;
  } catch {
    // If the guard itself fails, fall through — never block speech on a guard error.
  }

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
  await configureAudioForSpeech();

  try {
    const abortController = new AbortController();
    currentAbortController = abortController;
    const voiceTimeout = setTimeout(() => abortController.abort(), 12_000);

    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender, language }),
      signal: abortController.signal,
    }).finally(() => clearTimeout(voiceTimeout));

    // Bail if a newer speak() or stopSpeaking() fired while we were fetching.
    if (myId !== currentSpeechId) return;
    currentAbortController = null;

    if (!response.ok) {
      console.log('[voice] speak API error:', response.status);
      notifySpeaking(false);
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (myId !== currentSpeechId) return;

    if (arrayBuffer.byteLength < 100) {
      console.log('[voice] speak: empty audio payload');
      notifySpeaking(false);
      return;
    }

    const uint8 = new Uint8Array(arrayBuffer);
    const audioFile = new File(Paths.cache, `kevin_voice_${Date.now()}.mp3`);
    audioFile.write(uint8);

    if (myId !== currentSpeechId) return;

    const { sound } = await Audio.Sound.createAsync(
      { uri: audioFile.uri },
      { shouldPlay: true, volume: 1.0 },
    );

    // Bail if ownership was taken during createAsync.
    if (myId !== currentSpeechId) {
      await sound.unloadAsync().catch(() => {});
      return;
    }

    currentSound = sound;

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
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
          console.log('[voice] speak timeout');
          if (myId === currentSpeechId) {
            currentSound = null;
            notifySpeaking(false);
          }
          resolve();
        }, SPEAK_TIMEOUT_MS)
      ),
    ]);

  } catch (err) {
    if (myId === currentSpeechId) {
      currentSound = null;
      currentAbortController = null;
      notifySpeaking(false);
    }
    if (!(err instanceof Error && err.name === 'AbortError')) {
      console.log('[voice] speak error:', err);
    }
  }
};
