/**
 * 2026-05-24 v1.2.1 — Meta glasses media auto-detect from iPhone Photos.
 *
 * Ray-Ban Meta glasses save photos/videos to the iPhone Photos library
 * via the Meta View app (when "Save to Camera Roll" is ON in Meta View
 * settings). Meta View typically writes them to an album named
 * "Ray-Ban" or "Meta". This service polls the album and surfaces new
 * (<60s old) assets so SmartPlay Caddie can offer Tank analysis.
 *
 * NATIVE DEP NOTE: expo-media-library is a native module installed in
 * package.json today but NOT bundled into the current OTA build's
 * native binary. The runtime calls below will throw / return null
 * until the next `eas build --platform all --profile preview`
 * lands the native module. JS code is OTA-shippable; the runtime
 * lights up on the next native build cut.
 *
 * NO direct glasses connection — no Bluetooth LE, no Meta SDK. Pure
 * iPhone Photos polling.
 *
 * Privacy / consent:
 *   - All calls gracefully no-op when Photos permission is not granted.
 *   - We never auto-upload to the backend. The UI surfaces a banner
 *     with the user-visible thumbnail; user explicitly taps to
 *     analyze.
 *
 * Audio note: Ray-Ban Meta only records audio as part of video. No
 * standalone audio files exist on the glasses today. Audio analysis
 * via Meta video = future ffmpeg extraction (backend, not in-app).
 */

import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import { t } from 'i18next';

export interface MetaGlassesAsset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  creationTime: number;  // unix ms (MediaLibrary returns ms already)
  duration?: number;
}

/**
 * Return the most recent N assets from the Meta-glasses album, or [] when
 * permission is missing OR no Meta album exists. Never throws.
 */
export async function getLatestMetaGlassesMedia(limit = 5): Promise<MetaGlassesAsset[]> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (perm.status !== 'granted') return [];

    const albums = await MediaLibrary.getAlbumsAsync();
    // 2026-05-24 v1.2.2 — Android path expansion. Tim confirmed Meta
    // glasses media on Android lands in a user-named "SmartPlay
    // Caddie" Google Photos album (vs iOS's auto-named Ray-Ban / Meta
    // Camera Roll album). Match all three name conventions in the
    // same pass so iOS + Android share one detection path.
    const targetAlbum = albums.find((a) => {
      const t = a.title.toLowerCase();
      return (
        t.includes('ray-ban') ||
        t.includes('rayban') ||
        t.includes('meta') ||
        t.includes('smartplay caddie') ||
        t.includes('smartplay')
      );
    });
    if (!targetAlbum) return [];

    const result = await MediaLibrary.getAssetsAsync({
      album: targetAlbum,
      mediaType: ['photo', 'video'],
      sortBy: [['creationTime', false]],
      first: limit,
    });

    return result.assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      mediaType: asset.mediaType === 'photo' ? 'photo' : 'video',
      creationTime: asset.creationTime,
      duration: asset.duration ?? undefined,
    }));
  } catch (e) {
    // Native module not in the current build, or runtime error.
    // Honest no-op — feature stays dormant until EAS Build lands.
    console.log('[metaGlassesImport] getLatest failed (non-fatal):', e);
    return [];
  }
}

/**
 * Resize a Meta glasses photo for AI analysis (bandwidth + cost).
 * Returns a local file URI + the Tank prompt the UI can show in its
 * "ask Tank to analyze" confirmation.
 */
export async function processMetaGlassesPhoto(uri: string): Promise<{ processedUri: string; tankPrompt: string }> {
  const manipResult = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return {
    processedUri: manipResult.uri,
    tankPrompt: t('tank.analyze_hole_photo'),
  };
}

/**
 * v1.2.1 — Video is detected but NOT processed in-app (too heavy).
 * Returns the URI + a placeholder prompt so the UI can surface
 * "video detected, processing later" affordance. Full backend
 * pipeline lands in a future sprint.
 */
export async function processMetaGlassesVideo(uri: string): Promise<{ videoUri: string; tankPrompt: string }> {
  return {
    videoUri: uri,
    tankPrompt: t('tank.analyze_swing_video'),
  };
}

/**
 * Stub for future audio extraction from Meta videos. Ray-Ban Meta
 * doesn't expose a standalone audio stream — audio rides on the
 * video track. ffmpeg extraction (backend) is the future path. For
 * v1.2.1 we just return the video URI so the analysis backend
 * receives the full file and can handle audio server-side.
 */
export async function extractAudioFromMetaVideo(videoUri: string): Promise<string> {
  return videoUri;
}
