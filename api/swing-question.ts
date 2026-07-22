import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

// 2026-07-21 (QA audit, finding #7) — the @google/genai SDK has NO per-request timeout, so
// a Gemini stall (connection open, no body) would never reject, the OpenAI fallback below
// would never run, and the lambda would block to Vercel's maxDuration → 504. Every sibling
// route (swing-analysis, lie-analysis, _aiProvider, image-edit) already wraps generateContent
// in this race; this one was the lone bare call. A timeout throws into the existing catch and
// lets the OpenAI fallback take over.
function geminiWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * 2026-05-26 — Fix AT: Ask Your Swing.
 *
 * Bryson DeChambeau ran an ad showing Gemini analyzing his swing
 * conversationally — user asks a question about the video, Gemini
 * answers. SmartPlay Caddie matches and extends that capability with
 * caddie-voice replies and a three-provider resilience chain.
 *
 * Distinct from /api/swing-analysis (structured fault classification):
 * this endpoint takes a freeform user question + 1-5 swing frames and
 * returns a conversational caddie-voice answer that REFERENCES what's
 * visible in the frames.
 *
 * Provider order: Gemini 2.5 Flash → OpenAI gpt-4o.
 * Gemini-first deliberately — it's the model the public associates
 * with "ask your video a question" (the Bryson ad), and gemini-flash
 * is the cheapest/fastest of the three for image-grounded Q&A.
 *
 * Input shape:
 *   { frames: [{ b64, media_type? }], question: string,
 *     context: { caddie_name?, club?, prior_fault?, prior_cause?,
 *                prior_fix?, language? } }
 * Output:
 *   { answer: string, provider: 'gemini'|'openai',
 *     _debug: { fallback_reason } }
 */

const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });

function buildSystemPrompt(ctx: Record<string, unknown>): string {
  const caddieName = typeof ctx.caddie_name === 'string' && ctx.caddie_name.trim().length > 0
    ? ctx.caddie_name.trim()
    : 'the caddie';
  const language = typeof ctx.language === 'string' ? ctx.language.toLowerCase() : 'en';
  const langLine =
    language === 'es' ? '\nCRITICAL: Answer in Spanish (español).' :
    language === 'zh' ? '\nCRITICAL: Answer in Chinese (中文).' :
    '';

  const voiceLine =
    caddieName === 'Tank'   ? 'Voice: Tank — clipped, military cadence, imperative. ("Plant the lead foot. Drive it.")' :
    caddieName === 'Serena' ? 'Voice: Serena — precise instructor, technical but warm. ("At impact your trail shoulder is dropping — that\'s adding loft you don\'t need.")' :
    caddieName === 'Harry'  ? 'Voice: Harry — warm older caddie, encouraging, conversational. ("That swing\'s got plenty in it — just smooth out the transition.")' :
                              'Voice: Kevin — neutral conversational, technical when needed. ("Your hips are getting ahead of your shoulders on the way down.")';

  return `You are ${caddieName}, a golf swing analyst. The player just asked you a question about a specific swing. You can SEE 1-5 frames from that swing (chronological — frame 0 earliest, last frame latest).

${voiceLine}

Answer the player's question by REFERENCING what's actually visible in the frames. Be specific — cite a frame ("at the top," "into impact," "the finish") when it strengthens the answer. NEVER make up details that aren't visible.

Rules:
- 1-3 sentences. Conversational, not a lecture.
- Stay in ${caddieName}'s voice (see above).
- Ground the answer in what you see in the frames. If the question can't be answered from the visible frames, say so honestly ("I can see your impact, but I'd need a face-on angle to call your weight shift confidently") — never invent.
- If the question is about fixing a fault, give ONE actionable cue, not a list.
- No JSON, no markdown, no preamble. Just the spoken answer.${langLine}

Context the player has already seen for this swing (use when relevant; don't recite):${
    typeof ctx.club === 'string' && ctx.club ? `\n- Club: ${ctx.club}` : ''
  }${
    typeof ctx.prior_fault === 'string' && ctx.prior_fault ? `\n- Earlier flagged: ${ctx.prior_fault}` : ''
  }${
    typeof ctx.prior_cause === 'string' && ctx.prior_cause ? `\n- Earlier cause read: ${ctx.prior_cause}` : ''
  }${
    typeof ctx.prior_fix === 'string' && ctx.prior_fix ? `\n- Earlier fix offered: ${ctx.prior_fix}` : ''
  }`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const frames = (body.frames ?? []) as { b64: string; media_type?: string }[];
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const ctx = (body.context ?? {}) as Record<string, unknown>;

    if (!Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'frames[] (1-5 base64 images) required' });
    }
    if (frames.length > 5) {
      return res.status(400).json({ error: 'maximum 5 frames per question' });
    }
    if (!question || question.length < 2) {
      return res.status(400).json({ error: 'question required (min 2 chars)' });
    }
    if (question.length > 500) {
      return res.status(400).json({ error: 'question too long (max 500 chars)' });
    }
    const totalSize = frames.reduce((acc, f) => acc + (f.b64?.length ?? 0), 0);
    if (totalSize > 9_000_000) {
      return res.status(413).json({ error: 'frames too large; resize each to ~1024px on long edge' });
    }

    const systemPrompt = buildSystemPrompt(ctx);
    const userText = `Player's question: ${question}`;

    let answer = '';
    let providerUsed: 'gemini' | 'openai' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;

    // ── Gemini first (Bryson-ad parity). ────────────────────────────
    if (gemini) {
      try {
        const parts = [
          { text: systemPrompt + '\n\n' + userText },
          ...frames.map(f => ({
            inlineData: {
              mimeType: f.media_type ?? 'image/jpeg',
              data: f.b64,
            },
          })),
        ];
        const gem = await geminiWithTimeout(gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts }],
          config: { temperature: 0.4, maxOutputTokens: 300 },
        }), 15_000);
        answer = (gem.text ?? '').trim();
        if (!answer) geminiError = 'empty_response';
      } catch (e) {
        geminiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[swing-question] gemini primary failed:', geminiError);
      }
    } else {
      geminiError = 'GOOGLE_API_KEY not configured';
    }

    // ── OpenAI second. ──────────────────────────────────────────────
    if (!answer && process.env.OPENAI_API_KEY) {
      try {
        const openaiContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          ...frames.map(f => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${f.media_type ?? 'image/jpeg'};base64,${f.b64}`,
              detail: 'high' as const,
            },
          })),
          { type: 'text' as const, text: userText },
        ];
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 300,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: openaiContent },
          ],
        });
        answer = (oai.choices[0]?.message?.content ?? '').trim();
        providerUsed = 'openai';
        if (!answer) openaiError = 'empty_response';
      } catch (e) {
        openaiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[swing-question] openai fallback failed:', openaiError);
      }
    }

    if (!answer) {
      return res.status(502).json({
        error: 'All providers failed',
        gemini_error: geminiError,
        openai_error: openaiError,
      });
    }

    return res.status(200).json({
      answer,
      provider: providerUsed,
      _debug: {
        fallback_reason: providerUsed === 'gemini' ? null : { gemini: geminiError },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[swing-question] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
