import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';
import { providerFromHeader } from './_aiProvider';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;

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
  // 2026-06-21 — Only block when NO provider key is available. The original
  // Anthropic-only guard killed Gemini+OpenAI fallback chain (HIGH-3 audit).
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
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
    // 2026-05-26 — Fix W.2: SmartPlay conversational opener context.
    // The player just told the caddie out loud what they're looking
    // at; that transcript usually carries info the photo can't show
    // (distance to target, what's behind it, wind feel, prior shot
    // intent). Weight it: a verbal "I'm 140 to a back-left pin behind
    // bunkers" beats trying to infer the same from a tight lie photo.
    if (typeof ctx.player_notes === 'string' && ctx.player_notes.trim().length > 0) {
      contextLines.push(`Player's verbal context (spoken before the photo): "${ctx.player_notes.trim()}". Use this — it carries situational info the photo can't show on its own. When the lie photo and the verbal context point different directions, name BOTH and reconcile honestly ("you said back-left pin; I see a tight uphill lie — that combo says...").`);
    }
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

    const systemPrompt = buildSystemPrompt(personaInput);

    // 2026-05-26 — Fix BS: three-tier resilience chain. Each provider
    // attempt runs the same normalizer. We return the FIRST successful
    // parse — there's no scoring rubric here because lie-analysis is
    // narrower than swing-analysis (single image, single confidence
    // dimension); any provider that successfully reads the photo is
    // good enough to ship to the player.
    // 2026-06-21 — Respect X-AI-Provider header. If the client prefers
    // OpenAI, skip Gemini and start with OpenAI (avoids latency of a
    // Gemini attempt that the user has opted out of). Fallback chain
    // continues for robustness regardless of preference.
    const preferredProvider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const skipGemini = preferredProvider === 'openai';

    let parsed: AnalysisResponse | null = null;
    let providerUsed: 'gemini' | 'openai' | null = null;
    const errors: Record<string, string | null> = {
      gemini: null,
      openai: null,
    };

    // ── Stage 1: Gemini 2.5 Flash (speed path) ───────────────────
    if (!skipGemini && gemini) {
      try {
        const gem = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { text: systemPrompt + '\n\n' + userText },
              { inlineData: { mimeType: image_media_type, data: image_b64 } },
            ],
          }],
          config: {
            temperature: 0.3,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
          },
        });
        const rawText = (gem.text ?? '').trim();
        parsed = normalizeLieAnalysis(rawText);
        if (parsed) {
          providerUsed = 'gemini';
        } else {
          errors.gemini = rawText ? 'non_json_response' : 'empty_response';
        }
      } catch (e) {
        errors.gemini = e instanceof Error ? e.message : 'unknown';
        console.warn('[lie-analysis] gemini primary failed:', errors.gemini);
      }
    } else {
      errors.gemini = skipGemini ? 'skipped (client prefers openai)' : 'GOOGLE_API_KEY not configured';
    }

    // ── Stage 2: OpenAI gpt-4o (mid fallback) ────────────────────
    if (!parsed && process.env.OPENAI_API_KEY) {
      try {
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 500,
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${image_media_type};base64,${image_b64}`, detail: 'high' } },
                { type: 'text', text: userText },
              ],
            },
          ],
        });
        const rawText = (oai.choices[0]?.message?.content ?? '').trim();
        parsed = normalizeLieAnalysis(rawText);
        if (parsed) {
          providerUsed = 'openai';
          console.log('[lie-analysis] openai fallback succeeded after gemini:', errors.gemini);
        } else {
          errors.openai = rawText ? 'non_json_response' : 'empty_response';
        }
      } catch (e) {
        errors.openai = e instanceof Error ? e.message : 'unknown';
        console.warn('[lie-analysis] openai fallback failed:', errors.openai);
      }
    }

    if (!parsed || !providerUsed) {
      console.error('[lie-analysis] all providers failed', errors);
      return res.status(502).json({
        error: 'All providers failed',
        gemini_error: errors.gemini,
        openai_error: errors.openai,
      });
    }

    return res.status(200).json({
      ...parsed,
      _debug: { provider: providerUsed, errors },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[lie-analysis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}

/**
 * 2026-05-26 — Fix BS: shared normalizer for all three providers.
 * Returns parsed + sanitized AnalysisResponse, or null on parse fail
 * / empty input. Caller treats null as "this provider failed, try
 * the next one in the chain."
 */
function normalizeLieAnalysis(rawText: string): AnalysisResponse | null {
  if (!rawText) return null;
  let parsed: AnalysisResponse;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    parsed = JSON.parse(cleaned) as AnalysisResponse;
  } catch {
    return null;
  }
  if (typeof parsed.situation_description !== 'string') parsed.situation_description = '';
  if (typeof parsed.tactical_advice !== 'string') parsed.tactical_advice = '';
  if (parsed.recommended_club != null && typeof parsed.recommended_club !== 'string') parsed.recommended_club = null;
  if (parsed.alternative_play != null && typeof parsed.alternative_play !== 'string') parsed.alternative_play = null;
  if (!['high', 'medium', 'low'].includes(parsed.confidence_level)) parsed.confidence_level = 'medium';
  parsed.conservative_call = Boolean(parsed.conservative_call);
  return parsed;
}
