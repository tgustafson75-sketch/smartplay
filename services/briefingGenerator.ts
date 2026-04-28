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
}

// In-memory cache: roundId → briefing text
const cache = new Map<string, string>();

export function clearBriefingCache(roundId?: string): void {
  if (roundId) {
    cache.delete(roundId);
  } else {
    cache.clear();
  }
}

export async function generateBriefing(params: BriefingParams): Promise<string> {
  const { roundId, apiUrl, language = 'en', ...rest } = params;

  const cached = cache.get(roundId);
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

    cache.set(roundId, text);
    return text;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
