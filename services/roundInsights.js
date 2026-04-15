/**
 * roundInsights.js — AI-powered end-of-round coaching summary.
 *
 * Sends round stats and shot data to OpenAI once per round and returns
 * short, personal coaching insights. Called ONLY at round completion —
 * never during play.
 *
 * Usage:
 *   import { getRoundInsights } from '../services/roundInsights';
 *   const text = await getRoundInsights(holeStatsLog, shots);
 */

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

/**
 * Generate 3 insights + 1 priority from the completed round.
 *
 * @param {Array<{ hole: number, strokes: number, putts: number, fairwayHit: boolean|null, gir: boolean|null }>} holeStatsLog
 * @param {Array<{ club?: string, result?: string, miss?: string, distance?: number }>} shots
 * @returns {Promise<string>} — short coaching summary (<= 80 words), or null on failure
 */
export const getRoundInsights = async (holeStatsLog = [], shots = []) => {
  if (!OPENAI_API_KEY) return null;
  if (holeStatsLog.length === 0 && shots.length === 0) return null;

  // Build a lightweight summary to keep the prompt short
  const totalStrokes = holeStatsLog.reduce((s, h) => s + (h.strokes ?? 0), 0);
  const totalPutts   = holeStatsLog.reduce((s, h) => s + (h.putts   ?? 0), 0);
  const firs         = holeStatsLog.filter((h) => h.fairwayHit === true).length;
  const firAttempts  = holeStatsLog.filter((h) => h.fairwayHit !== null).length;
  const girs         = holeStatsLog.filter((h) => h.gir        === true).length;
  const girAttempts  = holeStatsLog.filter((h) => h.gir        !== null).length;
  const rightMiss    = shots.filter((s) => s.result === 'right' || s.miss === 'right').length;
  const leftMiss     = shots.filter((s) => s.result === 'left'  || s.miss === 'left' ).length;
  const totalShots   = shots.length;

  const summary = {
    holes:    holeStatsLog.length,
    strokes:  totalStrokes,
    putts:    totalPutts || null,
    fir:      firAttempts > 0 ? `${firs}/${firAttempts}` : null,
    gir:      girAttempts > 0 ? `${girs}/${girAttempts}` : null,
    miss_pattern: rightMiss > leftMiss ? 'right' : leftMiss > rightMiss ? 'left' : 'balanced',
    total_shots: totalShots,
  };

  const prompt = `You are a golf coach reviewing a completed round.

Round summary:
${JSON.stringify(summary)}

Give EXACTLY:
- 3 key insights (one sentence each)
- 1 priority improvement for next round (one sentence)

Be specific, practical, and encouraging. Keep total response under 80 words.`;

  try {
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
        max_tokens: 150,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
};
