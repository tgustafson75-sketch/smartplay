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
import Anthropic from '@anthropic-ai/sdk';
import { KEVIN_CHARACTER_SPEC } from '../constants/kevinCharacter';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL_NAME = 'cage_swing_review';

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Reviews a single cage practice swing using extracted acoustic and visual features. Returns a 1-2 sentence coaching response in Kevin\'s voice.',
  input_schema: {
    type: 'object',
    properties: {
      kevin_response: {
        type: 'string',
        description: '1-2 sentences in Kevin\'s established voice. Companion register, not coach.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'How confident Kevin is in the response given the feature quality (capture issues lower this).',
      },
    },
    required: ['kevin_response', 'confidence'],
  },
};

const CAGE_SYSTEM_PROMPT = `${KEVIN_CHARACTER_SPEC}

You are Kevin, the user's golf companion. You just watched a single
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

You MUST respond by calling the cage_swing_review tool with kevin_response
and confidence. Do not respond with any other content.`;

interface CageCoachResponse {
  kevin_response: string;
  confidence: 'high' | 'medium' | 'low';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { features?: unknown };
    const features = body?.features;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'features (object) required' });
    }

    console.log('[cage-coach] features received');

    const userMessage =
      `Here is the features.json from this swing. Use the priority rules ` +
      `and respond by calling cage_swing_review.\n\n` +
      JSON.stringify(features, null, 2);

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      temperature: 0.6,
      system: CAGE_SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userMessage }],
    });

    // The forced tool_choice guarantees a tool_use block in the response.
    const toolBlock = result.content.find(b => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      console.error('[cage-coach] no tool_use block in response');
      return res.status(502).json({ error: 'Model did not invoke the tool' });
    }
    const input = toolBlock.input as Partial<CageCoachResponse>;
    if (typeof input.kevin_response !== 'string' || !input.kevin_response.trim()) {
      console.error('[cage-coach] tool input missing kevin_response');
      return res.status(502).json({ error: 'Tool input missing kevin_response' });
    }
    const confidence: CageCoachResponse['confidence'] =
      input.confidence === 'high' || input.confidence === 'low' ? input.confidence : 'medium';

    const response: CageCoachResponse = {
      kevin_response: input.kevin_response.trim(),
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
