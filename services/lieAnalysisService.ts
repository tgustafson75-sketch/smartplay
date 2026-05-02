import type { LieAnalysisContext } from './lieAnalysisContext';

/**
 * Phase H — client-side fetcher for the lie-analysis endpoint.
 *
 * Returns the full analysis payload on success, or a typed error result the
 * UI can render directly (no-network → "save for later" flow; failures →
 * "try again" affordance). Never throws — surfaces all failure modes as
 * structured results.
 */

export type LieAnalysis = {
  situation_description: string;
  tactical_advice: string;
  recommended_club: string | null;
  alternative_play: string | null;
  confidence_level: 'high' | 'medium' | 'low';
  conservative_call: boolean;
  follow_up_question?: string | null;
};

export type LieAnalysisResult =
  | { kind: 'ok'; analysis: LieAnalysis }
  | { kind: 'no_network' }
  | { kind: 'too_large' }
  | { kind: 'low_quality'; follow_up: string }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;

export async function analyzeLie(
  imageBase64: string,
  context: LieAnalysisContext,
  imageMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<LieAnalysisResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  try {
    const res = await fetch(`${apiUrl}/api/lie-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: imageBase64,
        image_media_type: imageMediaType,
        context,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      return { kind: 'error', message: `Server returned ${res.status}` };
    }

    const data = (await res.json()) as LieAnalysis;

    // Low-confidence + follow_up_question = the model couldn't read the
    // image. Surface as low_quality so the UI prompts a retry rather than
    // speaking iffy advice aloud.
    if (data.confidence_level === 'low' && data.follow_up_question) {
      return { kind: 'low_quality', follow_up: data.follow_up_question };
    }

    return { kind: 'ok', analysis: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) {
      return { kind: 'no_network' };
    }
    return { kind: 'error', message: msg };
  }
}
