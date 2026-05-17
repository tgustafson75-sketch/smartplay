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
  /** Foreground location. Required for all GPS-dependent features
   *  (SmartFinder, shot tracking, hole detection). Without this the
   *  app is functionally unusable. */
  location: PermissionState;
  /** Background location. Required so GPS stays warm when the phone
   *  goes into the user's pocket between shots. Without this, hole
   *  transitions and yardages freeze the moment the screen turns off.
   *  Requested AFTER foreground (Android requires the foreground grant
   *  before showing the background prompt). */
  backgroundLocation: PermissionState;
  /** Photo-library access. Used by Space Scan + Tutorial Upload when
   *  the user picks an existing photo/video instead of capturing fresh.
   *  Requested via expo-image-picker (already in the bundle) so we
   *  don't need a separate expo-media-library install. */
  mediaLibrary: PermissionState;
  /** True iff the four CORE permissions (camera, mic, foreground location,
   *  media library) are all granted. Background location is tracked
   *  separately because partial denial there is recoverable (foreground
   *  service still keeps GPS warm on Android). */
  coreGranted: boolean;
  /** Legacy alias for coreGranted. Kept so existing consumers don't break. */
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
  const [cam, mic, loc, bg, ml] = await Promise.allSettled([
    Camera.getCameraPermissionsAsync(),
    Audio.getPermissionsAsync(),
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    ImagePicker.getMediaLibraryPermissionsAsync(),
  ]);
  const camera = normalize(cam.status === 'fulfilled' ? cam.value : null);
  const microphone = normalize(mic.status === 'fulfilled' ? mic.value : null);
  const location = normalize(loc.status === 'fulfilled' ? loc.value : null);
  const backgroundLocation = normalize(bg.status === 'fulfilled' ? bg.value : null);
  const mediaLibrary = normalize(ml.status === 'fulfilled' ? ml.value : null);
  const coreGranted = camera.granted && microphone.granted && location.granted && mediaLibrary.granted;
  return { camera, microphone, location, backgroundLocation, mediaLibrary, coreGranted, allGranted: coreGranted };
}

/** One-time pre-flight: prompt for every permission we'll ever need.
 *  Idempotent — safe to call multiple times. Marks "requested" so the
 *  first-launch screen knows whether it should still appear. Each
 *  permission ask is independent — partial grants are valid.
 *
 *  2026-05-16 — background-location is requested here too, after
 *  foreground is granted (Android requires that ordering). Previously
 *  this was deferred to round-start, which interrupted the user mid-
 *  round and silently broke background tracking if denied. */
export async function requestCorePermissions(): Promise<CorePermissionsResult> {
  // Fire requests sequentially so the OS dialogs queue cleanly (parallel
  // can race on some Android skins and skip prompts).
  let camera: PermissionState;
  let microphone: PermissionState;
  let location: PermissionState;
  let backgroundLocation: PermissionState = normalize(null);
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
  // Background location prompt only fires when foreground is granted —
  // Android skips the dialog (or auto-denies) otherwise, and iOS
  // requires the foreground grant first by design. Failure here is
  // non-fatal: foreground service on Android still keeps GPS warm.
  if (location.granted) {
    try {
      backgroundLocation = normalize(await Location.requestBackgroundPermissionsAsync());
    } catch (e) { console.log('[perm] background-location request failed', e); backgroundLocation = normalize(null); }
  } else {
    // Re-check anyway in case OS state changed since the foreground prompt.
    try { backgroundLocation = normalize(await Location.getBackgroundPermissionsAsync()); } catch {}
  }
  try {
    mediaLibrary = normalize(await ImagePicker.requestMediaLibraryPermissionsAsync());
  } catch (e) { console.log('[perm] media-library request failed', e); mediaLibrary = normalize(null); }

  // Mark "we've asked" regardless of grant outcome — partial denials are
  // a valid end state and we don't want to re-prompt on next launch.
  // The visible PermissionBanner on the Caddie tab handles the
  // recovery path when location was denied.
  try { useSettingsStore.getState().markTutorialSeen(REQUESTED_FLAG_KEY); } catch {}

  const coreGranted = camera.granted && microphone.granted && location.granted && mediaLibrary.granted;
  console.log('[perm] core requested:', {
    camera: camera.status,
    microphone: microphone.status,
    location: location.status,
    backgroundLocation: backgroundLocation.status,
    mediaLibrary: mediaLibrary.status,
    coreGranted,
  });
  return { camera, microphone, location, backgroundLocation, mediaLibrary, coreGranted, allGranted: coreGranted };
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

/** Quick check: is foreground location granted right now?
 *  Used by the Caddie-tab PermissionBanner and by roundStore.startRound
 *  to short-circuit instead of trying to spin up the GPS manager
 *  with no permission. */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    return !!granted;
  } catch {
    return false;
  }
}

/** Re-request just foreground location. Used by the Caddie-tab
 *  PermissionBanner so the user can recover from an earlier denial
 *  without diving into Settings. On Android 11+ a second OS dialog
 *  fires if canAskAgain is true; otherwise the user must visit
 *  Settings manually. */
export async function requestLocationAgain(): Promise<PermissionState> {
  try {
    return normalize(await Location.requestForegroundPermissionsAsync());
  } catch (e) {
    console.log('[perm] location re-request failed', e);
    return normalize(null);
  }
}
