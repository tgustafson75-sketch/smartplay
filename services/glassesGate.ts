/**
 * 2026-10-10 — Sightline slice 1: may the glasses surface render?
 *
 * Only inside the `glasses` build variant (app.config.js, APP_VARIANT=glasses → extra.appVariant) AND
 * with the remote kill switch on (api/flags `glasses_enabled`, default OFF). A store build is never the
 * glasses variant, so this is false there whatever the flag says — and it has no DAT SDK to talk to.
 */
import Constants from 'expo-constants';
import { isFlagEnabled } from '../store/flagStore';

export function isGlassesVariant(): boolean {
  try {
    return (Constants.expoConfig?.extra as { appVariant?: string } | undefined)?.appVariant === 'glasses';
  } catch { return false; }
}

export function isGlassesSurfaceEnabled(): boolean {
  return isGlassesVariant() && isFlagEnabled('glasses_enabled');
}
