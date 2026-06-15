/**
 * 2026-06-15 (Tim — AI club fitting, honest v1) — the FIT PROFILE.
 *
 * The honest, defensible first piece of club fitting ([[ai-club-fitting]]): GAPPING
 * from the player's REAL tracked distances. Reads the club ladder (clubStatsStore)
 * and finds the holes (a gap with no club that fits) + redundancies (two clubs doing
 * the same job). Pure / sync / never-throws.
 *
 * HONESTY (the whole feature depends on this): gaps/overlaps come from real tracked
 * carries; each club is flagged MEASURED vs inferred (standard chart), and overall
 * confidence scales with how much is measured. This is a DATA-GROWN STARTING POINT,
 * never a launch-monitor spec — no fabricated lie°, mph, or smash. The precision
 * fit metrics stay parked until capture supports them ([[face-smash-fps-future]]).
 */

export interface FitClubInput {
  club: string;
  yards: number;
  /** True = average from real tracked shots; false = standard-chart inference. */
  measured: boolean;
}

export interface FitGap {
  lower: string;      // shorter club bounding the gap
  upper: string;      // longer club bounding the gap
  gapYards: number;
  /** Yardage an ideal fill club would carry (centre of the gap). */
  centerYards: number;
}

export interface FitOverlap {
  shorter: string;
  longer: string;
  gapYards: number;   // how close they carry
}

export interface FitProfile {
  /** Full-swing clubs, longest→shortest (Putter / 0-yd excluded). */
  ladder: FitClubInput[];
  gaps: FitGap[];
  overlaps: FitOverlap[];
  measuredCount: number;
  totalCount: number;
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  disclaimer: string;
}

// A gap wider than this between two adjacent clubs is a real hole (~a club-and-a-
// half). Two clubs closer than the overlap are doing the same job.
const GAP_YARDS = 20;
const OVERLAP_YARDS = 7;

const DISCLAIMER =
  'A data-grown starting point from your tracked distances — not a launch-monitor fit. Bring it to a fitter to dial the specs.';

export function composeFitProfile(clubs: FitClubInput[]): FitProfile {
  const ladder = (clubs ?? [])
    .filter((c) => c && typeof c.yards === 'number' && c.yards > 0)
    .sort((a, b) => b.yards - a.yards);

  const gaps: FitGap[] = [];
  const overlaps: FitOverlap[] = [];
  for (let i = 0; i < ladder.length - 1; i++) {
    const longer = ladder[i];
    const shorter = ladder[i + 1];
    const d = Math.round(longer.yards - shorter.yards);
    if (d >= GAP_YARDS) {
      gaps.push({
        lower: shorter.club,
        upper: longer.club,
        gapYards: d,
        centerYards: Math.round((longer.yards + shorter.yards) / 2),
      });
    } else if (d <= OVERLAP_YARDS) {
      overlaps.push({ shorter: shorter.club, longer: longer.club, gapYards: d });
    }
  }

  const measuredCount = ladder.filter((c) => c.measured).length;
  const totalCount = ladder.length;
  const confidence: FitProfile['confidence'] = measuredCount >= 8 ? 'high' : measuredCount >= 4 ? 'medium' : 'low';

  let headline: string;
  if (confidence === 'low') {
    headline = 'Early read — log a few more tracked shots and your fit picture sharpens. So far, here\'s your distance ladder.';
  } else {
    const parts: string[] = [];
    if (gaps.length) parts.push(`${gaps.length} distance ${gaps.length === 1 ? 'gap' : 'gaps'} to fill`);
    if (overlaps.length) parts.push(`${overlaps.length} ${overlaps.length === 1 ? 'overlap' : 'overlaps'} (clubs doing the same job)`);
    headline = parts.length
      ? `Your set: ${parts.join(' · ')}.`
      : 'Your set is evenly gapped — no holes and no redundant clubs from your tracked distances.';
  }

  return { ladder, gaps, overlaps, measuredCount, totalCount, confidence, headline, disclaimer: DISCLAIMER };
}
