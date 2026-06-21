/**
 * Kevin's cage_swing_review tool — features.json → in-character coaching response.
 *
 * Routed at /api/kevin/coach (see vercel.json).
 *
 * This endpoint is invoked by the cage capture flow after /api/cage/analyze
 * returns features.json. It is NOT user-callable — voice / chat surfaces do
 * not expose this tool. Only the cage screen's typed client (services/cageApi.ts)
 * hits this URL.
 *
 * Implementation: Sonnet is given the cage_swing_review tool with a strict
 * input schema and is forced to invoke it via tool_choice. The tool's input
 * IS the response payload — Sonnet generates kevin_response + confidence
 * inline, and we extract from the first tool_use block in the message.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';
import { completeJSON, providerFromHeader } from './_aiProvider';

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildCageSystemPrompt = (g: Persona | VoiceGender) => `${getCharacterSpec(g)}

You are ${getCaddieName(g)}, the user's golf companion. You just watched a single
practice swing in their backyard cage. You will receive structured features
extracted from the swing's audio and video.

Respond in 1-2 sentences, in your established voice. Be specific — cite
one or two concrete numbers from the features when meaningful. Do not
list everything you see. Pick what matters most.

Priority order for what to comment on:
  1. If detection_confidence is "low" or warnings include "user_blocking_canvas",
     acknowledge the capture issue gently and suggest a re-take.
  2. If impact_radius_inches < 2: praise the contact, mention the spectral
     centroid only if it's notably low (<2200 Hz = flush) or high (>3200 Hz = thin).
  3. If impact_radius_inches >= 2 and < 6: note direction (left/right, high/low)
     in plain terms.
  4. If impact_radius_inches >= 6: note the dispersion neutrally, not critically.
  5. Inter-strike tempo (gaps between strikes) only if extreme (<8s = rushed,
     >25s = breaking rhythm).

Never use the words "spectral", "centroid", "decay ratio", "sustain".
Translate to: "clean contact", "flush", "thin", "fat", "off the toe/heel".

Do not give swing instruction. You are a companion, not a coach. Comment
on what just happened. Save instruction for when the user explicitly asks.

Respond ONLY with valid JSON — no preamble, no code fences:
{
  "kevin_response": "<1-2 sentences in your voice>",
  "confidence": "high" | "medium" | "low"
}`;

interface CageCoachResponse {
  kevin_response: string;
  confidence: 'high' | 'medium' | 'low';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      features?: unknown;
      voiceGender?: VoiceGender;
      persona?: string;
    };
    const features = body?.features;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'features (object) required' });
    }
    // Audit 101 / B4 — prefer persona; fall back to voiceGender for legacy.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? body.persona : (body.voiceGender ?? 'male')) as Persona | VoiceGender;

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    console.log('[cage-coach] features received');

    const userMessage =
      `Here is the features.json from this swing. Use the priority rules and respond with JSON.\n\n` +
      JSON.stringify(features, null, 2);

    const rawText = await completeJSON(provider, 'quality', buildCageSystemPrompt(personaInput), [{ role: 'user', content: userMessage }], { maxTokens: 400, temperature: 0.6 });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(rawText); } catch { /* use empty fallback */ }

    const kevinResponse = typeof parsed.kevin_response === 'string' ? parsed.kevin_response.trim() : '';
    if (!kevinResponse) {
      console.error('[cage-coach] missing kevin_response in JSON');
      return res.status(502).json({ error: 'Model returned no kevin_response' });
    }
    const VALID_CONFIDENCE = ['high', 'medium', 'low'] as const;
    const confidence: CageCoachResponse['confidence'] =
      (VALID_CONFIDENCE as readonly string[]).includes(parsed.confidence as string)
        ? (parsed.confidence as CageCoachResponse['confidence'])
        : 'medium';

    const response: CageCoachResponse = {
      kevin_response: kevinResponse,
      confidence,
    };
    console.log('[cage-coach] response:', response);
    return res.status(200).json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[cage-coach] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
