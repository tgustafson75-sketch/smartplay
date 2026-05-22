/**
 * Cage Mode — typed API client.
 *
 * 2026-05-21 — Fix G (Option A): the originally-planned /api/cage/check-
 * bullseye and /api/cage/analyze endpoints ("Prompt 2") never shipped —
 * vercel.json has no route for either path and no `api/cage/` directory
 * exists, so every request 404'd in production. Both client functions
 * and the CheckBullseyeResponse type are removed. The CageAnalyzeResponse
 * SHAPE is kept as the input contract for /api/kevin/coach (which IS
 * deployed); cage-mode.tsx now BUILDS that payload locally from real
 * acoustic-impact + ball-speed signals instead of pulling fabricated
 * features from a server response that never existed.
 *
 * One endpoint remains real and deployed:
 *   POST /api/kevin/coach — features payload → in-character coach response
 *                           (rewritten to api/cage-coach.ts in vercel.json)
 */

import type { Persona } from '../lib/persona';

const MOCK_MODE = process.env.EXPO_PUBLIC_CAGE_MOCK_MODE === 'true';
const KEVIN_MOCK_MODE = process.env.EXPO_PUBLIC_CAGE_KEVIN_MOCK_MODE === 'true';
const KEVIN_MOCK_LATENCY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export type CageAnalyzeResponse = {
  /** Features payload passed into the Kevin cage-review coach. Post-G
   *  these fields are populated client-side from real signals (acoustic
   *  impact + ball speed). bullseye_offsets stays empty — no CV scoring
   *  shipped, and we don't fake one. */
  strike_count: number;
  strike_times: number[];
  bullseye_offsets: { x: number; y: number; distance_in: number }[];
  notes: string[];
};

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

async function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export const isMockMode = (): boolean => MOCK_MODE;
export const isKevinMockMode = (): boolean => KEVIN_MOCK_MODE;

// ─── /api/kevin/coach ────────────────────────────────────────────────────────

export type CoachReviewResponse = {
  kevin_response: string;
  confidence: 'high' | 'medium' | 'low';
};

/**
 * Pass features.json to Kevin's cage_swing_review tool. Returns the
 * in-character 1-2 sentence response. With EXPO_PUBLIC_CAGE_KEVIN_MOCK_MODE=true
 * a hardcoded response comes back after 1s so the cage screen can be
 * exercised without burning Anthropic tokens.
 */
export async function coachReview(
  features: CageAnalyzeResponse,
  voiceGender: 'male' | 'female' = 'male',
  // 2026-05-21 — Fix Q: pass the active persona so cage swing reviews
  // route to the user's selected caddie (Tank on the cage by default,
  // or whoever the user has set globally) instead of defaulting to
  // Kevin via the server's voiceGender→Kevin fallback.
  persona?: Persona,
): Promise<ApiResult<CoachReviewResponse>> {
  if (KEVIN_MOCK_MODE) {
    await delay(KEVIN_MOCK_LATENCY_MS);
    return {
      kind: 'ok',
      data: {
        kevin_response:
          'Pure. That one came off the face flush — barely moved off the bullseye.',
        confidence: 'high',
      },
    };
  }

  try {
    const res = await fetch(`${apiUrl()}/api/kevin/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features, voiceGender, persona }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };
    const data = (await res.json()) as CoachReviewResponse;
    return { kind: 'ok', data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}
