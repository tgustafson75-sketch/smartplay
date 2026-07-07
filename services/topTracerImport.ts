/**
 * TopTracer range session import — client service.
 *
 * Mirrors the roundImport.ts pattern (pick → resize → POST → typed result)
 * but targets /api/toptracer-parse and maps the response into clubStatsStore.
 *
 * The flat-carry number from TopTracer is the canonical manual carry distance
 * for Kevin's recommendations. Total (with roll) is stored for display only.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl } from './apiBase';
import { type ClubName, CLUB_ORDER } from '../store/clubStatsStore';

// 2026-07-06 (audit) — read at fetch time, not module load: a module-scope
// snapshot would defeat the mid-session dual-host failover (see apiBase.ts).
const apiUrl = (): string => getApiBaseUrl();

export interface TopTracerClubRow {
  display_name: string;
  club_id: ClubName | null;
  flat_carry_yds: number | null;
  total_yds: number | null;
  ball_speed_mph: number | null;
  launch_deg: number | null;
  height_ft: number | null;
  hang_time_sec: number | null;
  landing_deg: number | null;
  curve_yds: number | null;
}

export interface TopTracerParseResult {
  view_type: 'table' | 'radar' | 'unknown';
  consistency_pct: number | null;
  clubs: TopTracerClubRow[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export type TopTracerPickResult =
  | { kind: 'ok'; uri: string }
  | { kind: 'cancelled' }
  | { kind: 'permission_denied' }
  | { kind: 'error'; message: string };

export type TopTracerParseOutcome =
  | { kind: 'ok'; result: TopTracerParseResult }
  | { kind: 'not_toptracer' }
  | { kind: 'no_clubs' }
  | { kind: 'too_large' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

export async function pickForTopTracer(): Promise<TopTracerPickResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { kind: 'permission_denied' };

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (picked.canceled || picked.assets.length === 0) return { kind: 'cancelled' };
    return { kind: 'ok', uri: picked.assets[0].uri };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'pick failed' };
  }
}

export async function parseTopTracerScreenshot(uri: string): Promise<TopTracerParseOutcome> {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    const b64 = manipulated.base64;
    if (!b64) return { kind: 'error', message: 'Could not encode screenshot.' };

    const res = await fetch(`${apiUrl()}/api/toptracer-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: b64, media_type: 'image/jpeg' }),
      // 2026-07-06 (audit) — bound the wait (~1.5× the route's 30s maxDuration)
      // so a dead connection surfaces as no_network instead of hanging forever.
      signal: AbortSignal.timeout(45_000),
    });

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      return { kind: 'error', message: typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}` };
    }

    const data = await res.json() as TopTracerParseResult;

    if (data.view_type === 'unknown') return { kind: 'not_toptracer' };

    const mappableClubs = data.clubs.filter(c => c.club_id !== null && c.flat_carry_yds !== null);
    if (mappableClubs.length === 0 && data.clubs.length === 0) return { kind: 'no_clubs' };

    return { kind: 'ok', result: data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}

/** Sort parsed rows into CLUB_ORDER sequence for display. */
export function sortedClubs(rows: TopTracerClubRow[]): TopTracerClubRow[] {
  return [...rows].sort((a, b) => {
    const ai = a.club_id ? CLUB_ORDER.indexOf(a.club_id) : 999;
    const bi = b.club_id ? CLUB_ORDER.indexOf(b.club_id) : 999;
    return ai - bi;
  });
}
