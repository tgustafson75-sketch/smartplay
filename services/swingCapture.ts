import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

export interface SwingCaptureResult {
  fix: string;
  fault: string | null;
  frameUri: string | null;
}

export type SwingView = 'face-on' | 'down-the-line';

export const compressFrame = async (imageUri: string): Promise<string | null> => {
  try {
    const compressed = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 640 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
    );

    const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: 'base64',
    });

    return base64;
  } catch (err) {
    console.log('[swingCapture] compress error:', err);
    return null;
  }
};

export const analyzeSwingFrame = async (
  frameBase64: string,
  club: string,
  feel: string | null,
  shape: string | null,
  dominantMiss: string | null,
  physicalLimitation: string | null,
  sessionFaults: string[],
  swingView: SwingView,
  language: string,
  apiUrl: string,
): Promise<SwingCaptureResult> => {
  // Audit 101 / S6 — clearTimeout AFTER res.json() completes, not in .finally()
  // on the fetch. If the server flushes headers fast but the body is slow,
  // the original `.finally(clearTimeout)` runs before parsing and leaves the
  // body parse with no timeout protection.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(apiUrl + '/api/smartmotion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frameBase64,
        club,
        feel,
        shape,
        dominantMiss,
        physicalLimitation,
        sessionFaults,
        swingView,
        language,
      }),
      signal: controller.signal,
    });

    const data = await res.json() as { fix?: string; fault?: string | null };
    clearTimeout(timeout);
    return {
      fix: data.fix ?? 'Set up the camera and try again.',
      fault: data.fault ?? null,
      frameUri: null,
    };
  } catch (err) {
    clearTimeout(timeout);
    console.log('[swingCapture] API error:', err);
    return {
      fix: 'Could not analyze the swing. Check your connection.',
      fault: null,
      frameUri: null,
    };
  }
};
