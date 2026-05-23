/**
 * 2026-05-22 — Expo Router parallel of api/meta-voice.ts.
 *
 * The Vercel @vercel/node handler at api/meta-voice.ts is the
 * production target. This Expo Router file exists so:
 *   1. Local dev (`expo start`) can resolve /api/meta-voice without
 *      hitting the deployed Vercel endpoint.
 *   2. Any future Expo-routed deployment path (e.g. EAS Hosting) has
 *      a working endpoint at the same path.
 *
 * Re-uses the SAME shape contract documented at api/meta-voice.ts:
 *   POST  { query, gps, spoken_context, user_id, state, image_base64? }
 *      → { speak, details, state, tone, alt, user_note }
 *   GET   ?demo=1         → 9-hole demo array
 *   GET   ?case=1|2|3     → single test case
 *
 * Keep the two files in lockstep (system prompt + intent regex +
 * emotional rule). If you change one, change both.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 1_300,
  maxRetries: 0,
});

interface RequestBody {
  query?: string;
  gps?: { lat: number; lng: number } | null;
  spoken_context?: string;
  user_id?: string;
  state?: Record<string, unknown>;
  image_base64?: string;
}

interface ResponsePayload {
  speak: string;
  details?: string;
  state: Record<string, unknown>;
  tone: 'neutral' | 'hype' | 'calm' | 'coach';
  alt?: string;
  user_note?: string;
}

type Intent = 'distance_request' | 'lie_assessment' | 'shot_result' | 'strategy' | 'general';

const DISTANCE_RE = /\b(yard|yds?|distance|how far|to (the )?(pin|green|flag|front|back|middle)|to pin)\b/i;
const LIE_RE = /\b(lie|stance|hazard|rough|bunker|sand|trees?|hardpan|water|fluffy|tight|buried|deep)\b/i;
const RESULT_RE = /\b(made it|stuck it|missed|short|long|left|right|hit (it|that)|nailed it|drained|bladed|fat|thin|chunked|skulled|good shot|bad shot|holed)\b/i;
const STRATEGY_RE = /\b(what should i|what'?s the play|smart play|aggressive|conservative|go for|lay up|options?)\b/i;
const SCENERY_RE = /\b(beautiful|sunset|sunrise|view|gorgeous|breathtaking|peaceful|quiet|stunning|magnificent)\b/i;

function classifyIntent(query: string, spokenContext: string): Intent {
  const hay = (query + ' ' + spokenContext).toLowerCase();
  if (RESULT_RE.test(hay)) return 'shot_result';
  if (DISTANCE_RE.test(hay)) return 'distance_request';
  if (LIE_RE.test(hay)) return 'lie_assessment';
  if (STRATEGY_RE.test(hay)) return 'strategy';
  return 'general';
}

function clampWords(s: string, n: number): string {
  const words = s.trim().split(/\s+/);
  return words.length <= n ? s.trim() : words.slice(0, n).join(' ');
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as RequestBody;
    const query = String(body.query ?? '').trim();
    const userId = String(body.user_id ?? '').trim();
    if (!query || !userId) {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
    const state = (body.state as Record<string, unknown>) ?? {};
    const intent = classifyIntent(query, body.spoken_context ?? '');

    if (!body.gps && intent === 'distance_request') {
      return Response.json({
        speak: 'I need your location. Open Caddy on phone.',
        state,
        tone: 'calm',
      } satisfies ResponsePayload);
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({
        speak: 'Standing by — checking the yardage now.',
        state,
        tone: 'calm',
      } satisfies ResponsePayload);
    }

    const sys = `You are a tour caddie on a Meta Ray-Ban call. Your output is read aloud verbatim. RULES:
- "speak" MUST be <=15 words. Use natural speech ("one forty five" not "145 yds").
- Never read lists. No "Option 1, Option 2".
- Sound like a real human caddie — confident, brief, useful.
- If danger present, warn briefly. "Water short. Play safe to center."
- "tone": "hype" after birdie / personal best, "calm" after double+, "coach" if user asked for help, "neutral" otherwise.
- "details" is the 1-sentence "why".
- "alt" is the alternative play, <=12 words.
- "user_note" is a personalization hint Meta AI should remember about this golfer.
Return EXACTLY this JSON (no preamble): { "speak": string, "details": string, "alt": string, "tone": "neutral"|"hype"|"calm"|"coach", "user_note": string }`;

    const emotionalTrigger =
      (state as { hole?: number }).hole === 1 ||
      SCENERY_RE.test(query) ||
      SCENERY_RE.test(body.spoken_context ?? '');
    const emotional = emotionalTrigger && Math.random() < 0.10
      ? '\nEMOTIONAL CONTEXT TRIGGER: Subtly humanize the speak field with a short scenery/welcome acknowledgment before the tactical answer.'
      : '';

    const userMsg = `Intent: ${intent}
Query: "${query}"
Spoken context: "${body.spoken_context ?? ''}"
GPS: ${body.gps ? `${body.gps.lat.toFixed(5)}, ${body.gps.lng.toFixed(5)}` : 'unavailable'}
State: ${JSON.stringify(state)}
${emotional}
${body.image_base64 ? '/* TODO: vision frame attached — multimodal path when Meta opens camera API */' : ''}
Give me the JSON.`;

    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      temperature: 0.2,
      system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });
    const block = result.content.find((b) => b.type === 'text');
    const raw = block && block.type === 'text' ? block.text.trim() : '';
    const parsed = safeParse(raw) ?? {};
    return Response.json({
      speak: clampWords(String(parsed.speak ?? 'Standing by.'), 15),
      details: typeof parsed.details === 'string' ? parsed.details.slice(0, 240) : undefined,
      alt: typeof parsed.alt === 'string' ? clampWords(parsed.alt, 12) : undefined,
      tone: ['hype', 'calm', 'coach', 'neutral'].includes(String(parsed.tone)) ? (parsed.tone as ResponsePayload['tone']) : 'neutral',
      user_note: typeof parsed.user_note === 'string' ? parsed.user_note.slice(0, 160) : undefined,
      state,
    } satisfies ResponsePayload);
  } catch {
    return Response.json({
      speak: 'One sec — finishing my read.',
      state: {},
      tone: 'calm',
    } satisfies ResponsePayload);
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Same demo payload structure as api/meta-voice.ts — kept brief here;
  // production users hit the Vercel endpoint for the full 9-turn deck.
  if (url.searchParams.get('demo')) {
    return Response.json({
      turns: [
        {
          hole: 1,
          user_says: 'Hey Meta, ask my caddy 145 to pin',
          caption: 'Hole 1 · distance request',
          api_response: {
            speak: 'Gorgeous morning. Smooth 9 iron, one forty five, dead center.',
            details: 'Calm air, no elevation. Your 9 carries 145.',
            tone: 'calm',
            state: { hole: 1, last_club: '9iron', last_yardage: 145 },
          },
        },
      ],
      note: 'Local-dev stub. Hit /api/meta-voice?demo=1 on Vercel for the full 9-hole deck.',
    });
  }
  return Response.json({
    speak: 'One forty five — smooth 9 iron, center cut.',
    state: { hole: 6, last_club: '9iron', last_yardage: 145 },
    tone: 'neutral',
  } satisfies ResponsePayload);
}
