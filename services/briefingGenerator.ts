import type { RoundMode } from '../types/patterns';

interface BriefingParams {
  roundId: string;
  courseName: string;
  mode: RoundMode;
  playerName: string;
  handicap: number;
  goal: string | null;
  dominantMiss: string | null;
  patternInsights: string[];
  ghostLabel: string | null;
  roundsTogether: number;
  apiUrl: string;
  language?: string;
  // Phase T — pre-computed by caller via handicapCalculator if Index is set
  courseHandicap?: number | null;
  teeName?: string | null;
  // Phase U — meaningful drift across recent rounds (from detectPatternShift)
  patternShiftAlert?: string | null;
}

// In-memory cache: `${roundId}|${language}` → briefing text. Keyed by
// language too so a mid-round language change re-fetches in the new tongue
// instead of returning the stale English text and speaking it with the
// Spanish/Chinese voice.
const cache = new Map<string, string>();
const cacheKey = (roundId: string, language: string): string =>
  `${roundId}|${language}`;

export function clearBriefingCache(roundId?: string): void {
  if (roundId) {
    for (const k of Array.from(cache.keys())) {
      if (k.startsWith(`${roundId}|`)) cache.delete(k);
    }
  } else {
    cache.clear();
  }
}

export async function generateBriefing(params: BriefingParams): Promise<string> {
  const { roundId, apiUrl, language = 'en', ...rest } = params;

  const cached = cache.get(cacheKey(roundId, language));
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(apiUrl + '/api/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ ...rest, language }),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Briefing API returned ' + res.status);

    const data = await res.json() as { brief?: string };
    const text = data.brief?.trim() ?? '';
    if (!text) throw new Error('Empty briefing response');

    cache.set(cacheKey(roundId, language), text);
    return text;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
