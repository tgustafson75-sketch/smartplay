/**
 * 2026-07-04 (elite-clean audit, menu finding #1) — the immediate spoken/shown
 * end-of-round summary line, extracted to ONE implementation. It was duplicated
 * verbatim in app/(tabs)/caddie.tsx (generateRoundSummary) and
 * components/tools/GlobalToolsMenu.tsx (Save & end), and the copies had already
 * begun to drift. Contextual by design: references something specific (best/worst
 * hole, course name, counts) so the caddie sounds present, never generic. The full
 * AI recap arrives seconds later; this is the instant line.
 */

export interface RoundEndSnapshot {
  total: number;
  vspar: number;
  played: number;
  /** Captured BEFORE endRound() — it resets scores/courseHoles/activeCourse. */
  scores: Record<number, number>;
  courseHoles: Array<{ hole: number; par: number }>;
  activeCourse: string | null;
}

export function buildRoundEndSummary(s: RoundEndSnapshot): string {
  const cName = s.activeCourse ?? 'this course';
  // 2026-07-07 (audit) — was `par ?? 4`, which fabricated par 4 for any hole with
  // unknown par: on a real par-3/par-5 the summary announced a par as a birdie/bogey
  // and spoke the wrong tally. Only count holes whose par is actually KNOWN (the recap
  // screen already greys unknown-par holes out — now the spoken summary agrees).
  const holesWithPar = Object.entries(s.scores)
    .map(([h, sc]) => {
      const par = s.courseHoles.find((c) => c.hole === Number(h))?.par ?? null;
      return { hole: Number(h), score: sc as number, par, offset: par != null ? (sc as number) - par : 0 };
    })
    .filter((h): h is { hole: number; score: number; par: number; offset: number } => h.score > 0 && h.par != null);
  if (holesWithPar.length === 0) return `${s.played} holes at ${cName} — let's see what the recap says.`;

  const best = holesWithPar.reduce((b, h) => (h.offset < b.offset ? h : b));
  const worst = holesWithPar.reduce((w, h) => (h.offset > w.offset ? h : w));
  const birdies = holesWithPar.filter((h) => h.offset < 0).length;
  const pars = holesWithPar.filter((h) => h.offset === 0).length;
  const bogeys = holesWithPar.filter((h) => h.offset === 1).length;
  const doublesPlus = holesWithPar.filter((h) => h.offset >= 2).length;

  if (s.vspar <= -3) {
    return `${s.total} at ${cName} — ${Math.abs(s.vspar)} under. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars. Real golf.`;
  }
  if (s.vspar === 0) {
    return `Even par at ${cName}. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars, ${bogeys} bogeys — discipline showed up today.`;
  }
  if (s.vspar <= 3 && s.played >= 9) {
    const bestLabel = best.offset < 0 ? 'birdie' : best.offset === 0 ? 'par' : `${best.score} on a par ${best.par}`;
    return `${s.total} on the card at ${cName} — ${s.vspar > 0 ? '+' + s.vspar : s.vspar}. Best hole was ${bestLabel} on ${best.hole}. ${pars + birdies} of ${s.played} holes at or under par.`;
  }
  if (s.played < 9) {
    return `${s.played} hole${s.played === 1 ? '' : 's'} in at ${cName}. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars, ${bogeys + doublesPlus} over — short sample, but I'm tracking it.`;
  }
  const worstLabel = worst.offset >= 2 ? `${worst.score} on hole ${worst.hole}` : `+${worst.offset} on ${worst.hole}`;
  return `${s.total} at ${cName} — ${s.vspar > 0 ? '+' + s.vspar : s.vspar}. ${worstLabel} stung, but ${pars + birdies} hole${pars + birdies === 1 ? '' : 's'} held up. Recap'll show the patterns.`;
}
