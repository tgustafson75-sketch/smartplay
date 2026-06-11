/**
 * 2026-06-11 — PURE ingestion rules for the bulk round-list import.
 *
 * Kept free of expo / network imports so the sim harness (plain Node) can
 * exercise the business rules directly. The IO wrapper (image pick, resize,
 * POST) lives in roundImport.ts and re-exports these.
 *
 * Tim's rules for importing a Golfshot/18Birdies/GHIN round-history LIST:
 *   - a row with NO score is in-progress/incomplete → DROP it.
 *   - a gross score in the 40s (really, sub-50) is a 9-HOLE round → tag it so
 *     the handicap pipeline doubles it instead of reading a 43 as a brilliant
 *     18-hole round. (Tim's a ~17.9 index: his 9s land 35–49, his 18s 80–99.)
 *   - the screenshot's stated hole count, when present, always wins over the
 *     score heuristic.
 */

export interface ListedRoundRow {
  played_date: string | null;
  course_name: string | null;
  total_score: number | null;
  score_vs_par: number | null;
  holes_played: number | null;
}

export interface RoundListImportResult {
  rounds: ListedRoundRow[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

/** Gross at/under this is treated as a 9-hole round when the screenshot doesn't
 *  state the hole count. Tim's "anything in the forties is nine holes" rule
 *  (captures sub-50 generally, so his 35/39 nine-hole rounds count too). */
export const NINE_HOLE_SCORE_MAX = 49;

export interface NormalizedListRound {
  courseName: string | null;
  playedDate: string | null;
  totalScore: number;
  scoreVsPar: number;
  holesPlayed: 9 | 18;
  nineHoleMode: boolean;
  /** Why holesPlayed was chosen — 'stated' (screen said so) vs 'forties_rule'
   *  (inferred from a sub-50 score). Surfaced in the confirm UI so the user
   *  sees which ones were guessed and can flip them. */
  holesSource: 'stated' | 'forties_rule';
}

export interface NormalizeListResult {
  keep: NormalizedListRound[];
  /** Rows dropped because they had no score (in-progress rounds). */
  skippedNoScore: number;
}

/**
 * Apply the ingestion rules to raw OCR rows. PURE + deterministic.
 */
export function normalizeImportedList(
  rows: ListedRoundRow[],
  nineHoleMax: number = NINE_HOLE_SCORE_MAX,
): NormalizeListResult {
  const keep: NormalizedListRound[] = [];
  let skippedNoScore = 0;
  for (const r of rows) {
    if (typeof r.total_score !== 'number' || !Number.isFinite(r.total_score) || r.total_score <= 0) {
      skippedNoScore++;
      continue;
    }
    const stated = r.holes_played === 9 || r.holes_played === 18;
    const holesPlayed: 9 | 18 = stated
      ? (r.holes_played as 9 | 18)
      : (r.total_score <= nineHoleMax ? 9 : 18);
    keep.push({
      courseName: r.course_name,
      playedDate: r.played_date,
      totalScore: r.total_score,
      scoreVsPar: typeof r.score_vs_par === 'number' && Number.isFinite(r.score_vs_par) ? r.score_vs_par : 0,
      holesPlayed,
      nineHoleMode: holesPlayed === 9,
      holesSource: stated ? 'stated' : 'forties_rule',
    });
  }
  return { keep, skippedNoScore };
}

/** Map a normalized list round into the addImportedRound input shape. */
export function buildListPersistInput(n: NormalizedListRound): {
  courseName: string | null;
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  totalScore: number;
  scoreVsPar: number;
  nineHoleMode: boolean;
  scores: Record<number, number>;
  putts: Record<number, number>;
} {
  const ts = (() => {
    if (n.playedDate) { const t = Date.parse(n.playedDate); if (Number.isFinite(t)) return t; }
    return Date.now() - 24 * 60 * 60 * 1000;
  })();
  return {
    courseName: n.courseName,
    startedAt: ts,
    endedAt: ts + 4 * 60 * 60 * 1000,
    holesPlayed: n.holesPlayed,
    totalScore: n.totalScore,
    scoreVsPar: n.scoreVsPar,
    nineHoleMode: n.nineHoleMode,
    scores: {},   // list import carries no per-hole detail; handicap uses the total
    putts: {},
  };
}
