/**
 * 2026-05-22 — Meta AI bridge endpoint.
 *
 * Hands-free entry for Ray-Ban Meta glasses via iOS Shortcuts. Meta AI
 * triggers the shortcut, dictates the user's query into our endpoint,
 * and reads the `speak` field back aloud. No official Meta SDK yet —
 * Shortcuts + dictation is the bridge.
 *
 * Targets:
 *   - <2s total latency end-to-end
 *   - <=15 words in `speak` field
 *   - State carried by the CLIENT (Shortcut copies `state` to clipboard,
 *     sends it back on next request) so the server stays stateless
 *
 * GET ?test=1 (or any GET) returns mock test data; useful for
 * exercising the iOS Shortcut without playing golf. See test cases at
 * the bottom of this file.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { completeJSON, providerFromHeader, type AiProvider, type StructuredSchema } from './_aiProvider';

// ─── Schemas ────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  query: z.string().min(1).max(500),
  gps: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  spoken_context: z.string().max(500).optional().default(''),
  user_id: z.string().min(1).max(120),
  state: z.record(z.string(), z.unknown()).optional().default({}),
  // 2026-05-22 — Future-proof: when Meta opens the camera API we'll
  // accept a base64 frame here. The endpoint already routes it to the
  // multimodal Sonnet path below (TODO marker). Today: always absent.
  image_base64: z.string().optional(),
});

type RequestPayload = z.infer<typeof RequestSchema>;

const StateSchema = z.object({
  hole: z.number().int().optional(),
  last_club: z.string().optional(),
  last_yardage: z.number().optional(),
  last_result_pending: z.boolean().optional(),
  last_gps: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  user_name: z.string().optional(),
  name_used_this_round: z.boolean().optional(),
  recent_score_vs_par: z.number().optional(),
});

const ResponseSchema = z.object({
  speak: z.string(),
  details: z.string().optional(),
  state: z.record(z.string(), z.unknown()),
  tone: z.enum(['neutral', 'hype', 'calm', 'coach']),
  alt: z.string().optional(),
  user_note: z.string().optional(),
});

type ResponsePayload = z.infer<typeof ResponseSchema>;

// ─── Structured output schema ────────────────────────────────────────────
//
// Passed to completeJSON so the LLM returns a schema-validated object.
// The `state` field is computed server-side by buildNextState() and must
// NOT appear here — the LLM only produces the five fields below.

const META_VOICE_SCHEMA: StructuredSchema = {
  name: 'meta_voice_response',
  openai: {
    type: 'object',
    properties: {
      speak:     { type: 'string' },
      details:   { type: 'string' },
      alt:       { type: 'string' },
      tone:      { type: 'string', enum: ['neutral', 'hype', 'calm', 'coach'] },
      user_note: { type: 'string' },
    },
    required: ['speak', 'tone'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      speak:     { type: 'STRING' },
      details:   { type: 'STRING' },
      alt:       { type: 'STRING' },
      tone:      { type: 'STRING', enum: ['neutral', 'hype', 'calm', 'coach'] },
      user_note: { type: 'STRING' },
    },
    required: ['speak', 'tone'],
  },
};

// ─── Intent classification ──────────────────────────────────────────────

type Intent = 'distance_request' | 'lie_assessment' | 'shot_result' | 'strategy' | 'general';

const DISTANCE_RE = /\b(yard|yds?|distance|how far|to (the )?(pin|green|flag|front|back|middle)|to pin)\b/i;
const LIE_RE = /\b(lie|stance|hazard|rough|bunker|sand|trees?|hardpan|water|fluffy|tight|buried|deep)\b/i;
const RESULT_RE = /\b(made it|stuck it|missed|short|long|left|right|hit (it|that)|nailed it|drained|bladed|fat|thin|chunked|skulled|good shot|bad shot|holed)\b/i;
const STRATEGY_RE = /\b(what should i|what'?s the play|smart play|aggressive|conservative|go for|lay up|options?)\b/i;

function classifyIntent(query: string, spokenContext: string): Intent {
  const hay = (query + ' ' + spokenContext).toLowerCase();
  if (RESULT_RE.test(hay)) return 'shot_result';
  if (DISTANCE_RE.test(hay)) return 'distance_request';
  if (LIE_RE.test(hay)) return 'lie_assessment';
  if (STRATEGY_RE.test(hay)) return 'strategy';
  return 'general';
}

// ─── Rate limiting (in-memory, per-process) ─────────────────────────────
//
// Vercel serverless processes can outlive a single request, so a simple
// Map-based rate limiter applies within a warm function instance. Cold
// starts reset; that's fine for "anti-spam, not security". Real RL
// would use Redis. 30 reqs/min per user is generous for a glasses
// conversation.

interface RateBucket { tokens: number; refilledAt: number }
const RATE_LIMIT_TOKENS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets: Map<string, RateBucket> = new Map();

function rateLimit(userId: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const b = rateBuckets.get(userId) ?? { tokens: RATE_LIMIT_TOKENS, refilledAt: now };
  if (now - b.refilledAt >= RATE_LIMIT_WINDOW_MS) {
    b.tokens = RATE_LIMIT_TOKENS;
    b.refilledAt = now;
  }
  if (b.tokens <= 0) {
    rateBuckets.set(userId, b);
    return { ok: false, remaining: 0 };
  }
  b.tokens--;
  rateBuckets.set(userId, b);
  return { ok: true, remaining: b.tokens };
}

// ─── GPS helpers ─────────────────────────────────────────────────────────

function haversineYards(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))) * 1.09361;
}

// ─── Course + weather + clubs (TODO: wire to real services) ─────────────
//
// The full Caddy services (courseDataOrchestrator.getHoleView,
// weatherService.fetchWeatherAt, golferModel.buildGolferModel) live
// client-side reading from Zustand stores. They aren't reachable from
// this Vercel handler today; the Shortcut client carries state forward
// in the `state` blob instead.
//
// FUTURE: when we ship a server-side Caddy context API the calls below
// land in this slot.

interface CourseContext {
  course_id: string | null;
  hole: number | null;
  par: number | null;
  yards_to_green: number | null;
}

async function getCourseContext(
  _gps: RequestPayload['gps'] | undefined,
  state: z.infer<typeof StateSchema>,
): Promise<CourseContext> {
  // TODO: wire to server-side getCourseData(gps) when the service exists.
  return {
    course_id: null,
    hole: state.hole ?? null,
    par: null,
    yards_to_green: state.last_yardage ?? null,
  };
}

interface WeatherContext {
  wind_mph: number | null;
  wind_dir_deg: number | null;
  temp_f: number | null;
}

async function getWind(gps: RequestPayload['gps'] | undefined): Promise<WeatherContext> {
  // 2026-06-23 (smoke-test) — env-name skew: api/weather.ts reads WEATHER_API_KEY
  // but this read OPENWEATHER_API_KEY, so meta-voice wind was dead whenever only the
  // former was set in prod. Accept either name.
  const owmKey = process.env.OPENWEATHER_API_KEY ?? process.env.WEATHER_API_KEY ?? '';
  if (!gps || !owmKey) {
    return { wind_mph: null, wind_dir_deg: null, temp_f: null };
  }
  try {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?` +
      `lat=${gps.lat}&lon=${gps.lng}&units=imperial&appid=${owmKey}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return { wind_mph: null, wind_dir_deg: null, temp_f: null };
    const data = (await res.json()) as { wind?: { speed?: number; deg?: number }; main?: { temp?: number } };
    return {
      wind_mph: typeof data.wind?.speed === 'number' ? data.wind.speed : null,
      wind_dir_deg: typeof data.wind?.deg === 'number' ? data.wind.deg : null,
      temp_f: typeof data.main?.temp === 'number' ? data.main.temp : null,
    };
  } catch {
    return { wind_mph: null, wind_dir_deg: null, temp_f: null };
  }
}

// ─── LLM composer ────────────────────────────────────────────────────────

async function runLLMRecommendation(input: {
  payload: RequestPayload;
  intent: Intent;
  course: CourseContext;
  weather: WeatherContext;
  state: z.infer<typeof StateSchema>;
  provider: AiProvider;
}): Promise<ResponsePayload> {
  const { payload, intent, course, weather, state, provider } = input;
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return fallbackResponse(payload, state, intent, 'no_ai_provider');
  }
  const sys = `You are a tour caddie on a Meta Ray-Ban call. Your output is read aloud verbatim. RULES:
- "speak" MUST be <=15 words. Use natural speech ("one forty five" not "145 yds").
- Never read lists. No "Option 1, Option 2".
- Sound like a real human caddie — confident, brief, useful.
- Use the user's name ONLY ONCE per round (name_used_this_round flag in state — never reuse).
- If danger present, warn briefly. "Water short. Play safe to center."
- "tone": "hype" after birdie / personal best, "calm" after double+, "coach" if user asked for help, "neutral" otherwise.
- "details" is the 1-sentence "why" the user MIGHT ask for next.
- "alt" is the alternative play, <=12 words.
- "user_note" is a personalization hint Meta AI should remember about this golfer.

Return EXACTLY this JSON (no preamble, no code fences):
{
  "speak": string,
  "details": string,
  "alt": string,
  "tone": "neutral"|"hype"|"calm"|"coach",
  "user_note": string
}`;

  // 2026-05-22 — Emotional-context rule. Three trigger conditions:
  //   - state.hole == 1 (round just started — caddie tones may welcome)
  //   - state.last_round_at older than 7 days OR absent (welcome back)
  //   - spoken_context mentions scenery words
  // When any fires, randomly (10%) inject a "feel the moment" prepend
  // hint into the LLM context so the model can subtly humanize the
  // response. Always honest — never invents emotional state, only
  // signals it MAY blend if appropriate.
  const emotionalSignal = computeEmotionalSignal(payload, state);
  const emotionalHint = emotionalSignal && Math.random() < 0.10
    ? `\nEMOTIONAL CONTEXT TRIGGER (${emotionalSignal}): The moment matters. ` +
      `Subtly humanize the speak field — a short scenery / welcome / rhythm acknowledgment ` +
      `BEFORE the tactical answer. The user_note should call out the emotional moment for ` +
      `Meta AI to remember. Don't be schmaltzy. One word of color at most. Example: ` +
      `"Gorgeous morning. Easy nine, one forty to center."`
    : '';

  const userMsg = `Intent: ${intent}
User query: "${payload.query}"
Spoken context (visual / lie hint): "${payload.spoken_context}"
GPS: ${payload.gps ? `${payload.gps.lat.toFixed(5)}, ${payload.gps.lng.toFixed(5)}` : 'unavailable'}
Course: hole ${course.hole ?? '?'}, par ${course.par ?? '?'}, ${course.yards_to_green ?? '?'} to green
Wind: ${weather.wind_mph != null ? `${Math.round(weather.wind_mph)} mph from ${weather.wind_dir_deg ?? '?'}°` : 'unknown'}
Temp: ${weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : 'unknown'}
State: ${JSON.stringify({
    last_club: state.last_club ?? null,
    last_yardage: state.last_yardage ?? null,
    last_result_pending: state.last_result_pending ?? false,
    recent_score_vs_par: state.recent_score_vs_par ?? null,
    user_name: state.user_name ?? null,
    name_used_this_round: state.name_used_this_round ?? false,
  })}
${emotionalHint}

${payload.image_base64 ? '/* TODO: vision frame attached — multimodal Sonnet call routes here once Meta opens camera API */' : ''}

Give me the JSON.`;

  try {
    const raw = await completeJSON(provider, 'fast', sys, [{ role: 'user', content: userMsg }], { maxTokens: 220, temperature: 0.2, schema: META_VOICE_SCHEMA });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validated = ResponseSchema.omit({ state: true }).parse({
      speak:     clampWords(String(parsed.speak ?? ''), 15) || 'Standing by.',
      details:   typeof parsed.details === 'string' ? parsed.details.slice(0, 240) : undefined,
      alt:       typeof parsed.alt === 'string' ? clampWords(parsed.alt, 12) : undefined,
      tone:      pickTone(parsed.tone),
      user_note: typeof parsed.user_note === 'string' ? parsed.user_note.slice(0, 160) : undefined,
    });
    return { ...validated, state: {} };
  } catch {
    return fallbackResponse(payload, state, intent, 'llm_error');
  }
}

function pickTone(v: unknown): 'neutral' | 'hype' | 'calm' | 'coach' {
  if (v === 'hype' || v === 'calm' || v === 'coach' || v === 'neutral') return v;
  return 'neutral';
}

const SCENERY_WORDS_RE = /\b(beautiful|sunset|sunrise|view|gorgeous|breathtaking|peaceful|quiet|stunning|magnificent|amazing morning|amazing evening)\b/i;

/** Returns the trigger reason when the emotional-context rule should
 *  fire (caller still gates on a 10% random roll). null otherwise. */
function computeEmotionalSignal(payload: RequestPayload, state: z.infer<typeof StateSchema>): string | null {
  if (state.hole === 1) return 'first_hole';
  // last_round_at gets parked in state when the round ends (UI side); if
  // the caller doesn't pass it, we treat absence as a possible long gap.
  const last = (state as Record<string, unknown>).last_round_at;
  if (typeof last !== 'number' || Date.now() - last > 7 * 24 * 60 * 60 * 1000) {
    // No previous record (true first-time-this-week) OR genuine 7d+ gap.
    // Only fires when this is ALSO the first hole signal-less context;
    // we want the emotional moment, not every cold-launch query.
    if (state.hole == null) return 'returning_player';
  }
  if (payload.spoken_context && SCENERY_WORDS_RE.test(payload.spoken_context)) return 'scenery';
  if (SCENERY_WORDS_RE.test(payload.query)) return 'scenery';
  return null;
}

function clampWords(s: string, n: number): string {
  const words = s.trim().split(/\s+/);
  return words.length <= n ? s.trim() : words.slice(0, n).join(' ');
}

// ─── State updater ──────────────────────────────────────────────────────

function buildNextState(
  payload: RequestPayload,
  prior: z.infer<typeof StateSchema>,
  intent: Intent,
  speak: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prior };

  // Hole increment: GPS jumped >200yd since last fix → likely next hole.
  if (payload.gps && prior.last_gps) {
    const moved = haversineYards(prior.last_gps, payload.gps);
    if (moved > 200) {
      next.hole = (prior.hole ?? 1) + 1;
    }
  }
  if (payload.gps) next.last_gps = payload.gps;

  // Distance-request → mark last_yardage from the query if present.
  const yardMatch = payload.query.match(/\b(\d{2,3})\b/);
  if (intent === 'distance_request' && yardMatch) {
    next.last_yardage = parseInt(yardMatch[1], 10);
    next.last_result_pending = false;
  }

  // Detect club mentioned in speak.
  const clubMatch = speak.match(/\b(driver|3 ?wood|5 ?wood|hybrid|[1-9] ?iron|pw|gw|sw|lw|putter|wedge)\b/i);
  if (clubMatch) {
    next.last_club = clubMatch[1].toLowerCase().replace(/\s+/g, '');
    next.last_result_pending = true;
  }

  if (intent === 'shot_result') {
    next.last_result_pending = false;
  }

  // Mark name as used once Kevin/the caddie spoke it (server can't
  // know for sure but if speak contains a capitalized 2-12 char word
  // matching state.user_name, flag it).
  if (prior.user_name && new RegExp(`\\b${escapeRe(prior.user_name)}\\b`).test(speak)) {
    next.name_used_this_round = true;
  }

  return next;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Fallbacks ──────────────────────────────────────────────────────────

function fallbackResponse(
  payload: RequestPayload,
  state: z.infer<typeof StateSchema>,
  intent: Intent,
  reason: string,
): ResponsePayload {
  const speak =
    intent === 'distance_request' && payload.gps == null
      ? "I need your location. Open Caddy on phone."
      : intent === 'distance_request'
      ? 'Standing by — checking the yardage now.'
      : 'On it. Open the app for the full read.';
  return {
    speak,
    state: { ...state, fallback_reason: reason },
    tone: 'calm',
  };
}

// ─── Main handler ───────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const t0 = Date.now();

  if (req.method === 'GET') {
    // 2026-05-22 — /api/meta-voice?demo=1 returns the 9-turn investor
    // demo array. Single endpoint handles both test single-case (?case=N)
    // and the full demo (?demo=1) so the Vercel routing layer stays flat.
    if (req.query.demo) {
      return res.status(200).json({ turns: getNineHoleDemo() });
    }
    return res.status(200).json(getTestPayload(req.query.case as string | undefined));
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload: RequestPayload;
  try {
    payload = RequestSchema.parse(req.body ?? {});
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues : [{ message: 'Invalid request' }];
    return res.status(400).json({ error: 'bad_request', issues });
  }

  const rl = rateLimit(payload.user_id);
  if (!rl.ok) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const state = StateSchema.parse(payload.state ?? {});
  const intent = classifyIntent(payload.query, payload.spoken_context ?? '');

  // No GPS path — short-circuit fast.
  if (!payload.gps && intent === 'distance_request') {
    const fast: ResponsePayload = {
      speak: 'I need your location. Open Caddy on phone.',
      state,
      tone: 'calm',
    };
    logLatency(payload.user_id, intent, t0, 'no_gps');
    return res.status(200).json(fast);
  }

  // Hard timeout: never block the iOS Shortcut longer than ~1.5s.
  // We race the LLM against a deadline; deadline winner serves a safe
  // fallback that ALSO returns valid JSON so the Shortcut doesn't break.
  const DEADLINE_MS = 1450;
  const deadline = new Promise<ResponsePayload>((resolve) =>
    setTimeout(
      () =>
        resolve({
          speak: 'One sec — finishing my read.',
          state,
          tone: 'calm',
        }),
      DEADLINE_MS,
    ),
  );

  const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);

  const work = (async (): Promise<ResponsePayload> => {
    const course = await getCourseContext(payload.gps, state);
    const weather = await getWind(payload.gps);
    const result = await runLLMRecommendation({ payload, intent, course, weather, state, provider });
    const nextState = buildNextState(payload, state, intent, result.speak);
    return { ...result, state: nextState };
  })();

  const final = await Promise.race([work, deadline]);
  logLatency(payload.user_id, intent, t0, 'ok');
  return res.status(200).json(final);
}

// ─── Logging (PII-stripped) ─────────────────────────────────────────────

function logLatency(userId: string, intent: Intent, t0: number, status: string): void {
  // Strip user_id to first 8 chars + hash-prefix-ish. No GPS, no query.
  const id = userId.slice(0, 8);
  console.log(`[meta-voice] user=${id} intent=${intent} status=${status} latency_ms=${Date.now() - t0}`);
}

// ─── Test payloads (GET ?case=N) ────────────────────────────────────────

function getTestPayload(testCase: string | undefined): ResponsePayload {
  switch (testCase) {
    case '2':
      // "bad lie" with spoken_context: "ball below feet in thick rough, 160 to green"
      return {
        speak: 'Take an extra club. Choke down. Aim center.',
        details: 'Ball below feet means it goes right. Rough adds spin loss.',
        alt: 'Pitch out sideways, 90 yards in.',
        tone: 'coach',
        user_note: 'Tim played a 6 iron from rough at 160 yards.',
        state: {
          hole: 7,
          last_club: '6iron',
          last_yardage: 160,
          last_result_pending: true,
        },
      };
    case '3':
      // "I made it" with state: {last_club: "8i", last_yardage: 155}
      return {
        speak: 'Yes! That 8 iron just stuck. Big shot.',
        details: 'Personal best with the 8 from 155 — note it.',
        tone: 'hype',
        user_note: 'Tim just hit his longest 8i this year at 155.',
        state: {
          hole: 9,
          last_club: '8iron',
          last_yardage: 155,
          last_result_pending: false,
          recent_score_vs_par: -1,
        },
      };
    case '1':
    default:
      // "145 to pin" with GPS on par 3
      return {
        speak: 'One forty five — smooth 9 iron, center cut.',
        details: 'Calm conditions, your 9 iron flies one forty five.',
        alt: 'Choked-down 8 if you want to keep it low.',
        tone: 'neutral',
        user_note: 'Tim asked for 145 on a par 3.',
        state: {
          hole: 6,
          last_club: '9iron',
          last_yardage: 145,
          last_result_pending: true,
        },
      };
  }
}

// ─── 9-hole investor demo (GET ?demo=1) ─────────────────────────────────
//
// Frozen sequence of 9 turns showing the caddy's range:
//   - Distance request → club rec
//   - Bad lie + recovery
//   - Wind correction
//   - Scenery emotional moment (emotional rule fires)
//   - Shot result + ack
//   - Strategy / lay-up call
//   - Personal best moment (hype tone)
//   - Mental reset after bad shot
//   - Round-end summary

interface DemoTurn {
  hole: number;
  user_says: string;
  api_response: ResponsePayload;
  caption: string;
}

function getNineHoleDemo(): DemoTurn[] {
  return [
    {
      hole: 1,
      user_says: 'Hey Meta, ask my caddy 145 to pin',
      caption: 'Hole 1 · distance request',
      api_response: {
        speak: 'Gorgeous morning. Smooth 9 iron, one forty five, dead center.',
        details: 'Calm air, no elevation change. Your stock 9 carries 145.',
        alt: 'Choked-down 8 if your tempo feels quick.',
        tone: 'calm',
        user_note: 'Tim opened the round with a 145 on par 3. Calm tone.',
        state: { hole: 1, last_club: '9iron', last_yardage: 145, last_result_pending: true, name_used_this_round: true },
      },
    },
    {
      hole: 2,
      user_says: 'Hey Meta, ask my caddy I pushed it right',
      caption: 'Hole 2 · shot result, no judgment',
      api_response: {
        speak: 'No stress. Wedge to center, sixty five out.',
        details: 'Wedge from light rough gets the most spin to hold.',
        tone: 'calm',
        state: { hole: 2, last_club: 'wedge', last_yardage: 65, last_result_pending: true, name_used_this_round: true },
      },
    },
    {
      hole: 3,
      user_says: 'Hey Meta, ask my caddy how is the wind',
      caption: 'Hole 3 · wind read',
      api_response: {
        speak: 'Eight into your face. Bump it one extra club.',
        details: 'Headwind eats roughly 1.5 yards per mph at your trajectory.',
        tone: 'neutral',
        state: { hole: 3, last_result_pending: false, name_used_this_round: true },
      },
    },
    {
      hole: 4,
      user_says: 'Hey Meta, ask my caddy beautiful view from this tee',
      caption: 'Hole 4 · scenery moment (emotional rule fired)',
      api_response: {
        speak: 'It is. Take it in. Then driver, aim left bunker.',
        details: 'Fairway opens left of the bunker; safer angle in.',
        tone: 'hype',
        user_note: 'Tim noticed the view on 4. He plays better when relaxed — keep the tone light.',
        state: { hole: 4, last_club: 'driver', last_result_pending: true, name_used_this_round: true },
      },
    },
    {
      hole: 5,
      user_says: 'Hey Meta, ask my caddy bad lie, ball below feet in rough',
      caption: 'Hole 5 · spoken visual context drives lie call',
      api_response: {
        speak: 'Extra club. Choke down. Aim left edge — ball goes right.',
        details: 'Ball below feet pushes flight right; rough kills spin.',
        alt: 'Pitch out sideways, ninety in.',
        tone: 'coach',
        user_note: 'Tim played a 6 iron from below-feet rough at 160 yards.',
        state: { hole: 5, last_club: '6iron', last_yardage: 160, last_result_pending: true, name_used_this_round: true },
      },
    },
    {
      hole: 6,
      user_says: 'Hey Meta, ask my caddy what is the play',
      caption: 'Hole 6 · strategy call',
      api_response: {
        speak: 'Lay up to one fifteen. Full pitching wedge in.',
        details: 'Carry to the green needs 230 over water. Play smart.',
        alt: 'Three wood if you trust the carry.',
        tone: 'coach',
        state: { hole: 6, last_club: '7iron', last_yardage: 115, last_result_pending: true, name_used_this_round: true },
      },
    },
    {
      hole: 7,
      user_says: 'Hey Meta, ask my caddy I crushed it',
      caption: 'Hole 7 · personal best — hype tone',
      api_response: {
        speak: 'Yes! That eight just stuck. Longest of the year.',
        details: 'Personal best with the 8 from 155 — note it.',
        tone: 'hype',
        user_note: 'Tim just hit his longest 8 iron of the year at 155.',
        state: { hole: 7, last_club: '8iron', last_yardage: 155, last_result_pending: false, recent_score_vs_par: -1, name_used_this_round: true },
      },
    },
    {
      hole: 8,
      user_says: 'Hey Meta, ask my caddy I made a double',
      caption: 'Hole 8 · mental reset after double — calm tone',
      api_response: {
        speak: 'One shot at a time. Reset on the tee. You got this.',
        details: 'Doubles compound when you press. Stay in your routine.',
        tone: 'calm',
        user_note: 'Tim made a double on 8. Keep the next few responses calm and short.',
        state: { hole: 8, last_result_pending: false, recent_score_vs_par: 1, name_used_this_round: true },
      },
    },
    {
      hole: 9,
      user_says: 'Hey Meta, ask my caddy how am I doing',
      caption: 'Hole 9 · round summary',
      api_response: {
        speak: 'Through nine: even par. Big finish — birdie this one.',
        details: 'Even par through 9 is your front-nine PR this season.',
        tone: 'hype',
        user_note: 'Tim shot even par on the front nine — personal record this season.',
        state: { hole: 9, recent_score_vs_par: 0, last_result_pending: false, name_used_this_round: true },
      },
    },
  ];
}
