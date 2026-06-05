/**
 * 2026-06-04 — Kevin's Read generator.
 *
 * Pulls the last 5 rounds + their shots from roundStore, POSTs them to
 * /api/kevin-read (Haiku, 2-3 sentence assessment), and caches the
 * result on playerProfileStore.kevinRead.
 *
 * Three call sites:
 *   - roundStore.endRound fires this fire-and-forget after the recap
 *     generation kicks off.
 *   - Dashboard "tap to refresh" on the Kevin's Read card.
 *   - Could be called from a settings-debug surface for manual refresh.
 *
 * Never throws — every failure path writes a fallback string to the
 * store so the dashboard always has SOMETHING to render. Concurrency
 * guarded by an in-flight flag so rapid double-taps don't fire two
 * requests.
 */

import { useRoundStore } from '../store/roundStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';

const MAX_ROUNDS = 5;
const MAX_SHOTS = 60;

let inFlight = false;

export async function generateKevinRead(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
    if (!apiUrl) {
      // No API URL configured (likely dev without env) — leave the cache
      // alone; dashboard falls back to its inline default line.
      return;
    }

    const round = useRoundStore.getState();
    const recent = round.roundHistory.slice(-MAX_ROUNDS);
    const recentRounds = recent.map(r => ({
      totalScore: r.totalScore,
      scoreVsPar: r.scoreVsPar,
      holesPlayed: r.holesPlayed,
      mode: r.mode,
      courseName: r.courseName ?? null,
      endedAt: r.endedAt,
    }));

    // Trim shots to MAX_SHOTS most-recent across the rounds (newest first).
    const allShots = recent
      .flatMap(r => r.shots)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, MAX_SHOTS)
      .map(s => ({
        hole: s.hole,
        club: s.club ?? null,
        direction: s.direction ?? null,
        feel: s.feel ?? null,
        outcome: s.outcome ?? null,
        distance_yards: s.distance_yards ?? null,
        carry_distance: s.carry_distance ?? null,
        shot_in_hole_index: s.shot_in_hole_index ?? null,
      }));

    const res = await fetch(apiUrl + '/api/kevin-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rounds: recentRounds, shots: allShots }),
      // Tight timeout — this is opportunistic; we don't block UX on it.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.log('[kevinRead] non-2xx:', res.status);
      return;
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? '').trim();
    if (!text) return;

    usePlayerProfileStore.getState().setKevinRead({
      text,
      generatedAt: Date.now(),
    });
  } catch (e) {
    console.log('[kevinRead] generate failed (non-fatal):', e instanceof Error ? e.message : e);
  } finally {
    inFlight = false;
  }
}
