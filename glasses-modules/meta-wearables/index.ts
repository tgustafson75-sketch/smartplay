/**
 * Sightline slice 1 — the JS face of the glasses-only native module (glasses-modules/meta-wearables).
 * Null in every build that does not link it (every store build): callers must handle `null`.
 */
import { Platform } from 'react-native';

export type SessionErrorCode =
  | 'INSUFFICIENT_SDK_VERSION' | 'DWA_OUT_OF_STU_RANGE' | 'DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED'
  | 'DWA_UNAVAILABLE' | 'CAPABILITY_DENIED' | string;

export interface MetaWearablesNative {
  register(): void;
  getRegistrationState(): 'UNAVAILABLE' | 'AVAILABLE' | 'REGISTERING' | 'REGISTERED' | 'UNREGISTERING';
  requestCameraPermission(): Promise<'GRANTED' | 'DENIED' | string>;
  startSession(): Promise<void>;
  stopSession(): void;
  startStream(options: { quality: 'LOW' | 'MEDIUM'; fps: 2 | 7 }): Promise<void>;
  stopStream(): void;
  /** A still from the live stream: a local JPEG file:// URI. */
  capturePhoto(): Promise<string>;
  addListener(event: string, cb: (payload: Record<string, unknown>) => void): { remove(): void };
}

let cached: MetaWearablesNative | null | undefined;

export function metaWearables(): MetaWearablesNative | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'android') return cached;
  try {
    const core = require('expo-modules-core') as typeof import('expo-modules-core');
    cached = (core.requireOptionalNativeModule('MetaWearables') as MetaWearablesNative | null) ?? null;
  } catch { cached = null; }
  return cached;
}
