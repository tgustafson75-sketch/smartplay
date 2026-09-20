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
import { getApiBaseUrl, appKeyHeaders } from './apiBase';

const apiUrl = (): string => getApiBaseUrl();

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

// 2026-09-20 — every prompt that dresses a person carries the no-logo clause. Neither of these
// names a brand, but "touring professional" is enough on its own: the custom-caddie prompt came
// back with a mangled PGA TOUR mark on the polo, and these produce the same kind of artifact — a
// picture of the user that they keep and can save to their camera roll. Asking for no branding is
// free; finding someone's trademark on our output later is not. [[no-half-fixes-enforce-every-surface]]
const NO_BRANDING = 'No logos, brand marks, or text on any clothing. ';

const STYLE_PROMPTS: Record<'caddie' | 'pro', string> = {
  caddie:
    'Stylize this person as a friendly golf caddie. Keep their face clearly recognizable. ' +
    'Clean unbranded caddie polo and visor, sunny fairway behind, photorealistic, warm soft lighting, ' +
    NO_BRANDING +
    'head-and-shoulders, centered square composition.',
  pro:
    'Stylize this person as a confident touring professional golfer. Keep their face clearly ' +
    'recognizable. Clean modern unbranded golf polo, course behind, photorealistic, ' +
    NO_BRANDING +
    'head-and-shoulders, centered square composition.',
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
      headers: { 'Content-Type': 'application/json', ...appKeyHeaders() },
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
