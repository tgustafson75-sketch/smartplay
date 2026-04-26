import { Audio } from 'expo-av';
import { cacheDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';

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

    const response = await fetch(apiUrl + '/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender, language }),
    });

    if (!response.ok) {
      console.log('[voice] speak API error:', response.status);
      return;
    }

    // Save audio to cache file — URL.createObjectURL not available in RN
    const arrayBuffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const CHUNK = 8192;
    let binary = '';
    for (let offset = 0; offset < uint8.byteLength; offset += CHUNK) {
      const slice = uint8.subarray(offset, offset + CHUNK);
      binary += String.fromCharCode(...(slice as unknown as number[]));
    }
    const base64 = btoa(binary);

    const fileUri = (cacheDirectory ?? '') + 'kevin_voice_' + Date.now() + '.mp3';
    await writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });

    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: true, volume: 1.0 },
    );

    currentSound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        currentSound = null;
      }
    });

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
