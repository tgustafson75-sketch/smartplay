/**
 * 2026-06-08 — Golfer avatar capture + optional AI stylization.
 *
 * captureGolferSelfie() — front-camera selfie, cropped square, resized to a
 *   small avatar (returns a file URI).
 * stylizeGolferSelfie() — runs the selfie through /api/image-edit (the same
 *   pipeline as the custom-caddie portrait flow) to render the person as a
 *   caddie or a touring pro, keeping their face recognizable. Returns a
 *   data: URL, or null on failure (caller falls back to the raw selfie).
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

/** Front-camera selfie → square → small avatar file URI. null = cancelled
 *  or permission denied. */
export async function captureGolferSelfie(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    cameraType: ImagePicker.CameraType.front,
    quality: 0.85,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (result.canceled || !result.assets[0]?.uri) return null;
  const manip = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 256, height: 256 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  // 2026-06-08 — copy out of the cache dir into persistent storage so the
  // avatar survives an OS cache eviction (cache uris can be cleared,
  // leaving a blank avatar). AI-stylized portraits are data: URLs and
  // already durable. Falls back to the cache uri if the copy fails.
  try {
    const FS = await import('expo-file-system/legacy');
    if (FS.documentDirectory) {
      const dir = `${FS.documentDirectory}avatars/`;
      await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
      const dest = `${dir}selfie-${Date.now()}.jpg`;
      await FS.copyAsync({ from: manip.uri, to: dest });
      return dest;
    }
  } catch (e) {
    console.log('[golferAvatar] persist copy failed (using cache uri)', e);
  }
  return manip.uri;
}

const STYLE_PROMPTS: Record<'caddie' | 'pro', string> = {
  caddie:
    'Stylize this person as a friendly golf caddie. Keep their face clearly recognizable. ' +
    'Clean caddie polo and visor, sunny fairway behind, photorealistic, warm soft lighting, ' +
    'head-and-shoulders, centered square composition.',
  pro:
    'Stylize this person as a confident touring professional golfer. Keep their face clearly ' +
    'recognizable. Clean modern golf polo, course behind, photorealistic, head-and-shoulders, ' +
    'centered square composition.',
};

/** Selfie URI → AI-stylized caddie/pro portrait as a data: URL. null on any
 *  failure (caller keeps the raw selfie). */
export async function stylizeGolferSelfie(selfieUri: string, style: 'caddie' | 'pro'): Promise<string | null> {
  try {
    // image-edit wants PNG, reasonably sized.
    const manip = await ImageManipulator.manipulateAsync(
      selfieUri,
      [{ resize: { width: 1024, height: 1024 } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.PNG },
    );
    const FS = await import('expo-file-system/legacy');
    const b64 = await FS.readAsStringAsync(manip.uri, { encoding: FS.EncodingType.Base64 });
    const res = await fetch(apiUrl() + '/api/image-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: b64, prompt: STYLE_PROMPTS[style] }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.b64) return null;
    return `data:image/png;base64,${data.b64}`;
  } catch (e) {
    console.log('[golferAvatar] stylize failed (non-fatal)', e);
    return null;
  }
}
