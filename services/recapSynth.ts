/**
 * 2026-06-13 (Tim — speed is critical) — INSTANT recap from the stored RoundRecord.
 *
 * The recap screen used to poll the archive for 30s; a round that never had an LLM
 * recap generated (older in-app rounds, or generation still pending) just spun. This
 * builds a complete, honest recap synchronously from data we already have on the
 * record (scores, shots, the deterministic summary) so the round renders immediately.
 * The richer archived recap (if/when it exists) still wins on the screen.
 *
 * PURE — types-only imports (no react-native / expo), so it's unit-testable in the
 * sim harness and safe to call synchronously on render. Never throws.
 */

import type { RoundRecap, HoleComparison } from '../types/plan';
import type { RoundRecord } from '../store/roundStore';

export function synthesizeRecapFromRecord(record: RoundRecord): RoundRecap {
  const holes = Object.keys(record.scores ?? {})
    .map((k) => Number(k))
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);
  const hole_comparisons: HoleComparison[] = holes.map((hole) => ({
    hole_number: hole,
    actual_shots: (record.shots ?? []).filter((s) => s.hole === hole),
    actual_score: typeof record.scores[hole] === 'number' ? record.scores[hole] : null,
    matched_shots: [],
    kevin_summary: null,
  }));
  return {
    round_id: record.id,
    course_id: record.courseId ?? '',
    course_name: record.courseName ?? 'Your round',
    mode: record.mode ?? 'free_play',
    started_at: record.startedAt,
    ended_at: record.endedAt,
    total_score: record.totalScore,
    hole_comparisons,
    overall_kevin_summary: record.summary ?? null,
    ghost_match: null,
  };
}
