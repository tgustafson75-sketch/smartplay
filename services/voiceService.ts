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

// ─── SPEAK ────────────────────────────────

export const speak = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh' = 'en',
  apiUrl: string,
): Promise<void> => {
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
