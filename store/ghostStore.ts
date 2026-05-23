import { create } from 'zustand';
import type { RoundRecord } from './roundStore';
import type { GhostHoleResult, GhostMatchSnapshot } from '../types/ghost';

// Not persisted — ghost match is only active during a live round.

interface GhostState {
  ghostRecord: RoundRecord | null;
  holeResults: Record<number, GhostHoleResult>;
  overall_delta: number;
  holes_compared: number;

  activateGhost: (record: RoundRecord) => void;
  deactivateGhost: () => void;
  updateHole: (holeNumber: number, currentScore: number) => void;
  getLabel: () => string | null;
  getSummaryText: () => string | null;
  getSnapshot: () => GhostMatchSnapshot | null;
  /** 2026-05-22 — UI accessor. The ghost score on `holeNumber` from the
   *  prior round, when present. Null when no ghost is active or the past
   *  round didn't have a score for that hole. Strong current-hole bias:
   *  callers pass the current hole and get back the directly-comparable
   *  prior-round score. */
  getGhostScoreForHole: (holeNumber: number) => number | null;
  /** 2026-05-22 — UI accessor. Compact one-line "vs last time" string for
   *  the current hole, suitable for rendering in DataStrip / Cockpit.
   *  Strong current-hole bias plus the running overall_delta for context.
   *  Returns null when no ghost is active.
   *  Example: "vs last: -1 hole · -2 round" */
  getHoleDeltaLine: (holeNumber: number) => string | null;
}

export const useGhostStore = create<GhostState>((set, get) => ({
  ghostRecord: null,
  holeResults: {},
  overall_delta: 0,
  holes_compared: 0,

  activateGhost: (record) => set({
    ghostRecord: record,
    holeResults: {},
    overall_delta: 0,
    holes_compared: 0,
  }),

  deactivateGhost: () => set({
    ghostRecord: null,
    holeResults: {},
    overall_delta: 0,
    holes_compared: 0,
  }),

  updateHole: (holeNumber, currentScore) => {
    const { ghostRecord, holeResults } = get();
    if (!ghostRecord) return;

    const ghostScore = ghostRecord.scores[holeNumber] ?? null;
    const delta = ghostScore != null ? currentScore - ghostScore : null;

    const updated: Record<number, GhostHoleResult> = {
      ...holeResults,
      [holeNumber]: { ghost_score: ghostScore, current_score: currentScore, delta },
    };

    let overall = 0;
    let compared = 0;
    for (const r of Object.values(updated)) {
      if (r.delta != null) { overall += r.delta; compared++; }
    }

    set({ holeResults: updated, overall_delta: overall, holes_compared: compared });
  },

  getLabel: () => {
    const r = get().ghostRecord;
    if (!r) return null;
    return `${r.courseName ?? 'Past round'} — ${r.totalScore}`;
  },

  getSummaryText: () => {
    const { ghostRecord, overall_delta, holes_compared } = get();
    if (!ghostRecord) return null;
    const label = `${ghostRecord.courseName ?? 'past round'} (${ghostRecord.totalScore})`;
    if (holes_compared === 0) return `Playing ghost of ${label} — no holes compared yet.`;
    const abs = Math.abs(overall_delta);
    const strokes = abs === 1 ? 'stroke' : 'strokes';
    const status = overall_delta === 0
      ? 'dead even'
      : overall_delta < 0 ? `ahead by ${abs} ${strokes}`
      : `behind by ${abs} ${strokes}`;
    return `vs ${label}: ${status} through ${holes_compared} holes.`;
  },

  getGhostScoreForHole: (holeNumber) => {
    const r = get().ghostRecord;
    if (!r) return null;
    return r.scores[holeNumber] ?? null;
  },

  getHoleDeltaLine: (holeNumber) => {
    const { ghostRecord, holeResults, overall_delta, holes_compared } = get();
    if (!ghostRecord) return null;
    const ghostScore = ghostRecord.scores[holeNumber] ?? null;
    const hole = holeResults[holeNumber];
    // Hole-level delta first (strong current-hole bias).
    let holePart: string;
    if (hole?.delta != null) {
      holePart = hole.delta === 0
        ? 'even hole'
        : hole.delta < 0 ? `-${Math.abs(hole.delta)} hole` : `+${hole.delta} hole`;
    } else if (ghostScore != null) {
      holePart = `last: ${ghostScore}`;
    } else {
      holePart = 'no ghost data';
    }
    // Add running overall context when at least one hole has been compared.
    if (holes_compared === 0) return `vs last · ${holePart}`;
    const overallPart = overall_delta === 0
      ? 'even round'
      : overall_delta < 0 ? `-${Math.abs(overall_delta)} round` : `+${overall_delta} round`;
    return `vs last · ${holePart} · ${overallPart}`;
  },

  getSnapshot: () => {
    const { ghostRecord, holeResults, overall_delta, holes_compared } = get();
    if (!ghostRecord) return null;
    return {
      ghost_round_id: ghostRecord.id,
      ghost_round_label: `${ghostRecord.courseName ?? 'Past round'} (${ghostRecord.totalScore})`,
      ghost_total: ghostRecord.totalScore,
      hole_results: holeResults,
      overall_delta,
      holes_compared,
    };
  },
}));
