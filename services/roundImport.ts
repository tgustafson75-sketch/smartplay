/**
 * 2026-05-26 — Fix AA: Round screenshot import client service.
 *
 * Tim's beta-blocker roadmap: import past rounds from screenshots
 * (Golfshot, 18Birdies, GHIN, paper scorecard photos, etc.) so the
 * player's SmartPlay statistics + handicap calc benefit from data
 * they've accumulated outside the app.
 *
 * Flow:
 *   1. pickFromLibrary() — expo-image-picker, resize to 1280px
 *   2. parseRoundScreenshot() — POST base64 → /api/round-import →
 *      structured RoundImportResult (Gemini-first)
 *   3. confirmAndPersist() — caller-controlled (UI confirmation step)
 *      → useRoundStore.addImportedRound()
 *
 * Defensive: every step returns a discriminated-union result so the
 * caller can surface specific error states (no photo, low confidence,
 * provider failure, etc.) without re-implementing error parsing.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

export type ImportedHole = {
  hole: number;
  par: number | null;
  score: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
  gir: boolean | null;
};

export interface RoundImportResult {
  course_name: string | null;
  played_date: string | null;
  tee_color: string | null;
  holes_played: number | null;
  total_score: number | null;
  total_par: number | null;
  score_vs_par: number | null;
  holes: ImportedHole[];
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  _debug?: {
    provider?: 'gemini' | 'openai' | 'anthropic';
    fallback_reason?: unknown;
  };
}

export type PickResult =
  | { kind: 'ok'; uri: string }
  | { kind: 'cancelled' }
  | { kind: 'permission_denied' }
  | { kind: 'error'; message: string };

export type ParseResult =
  | { kind: 'ok'; result: RoundImportResult }
  | { kind: 'too_large' }
  | { kind: 'not_a_scorecard' }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

/**
 * Pick a screenshot from the photo library. Camera is intentionally
 * NOT offered — scorecards live in the player's existing photo roll,
 * not in a fresh capture.
 */
export async function pickFromLibrary(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { kind: 'permission_denied' };

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return { kind: 'cancelled' };
    }
    return { kind: 'ok', uri: picked.assets[0].uri };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : 'pick failed' };
  }
}

/**
 * Resize the screenshot to 1280px on long edge + POST to /api/round-import.
 * Returns the parsed RoundImportResult OR a typed error.
 */
export async function parseRoundScreenshot(uri: string): Promise<ParseResult> {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1280 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    const b64 = manipulated.base64;
    if (!b64) {
      return { kind: 'error', message: 'Could not encode screenshot.' };
    }

    const res = await fetch(`${apiUrl}/api/round-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: b64,
        image_media_type: 'image/jpeg',
      }),
    });

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { kind: 'error', message: typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}` };
    }

    const data = (await res.json()) as RoundImportResult;

    // The endpoint returns the same shape with empty holes[] +
    // "this doesn't look like a scorecard" warning when the image
    // isn't a scorecard. Surface that as a distinct kind so the UI
    // can show a useful retry message.
    const notAScorecard =
      data.holes.length === 0 &&
      (data.warnings ?? []).some(w => /doesn't look like a scorecard|not a (?:golf )?scorecard/i.test(w));
    if (notAScorecard) return { kind: 'not_a_scorecard' };

    return { kind: 'ok', result: data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/network|abort|timeout|fetch/i.test(msg)) {
      return { kind: 'no_network' };
    }
    return { kind: 'error', message: msg };
  }
}

/**
 * Translate the API result shape into the input that
 * roundStore.addImportedRound expects. Decoupled from the store
 * itself so tests can verify the mapping without standing the store
 * up. Returns null when there's nothing worth persisting (zero
 * scored holes).
 */
export function buildPersistInput(result: RoundImportResult): {
  courseName: string | null;
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  totalScore: number;
  scoreVsPar: number;
  nineHoleMode: boolean;
  scores: Record<number, number>;
  putts: Record<number, number>;
} | null {
  const scoredHoles = result.holes.filter(h => typeof h.score === 'number' && h.score > 0);
  if (scoredHoles.length === 0) return null;

  const scores: Record<number, number> = {};
  const putts: Record<number, number> = {};
  for (const h of scoredHoles) {
    if (typeof h.score === 'number') scores[h.hole] = h.score;
    if (typeof h.putts === 'number') putts[h.hole] = h.putts;
  }

  const totalScore = result.total_score
    ?? scoredHoles.reduce((acc, h) => acc + (h.score ?? 0), 0);

  // Derive scoreVsPar when API didn't supply one but we have all pars.
  const scoreVsPar = (() => {
    if (typeof result.score_vs_par === 'number') return result.score_vs_par;
    const allParred = scoredHoles.every(h => typeof h.par === 'number');
    if (!allParred) return 0;
    return scoredHoles.reduce((acc, h) => acc + ((h.score ?? 0) - (h.par ?? 0)), 0);
  })();

  const ts = (() => {
    if (result.played_date) {
      const t = Date.parse(result.played_date);
      if (Number.isFinite(t)) return t;
    }
    // Unknown date → bias to "yesterday at noon" so the record sorts
    // before today's live rounds but doesn't pretend a specific date.
    return Date.now() - 24 * 60 * 60 * 1000;
  })();

  return {
    courseName: result.course_name,
    startedAt: ts,
    endedAt: ts + 4 * 60 * 60 * 1000, // assume ~4h round; tightens analytics that read durations
    holesPlayed: scoredHoles.length,
    totalScore,
    scoreVsPar,
    nineHoleMode: scoredHoles.length === 9,
    scores,
    putts,
  };
}
