/**
 * Phase AQ — Context synthesis endpoint.
 *
 * Single Sonnet call that produces a persistent context blob for one of
 * four event types. Output is stored client-side and injected into every
 * future Kevin system prompt so each call has user-specific grounding
 * without per-call latency or repeated synthesis.
 *
 * Request shape:
 *   POST /api/context-synthesis
 *   { type: 'onboarding' | 'cage_session' | 'round' | 'patterns', payload: {...} }
 *
 * Response: { summary: string }
 *
 * Cost: 1 Sonnet call per event. Per-user monthly volume:
 *   - Onboarding: 1 (one-time)
 *   - Cage sessions: ~5-15
 *   - Rounds: ~5-20
 *   - Patterns: 4 (weekly-ish)
 * → ~15-40 Sonnet calls/user/month for context architecture. Bounded.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type SynthesisType = 'onboarding' | 'cage_session' | 'round' | 'patterns';

const PROMPT_BY_TYPE: Record<SynthesisType, (payload: Record<string, unknown>) => { system: string; user: string }> = {
  onboarding: (p) => ({
    system: `You are writing a private 2-3 paragraph note for Kevin (an AI golf caddie) about a new user. Caddie's-eye-view: what this golfer is trying to achieve, what their level suggests about how to caddie for them, what to remember about their game, AND what tone register fits them.

The note should explicitly call out:
- Their level (handicap + experience context — are they starting / improving / returning / competitive?)
- Their typical miss in language Kevin can act on ("favor left targets" not just "slice")
- The tone register that fits them best:
  * "starting" → patient, encouraging, plain-language explanations
  * "improving" → engaged coach voice on practice, decisive caddie on course
  * "returning" → supportive, non-judgmental, acknowledge effort over outcome
  * "competitive" → terse, precise, no fluff, admit uncertainty fast

Style: terse, factual, second-person from Kevin's perspective ("She's an 18 handicap rebuilding after a decade away — keep the tone supportive..."). No advice to user, no padding. Output the note text only — no preamble, no headers.`,
    user: `New user inputs:
- Name: ${p.firstName ?? 'unknown'}
- Handicap: ${p.handicap ?? 'unknown'}
- Goal mode: ${p.defaultMode ?? 'unknown'}
- Goal text: ${p.goal ?? 'unknown'}
- Typical miss: ${p.missType ?? p.dominantMiss ?? 'unknown'}
- Where they are in their golf: ${p.experienceContext ?? 'unknown'}
- Physical limitation: ${p.physicalLimitation ?? 'none stated'}
- Home course: ${p.homeCourse ?? 'unknown'}
- Personal best: ${p.personalBest ?? 'unknown'}

Write the caddie's-eye-view note. Include the tone register guidance.`,
  }),

  cage_session: (p) => ({
    system: `You are writing a private 1-paragraph note for Kevin about a practice session. What to remember from this practice if relevant patterns appear next round.

Style: terse, factual, second-person from Kevin's perspective. Reference specific clubs and faults if known. Output the note text only.`,
    user: `Cage session:
- Club: ${p.club ?? 'unknown'}
- Shot count: ${p.shotCount ?? 0}
- Primary issue: ${p.primaryIssue ?? 'no fault detected'}
- Severity: ${p.severity ?? 'unknown'}
- Drill recommended: ${p.drillName ?? 'none'}
- Dominant miss: ${p.dominantMiss ?? 'unknown'}

Write the practice-memory note.`,
  }),

  round: (p) => ({
    system: `You are writing a private 1-paragraph note for Kevin about a completed round. What to remember if the user plays this course again or shows similar patterns.

Style: terse, factual, second-person. Specific (course name, hole numbers, club tendencies) — no generic golf platitudes. Output the note text only.`,
    user: `Round:
- Course: ${p.course ?? 'unknown'}
- Score: ${p.score ?? 'unknown'} (${p.scoreVsPar ?? 0} vs par)
- Holes played: ${p.holesPlayed ?? 0}
- Notable patterns: ${(p.patterns as string[] ?? []).join(' / ') || 'none flagged'}
- Hero moments: ${p.heroCount ?? 0}
- Dominant miss this round: ${p.dominantMiss ?? 'unknown'}

Write the round-memory note.`,
  }),

  patterns: (p) => ({
    system: `You are writing a private 2-3 sentence cross-session pattern summary for Kevin. Look across the user's recent rounds and practice for emerging tendencies — swing tendencies, scoring tendencies, club usage, course strugglers.

Style: terse, factual, second-person. If no real pattern emerges, say so honestly ("No clear pattern across these sessions yet."). Output the summary text only.`,
    user: `Recent activity:
- Rounds: ${p.roundCount ?? 0} (last ${p.windowDays ?? 30} days)
- Cage sessions: ${p.cageCount ?? 0}
- Round insights: ${(p.recentRoundInsights as string[] ?? []).slice(0, 5).join(' || ') || 'none yet'}
- Cage insights: ${(p.recentCageInsights as string[] ?? []).slice(0, 5).join(' || ') || 'none yet'}

Write the cross-session pattern summary.`,
  }),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      type?: SynthesisType;
      payload?: Record<string, unknown>;
    };
    const type = body.type;
    const payload = body.payload ?? {};

    if (!type || !PROMPT_BY_TYPE[type]) {
      return res.status(400).json({ error: 'invalid type' });
    }

    const { system, user } = PROMPT_BY_TYPE[type](payload);

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      temperature: 0.4,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const block = completion.content.find(c => c.type === 'text');
    const summary = block && block.type === 'text' ? block.text.trim() : '';
    if (!summary) return res.status(502).json({ error: 'Empty model response' });

    console.log(`[context-synthesis] type=${type} chars=${summary.length}`);
    return res.status(200).json({ summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[context-synthesis] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
