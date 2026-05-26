import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/**
 * 2026-05-26 — Fix AU: Cross-analyze two swings.
 *
 * Tim: "a very, very cool option is a cross analyze both swings
 * together and see if there's a difference."
 *
 * Takes TWO frame sets (typically the persisted fault frame from the
 * older swing and the newer swing) plus caddie context, returns a
 * conversational diff in the active caddie's voice:
 *   - what changed for the better
 *   - what changed for the worse
 *   - the ONE thing to keep working on
 *
 * Provider chain: Gemini 2.5 Flash → OpenAI gpt-4o → Anthropic Sonnet.
 * Same shape as /api/swing-question — caddie-voice baked into the
 * system prompt, JSON-free conversational output that goes straight
 * to speak() on the client.
 */

const gemini = process.env.GOOGLE_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

interface FrameInput { b64: string; media_type?: string }

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
    caddieName === 'Tank'   ? 'Voice: Tank — clipped, military cadence, imperative.' :
    caddieName === 'Serena' ? 'Voice: Serena — precise instructor, technical but warm.' :
    caddieName === 'Harry'  ? 'Voice: Harry — warm older caddie, encouraging, conversational.' :
                              'Voice: Kevin — neutral conversational, technical when needed.';

  return `You are ${caddieName}, a golf swing analyst. The player just showed you TWO swings to compare. You see two frames: the FIRST is the OLDER swing, the SECOND is the NEWER swing.

${voiceLine}

Your job: a tight, useful diff. Compare what's visible BETWEEN the two frames and tell the player what's actually different — not generic swing advice.

Structure (3-4 short sentences total, no bullets):
1. Lead with what got BETTER in the newer swing (or what stayed solid). One concrete thing you can SEE.
2. Name what got WORSE or unchanged-but-still-a-problem. One concrete thing you can SEE.
3. Give ONE swing-cue to focus on for the next rep.
4. Optional: a single line of encouragement if the trend is positive, OR a single line of urgency if it's regressing.

Rules:
- Ground every claim in what's actually visible. NEVER invent details — if the angle/lighting/crop hides a phase, say so honestly ("can't tell from this angle whether your hips fired earlier this time").
- Stay in ${caddieName}'s voice.
- 3-4 sentences. Conversational, not a lecture. No bullets, no headings, no JSON.
- The first sentence should be the one you'd say out loud first if the player tapped Compare.${langLine}${
    typeof ctx.club === 'string' && ctx.club ? `\n- Club: ${ctx.club}` : ''
  }`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const older = body.older_frame as FrameInput | undefined;
    const newer = body.newer_frame as FrameInput | undefined;
    const ctx = (body.context ?? {}) as Record<string, unknown>;

    if (!older?.b64 || !newer?.b64) {
      return res.status(400).json({ error: 'older_frame and newer_frame (each with b64) required' });
    }
    if ((older.b64.length + newer.b64.length) > 9_000_000) {
      return res.status(413).json({ error: 'frames too large; resize each to ~1024px on long edge' });
    }

    const systemPrompt = buildSystemPrompt(ctx);
    const userText = 'Compare the OLDER swing (first image) to the NEWER swing (second image). What changed?';

    let answer = '';
    let providerUsed: 'gemini' | 'openai' | 'anthropic' = 'gemini';
    let geminiError: string | null = null;
    let openaiError: string | null = null;
    let anthropicError: string | null = null;

    if (gemini) {
      try {
        const parts = [
          { text: systemPrompt + '\n\n' + userText },
          { inlineData: { mimeType: older.media_type ?? 'image/jpeg', data: older.b64 } },
          { inlineData: { mimeType: newer.media_type ?? 'image/jpeg', data: newer.b64 } },
        ];
        const gem = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts }],
          config: { temperature: 0.4, maxOutputTokens: 400 },
        });
        answer = (gem.text ?? '').trim();
        if (!answer) geminiError = 'empty_response';
      } catch (e) {
        geminiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[swing-compare] gemini primary failed:', geminiError);
      }
    } else {
      geminiError = 'GOOGLE_API_KEY not configured';
    }

    if (!answer && process.env.OPENAI_API_KEY) {
      try {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          { type: 'image_url', image_url: { url: `data:${older.media_type ?? 'image/jpeg'};base64,${older.b64}`, detail: 'high' } },
          { type: 'image_url', image_url: { url: `data:${newer.media_type ?? 'image/jpeg'};base64,${newer.b64}`, detail: 'high' } },
          { type: 'text', text: userText },
        ];
        const oai = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 400,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content },
          ],
        });
        answer = (oai.choices[0]?.message?.content ?? '').trim();
        providerUsed = 'openai';
        if (!answer) openaiError = 'empty_response';
      } catch (e) {
        openaiError = e instanceof Error ? e.message : 'unknown';
        console.warn('[swing-compare] openai fallback failed:', openaiError);
      }
    }

    if (!answer && process.env.ANTHROPIC_API_KEY) {
      try {
        const content = [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: (older.media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: older.b64,
            },
          },
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: (newer.media_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: newer.b64,
            },
          },
          { type: 'text' as const, text: userText },
        ];
        const completion = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          temperature: 0.4,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        });
        const block = completion.content.find(c => c.type === 'text');
        answer = block && block.type === 'text' ? block.text.trim() : '';
        providerUsed = 'anthropic';
        if (!answer) anthropicError = 'empty_response';
      } catch (e) {
        anthropicError = e instanceof Error ? e.message : 'unknown';
        console.error('[swing-compare] anthropic last-resort failed:', anthropicError);
      }
    }

    if (!answer) {
      return res.status(502).json({
        error: 'All providers failed',
        gemini_error: geminiError,
        openai_error: openaiError,
        anthropic_error: anthropicError,
      });
    }

    return res.status(200).json({ answer, provider: providerUsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[swing-compare] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
