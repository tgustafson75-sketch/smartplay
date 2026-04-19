// Round Analyzer Service
// Fire-and-forget: called once when a round ends.
// Sends aggregated shot stats to the local API route, then persists the AI insight.
// NEVER called during live gameplay. App works fully if this fails.

import type { Shot } from '../store/roundStore';
import type { AiRoundInsight } from '../app/api/analyze-round+api';
import { useAiProfileStore } from '../store/aiProfileStore';

/** Tallies directional miss results from a set of shots. */
export function getMissStats(shots: Shot[]): { left: number; right: number; center: number } {
  const stats = { left: 0, right: 0, center: 0 };
  for (const s of shots) {
    if (s.result === 'left')   stats.left++;
    if (s.result === 'right')  stats.right++;
    if (s.result === 'center') stats.center++;
  }
  return stats;
}

/**
 * Submits the completed round's shot data to the AI analysis endpoint.
 * Runs fully in the background — does not await in the call site.
 * Gracefully ignores network failures, timeouts, or parse errors.
 */
export async function analyzeRoundInBackground(shots: Shot[]): Promise<void> {
  if (!shots || shots.length < 3) return; // too few shots to be meaningful

  try {
    const controller = new AbortController();
    // 15-second hard timeout — never blocks the UI
    const timer = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch('/api/analyze-round', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) return; // silently drop failures

    const insight: AiRoundInsight = await res.json();

    // Validate the response has the required shape before persisting
    if (
      typeof insight?.missBias === 'string' &&
      typeof insight?.confidence === 'string'
    ) {
      useAiProfileStore.getState().applyInsight({
        missBias:        insight.missBias,
        confidence:      insight.confidence,
        clubAdjustments: insight.clubAdjustments ?? {},
        coachNote:       insight.coachNote ?? '',
      });
    }
  } catch {
    // Network error, abort, parse failure — all silently ignored
  }
}
