import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { KEVIN_CHARACTER_SPEC } from '../constants/kevinCharacter';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECAP_SYSTEM = `${KEVIN_CHARACTER_SPEC}

You are Kevin, summarizing a just-completed round. Your tone is honest and real — not a pep talk.

For each hole provided, write 1-2 sentences describing what happened relative to the plan (if any). Acknowledge good execution. Call out misses honestly but briefly.

Mode-aware tone:
- break_100: celebrate avoided blow-ups, note where bogey was the right play
- break_90: focus on smart misses and pars, note where the strategy held
- break_80: focus on scoring chances and discipline, call out unnecessary risks
- free_play: light, conversational, not prescriptive

After the per-hole summaries, write one overall_summary: one strong observation about the round and one concrete takeaway for next time. Max 3 sentences for overall_summary.

Never use the words 'metric', 'session', 'feature', 'system', or 'data' in responses.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "hole_summaries": [
    { "hole_number": 1, "summary": "..." },
    ...
  ],
  "overall_summary": "..."
}`;

interface HoleSummaryRequest {
  hole_number: number;
  par: number;
  score: number | null;
  plan_summary: string | null;
  shots_summary: string | null;
  variance: number | null;
}

interface RecapRequest {
  player_name: string;
  course_name: string;
  mode: string;
  total_score: number;
  score_vs_par: number;
  holes_played: number;
  holes: HoleSummaryRequest[];
  pattern_insights: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const raw = (req.body ?? {}) as Partial<RecapRequest>;

    if (!Array.isArray(raw.holes) || raw.holes.length === 0) {
      return res.status(400).json({ error: 'holes[] (non-empty array of hole summaries) required' });
    }
    if (typeof raw.course_name !== 'string' || !raw.course_name.trim()) {
      return res.status(400).json({ error: 'course_name (string) required' });
    }

    const body = raw as RecapRequest;
    if (!Array.isArray(body.pattern_insights)) body.pattern_insights = [];

    const modeLabel: Record<string, string> = {
      break_100: 'Break 100',
      break_90:  'Break 90',
      break_80:  'Break 80',
      free_play: 'Free Play',
    };

    const holesBlock = body.holes
      .map(h => {
        const scoreLine = h.score != null
          ? `Score: ${h.score} (${h.variance != null ? (h.variance > 0 ? '+' + h.variance : String(h.variance)) : '?'} vs plan)`
          : 'Score: not recorded';
        const planLine = h.plan_summary ? `Plan: ${h.plan_summary}` : 'Plan: none';
        const shotsLine = h.shots_summary ? `Shots: ${h.shots_summary}` : 'Shots: not tracked';
        return `Hole ${h.hole_number} (par ${h.par}):\n  ${scoreLine}\n  ${planLine}\n  ${shotsLine}`;
      })
      .join('\n\n');

    const patternBlock = body.pattern_insights.length > 0
      ? `\nPlayer patterns this round:\n${body.pattern_insights.map(i => '- ' + i).join('\n')}`
      : '';

    const userMessage = `Recap for ${body.player_name || 'the player'} at ${body.course_name}.
Mode: ${modeLabel[body.mode] ?? body.mode}
Total: ${body.total_score} (${body.score_vs_par >= 0 ? '+' : ''}${body.score_vs_par}) over ${body.holes_played} holes
${patternBlock}

${holesBlock}

Write per-hole summaries and an overall summary. Respond only with valid JSON as specified.`;

    console.log('[recap] generating for', body.course_name, body.mode, body.holes_played, 'holes');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: RECAP_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content.find(b => b.type === 'text');
    const rawText = (block as { type: 'text'; text: string } | undefined)?.text ?? '';

    // Extract JSON — Claude sometimes wraps in ```json...```
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as {
      hole_summaries: Array<{ hole_number: number; summary: string }>;
      overall_summary: string;
    };

    console.log('[recap] generated', parsed.hole_summaries.length, 'hole summaries');
    return res.status(200).json(parsed);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[recap] error:', msg);
    return res.status(500).json({ error: msg });
  }
}
