import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeVision, providerFromHeader } from './_aiProvider';

/**
 * Phase L — CV scoring endpoint.
 *
 * Cloud-based via Anthropic vision (same architectural pattern as Phase H
 * lie-analysis and Phase K swing-analysis). Accepts a single base64 photo
 * of an Arena challenge result (today: Closest-to-Pin) plus the challenge
 * type and known reference (target distance) and returns an estimated
 * proximity-to-target measurement in feet.
 *
 * Conservative-by-design: when the photo doesn't clearly show both ball and
 * target, returns confidence: 'low' with a follow-up question instead of
 * guessing. Mike's manual-bucket fallback stays in place either way.
 *
 * Today wired only into CTP (Closest to Pin). Skills, Sim Round, and
 * Scramble challenges are deferred — each has a different scoring shape
 * (multi-target / multi-shot / partner-format) that would benefit from its
 * own targeted prompt + UI.
 */

type CVChallenge = 'ctp' | 'skills' | 'sim' | 'scramble';

type CVScoringResponse = {
  challenge: CVChallenge;
  proximity_feet: number | null;     // estimated distance ball → pin
  proximity_bucket: 'inside_3' | 'inside_6' | 'inside_10' | 'inside_20' | 'outside_20' | 'missed_green' | null;
  confidence: 'high' | 'medium' | 'low';
  observation: string;                // one sentence describing what's visible
  follow_up_question?: string | null;
};

const CTP_SYSTEM_PROMPT = `You are scoring a Closest-to-Pin shot from a single photo. The player took the photo on the green showing their ball position relative to the pin (flagstick).

Your job: estimate the distance from the ball to the pin in feet, and bucket it into one of the standard CTP categories. Use the flagstick as your scale reference — a regulation flagstick is ~7 feet (84 inches) tall.

Buckets:
- inside_3: ball is within 3 feet of the pin
- inside_6: 3 to 6 feet
- inside_10: 6 to 10 feet
- inside_20: 10 to 20 feet
- outside_20: more than 20 feet but on the green
- missed_green: ball not on the green

Output ONLY a JSON object:
{
  "challenge": "ctp",
  "proximity_feet": <integer estimate, or null if you can't see both ball and pin>,
  "proximity_bucket": "<one of the buckets above, or null if low confidence>",
  "confidence": "high" | "medium" | "low",
  "observation": "<one short sentence — what's visible in the photo>",
  "follow_up_question": "<short retake suggestion ONLY when confidence: low; else null>"
}

Rules:
- BE CONSERVATIVE. The user has manual-bucket fallback if this fails. Wrong "Inside 3" calls when the ball is 12 feet away damages trust faster than declining.
- If you can see only the ball OR only the pin (not both), confidence: 'low' + follow_up_question asking for a wider photo.
- The flagstick is your scale anchor. If it's not visible, confidence: 'low'.
- Output ONLY valid JSON. No code fences, no preamble.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const image_b64 = String(body.image_b64 ?? '').trim();
    const image_media_type = String(body.image_media_type ?? 'image/jpeg');
    const challenge = String(body.challenge ?? 'ctp') as CVChallenge;
    const target_distance_yards = typeof body.target_distance_yards === 'number' ? body.target_distance_yards : null;

    if (!image_b64) {
      return res.status(400).json({ error: 'image_b64 required' });
    }
    if (image_b64.length > 7_000_000) {
      return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });
    }
    if (challenge !== 'ctp') {
      return res.status(400).json({
        error: `CV scoring for '${challenge}' is not yet implemented. CTP only in Phase L v1.`,
      });
    }

    const userText = target_distance_yards != null
      ? `Target was ${target_distance_yards} yards from tee. Estimate ball-to-pin proximity from the photo.`
      : 'Estimate ball-to-pin proximity from the photo.';

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const text = await completeVision(provider, 'quality', CTP_SYSTEM_PROMPT, userText,
      [{ b64: image_b64, mimeType: image_media_type }],
      { maxTokens: 400, temperature: 0.2, forceJSON: true },
    );
    if (!text) return res.status(502).json({ error: 'Empty model response' });

    let parsed: CVScoringResponse;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as CVScoringResponse;
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    parsed.challenge = 'ctp';
    if (!['high', 'medium', 'low'].includes(parsed.confidence)) parsed.confidence = 'low';
    if (parsed.proximity_feet != null && (typeof parsed.proximity_feet !== 'number' || parsed.proximity_feet < 0)) {
      parsed.proximity_feet = null;
    }
    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[cv-scoring] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
