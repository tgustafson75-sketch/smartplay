/**
 * 2026-05-22 — Vercel handler: Junior Swing Analysis.
 *
 * Mirror of app/api/junior-swing-analysis+api.ts for production. The
 * Expo Router file is used in local dev; this one is the live Vercel
 * deployment. Keep both in lockstep.
 *
 * Age-band-aware multimodal endpoint for SmartPlay's Family Coaching
 * mode. Receives frames + family-member context + prior-swing snapshot,
 * returns warm, age-appropriate analysis with progress diff.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCaddieName } from '../lib/persona';
import { completeVision, providerFromHeader, type AiImageInput, type StructuredSchema } from './_aiProvider';

const MAX_FRAMES = 6;

const JUNIOR_SWING_SCHEMA: StructuredSchema = {
  name: 'junior_swing_analysis',
  openai: {
    type: 'object',
    properties: {
      swingId:       { type: 'string' },
      timestamp:     { type: 'string' },
      club:          { type: ['string', 'null'] },
      fundamentals: {
        type: 'object',
        properties: {
          grip:          { type: 'string', enum: ['square', 'strong', 'weak', 'too_tight', 'too_loose', 'unknown'] },
          stance:        { type: 'string', enum: ['balanced', 'too_wide', 'too_narrow', 'tilted', 'unknown'] },
          head_movement: { type: 'string', enum: ['still', 'slight', 'lifting', 'swaying', 'unknown'] },
          tempo:         { type: 'string', enum: ['smooth', 'quick', 'rushed', 'jerky', 'unknown'] },
          balance:       { type: 'string', enum: ['finished_balanced', 'fell_back', 'fell_forward', 'spun_out', 'unknown'] },
        },
        required: ['grip', 'stance', 'head_movement', 'tempo', 'balance'],
        additionalProperties: false,
      },
      wins:         { type: 'array', items: { type: 'string' } },
      next_focus:   { type: ['string', 'null'] },
      fun_drill:    { type: ['string', 'null'] },
      vs_previous:  {
        oneOf: [
          {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['improved', 'same', 'declined'] },
              summary:   { type: 'string' },
            },
            required: ['direction', 'summary'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      },
      overallScore:  { type: 'integer', minimum: 0, maximum: 100 },
      coachComment:  { type: 'string' },
    },
    required: ['swingId', 'timestamp', 'club', 'fundamentals', 'wins', 'next_focus', 'fun_drill', 'vs_previous', 'overallScore', 'coachComment'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      swingId:       { type: 'STRING' },
      timestamp:     { type: 'STRING' },
      club:          { type: 'STRING', nullable: true },
      fundamentals: {
        type: 'OBJECT',
        properties: {
          grip:          { type: 'STRING' },
          stance:        { type: 'STRING' },
          head_movement: { type: 'STRING' },
          tempo:         { type: 'STRING' },
          balance:       { type: 'STRING' },
        },
      },
      wins:         { type: 'ARRAY', items: { type: 'STRING' } },
      next_focus:   { type: 'STRING', nullable: true },
      fun_drill:    { type: 'STRING', nullable: true },
      vs_previous:  {
        type: 'OBJECT',
        nullable: true,
        properties: {
          direction: { type: 'STRING' },
          summary:   { type: 'STRING' },
        },
      },
      overallScore:  { type: 'INTEGER' },
      coachComment:  { type: 'STRING' },
    },
  },
  anthropic: {
    input_schema: {
      type: 'object',
      properties: {
        swingId:       { type: 'string' },
        timestamp:     { type: 'string' },
        club:          { type: ['string', 'null'] },
        fundamentals: {
          type: 'object',
          properties: {
            grip:          { type: 'string', enum: ['square', 'strong', 'weak', 'too_tight', 'too_loose', 'unknown'] },
            stance:        { type: 'string', enum: ['balanced', 'too_wide', 'too_narrow', 'tilted', 'unknown'] },
            head_movement: { type: 'string', enum: ['still', 'slight', 'lifting', 'swaying', 'unknown'] },
            tempo:         { type: 'string', enum: ['smooth', 'quick', 'rushed', 'jerky', 'unknown'] },
            balance:       { type: 'string', enum: ['finished_balanced', 'fell_back', 'fell_forward', 'spun_out', 'unknown'] },
          },
          required: ['grip', 'stance', 'head_movement', 'tempo', 'balance'],
        },
        wins:         { type: 'array', items: { type: 'string' } },
        next_focus:   { type: ['string', 'null'] },
        fun_drill:    { type: ['string', 'null'] },
        vs_previous:  {
          oneOf: [
            {
              type: 'object',
              properties: {
                direction: { type: 'string', enum: ['improved', 'same', 'declined'] },
                summary:   { type: 'string' },
              },
              required: ['direction', 'summary'],
            },
            { type: 'null' },
          ],
        },
        overallScore:  { type: 'integer', minimum: 0, maximum: 100 },
        coachComment:  { type: 'string' },
      },
      required: ['swingId', 'timestamp', 'club', 'fundamentals', 'wins', 'next_focus', 'fun_drill', 'vs_previous', 'overallScore', 'coachComment'],
    },
  },
  // 2026-07-09 — the openai schema uses minimum/maximum + oneOf, which OpenAI
  // structured-outputs STRICT mode rejects (400). Opt out of strict (the model still
  // returns the JSON; the client parses defensively). Fixes the 500 the gemini→openai
  // default flip introduced on this vision route.
  strict: false,
};

interface MemberInfo {
  first_name: string;
  nickname: string | null;
  relationship: string;
  age: number | null;
  skill_level: string;
  handedness: 'right' | 'left' | 'unknown';
  approximate_handicap: number | null;
}

interface PriorInfo {
  timestamp: string;
  fundamentals: Record<string, string>;
  wins: string[];
  next_focus: string | null;
  overall_score: number;
}

interface RequestBody {
  frames_base64?: string[];
  video_url?: string | null;
  notes?: string | null;
  club?: string | null;
  member: MemberInfo;
  age_band: 'tiny' | 'junior' | 'teen' | 'adult';
  persona?: string | null;
  voiceGender?: 'male' | 'female';
  prior_swing?: PriorInfo | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No AI provider configured' });
  }

  try {
    const body = (req.body ?? {}) as RequestBody;
    if (!body.member || !body.age_band) {
      return res.status(400).json({ error: 'member and age_band required' });
    }
    const persona = (body.persona ?? body.voiceGender ?? 'male') as string;
    const caddieName = getCaddieName(persona);

    const frames = (body.frames_base64 ?? []).slice(0, MAX_FRAMES);
    const hasFrames = frames.length > 0;
    const hasVideo = !!body.video_url;

    console.log('[junior-swing] received:', {
      frameCount: frames.length,
      hasVideo,
      member: body.member.first_name,
      age: body.member.age,
      band: body.age_band,
      hasPrior: !!body.prior_swing,
    });

    if (!hasFrames && !hasVideo) {
      return res.status(200).json(warmShell(body.member, body.age_band, caddieName, body.prior_swing ?? null));
    }

    const provider = providerFromHeader(req.headers as Record<string, string | string[] | undefined>);
    const images: AiImageInput[] = frames.map(b64 => ({ b64, mimeType: 'image/jpeg' }));
    const ctx: string[] = [];
    ctx.push(`Golfer: ${body.member.first_name}${body.member.nickname ? ` ("${body.member.nickname}")` : ''}`);
    if (body.member.age != null) ctx.push(`Age: ${body.member.age}`);
    ctx.push(`Skill level: ${body.member.skill_level.replace(/_/g, ' ')}`);
    ctx.push(`Handedness: ${body.member.handedness}`);
    if (body.club) ctx.push(`Club: ${body.club}`);
    if (body.notes) ctx.push(`Parent's note: "${body.notes}"`);
    if (body.video_url) ctx.push(`Video URL: ${body.video_url}`);
    if (body.prior_swing) {
      ctx.push(
        `Prior swing snapshot (for progress comparison):` +
        ` overallScore=${body.prior_swing.overall_score},` +
        ` last focus=${body.prior_swing.next_focus ?? 'none'},` +
        ` fundamentals=${JSON.stringify(body.prior_swing.fundamentals)}.`,
      );
    }
    const userText = ctx.join('\n') + '\n\nReturn ONLY the JSON object described in the system prompt. No preamble.';

    const raw = await completeVision(provider, 'quality', buildSystem(body.age_band, caddieName, body.member),
      userText, images,
      { maxTokens: 1200, temperature: 0.3, schema: JUNIOR_SWING_SCHEMA },
    );
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn('[junior-swing] parse failed; returning warm shell');
      return res.status(200).json(warmShell(body.member, body.age_band, caddieName, body.prior_swing ?? null));
    }
    return res.status(200).json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[junior-swing] error:', msg);
    return res.status(500).json({ error: msg });
  }
}

function buildSystem(band: RequestBody['age_band'], caddieName: string, member: MemberInfo): string {
  // 2026-06-08 (audit #2) — don't silently default unknown handedness to
  // right-handed cues. Left → mirror; unknown → avoid absolute L/R and
  // describe relative to the target line so the advice is correct either way.
  const mirrorNote =
    member.handedness === 'left'
      ? 'IMPORTANT: this golfer is LEFT-HANDED. Mirror any directional cue ("draw" / "fade", "left edge" / "right edge", inside/outside).'
      : member.handedness === 'unknown'
        ? 'NOTE: handedness is unknown — do NOT use absolute left/right cues. Describe direction relative to the player\'s target line (e.g. "started right of your line") so the cue is correct for a right- or left-hander.'
        : '';

  const tonePresets: Record<RequestBody['age_band'], string> = {
    tiny:
      `${member.first_name} is ${member.age ?? 6} years old. Use SHORT words. SHORT sentences. ` +
      `LEAD WITH JOY. "Nice swing!" "You did it!" "I saw you keep your eye on the ball — wow!". ` +
      `One — and only ONE — tiny thing to try next time, phrased as a game ("Can you swing like a smooth pendulum?"). ` +
      `Never use words like "deceleration", "tempo", "balance" — say what the body did in words a 6yo knows. ` +
      `coachComment max 25 words.`,
    junior:
      `${member.first_name} is ${member.age ?? 10} years old. Lead with WHAT WENT WELL. ` +
      `Use simple golf words ("nice grip", "good balance", "smooth swing"). ` +
      `ONE focus area for next time — pick the highest-leverage fundamental. ` +
      `Always include a fun_drill that turns the focus into a game. ` +
      `coachComment 25-45 words. Warm, encouraging, ${caddieName}'s voice.`,
    teen:
      `${member.first_name} is ${member.age ?? 14} years old. You can use real golf vocabulary ` +
      `(tempo, balance, weight transfer, grip pressure) but keep it specific and actionable. ` +
      `Still LEAD WITH WINS. ONE next-time focus. Skip the fun_drill if the player is past ` +
      `game-ifying — only include when it actually helps. ` +
      `coachComment 35-55 words. Direct + encouraging.`,
    adult:
      `${member.first_name} is an adult. Full SmartPlay coaching tone. Wins first, ONE focus, ` +
      `technical observations honest and specific. fun_drill optional. ` +
      `coachComment 35-60 words in ${caddieName}'s voice.`,
  };

  return `You are ${caddieName}, SmartPlay's family-coaching caddie. You are analyzing a swing video from a parent recording their kid (or another family member). Be warm, honest, and age-appropriate.

GOLFER CONTEXT:
${tonePresets[band]}
${mirrorNote}

WHAT TO LOOK FOR (across frames):
  - Grip (square / strong / weak / too tight / too loose)
  - Stance (balanced / too wide / too narrow / tilted)
  - Head movement (still / slight / lifting / swaying)
  - Tempo (smooth / quick / rushed / jerky)
  - Balance at finish (finished balanced / fell back / fell forward / spun out)

PROGRESS:
If prior swing context is provided, give an HONEST diff in vs_previous:
  - direction: improved | same | regressed
  - summary: one sentence comparing the most-visible change

OUTPUT JSON SHAPE (return EXACTLY this — no preamble, no code fences):
{
  "swingId": string,
  "timestamp": ISO 8601 UTC,
  "club": string | null,
  "fundamentals": {
    "grip": "square"|"strong"|"weak"|"too_tight"|"too_loose"|"unknown",
    "stance": "balanced"|"too_wide"|"too_narrow"|"tilted"|"unknown",
    "head_movement": "still"|"slight"|"lifting"|"swaying"|"unknown",
    "tempo": "smooth"|"quick"|"rushed"|"jerky"|"unknown",
    "balance": "finished_balanced"|"fell_back"|"fell_forward"|"spun_out"|"unknown"
  },
  "wins": string[],
  "next_focus": string | null,
  "fun_drill": string | null,
  "vs_previous": { direction, summary } | null,
  "overallScore": integer 0..100,
  "coachComment": string
}

CONFIDENCE / HONESTY:
  - Lower fundamentals to 'unknown' rather than guess. Better honesty than a confident wrong call.
  - overallScore is AGE-RELATIVE.
  - Never call out something a kid CAN'T fix (body proportions, club fit).

Make this feel like a personal coach who genuinely cares about this kid.`;
}

function warmShell(member: MemberInfo, band: RequestBody['age_band'], caddieName: string, prior: PriorInfo | null): Record<string, unknown> {
  const fallback = band === 'tiny'
    ? `${member.first_name}! Big swing! Let's do another and I'll watch you.`
    : band === 'junior'
    ? `Hey ${member.first_name}! Couldn't see that one clearly — let's grab another and ${caddieName} will give you real feedback.`
    : band === 'teen'
    ? `${member.first_name} — video didn't come through clearly. One more rep and we'll dial it in.`
    : `${caddieName} here — couldn't see that one cleanly. Let's go again.`;
  return {
    swingId: 'jswing_' + Date.now().toString(36),
    timestamp: new Date().toISOString(),
    club: null,
    fundamentals: { grip: 'unknown', stance: 'unknown', head_movement: 'unknown', tempo: 'unknown', balance: 'unknown' },
    wins: [band === 'tiny' || band === 'junior'
      ? `You stepped up and took a swing — that's the first big win.`
      : `Took the rep — that's how progress compounds.`],
    next_focus: null,
    fun_drill: null,
    vs_previous: prior ? { direction: 'same', summary: 'Couldn\'t compare clearly this time.' } : null,
    overallScore: 50,
    coachComment: fallback,
  };
}
