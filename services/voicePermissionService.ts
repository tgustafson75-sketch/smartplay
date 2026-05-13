import { Audio } from 'expo-av';
import { useVoiceHintsStore } from '../store/voiceHintsStore';
import { useSettingsStore } from '../store/settingsStore';

const PERMISSION_EXPLAINER =
  "Kevin listens when you talk to him. Allow microphone access to use voice. " +
  "You can always tap instead.";

/**
 * Check microphone permission. Requests if not yet determined. Persists denial
 * state so the app can route to tap-only mode without re-prompting on every voice
 * entry point.
 *
 * Returns true if currently granted, false if denied or undetermined-then-denied.
 */
export async function checkMicPermission(): Promise<boolean> {
  const hints = useVoiceHintsStore.getState();
  try {
    const current = await Audio.getPermissionsAsync();
    if (current.granted) {
      if (hints.mic_permission_denied) hints.setMicGranted();
      return true;
    }
    if (!current.canAskAgain) {
      hints.setMicDenied(true);
      return false;
    }
    const requested = await Audio.requestPermissionsAsync();
    if (requested.granted) {
      hints.setMicGranted();
      return true;
    }
    hints.setMicDenied(true);
    return false;
  } catch (err) {
    console.log('[voicePermission] error:', err);
    return false;
  }
}

/**
 * True when the user has actively denied microphone access AND hasn't re-enabled
 * voice via Settings. Voice prompts (hints, conversational logging) consult this
 * to stay quiet rather than nag.
 */
export function isVoiceSuppressed(): boolean {
  const hints = useVoiceHintsStore.getState();
  const settings = useSettingsStore.getState();
  // User flipped voiceEnabled off explicitly via Settings → respect that.
  if (!settings.voiceEnabled) return true;
  // Mic was denied at the OS level → suppress until they re-enable in Settings.
  if (hints.mic_permission_denied) return true;
  return false;
}

/** User flipped voiceEnabled back on in Settings — clear any prior denial flag. */
export function clearMicDenial(): void {
  useVoiceHintsStore.getState().setMicDenied(false);
  // Audit follow-up (2026-05-13) — also invalidate the module-level
  // permission cache inside useVoiceCaddie. Without this, a user who
  // denied mic earlier and now re-enables voice still hits a stale
  // `micPermissionGranted = false` and the next tap silently bails
  // instead of re-asking the OS. Dynamic import avoids the
  // hook-imports-service-imports-hook cycle.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../hooks/useVoiceCaddie') as { resetMicPermissionCache?: () => void };
    mod.resetMicPermissionCache?.();
  } catch { /* swallow — cache reset is a nice-to-have, not load-bearing */ }
}

export const PERMISSION_EXPLAINER_TEXT = PERMISSION_EXPLAINER;
