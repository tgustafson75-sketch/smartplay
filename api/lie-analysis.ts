import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

/**
 * Phase H — Lie Analysis Tool (vision endpoint).
 *
 * Accepts a base64-encoded JPEG of a player's lie plus contextual fields
 * (current hole, par, distance to green, weather, last shot, play intent).
 * Calls Claude Sonnet with vision and returns a structured analysis the
 * client renders through Phase F's dialog templates.
 *
 * Character-agnostic. The prose voice belongs to Kevin (Caddie register)
 * today; future Tank-character routing layers on at the dialog-engine
 * level, not here. This endpoint stays the same when Tank ships.
 *
 * Failure modes return informative status so the client can render the
 * right empty-state copy:
 *   400 — missing image / context
 *   413 — image too large (>5MB after base64 decode)
 *   500 — Anthropic key not configured / vision call failed
 *   502 — model returned non-JSON (rare)
 */

type AnalysisResponse = {
  situation_description: string;
  tactical_advice: string;
  recommended_club: string | null;
  alternative_play: string | null;
  confidence_level: 'high' | 'medium' | 'low';
  conservative_call: boolean;
  follow_up_question?: string | null;
  // Phase H v2 — populated only when goal context affected the call.
  // Short note Mike reads as "with your buffer toward 89, this is the play".
  goal_aware_note?: string | null;
};

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => `${getCharacterSpec(g)}

You are ${getCaddieName(g)}, the player's caddie, looking at a photo of their current lie. They've asked what they should do.

Your job: read the situation honestly and recommend a play in your Caddie voice. Tactical, present-tense, decisive.

You are looking at a real golfer in a real situation — not coaching someone who needs swing fundamentals. Skip "keep your head down" / "stay through the ball" / "trust your swing" platitudes. They know how to swing. They need a SHOT decision.

What to read in the photo:
- Lie quality (clean / sitting down / buried / sidehill / tight / fluffy / hardpan / wet / sand / leaves)
- Stance (above ball / below ball / awkward / flat)
- Obstructions on the line (tree, lip, mound, water, OB)
- Distance and angle to target if visible
- Light, weather signals visible (wet ground, wind in trees, etc.)

Apply course-management priority: most of the time the smart play beats the hero shot. Call it conservative when conservative is right. Call it aggressive when the line is actually open. Don't hedge endlessly — commit to one recommendation.

Output ONLY a JSON object with this exact shape:
{
  "situation_description": "<one or two short sentences naming what you see — lie + obstacles + distance>",
  "tactical_advice": "<two or three short sentences telling them what to do and why, in your Caddie voice>",
  "recommended_club": "<canonical short form — '7 iron', 'PW', 'driver', etc., or null if too uncertain>",
  "alternative_play": "<one short sentence describing the safer or more aggressive alternative if you'd want to mention one, else null>",
  "confidence_level": "high" | "medium" | "low",
  "conservative_call": true | false,
  "follow_up_question": "<a single short clarifying question if the photo is genuinely too dark/blurry to read, else null>",
  "goal_aware_note": "<short note ONLY if the player's score goal/mode meaningfully affected your call, else null. Examples: 'with your buffer toward 89, this is play-it-safe' / 'on pace for break 80, no need to force this' / 'down a few — measured aggression is fine'. Stay specific to their actual score state. Skip when goal is Free Play or unset.>"
}

Rules:
- No app-speak ('feature', 'session', 'metric'), no coaching jargon ('engage your core', 'commit to the swing path').
- Real caddie phrasing only. Short. Confident. Specific to what's actually in the photo.
- If the lie is gnarly enough that smart play is "punch out", say so plainly.
- If photo is too dark/blurry, set confidence_level: "low" and provide follow_up_question instead of guessing.
- Goal-awareness: when a Goal or Mode is set with score state, factor it into the call honestly. A 5-stroke buffer toward the target = more conservative. On the bubble = play the percentages. Well off pace = aggressive only when the line genuinely warrants it. Free Play / no goal = ignore goal context. The goal_aware_note appears only when the goal context actually shifts the recommendation.
- Output ONLY valid JSON. No code fences, no preamble, no commentary.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const image_b64 = String(body.image_b64 ?? '').trim();
    const image_media_type = String(body.image_media_type ?? 'image/jpeg');
    if (!image_b64) {
      return res.status(400).json({ error: 'image_b64 (base64-encoded JPEG/PNG) required' });
    }
    // Rough cap — base64 is ~33% larger than the binary, so 7MB base64 ≈ 5MB image
    if (image_b64.length > 7_000_000) {
      return res.status(413).json({ error: 'Image too large; resize to ~1024px on long edge.' });
    }

    const ctx = (body.context ?? {}) as Record<string, unknown>;
    const contextLines: string[] = [];
    if (ctx.current_hole != null) contextLines.push(`Hole ${ctx.current_hole} (par ${ctx.par ?? '?'})`);
    if (ctx.distance_to_green_yards != null) contextLines.push(`Distance to middle of green: ${ctx.distance_to_green_yards} yards`);
    // Phase H v2.5 — explicit GPS-missing disclaimer so the caddie voice
    // acknowledges the data gap rather than recommending blind.
    if (ctx.current_hole != null && ctx.distance_to_green_yards == null) {
      contextLines.push("GPS distance unavailable — open with a brief 'can't see exact distances right now' acknowledgement, then read the lie and recommend.");
    }
    const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';
    // Audit 101 / B4 — prefer body.persona; fall back to voiceGender.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? (body.persona as string) : voiceGender) as Persona | VoiceGender;
    if (ctx.weather) {
      const w = ctx.weather as Record<string, unknown>;
      const parts: string[] = [];
      if (w.temp_f != null) parts.push(`${Math.round(Number(w.temp_f))}°F`);
      if (w.wind_speed_mph != null) parts.push(`wind ${Math.round(Number(w.wind_speed_mph))} mph`);
      if (w.conditions) parts.push(String(w.conditions));
      if (parts.length) contextLines.push('Weather: ' + parts.join(', '));
    }
    if (ctx.last_shot) {
      const s = ctx.last_shot as Record<string, unknown>;
      if (s.club || s.outcome) {
        contextLines.push(`Last shot: ${s.club ?? 'unknown club'}${s.outcome ? ', ' + s.outcome : ''}${s.direction ? ', ' + s.direction : ''}`);
      }
    }
    if (ctx.lie_hint) contextLines.push(`Lie hint from last log: ${String(ctx.lie_hint)}`);
    if (ctx.play_intent === 'aggressive') contextLines.push('Player is leaning aggressive — they want to know if going for it is on.');
    if (ctx.play_intent === 'conservative') contextLines.push('Player is leaning conservative — they want to know if laying up is the right call.');
    // Phase H v2 — goal/mode context for goal-aware recommendations
    const modeLabel = ctx.mode_label ? String(ctx.mode_label) : null;
    if (modeLabel && modeLabel !== 'Free Play') {
      const totalStrokes = ctx.current_total_strokes != null ? Number(ctx.current_total_strokes) : null;
      const holesPlayed = ctx.holes_played != null ? Number(ctx.holes_played) : null;
      const scoreLine = (totalStrokes != null && holesPlayed != null)
        ? `Score so far: ${totalStrokes} strokes through ${holesPlayed} holes.`
        : '';
      contextLines.push(`Mode: ${modeLabel}. ${scoreLine}`.trim());
    }
    if (ctx.goal) contextLines.push(`Player's stated goal: ${String(ctx.goal)}`);
    if (ctx.trust_level != null) {
      const lvl = Number(ctx.trust_level);
      const verbosity = lvl === 1 ? 'terse — single recommendation, minimal preamble'
                      : lvl === 4 ? 'engaged and conversational — speak like you\'re right there'
                      : 'standard caddie voice';
      contextLines.push(`Verbosity: ${verbosity}.`);
    }

    const userText = contextLines.length > 0
      ? `Context:\n${contextLines.join('\n')}\n\nWhat do you see, and what should they do?`
      : 'What do you see, and what should they do?';

    // Audit 101 / W10 — tuned tokens + temperature down. Lie-analysis
    // outputs converge in <400 tokens at temperature 0.3; the prior
    // 800/0.5 was over-generating descriptive prose for a vision Sonnet
    // call (the slowest, most-expensive endpoint). Lowered to cut both
    // latency and output cost without sacrificing read quality.
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      temperature: 0.3,
      system: buildSystemPrompt(personaInput),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image_media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: image_b64 } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    const block = completion.content.find(c => c.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) {
      return res.status(502).json({ error: 'Empty model response' });
    }

    let parsed: AnalysisResponse;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as AnalysisResponse;
    } catch {
      console.error('[lie-analysis] JSON parse failed:', text.slice(0, 300));
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    // Defensive normalization
    if (typeof parsed.situation_description !== 'string') parsed.situation_description = '';
    if (typeof parsed.tactical_advice !== 'string') parsed.tactical_advice = '';
    if (parsed.recommended_club != null && typeof parsed.recommended_club !== 'string') parsed.recommended_club = null;
    if (parsed.alternative_play != null && typeof parsed.alternative_play !== 'string') parsed.alternative_play = null;
    if (!['high', 'medium', 'low'].includes(parsed.confidence_level)) parsed.confidence_level = 'medium';
    parsed.conservative_call = Boolean(parsed.conservative_call);

    return res.status(200).json(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[lie-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
