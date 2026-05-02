/**
 * Phase L — CV scoring client wrapper.
 *
 * Today: cloud-based via Anthropic vision (option a per spec). Single photo
 * → proximity bucket. Future swap to local CV model is a single-file body
 * change in this file.
 *
 * Wired into Closest-to-Pin in v1; Skills / Sim Round / Scramble deferred
 * until each gets a targeted scoring prompt + UI.
 */

export type CVChallenge = 'ctp' | 'skills' | 'sim' | 'scramble';

export type CVScoring = {
  challenge: CVChallenge;
  proximity_feet: number | null;
  proximity_bucket: 'inside_3' | 'inside_6' | 'inside_10' | 'inside_20' | 'outside_20' | 'missed_green' | null;
  confidence: 'high' | 'medium' | 'low';
  observation: string;
  follow_up_question?: string | null;
};

export type CVScoringResult =
  | { kind: 'ok'; scoring: CVScoring }
  | { kind: 'low_quality'; follow_up: string }
  | { kind: 'no_network' }
  | { kind: 'error'; message: string };

export async function scoreCTPShot(
  imageBase64: string,
  targetDistanceYards: number | null,
  imageMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<CVScoringResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  try {
    const res = await fetch(`${apiUrl}/api/cv-scoring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: imageBase64,
        image_media_type: imageMediaType,
        challenge: 'ctp',
        target_distance_yards: targetDistanceYards,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { kind: 'error', message: `Server returned ${res.status}` };
    const data = (await res.json()) as CVScoring;
    if (data.confidence === 'low' && data.follow_up_question) {
      return { kind: 'low_quality', follow_up: data.follow_up_question };
    }
    return { kind: 'ok', scoring: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) return { kind: 'no_network' };
    return { kind: 'error', message: msg };
  }
}

/** Map proximity_bucket → the existing CTP RESULT_OPTIONS feet value. */
export function bucketToFeet(bucket: CVScoring['proximity_bucket']): number {
  switch (bucket) {
    case 'inside_3': return 3;
    case 'inside_6': return 6;
    case 'inside_10': return 10;
    case 'inside_20': return 20;
    case 'outside_20': return 30;
    case 'missed_green': return 99;
    default: return 99;
  }
}
