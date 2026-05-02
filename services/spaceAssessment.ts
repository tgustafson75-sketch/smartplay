/**
 * Phase W — Practice Space Assessment client.
 *
 * Single-flight controller pattern (mirrors lieAnalysisService) so a fast
 * second tap aborts the in-flight scan and the badge state stays honest.
 * Persists saved configurations via AsyncStorage so SwingLab home + Cage
 * Mode setup can pre-fill from the last scan.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

export type SpaceType = 'cage' | 'range_bay' | 'backyard' | 'basement' | 'garage' | 'other';

export interface SpaceAssessment {
  space_type: SpaceType;
  summary: string;
  recommended_setup: { mat_position: string; aim_direction: string };
  camera_position: { dtl_placement: string | null; face_on_placement: string | null };
  recommended_drills: string[];
  avoid_drills: { drill_id: string; reason: string }[];
  safety_notes: string[];
  limitations: string[];
}

export interface SpaceConfiguration {
  id: string;
  saved_at: number;
  label: string;                 // user-supplied or auto from space_type
  thumbnail_uri: string | null;  // local image URI used for the scan
  assessment: SpaceAssessment;
}

export type SpaceScanResult =
  | { kind: 'ok'; assessment: SpaceAssessment }
  | { kind: 'too_large' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;
const STORAGE_KEY = '@smartplay/space_configs';

class SpaceScanController {
  private currentRequest: AbortController | null = null;

  beginNew(): AbortController {
    if (this.currentRequest) {
      this.currentRequest.abort();
      try { Sentry.addBreadcrumb({ category: 'space_scan', level: 'info', message: 'cancel_replace' }); } catch {}
    }
    const ctrl = new AbortController();
    this.currentRequest = ctrl;
    return ctrl;
  }

  end(ctrl: AbortController | null): void {
    if (ctrl && this.currentRequest === ctrl) this.currentRequest = null;
  }
}

const controller = new SpaceScanController();

export async function scanSpace(
  imageBase64: string,
  imageMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<SpaceScanResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const myController = controller.beginNew();

  try {
    const timeoutId = setTimeout(() => myController.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${apiUrl}/api/space-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: imageBase64, image_media_type: imageMediaType }),
      signal: myController.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };

    const data = (await res.json()) as SpaceAssessment;
    return { kind: 'ok', assessment: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  } finally {
    controller.end(myController);
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────

export async function listSpaceConfigurations(): Promise<SpaceConfiguration[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SpaceConfiguration[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getMostRecentSpaceConfiguration(): Promise<SpaceConfiguration | null> {
  const all = await listSpaceConfigurations();
  if (all.length === 0) return null;
  return all.reduce((acc, c) => (c.saved_at > acc.saved_at ? c : acc), all[0]);
}

export async function saveSpaceConfiguration(input: {
  label: string;
  thumbnail_uri: string | null;
  assessment: SpaceAssessment;
}): Promise<{ kind: 'ok'; config: SpaceConfiguration } | { kind: 'error'; message: string }> {
  const config: SpaceConfiguration = {
    id: `${Date.now()}_space`,
    saved_at: Date.now(),
    label: input.label || labelForType(input.assessment.space_type),
    thumbnail_uri: input.thumbnail_uri,
    assessment: input.assessment,
  };
  try {
    const all = await listSpaceConfigurations();
    // Keep last 10 to bound storage.
    const next = [...all, config].slice(-10);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { kind: 'ok', config };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[spaceAssessment] save failed:', msg);
    return { kind: 'error', message: msg };
  }
}

export async function deleteSpaceConfiguration(id: string): Promise<boolean> {
  try {
    const all = await listSpaceConfigurations();
    const next = all.filter(c => c.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    console.log('[spaceAssessment] delete failed:', e);
    return false;
  }
}

function labelForType(t: SpaceType): string {
  switch (t) {
    case 'cage':      return 'My Cage';
    case 'range_bay': return 'Range Bay';
    case 'backyard':  return 'Backyard';
    case 'basement':  return 'Basement';
    case 'garage':    return 'Garage';
    default:          return 'My Practice Space';
  }
}
