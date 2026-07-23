/**
 * 2026-07-23 (Tim — Bag Vision Phase 2: Fit Gap).
 *
 * composeFitProfile answers "where are the distance gaps in my ladder?" purely from tracked/stated
 * carries. Fit Gap adds the missing half: cross-reference those gaps against the bag the player
 * ACTUALLY OWNS (clubBagStore, populated by Bag Vision) so the advice is honest about ownership:
 *   - a gap you already own a club for  → "dial it in", not "buy a club"
 *   - a gap nothing in your bag covers   → "consider adding one"
 *   - clubs you own but never dialed     → "set/track a carry so the caddie can use it"
 *   - two owned clubs doing the same job  → possible redundancy
 *
 * Pure (no store/RN imports) so it's unit-testable and reusable. The screen feeds it the owned
 * set + the FitProfile gaps/overlaps + a dialed-in predicate.
 */
import type { FitGap, FitOverlap } from './fitProfile';

export interface OwnedClub {
  /** Recognizer id, e.g. 'DR' | '5H' | '7I'. */
  club_id: string;
  /** Mapped ladder ClubName (clubStatsStore), or null when it has no full-swing slot (putter). */
  name: string | null;
  brand?: string;
  model?: string;
  loft?: string;
}

export type FitGapKind = 'undialed' | 'fillable_gap' | 'unfilled_gap' | 'redundant';

export interface FitGapFinding {
  kind: FitGapKind;
  title: string;
  detail: string;
}

export interface FitGapReport {
  findings: FitGapFinding[];
  ownedCount: number;
  /** Owned full-swing clubs that have a real carry behind them. */
  dialedCount: number;
}

/** Human label for an owned club: "Callaway Apex 7I" when known, else the id. */
function ownedLabel(c: OwnedClub): string {
  const spec = [c.brand, c.model].filter(Boolean).join(' ').trim();
  return spec ? `${spec} (${c.club_id})` : c.club_id;
}

export function composeFitGap(input: {
  owned: OwnedClub[];
  gaps: FitGap[];
  overlaps: FitOverlap[];
  /** ClubName → does the player have a real (measured or stated) carry for it? */
  hasDistance: (clubName: string) => boolean;
  /** Full-swing ClubName order (clubStatsStore CLUB_ORDER) for "between" checks. */
  clubOrder: readonly string[];
}): FitGapReport {
  const { owned, gaps, overlaps, hasDistance, clubOrder } = input;
  const findings: FitGapFinding[] = [];

  // Only full-swing owned clubs participate (a putter has no carry slot).
  const fullSwing = owned.filter((c) => c.name != null && clubOrder.includes(c.name));
  const ownedNames = new Set(fullSwing.map((c) => c.name as string));
  const idxOf = (name: string) => clubOrder.indexOf(name);

  const dialedCount = fullSwing.filter((c) => hasDistance(c.name as string)).length;

  // 1. Owned but undialed — the caddie can't use a club whose carry it doesn't know.
  for (const c of fullSwing) {
    if (!hasDistance(c.name as string)) {
      findings.push({
        kind: 'undialed',
        title: `Dial in your ${ownedLabel(c)}`,
        detail: `You carry it, but there's no carry distance yet — set one or track a few shots so your caddie factors it into club choice.`,
      });
    }
  }

  // 2. Distance gaps, with ownership context.
  for (const g of gaps) {
    const lo = idxOf(g.lower), hi = idxOf(g.upper);
    // An owned club whose slot sits strictly between the two clubs bounding the gap.
    const between = lo >= 0 && hi >= 0
      ? fullSwing.find((c) => { const i = idxOf(c.name as string); return i > Math.min(lo, hi) && i < Math.max(lo, hi); })
      : undefined;
    if (between) {
      findings.push({
        kind: 'fillable_gap',
        title: `Fill the ${g.gapYards}-yd gap with a club you own`,
        detail: `Between ${g.lower} and ${g.upper} you carry a ${ownedLabel(between)} — dial in its carry (~${g.centerYards}y) and the gap closes.`,
      });
    } else {
      findings.push({
        kind: 'unfilled_gap',
        title: `${g.gapYards}-yd gap between ${g.lower} and ${g.upper}`,
        detail: `Nothing in your bag covers ~${g.centerYards}y — a club there (often a hybrid or higher-lofted fairway) would tighten your ladder.`,
      });
    }
  }

  // 3. Redundant: two OWNED clubs carrying within the overlap threshold.
  for (const o of overlaps) {
    if (ownedNames.has(o.shorter) && ownedNames.has(o.longer)) {
      findings.push({
        kind: 'redundant',
        title: `${o.shorter} and ${o.longer} overlap`,
        detail: `They carry within ${o.gapYards}y of each other — one may be redundant. Consider swapping one for a club that fills a gap above.`,
      });
    }
  }

  return { findings, ownedCount: fullSwing.length, dialedCount };
}
