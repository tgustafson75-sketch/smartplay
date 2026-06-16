import type { RoundMode } from '../types/patterns';
import type { Persona, VoiceGender } from '../lib/persona';

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
  // Phase V.7+ — last 1-3 cage sessions so the first-tee briefing can
  // reference recent practice ("let's see if Tuesday's driver work holds up")
  // instead of starting cold every round.
  recentCageSessions?: Array<{
    club: string;
    dominantMiss: string | null;
    rootCause: string | null;
    date: string;
  }>;
  voiceGender?: VoiceGender;
  // 2026-05-21 — Fix Q: pass the active persona so the briefing renders
  // in the user's selected caddie's voice + system prompt. Without it the
  // backend resolves voiceGender → Kevin/Serena and ignores Tank.
  persona?: Persona;
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

// 2026-06-15 (Tim — pre-round brief fired ~25s AFTER start-round) — ROOT CAUSE:
// the brief is generated at the hole-1 handoff, which is the FIRST hit on the
// cold /api/briefing Lambda (Sonnet ~14s + cold boot + cold TLS). Fire this the
// instant "Start Round Here" is tapped: it warms the Lambda + Anthropic SDK +
// TLS during the navigation/round-setup window, so the real brief at the handoff
// lands promptly instead of paying the full cold-start while people watch.
// Fire-and-forget, 30s dedupe, silent on failure. Mirrors prewarmVoice().
let lastBriefingWarmAt = 0;
const BRIEFING_WARMUP_DEDUPE_MS = 30_000;
export function prewarmBriefing(apiUrl: string): void {
  const now = Date.now();
  if (now - lastBriefingWarmAt < BRIEFING_WARMUP_DEDUPE_MS) return;
  lastBriefingWarmAt = now;
  if (!apiUrl) return;

  void fetch(`${apiUrl}/api/briefing?mode=warmup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'warmup' }),
    signal: AbortSignal.timeout(15_000),
  })
    .then(() => { console.log('[briefingGenerator] briefing endpoint warmed'); })
    .catch(() => { /* Silent — warmup is opportunistic. */ });
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
      body: JSON.stringify({
        ...rest,
        language,
        voiceGender: params.voiceGender ?? 'male',
        persona: params.persona,
      }),
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
