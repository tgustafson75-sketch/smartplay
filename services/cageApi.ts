/**
 * Cage Drill — typed API client.
 *
 * Two endpoints (backend lands in Prompt 2):
 *   POST /api/cage/check-bullseye  — image base64 → { detected, location, canvas_visible }
 *   POST /api/cage/analyze         — multipart video → opaque features.json
 *
 * Mock mode is gated by EXPO_PUBLIC_CAGE_MOCK_MODE=true and returns
 * hardcoded successful responses after a 1.5s delay so the on-device
 * state machine can be exercised end-to-end before the backend exists.
 */

const MOCK_MODE = process.env.EXPO_PUBLIC_CAGE_MOCK_MODE === 'true';
const KEVIN_MOCK_MODE = process.env.EXPO_PUBLIC_CAGE_KEVIN_MOCK_MODE === 'true';
const MOCK_LATENCY_MS = 1500;
const KEVIN_MOCK_LATENCY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export type CheckBullseyeResponse = {
  detected: boolean;
  location: [number, number] | null;
  canvas_visible: boolean;
};

export type CageAnalyzeResponse = {
  /** Opaque to the screen for now — rendered as formatted JSON. The mock
   *  shape here is a placeholder; Prompt 2 will define the real schema. */
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

// ─── /api/cage/check-bullseye ────────────────────────────────────────────────

export async function checkBullseye(imageBase64: string): Promise<ApiResult<CheckBullseyeResponse>> {
  if (MOCK_MODE) {
    await delay(MOCK_LATENCY_MS);
    return {
      kind: 'ok',
      data: { detected: true, location: [534, 887], canvas_visible: true },
    };
  }

  try {
    const res = await fetch(`${apiUrl()}/api/cage/check-bullseye`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };
    const data = (await res.json()) as CheckBullseyeResponse;
    return { kind: 'ok', data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}

// ─── /api/cage/analyze ───────────────────────────────────────────────────────

export async function analyzeCageVideo(videoUri: string): Promise<ApiResult<CageAnalyzeResponse>> {
  if (MOCK_MODE) {
    await delay(MOCK_LATENCY_MS);
    return {
      kind: 'ok',
      data: {
        strike_count: 5,
        strike_times: [1.42, 3.81, 5.97, 8.14, 10.62],
        bullseye_offsets: [
          { x: -2,  y: 1,   distance_in: 2.2 },
          { x: 4,   y: -3,  distance_in: 5.0 },
          { x: 0,   y: 0,   distance_in: 0.0 },
          { x: 6,   y: 2,   distance_in: 6.3 },
          { x: -1,  y: -1,  distance_in: 1.4 },
        ],
        notes: [
          'Three of five strikes within 5 inches of center.',
          'Slight rightward bias on shots 2 and 4.',
          'Shot 3 was a direct hit.',
        ],
      },
    };
  }

  try {
    const formData = new FormData();
    formData.append('video', {
      uri: videoUri,
      type: 'video/mp4',
      name: 'cage_drill.mp4',
    } as unknown as Blob);

    const res = await fetch(`${apiUrl()}/api/cage/analyze`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };
    const data = (await res.json()) as CageAnalyzeResponse;
    return { kind: 'ok', data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
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
export async function coachReview(features: CageAnalyzeResponse, voiceGender: 'male' | 'female' = 'male'): Promise<ApiResult<CoachReviewResponse>> {
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
      body: JSON.stringify({ features, voiceGender }),
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
