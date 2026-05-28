import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { getCaddieName, getCharacterSpec, type VoiceGender, type Persona } from '../lib/persona';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 1 });

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

// 2026-05-28 — Fix FT: per-hole description for unfamiliar courses.
// hole_notes is the existing 6-12 word phrase; hole_descriptions is
// the new 2-3 sentence preview a player would want before teeing off
// on a course they've never seen. Both shipped together so existing
// consumers (Course Detail screen) keep working while new surfaces
// (hole-view, pre-shot card) can opt into the longer copy.
//
// description_source is the trust marker: 'public_synthesis' means
// AI-generated from par/yardage/course-name (no field verification,
// no hazard placements unless the input data confirmed them).
// Future: 'pro_contributed' (Tank/Randy/etc) and 'field_verified'
// (player feedback corrections) flow through the same field with
// different markers so the UI can render confidence.
type HoleDescription = {
  hole_number: number;
  description: string;
  description_source: 'public_synthesis' | 'pro_contributed' | 'field_verified';
};

type CourseContent = {
  about: string;
  caddie_tips: string[];
  hole_notes: { hole_number: number; note: string }[];
  hole_descriptions: HoleDescription[];
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
  ],
  "hole_descriptions": [
    { "hole_number": 1, "description": "<2 to 3 sentence preview a first-time player would want>" },
    { "hole_number": 2, "description": "<2 to 3 sentence preview>" }
    // ... one entry per hole in the input
  ]
}

Rules:
- About: 2-4 sentences. What kind of course is this? What does it ask of the player? Skip cliches like "challenging yet enjoyable" or "for golfers of all skill levels".
- Caddie Tips: 4-6 entries. Each one must be SPECIFIC. "Aim center on long par 4s" passes. "Play smart" fails. Tie to the course's actual character (length, par mix, region/conditions you can infer from the name).
- Hole Notes: exactly one entry per hole in the input. Short — 6 to 12 words. One phrase that gives the player something to think about on that hole. Lean on yardage and par to infer character (long par 4 = tee shot conversation, short par 3 = club selection conversation, par 5 = reachable-or-not conversation).

HOLE DESCRIPTIONS (most important rules — read carefully):
- Exactly one entry per hole. 2-3 sentences, ~25-50 words.
- This is for a player who has NEVER seen this course and is about to tee off. They want what a friend who's played there would tell them in the cart.
- BE HONEST about what you don't know. You have par + yardage + course name + region inferred from name. You do NOT have hole-by-hole hazard positions. So:
  - YES: "Long par 4 — the tee shot is the conversation. Anything short and you've got a long iron in."
  - YES: "Short par 3 — wedge or short iron, but pin position will dictate which side to miss."
  - YES: "Reachable par 5 for big hitters. Worth knowing whether you're going for it before you tee off."
  - NO: "Bunker right at 230" / "Water left of the green" / "Dogleg right around the trees" — you have no source for ANY of those specifics. Inventing them is worse than no description.
- Use the COURSE'S region/character to flavor (a Scottish links course plays different than a Florida resort; "Pebble Beach" implies coastal, "Pinehurst" implies pine corridors). Stay within what the name reasonably tells you.
- Skip if a hole has weird input data (yardage=0 or par=0 or hole_number<=0). Return an honest description if you can; OK to write "Limited data — play your standard plan" rather than invent.
- This is "from public data" framing, not "I have walked this course." Sound like a caddie summarizing what's known, not making things up.

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
    //
    // 2026-05-28 — Fix FT: max_tokens bumped 2000 → 4500 to make room for
    // hole_descriptions (18 holes × ~50 words × ~1.5 tokens/word ≈ 1350
    // additional tokens). 2000 was tight on the prior 3-section payload;
    // truncating now would lose mid-array hole entries.
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4500,
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

    // 2026-05-28 — Fix FT: normalize the new hole_descriptions array.
    // Stamp description_source='public_synthesis' on every entry the
    // model produced — this is the trust marker the UI surfaces as
    // "from public data, not field-verified." Pro-contributed and
    // field-verified sources will eventually overwrite specific entries
    // via a separate path and carry their own marker. Missing entries
    // (model omitted a hole, or output got truncated) are NOT
    // backfilled with placeholder text — the UI just doesn't render
    // a description card for that hole. Honest empty > invented copy.
    if (!Array.isArray(parsed.hole_descriptions)) {
      parsed.hole_descriptions = [];
    }
    parsed.hole_descriptions = (parsed.hole_descriptions as unknown[])
      .map((raw): HoleDescription | null => {
        if (raw == null || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        const holeNumber = typeof r.hole_number === 'number' ? r.hole_number : null;
        const description = typeof r.description === 'string' ? r.description.trim() : '';
        if (holeNumber == null || description.length === 0) return null;
        return {
          hole_number: holeNumber,
          description,
          description_source: 'public_synthesis' as const,
        };
      })
      .filter((h): h is HoleDescription => h != null);

    cache.set(courseId, { content: parsed, cached_at: Date.now() });
    return res.status(200).json({ ...parsed, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-content] exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
