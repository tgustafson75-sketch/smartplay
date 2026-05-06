/**
 * Central one-time permissions request.
 *
 * Tim's complaint that prompted this: every camera-using surface
 * (SmartVision, SmartFinder, Lie Analysis, Cage Drill, Space Scan)
 * was asking for camera permission individually, and tapping "Allow"
 * was silently failing on Android when the OS had pre-suppressed the
 * dialog. Result: stuck on a permission-request screen with no way out.
 *
 * Fix: ask for everything we'll ever need ONCE, up-front, in a friendly
 * pre-flight screen during the first-launch flow. After that, every tool
 * checks the granted state and uses it directly — no per-tool dialog.
 *
 * Honest about Android quirks:
 *   - Android suppresses the OS dialog on the 2nd ask in some versions.
 *     If we detect "asked" but state still says undetermined, we route
 *     the user to Settings rather than re-asking and getting a no-op.
 *   - iOS only asks ONCE per permission ever; subsequent denied requests
 *     resolve immediately without showing a dialog.
 *   - Both behaviors are why the per-tool prompt pattern was fragile.
 */

import { Camera } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useSettingsStore } from '../store/settingsStore';

export type PermissionKind = 'camera' | 'microphone' | 'location' | 'mediaLibrary';

export interface PermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
}

export interface CorePermissionsResult {
  camera: PermissionState;
  microphone: PermissionState;
  location: PermissionState;
  /** Photo-library access. Used by Space Scan + Tutorial Upload when
   *  the user picks an existing photo/video instead of capturing fresh.
   *  Requested via expo-image-picker (already in the bundle) so we
   *  don't need a separate expo-media-library install. */
  mediaLibrary: PermissionState;
  allGranted: boolean;
}

const REQUESTED_FLAG_KEY = 'core_permissions_requested';

function normalize(p: { granted?: boolean; canAskAgain?: boolean; status?: string } | null | undefined): PermissionState {
  if (!p) return { granted: false, canAskAgain: true, status: 'undetermined' };
  return {
    granted: !!p.granted,
    canAskAgain: p.canAskAgain ?? true,
    status: (p.status as 'granted' | 'denied' | 'undetermined') ?? 'undetermined',
  };
}

/** Read current state of all core permissions without prompting. Safe
 *  to call from any surface — used by tool screens to check whether
 *  they can use the camera/mic/etc. without re-asking. */
export async function getCorePermissionsState(): Promise<CorePermissionsResult> {
  const [cam, mic, loc, ml] = await Promise.allSettled([
    Camera.getCameraPermissionsAsync(),
    Audio.getPermissionsAsync(),
    Location.getForegroundPermissionsAsync(),
    ImagePicker.getMediaLibraryPermissionsAsync(),
  ]);
  const camera = normalize(cam.status === 'fulfilled' ? cam.value : null);
  const microphone = normalize(mic.status === 'fulfilled' ? mic.value : null);
  const location = normalize(loc.status === 'fulfilled' ? loc.value : null);
  const mediaLibrary = normalize(ml.status === 'fulfilled' ? ml.value : null);
  const allGranted = camera.granted && microphone.granted && location.granted && mediaLibrary.granted;
  return { camera, microphone, location, mediaLibrary, allGranted };
}

/** One-time pre-flight: prompt for every permission we'll ever need.
 *  Idempotent — safe to call multiple times. Marks "requested" so the
 *  first-launch screen knows whether it should still appear. Each
 *  permission ask is independent — partial grants are valid. */
export async function requestCorePermissions(): Promise<CorePermissionsResult> {
  // Fire requests sequentially so the OS dialogs queue cleanly (parallel
  // can race on some Android skins and skip prompts).
  let camera: PermissionState;
  let microphone: PermissionState;
  let location: PermissionState;
  let mediaLibrary: PermissionState;
  try {
    camera = normalize(await Camera.requestCameraPermissionsAsync());
  } catch (e) { console.log('[perm] camera request failed', e); camera = normalize(null); }
  try {
    microphone = normalize(await Audio.requestPermissionsAsync());
  } catch (e) { console.log('[perm] mic request failed', e); microphone = normalize(null); }
  try {
    location = normalize(await Location.requestForegroundPermissionsAsync());
  } catch (e) { console.log('[perm] location request failed', e); location = normalize(null); }
  try {
    mediaLibrary = normalize(await ImagePicker.requestMediaLibraryPermissionsAsync());
  } catch (e) { console.log('[perm] media-library request failed', e); mediaLibrary = normalize(null); }

  // Mark "we've asked" regardless of grant outcome — partial denials are
  // a valid end state and we don't want to re-prompt on next launch.
  try { useSettingsStore.getState().markTutorialSeen(REQUESTED_FLAG_KEY); } catch {}

  const allGranted = camera.granted && microphone.granted && location.granted && mediaLibrary.granted;
  console.log('[perm] core requested:', { camera: camera.status, microphone: microphone.status, location: location.status, mediaLibrary: mediaLibrary.status, allGranted });
  return { camera, microphone, location, mediaLibrary, allGranted };
}

/** Has the one-time pre-flight already been run? Drives the first-launch
 *  router decision (show /permissions vs skip straight to onboarding). */
export function corePermissionsRequested(): boolean {
  try {
    return !!useSettingsStore.getState().tutorialsSeen?.[REQUESTED_FLAG_KEY];
  } catch {
    return false;
  }
}

/** Reset the "requested" marker. Used by the Settings reset flow so a
 *  fresh-install simulation re-shows the permissions screen. */
export function resetCorePermissionsRequested(): void {
  try {
    const settings = useSettingsStore.getState();
    const seen = { ...(settings.tutorialsSeen ?? {}) };
    delete seen[REQUESTED_FLAG_KEY];
    useSettingsStore.setState({ tutorialsSeen: seen });
  } catch {}
}
