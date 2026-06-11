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
 *  state the hole count AND carries no vs-par to derive par-played. Tim's
 *  "anything in the forties is nine holes" fallback. */
export const NINE_HOLE_SCORE_MAX = 49;

/** Par-played (score − vs-par) below this is a 9-hole round; at/above is 18.
 *  Real 9s are par ~27–36, real 18s par ~70–72, so 54 cleanly splits them and
 *  is far more reliable than the gross-score guess. */
export const NINE_HOLE_PAR_MAX = 53;

/** Minimum strokes/hole for a COMPLETED round. A finished round can't average
 *  under this, so a lower score is an abandoned/partial round (e.g. an imported
 *  "4" from a round quit after one hole) — dropped, never handicap-counted. */
export const MIN_STROKES_PER_HOLE = 3;

export interface NormalizedListRound {
  courseName: string | null;
  playedDate: string | null;
  totalScore: number;
  scoreVsPar: number;
  holesPlayed: 9 | 18;
  nineHoleMode: boolean;
  /** Why holesPlayed was chosen — 'stated' (screen said so), 'vs_par' (derived
   *  from par-played, the reliable path) or 'forties_rule' (gross-score guess).
   *  Surfaced in the confirm UI so the user sees which were guessed. */
  holesSource: 'stated' | 'vs_par' | 'forties_rule';
}

export interface NormalizeListResult {
  keep: NormalizedListRound[];
  /** Rows dropped because they had no score (in-progress rounds). */
  skippedNoScore: number;
  /** Rows dropped because the score was too low to be a finished round
   *  (under MIN_STROKES_PER_HOLE/hole) — abandoned/partial rounds. */
  skippedIncomplete: number;
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
  let skippedIncomplete = 0;
  for (const r of rows ?? []) {
    if (!r || typeof r !== 'object') continue; // defensive: skip a malformed row
    if (typeof r.total_score !== 'number' || !Number.isFinite(r.total_score) || r.total_score <= 0) {
      skippedNoScore++;
      continue;
    }
    const hasVsPar = typeof r.score_vs_par === 'number' && Number.isFinite(r.score_vs_par);
    // Hole count: a stated count wins; else derive from par-played (the
    // reliable signal — par ~36 ⇒ 9, ~72 ⇒ 18); else fall back to the gross
    // sub-50 guess when no vs-par is available.
    let holesPlayed: 9 | 18;
    let holesSource: 'stated' | 'vs_par' | 'forties_rule';
    if (r.holes_played === 9 || r.holes_played === 18) {
      holesPlayed = r.holes_played;
      holesSource = 'stated';
    } else if (hasVsPar) {
      const parPlayed = r.total_score - (r.score_vs_par as number);
      holesPlayed = parPlayed <= NINE_HOLE_PAR_MAX ? 9 : 18;
      holesSource = 'vs_par';
    } else {
      holesPlayed = r.total_score <= nineHoleMax ? 9 : 18;
      holesSource = 'forties_rule';
    }
    // Completeness: a finished round can't average under MIN_STROKES_PER_HOLE.
    // Drop abandoned/partial rounds (e.g. an imported "4") — left in, they
    // convert to wildly-low differentials that crater the handicap Index.
    if (r.total_score < MIN_STROKES_PER_HOLE * holesPlayed) {
      skippedIncomplete++;
      continue;
    }
    keep.push({
      courseName: r.course_name,
      playedDate: r.played_date,
      totalScore: r.total_score,
      scoreVsPar: hasVsPar ? (r.score_vs_par as number) : 0,
      holesPlayed,
      nineHoleMode: holesPlayed === 9,
      holesSource,
    });
  }
  return { keep, skippedNoScore, skippedIncomplete };
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
