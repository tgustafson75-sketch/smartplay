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

// ─── SPEAK ────────────────────────────────

const SPEAK_TIMEOUT_MS = 30_000;

let currentSound: Audio.Sound | null = null;

export const speak = async (
  text: string,
  gender: 'male' | 'female',
  language: 'en' | 'es' | 'zh' = 'en',
  apiUrl: string,
): Promise<void> => {
  try {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    }

    await configureAudioForSpeech();

    const voiceController = new AbortController();
    const voiceTimeout = setTimeout(() => voiceController.abort(), 12000);

    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender, language }),
      signal: voiceController.signal,
    }).finally(() => clearTimeout(voiceTimeout));

    if (!response.ok) {
      console.log('[voice] speak API error:', response.status);
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength < 100) {
      console.log('[voice] speak: empty audio payload');
      return;
    }

    const uint8 = new Uint8Array(arrayBuffer);
    const audioFile = new File(Paths.cache, `kevin_voice_${Date.now()}.mp3`);
    audioFile.write(uint8);

    const { sound } = await Audio.Sound.createAsync(
      { uri: audioFile.uri },
      { shouldPlay: true, volume: 1.0 },
    );

    currentSound = sound;

    await Promise.race([
      new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            sound.unloadAsync().catch(() => {});
            try { audioFile.delete(); } catch {}
            currentSound = null;
            resolve();
          }
        });
      }),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log('[voice] speak timeout');
          currentSound = null;
          resolve();
        }, SPEAK_TIMEOUT_MS)
      ),
    ]);

  } catch (err) {
    console.log('[voice] speak error:', err);
  }
};

export const stopSpeaking = async (): Promise<void> => {
  try {
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    }
  } catch (err) {
    console.log('[voice] stop error:', err);
  }
};

export const isSpeaking = (): boolean => currentSound !== null;
