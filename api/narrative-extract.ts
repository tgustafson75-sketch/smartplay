/**
 * 2026-07-07 (Tim — narrative profile intake): extract golfer-narrative FACTS from
 * free conversation. The relationship layer: the caddie gets to know the golfer —
 * how they practice, the time they really have, what they like/avoid, where the game
 * needs work, experience, goals, life context — and the CNS remembers it
 * (caddieMemoryStore.recordNarrative), so every brain surface coaches inside that
 * reality. Voice/relationship-derived, not form-derived.
 *
 *   POST /api/narrative-extract  { text, question? }  →  { facts: {...} }
 *
 * `text` is what the golfer SAID (one intake answer, or a chat excerpt). `question`
 * is the prompt they were answering (context for the extraction). Output fields are
 * all optional — extract ONLY what was actually said. Never invent, never infer
 * beyond the words. Empty facts is a valid result.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 18_000, maxRetries: 1 });

const PROMPT = `You are the memory of a personal golf caddie. The golfer just said something (possibly answering a question). Extract ONLY the durable facts about WHO THEY ARE AS A GOLFER that are actually present in their words — things a great caddie/coach would remember for years.

Extraction targets (all optional — leave out anything not actually said):
- experience: how long they've played, lessons or self-taught, background ("played in college", "picked it up 3 years ago").
- practiceFrequency: how often + what kind of practice they really do.
- timeAvailable: the time they realistically have (windows, travel, "hotel nights", family constraints).
- likes: things they enjoy doing (drills, range, playing with friends, competition...).
- dislikes: things they avoid or hate (putting drills, slow play, lessons...).
- workAreas: where THEY feel the game needs the most work, in their words.
- strengths: what works for them / what they're proud of.
- goals: what they want ("break 85", "beat my brother", "not embarrass myself at the member-guest").
- story: any other durable life/golf context worth remembering ("travels for work", "plays with his son", "recovering from shoulder surgery").

Rules:
- Extract, don't infer. "I hate practicing putting" → dislikes:["practicing putting"], workAreas stays empty unless they SAID it needs work.
- Short phrases in the golfer's own words (max ~12 words each).
- Scalars (experience/practiceFrequency/timeAvailable): one concise sentence, only if said.
- If nothing durable was said, return every field empty. That is a good answer.`;

const TOOL: Anthropic.Tool = {
  name: 'record_narrative_facts',
  description: 'Record the durable golfer-narrative facts present in the message.',
  input_schema: {
    type: 'object',
    properties: {
      experience: { type: ['string', 'null'] },
      practiceFrequency: { type: ['string', 'null'] },
      timeAvailable: { type: ['string', 'null'] },
      likes: { type: 'array', items: { type: 'string' } },
      dislikes: { type: 'array', items: { type: 'string' } },
      workAreas: { type: 'array', items: { type: 'string' } },
      strengths: { type: 'array', items: { type: 'string' } },
      goals: { type: 'array', items: { type: 'string' } },
      story: { type: 'array', items: { type: 'string' } },
    },
    required: [],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(200).json({ configured: false });

  const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as { text?: unknown; question?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : '';
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_narrative_facts' },
      messages: [{
        role: 'user',
        content: `${PROMPT}\n\n${question ? `The caddie asked: "${question}"\n` : ''}The golfer said: "${text}"`,
      }],
    });
    const toolUse = completion.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) return res.status(502).json({ error: 'no tool_use in response' });
    const raw = toolUse.input as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];
    return res.status(200).json({
      facts: {
        experience: str(raw.experience),
        practiceFrequency: str(raw.practiceFrequency),
        timeAvailable: str(raw.timeAvailable),
        likes: arr(raw.likes),
        dislikes: arr(raw.dislikes),
        workAreas: arr(raw.workAreas),
        strengths: arr(raw.strengths),
        goals: arr(raw.goals),
        story: arr(raw.story),
      },
    });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'extract failed' });
  }
}
