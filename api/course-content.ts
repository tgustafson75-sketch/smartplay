import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Phase D-1 — Course Detail content generation.
 *
 * Generates the About paragraph, Caddie Tips bullets, and per-hole one-liners
 * that populate the Course Detail surface. Voice: thoughtful caddie who has
 * played the course many times. Not marketing copy, not a database template.
 *
 * Input:
 *   { courseId, courseName, location?, par, yardage, rating?, slope?, holes: [{hole_number, par, yardage}] }
 *
 * Output:
 *   { about: string, caddie_tips: string[], hole_notes: [{hole_number, note}] }
 *
 * Uses Claude Sonnet for prose quality. Per-process in-memory cache keyed by
 * courseId — Vercel-instance-local; client-side AsyncStorage cache in
 * courseContentService.ts handles cross-session persistence.
 */

type HoleInput = { hole_number: number; par: number; yardage: number };
type CourseContent = {
  about: string;
  caddie_tips: string[];
  hole_notes: { hole_number: number; note: string }[];
};

const cache: Map<string, { content: CourseContent; cached_at: number }> = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

// Audit 101 / B4 — accept Persona | VoiceGender so callers can pass either.
const buildSystemPrompt = (g: Persona | VoiceGender) => `${getCharacterSpec(g)}

You are ${getCaddieName(g)} generating Course Detail content — a thoughtful caddie's preview of a course the player is about to study before they tee off.

Write as a caddie who has actually played this course many times. Specific over generic. Course character over scorecard recitation. Plain English over marketing copy.

Output ONLY a JSON object with this exact shape:
{
  "about": "<2 to 4 sentence paragraph capturing the course's character>",
  "caddie_tips": [
    "<specific actionable tip>",
    "<specific actionable tip>",
    "<4 to 6 tips total>"
  ],
  "hole_notes": [
    { "hole_number": 1, "note": "<one short specific phrase about this hole>" },
    { "hole_number": 2, "note": "<one short specific phrase>" }
    // ... one entry per hole in the input
  ]
}

Rules:
- About: 2-4 sentences. What kind of course is this? What does it ask of the player? Skip cliches like "challenging yet enjoyable" or "for golfers of all skill levels".
- Caddie Tips: 4-6 entries. Each one must be SPECIFIC. "Aim center on long par 4s" passes. "Play smart" fails. Tie to the course's actual character (length, par mix, region/conditions you can infer from the name).
- Hole Notes: exactly one entry per hole in the input. Short — 6 to 12 words. One phrase that gives the player something to think about on that hole. Lean on yardage and par to infer character (long par 4 = tee shot conversation, short par 3 = club selection conversation, par 5 = reachable-or-not conversation).
- No app-speak. No "metrics", "sessions", "features", "data".
- No bullet points, no headers, no commentary outside the JSON.
- Output ONLY valid JSON. No code fences, no preamble.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const courseId = String(body.courseId ?? '').trim();
    const courseName = String(body.courseName ?? '').trim();
    const location = body.location ? String(body.location) : '';
    const par = typeof body.par === 'number' ? body.par : 72;
    const yardage = typeof body.yardage === 'number' ? body.yardage : 0;
    const rating = typeof body.rating === 'number' ? body.rating : null;
    const slope = typeof body.slope === 'number' ? body.slope : null;
    const holesInput = (body.holes ?? []) as HoleInput[];
    const voiceGender: VoiceGender = (body.voiceGender as VoiceGender | undefined) ?? 'male';
    // Audit 101 / B4 — prefer body.persona; fall back to voiceGender.
    const personaInput: Persona | VoiceGender =
      (typeof body.persona === 'string' ? (body.persona as string) : voiceGender) as Persona | VoiceGender;

    if (!courseId || !courseName || !Array.isArray(holesInput) || holesInput.length === 0) {
      return res.status(400).json({ error: 'courseId, courseName, and non-empty holes array required' });
    }

    // Cache hit
    const cached = cache.get(courseId);
    if (cached && Date.now() - cached.cached_at < CACHE_TTL_MS) {
      return res.status(200).json({ ...cached.content, cached: true });
    }

    const userPrompt = `Course: ${courseName}${location ? ` (${location})` : ''}
Total: par ${par}, ${yardage} yards${rating != null ? `, rating ${rating}` : ''}${slope != null ? `, slope ${slope}` : ''}

Holes:
${holesInput.map(h => `${h.hole_number}: par ${h.par}, ${h.yardage}y`).join('\n')}

Generate the JSON.`;

    // Audit 101 / W4 — opt the system prompt into Anthropic ephemeral
    // prompt caching (5-min TTL). Course content prompts are large.
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.7,
      system: [{ type: 'text', text: buildSystemPrompt(personaInput), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = completion.content.find(c => c.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    if (!text) {
      console.error('[course-content] empty response');
      return res.status(502).json({ error: 'Empty model response' });
    }

    let parsed: CourseContent;
    try {
      // Strip code fences if model added them despite instructions
      const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(cleaned) as CourseContent;
    } catch (e) {
      console.error('[course-content] JSON parse failed:', text.slice(0, 300));
      return res.status(502).json({ error: 'Model returned non-JSON', raw: text.slice(0, 300) });
    }

    // Defensive normalization
    if (typeof parsed.about !== 'string') parsed.about = '';
    if (!Array.isArray(parsed.caddie_tips)) parsed.caddie_tips = [];
    if (!Array.isArray(parsed.hole_notes)) parsed.hole_notes = [];

    cache.set(courseId, { content: parsed, cached_at: Date.now() });
    return res.status(200).json({ ...parsed, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-content] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
