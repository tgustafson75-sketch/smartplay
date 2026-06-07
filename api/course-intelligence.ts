/**
 * 2026-06-06 — Phase 2.5: Course intelligence prefetch.
 *
 * Pulls a condensed 2-3 sentence brief about a specific course via
 * Anthropic Sonnet with the web_search tool enabled. The brief is
 * what a caddie WOULD know walking onto a course they've played
 * before: signature holes, course character, common difficulty
 * patterns, anything that helps the brain give specific advice
 * instead of generic theory.
 *
 * Distinct from /api/course-content (Phase D-1):
 *   - course-content generates structured About + Caddie Tips + per-
 *     hole notes from Claude's training data alone (no web search).
 *   - course-intelligence pulls LIVE web-search-grounded info for the
 *     specific course, condensed to ~200-400 chars total. Cheaper to
 *     bundle into every /api/kevin call than course-content's full
 *     payload, but live + accurate where course-content guesses.
 *
 * Output shape: { intelligence: string | null, source: string,
 * cached_at: number }
 *
 * Caching: per-process in-memory (Vercel-instance-local). Client-side
 * AsyncStorage persistence in services/courseIntelligenceService.ts
 * with a 30-day TTL so even after instance recycling we don't refetch.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });

type Cached = { intelligence: string | null; cached_at: number };
const cache = new Map<string, Cached>();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SYSTEM_PROMPT = `You are researching a golf course for a caddie. Search the web for current information about the course and return a CONDENSED 2-3 sentence brief that helps a caddie give specific, useful advice during a round.

What to include (prioritized):
- Signature holes (by number) and what makes them notable
- Course character (links / parkland / desert / mountain / target-style)
- Common difficulty patterns the player will face (greens speed, wind exposure, forced carries, doglegs)
- One or two specific tactical notes a caddie would mention

What to AVOID:
- Marketing fluff ("renowned championship layout", "pristine conditions")
- History trivia that doesn't help the player today
- Generic golf advice ("hit the fairway")
- Anything you couldn't verify from your searches

Output ONLY the 2-3 sentence brief as plain text. No headers, no bullets, no preamble, no "I searched for...". If you genuinely can't find specifics, return the SINGLE word: UNKNOWN.

Length target: 200-400 characters total. Tight is good.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const courseId = String(body.courseId ?? '').trim();
    const courseName = String(body.courseName ?? '').trim();
    const location = body.location ? String(body.location) : '';

    if (!courseId || !courseName) {
      return res.status(400).json({ error: 'courseId and courseName required' });
    }

    const cached = cache.get(courseId);
    if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
      return res.status(200).json({ intelligence: cached.intelligence, source: 'cache', cached_at: cached.cached_at });
    }

    const userPrompt = `Course: ${courseName}${location ? ` (${location})` : ''}\n\nResearch and return the brief.`;

    // Anthropic web_search tool. The model decides whether and how
    // many times to search; we cap at 3 invocations to keep cost
    // predictable. Returns plain text — we treat 'UNKNOWN' as null
    // so the client doesn't inject useless context.
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      temperature: 0.3,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        } as unknown as Anthropic.Tool,
      ],
      messages: [{ role: 'user', content: userPrompt }],
    });

    // The model may produce text in multiple blocks interleaved with
    // tool_use blocks. Concatenate all text-block content.
    const textParts: string[] = [];
    for (const block of completion.content) {
      if (block.type === 'text') textParts.push(block.text);
    }
    const raw = textParts.join('\n').trim();

    const intelligence =
      !raw || /^unknown\s*$/i.test(raw) ? null : raw.length > 800 ? raw.slice(0, 800) : raw;

    const entry: Cached = { intelligence, cached_at: Date.now() };
    cache.set(courseId, entry);

    return res.status(200).json({ intelligence: entry.intelligence, source: 'fresh', cached_at: entry.cached_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[course-intelligence] error:', msg);
    return res.status(200).json({ intelligence: null, source: 'error', error: msg, cached_at: Date.now() });
  }
}
