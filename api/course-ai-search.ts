/**
 * 2026-06-30 — AI course-search FALLBACK (Tim: "we have the Gemini API, facilitate
 * the search").
 *
 * The primary course search (api/course-proxy → golfcourseapi.com) is a TEXT search
 * against a finite DB. When a real course isn't in that DB the caddie was wrongly
 * saying "not in the database" and the user hit a dead end. This route is the
 * fallback: ask the AI provider (Gemini by default) to IDENTIFY the course from the
 * query so we can still confirm it exists, place it, hand it to the caddie brain, and
 * offer a booking link.
 *
 * HONESTY BOUNDARY (Tim's "Recognize + book + brain" choice): an AI result has NO hole
 * geometry — it CANNOT drive the SmartVision/SmartFinder GPS overlay. So:
 *   - found=false (+ low confidence) when the model doesn't actually recognize it.
 *     The model is instructed to NEVER fabricate a course.
 *   - the client labels these results "AI-identified · no GPS overlay" and routes them
 *     to info + booking, not to a normal playable round.
 *
 * Distinct from api/course-intelligence (web-grounded 2-3 sentence brief for a course
 * we already have an id for). This one RESOLVES an unknown query to a course identity.
 *
 * Output shape: { found, name, club_name, city, state, country, location, description,
 * website, confidence }.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { completeJSON, providerFromHeaderSafe, type StructuredSchema } from './_aiProvider';

// 2026-06-30 — robust JSON extraction. Even with responseSchema, a provider can wrap the
// object in ```json fences or add a stray preamble; strip those and pull the first {...}
// block before parsing so a real course never reads as "unreadable". (The other failure
// mode — truncation — is prevented by a larger token budget + a bounded description.)
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

const COURSE_SCHEMA: StructuredSchema = {
  name: 'ai_course_identity',
  openai: {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      name: { type: 'string' },
      club_name: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      country: { type: 'string' },
      description: { type: 'string' },
      website: { type: ['string', 'null'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['found', 'name', 'club_name', 'city', 'state', 'country', 'description', 'website', 'confidence'],
    additionalProperties: false,
  },
  gemini: {
    type: 'OBJECT',
    properties: {
      found: { type: 'BOOLEAN' },
      name: { type: 'STRING' },
      club_name: { type: 'STRING' },
      city: { type: 'STRING' },
      state: { type: 'STRING' },
      country: { type: 'STRING' },
      description: { type: 'STRING' },
      website: { type: 'STRING', nullable: true },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    },
    required: ['found', 'name', 'club_name', 'city', 'state', 'country', 'description', 'website', 'confidence'],
  },
};

const SYSTEM_PROMPT = `You identify golf courses from a user's search text for a golf caddie app. The user typed a course name (possibly partial, misspelled, or with a town) that was NOT found in our course database. Decide whether it names a REAL golf course you actually know.

RULES — honesty is critical:
- If you genuinely recognize a real golf course matching the query, set found=true and fill in its real name, club/facility name, city, state/province, country, and a description that is ONE short sentence (max ~20 words: character like links/parkland/desert/mountain, public/private, anything notable). Keep it concise.
- If you do NOT recognize a specific real course, OR you would have to guess/invent details, set found=false and use confidence "low". NEVER fabricate a course, address, or website. A wrong "yes" is worse than an honest "no".
- confidence: "high" only when you're sure of the exact course; "medium" when you know a course by that name but are unsure of the specific location; "low" when unsure.
- website: the course's real website if you know it, otherwise null. Do not invent URLs.
- Prefer the most likely single match. If the query is ambiguous between several courses, pick the best-known and lower the confidence.

Return ONLY the structured object.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const q = (req.method === 'POST' ? (req.body?.q ?? req.body?.query) : (req.query.q ?? req.query.query)) as string | undefined;
  const region = (req.method === 'POST' ? req.body?.region : req.query.region) as string | undefined;

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Missing search query (q=...)' });
  }

  const provider = providerFromHeaderSafe(req.headers as Record<string, string | string[] | undefined>);
  const userPrompt = region
    ? `Course search: "${q.trim()}". The user is near: ${region}. Identify the course.`
    : `Course search: "${q.trim()}". Identify the course.`;

  try {
    const raw = await completeJSON(
      provider,
      'fast',
      SYSTEM_PROMPT,
      [{ role: 'user', content: userPrompt }],
      // 768 tokens (was 400) so the JSON object always completes — a verbose description
      // was truncating mid-string and failing the parse for real courses (e.g. Green Hill,
      // Worcester). The prompt also bounds the description to one short sentence.
      { maxTokens: 768, temperature: 0, schema: COURSE_SCHEMA, timeoutMs: 18_000 },
    );

    const parsed = extractJson(raw);
    if (!parsed) {
      console.error('[course-ai-search] non-JSON response:', raw.slice(0, 200));
      return res.status(200).json({ found: false, _error: 'AI search returned an unreadable result' });
    }

    const found = parsed.found === true;
    if (!found) {
      return res.status(200).json({ found: false });
    }

    const city = String(parsed.city ?? '').trim();
    const state = String(parsed.state ?? '').trim();
    const country = String(parsed.country ?? '').trim();
    const location = [city, state, country].filter(Boolean).join(', ');
    const website = parsed.website && String(parsed.website).startsWith('http') ? String(parsed.website) : null;

    return res.status(200).json({
      found: true,
      name: String(parsed.name ?? parsed.club_name ?? q).trim(),
      club_name: String(parsed.club_name ?? parsed.name ?? '').trim(),
      city,
      state,
      country,
      location,
      description: String(parsed.description ?? '').trim(),
      website,
      confidence: ['high', 'medium', 'low'].includes(String(parsed.confidence)) ? String(parsed.confidence) : 'low',
      source: 'ai',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[course-ai-search] exception:', msg);
    return res.status(200).json({ found: false, _error: 'AI search unavailable' });
  }
}
