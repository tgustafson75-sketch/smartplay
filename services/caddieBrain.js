/**
 * caddieBrain.js — Centralized AI Caddie Brain
 *
 * Sends full situational context to OpenAI and returns structured caddie advice:
 * club, target, miss strategy, and a confidence cue — all in under 60 words.
 *
 * IMPORTANT:
 *   - Does NOT modify voice profiles or playback
 *   - Does NOT mutate any existing store or state
 *   - Returns a plain string; caller decides how to display / speak it
 */

const OPENAI_API_KEY =
  process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Shot pattern helper (local, no network)
// ---------------------------------------------------------------------------

const getShotPattern = (shots = []) => {
  if (!shots.length) return 'neutral';
  const misses = shots.map((s) => s.miss ?? s.result).filter(Boolean);
  const right = misses.filter((m) => m === 'right').length;
  const left = misses.filter((m) => m === 'left').length;
  if (right > left) return 'miss_right';
  if (left > right) return 'miss_left';
  return 'neutral';
};

// ---------------------------------------------------------------------------
// getCaddieAdvice — main export
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   hole: number,
 *   distance: string | number,
 *   lie?: string,
 *   wind?: string,
 *   playerProfile?: object,
 *   shots?: Array<{ miss?: string, result?: string }>,
 *   mode?: string,
 *   strategy?: string,
 *   dispersion?: string,
 *   recommendedClub?: string | null,
 *   clubStats?: Record<string, { avg: number, min: number, max: number, count: number }> | null,
 * }} params
 * @returns {Promise<string>} caddie advice (plain text, ≤ 60 words)
 */
export const getCaddieAdvice = async ({
  hole,
  distance,
  lie = 'fairway',
  wind = 'calm',
  playerProfile = {},
  shots = [],
  mode = 'safe',
  strategy = null,
  dispersion = null,
  recommendedClub = null,
  clubStats = null,
}) => {
  if (!OPENAI_API_KEY) {
    console.warn('[CaddieBrain] EXPO_PUBLIC_OPENAI_API_KEY not set');
    return 'No API key — caddie unavailable.';
  }

  const pattern = getShotPattern(shots);

  const strategyBlock = strategy
    ? `\nSTRATEGY CONTEXT:\n${strategy}`
    : '';
  const dispersionBlock = dispersion && dispersion !== 'unknown'
    ? `\nDISPERSION:\n${dispersion}`
    : '';

  // Club learning block — only included when the player has real distance data
  const clubBlock = (() => {
    if (!recommendedClub && (!clubStats || Object.keys(clubStats).length === 0)) return '';
    const lines = [];
    if (recommendedClub) lines.push(`Recommended club (by distance match): ${recommendedClub}`);
    if (clubStats && Object.keys(clubStats).length > 0) {
      lines.push('Player-learned club distances:');
      Object.entries(clubStats)
        .sort((a, b) => b[1].avg - a[1].avg)
        .forEach(([c, s]) => lines.push(`  ${c}: avg ${s.avg}y (${s.count} shot${s.count !== 1 ? 's' : ''})`));
    }
    return `\nCLUB DATA (real player distances — use these over generic yardages):\n${lines.join('\n')}`;
  })();

  const prompt = `You are a professional golf caddie.

STYLE:
- Confident
- Calm
- Short and decisive
- No over-explaining

PLAYER:
${JSON.stringify(playerProfile)}

CURRENT SITUATION:
- Hole: ${hole}
- Distance: ${distance} yards
- Lie: ${lie}
- Wind: ${wind}
${strategyBlock}${dispersionBlock}${clubBlock}

SHOT PATTERN: ${pattern}

MODE: ${mode}

INSTRUCTIONS:
- Factor in dispersion and strategy when selecting club and target.
- Use real player distances from CLUB DATA when available; prefer the recommended club unless lie/wind override it.
- Adjust for wind and lie conditions.
Give:
1. Club
2. Target
3. Miss strategy
4. One sentence confidence line

Keep total response under 60 words.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 120,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`[CaddieBrain] OpenAI error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? 'No advice returned.';
};
