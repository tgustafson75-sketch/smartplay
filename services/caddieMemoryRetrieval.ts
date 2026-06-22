/**
 * Caddie Central Nervous System — Phase 2: the Retrieval layer.
 *
 * ONE pure, SYNC, NEVER-THROWING function that hands the brain the relevant
 * slice of the learned memory (store/caddieMemoryStore — Phase 1) as a compact
 * prompt block. This is the speed/quality upgrade: instead of assembling lots
 * of scattered, throw-prone context per call, the brain pastes one tight,
 * null-safe block of what we've actually learned about THIS player on THIS
 * hole with THIS club.
 *
 * SAFETY (see docs/caddie-cns-phase1-2.md):
 *   • Sync + wrapped — can never throw; returns an empty-but-valid context.
 *   • Additive — fed through the existing `unified_context_block` the server
 *     already pastes verbatim, so NO server change and the live context builders
 *     stay as the fallback. Empty memory (new player) → empty block → today's
 *     behavior exactly. Gated by CNS_RETRIEVAL_ENABLED.
 *   • Honest — only surfaces learned numbers the store deemed real (carry stays
 *     null until enough samples); GPS still wins on live distance (stated in
 *     the block header so the brain treats memory as a prior, not gospel).
 */

import { useCaddieMemoryStore, type ClubModel } from '../store/caddieMemoryStore';

/** Master switch. ON: the brain receives the learned-memory block (additive).
 *  Flip to false to fall back to live-context-only with zero other changes. */
export const CNS_RETRIEVAL_ENABLED = true;

/** Phase 4 honesty floor: "you usually tee X here" implies a REPEAT — one round
 *  isn't a pattern. Stay silent until the hole has been played at least this many
 *  times, mirroring the bag's MIN_SAMPLES gate (learned state is null until real). */
export const MIN_HOLE_PLAYS_FOR_GUIDANCE = 2;

export interface CaddieContext {
  /** Compact newline block for the brain prompt. '' when nothing is learned. */
  promptBlock: string;
  bag: ClubModel[];
  course: {
    name: string | null;
    hole: number | null;
    par: number | null;
    bestLine: string | null;
    greenBehavior: string | null;
    typicalClub: string | null;
    roundsPlayed: number;
  } | null;
  tendencies: string | null;
  recentReflection: string | null;
}

const EMPTY: CaddieContext = {
  promptBlock: '', bag: [], course: null, tendencies: null, recentReflection: null,
};

export function getCaddieContext(input: {
  playerId?: string;
  courseId?: string | null;
  hole?: number | null;
  club?: string | null;
}): CaddieContext {
  if (!CNS_RETRIEVAL_ENABLED) return EMPTY;
  try {
    const p = useCaddieMemoryStore.getState().getPlayer(input.playerId);

    // Bag — only clubs with a REAL learned carry, longest first.
    const bag = Object.values(p.bag)
      .filter((c) => c.avgCarryYds != null)
      .sort((a, b) => (b.avgCarryYds ?? 0) - (a.avgCarryYds ?? 0));

    // Course slice — this course + this hole (the relevant slice, not all history).
    let course: CaddieContext['course'] = null;
    if (input.courseId && p.courses[input.courseId]) {
      const cm = p.courses[input.courseId];
      const hole = input.hole ?? null;
      const hm = hole != null ? cm.holes[hole] ?? null : null;
      course = {
        name: cm.name,
        hole,
        par: hm?.par ?? null,
        bestLine: hm?.bestLine ?? null,
        greenBehavior: hm?.greenBehavior ?? null,
        typicalClub: hm?.typicalTeeClub ?? null,
        roundsPlayed: cm.rounds_played,
      };
    }

    const tendencies = p.tendencies.dominantMiss
      ? `Dominant miss: ${p.tendencies.dominantMiss.replace(/_/g, ' ')}.`
      : null;
    const recentReflection = p.reflections[0]?.summary ?? null;

    // 2026-06-13 (audit G2) — reconcile the two learned-bag models. clubStatsStore is
    // the shot-tracking bag the rest of the app (ball-fit / scorecard / strategy) reads;
    // the brain reads this CNS bag. Pull clubStats lazily so the brain can FALL BACK to
    // it where the CNS bag is thin — so it never quotes a different (or no) yardage than
    // the rest of the app. Conservative: the CNS carry always WINS where it exists;
    // clubStats only fills gaps. getLearnedClubDistances returns real tracked clubs only.
    let statsBag: Record<string, number> = {};
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cs = require('../store/clubStatsStore') as typeof import('../store/clubStatsStore');
      statsBag = cs.getLearnedClubDistances();
    } catch { /* clubStats optional */ }

    // promptBlock — built from the most decision-relevant facts, empties omitted.
    const lines: string[] = [];
    if (input.club) {
      const cm = bag.find((c) => c.club === input.club);
      if (cm?.avgCarryYds != null) {
        lines.push(
          `Your learned ${cm.club} carry: ~${cm.avgCarryYds}y` +
          (cm.dispersionYds != null ? ` (±${cm.dispersionYds}y)` : '') +
          ` from ${cm.samples} tracked shots.`,
        );
      } else if (typeof statsBag[input.club] === 'number' && statsBag[input.club] > 0) {
        // CNS hasn't learned this club yet — use the tracked carry the rest of the app uses.
        lines.push(`Your learned ${input.club} carry: ~${Math.round(statsBag[input.club])}y (tracked).`);
      }
    }
    if (bag.length > 0) {
      lines.push(`Learned bag: ${bag.slice(0, 6).map((c) => `${c.club} ~${c.avgCarryYds}y`).join(', ')}.`);
    } else {
      // CNS bag empty — don't leave the brain blind when the app already knows the bag.
      const entries = Object.entries(statsBag)
        .filter(([, y]) => typeof y === 'number' && y > 0)
        .sort((a, b) => b[1] - a[1]);
      if (entries.length > 0) {
        lines.push(`Learned bag: ${entries.slice(0, 6).map(([c, y]) => `${c} ~${Math.round(y)}y`).join(', ')}.`);
      }
    }
    if (course) {
      const parts: string[] = [];
      if (course.name) parts.push(course.name);
      if (course.hole != null) parts.push(`hole ${course.hole}${course.par ? ` (par ${course.par})` : ''}`);
      if (course.roundsPlayed > 0) parts.push(`played ${course.roundsPlayed}x`);
      if (course.typicalClub) parts.push(`you usually tee ${course.typicalClub} here`);
      if (course.bestLine) parts.push(course.bestLine);
      if (course.greenBehavior) parts.push(`green: ${course.greenBehavior}`);
      if (parts.length > 0) lines.push(`Course memory — ${parts.join('; ')}.`);
    }
    // 2026-06-14 (Tim — course book) — STATIC course knowledge anchored offline
    // (hole note + hazards). Unlike learned memory, this is available on hole 1 of
    // a course you've never played, and with no signal. Hole-specific only here to
    // keep the prompt tight.
    if (input.courseId && input.hole != null) {
      try {
        const sh = useCaddieMemoryStore.getState().getStaticHole(input.courseId, input.hole);
        if (sh) {
          const sParts: string[] = [];
          if (sh.note) sParts.push(sh.note);
          if (sh.hazards && sh.hazards.length > 0) sParts.push(`watch: ${sh.hazards.slice(0, 3).join(', ')}`);
          if (sParts.length > 0) lines.push(`Hole notes (course book) — ${sParts.join('; ')}.`);
        }
      } catch { /* book optional */ }
    }
    if (tendencies) lines.push(tendencies);
    if (recentReflection) {
      lines.push(`Last round takeaway: ${recentReflection}`);
      const keyTakeaways = p.reflections[0]?.keyTakeaways;
      if (keyTakeaways && keyTakeaways.length > 0) {
        lines.push(`Key takeaways: ${keyTakeaways.slice(0, 2).map((t) => t.trim().replace(/\.?$/, '.')).join(' ')}`);
      }
    }

    const promptBlock = lines.length > 0
      ? `CADDIE MEMORY (learned over time — treat as strong priors; live GPS still wins on the working distance):\n${lines.join('\n')}`
      : '';

    return { promptBlock, bag, course, tendencies, recentReflection };
  } catch {
    return EMPTY;
  }
}

/** Merge the learned-memory block into an existing context block (the field the
 *  server already pastes). Either may be empty; returns null when both are. */
export function mergeMemoryIntoContext(existing: string | null, memoryBlock: string): string | null {
  const merged = [existing, memoryBlock].filter((s) => s && s.trim()).join('\n\n');
  return merged.length > 0 ? merged : null;
}

/**
 * CNS Phase 4 — signal-independence. Learned guidance for a specific course +
 * hole, so on a REPEAT course with weak/absent GPS the caddie can still advise
 * from memory ("you usually tee 7-iron here; favor left") instead of going
 * silent. Sync, never throws; returns null when there's nothing learned yet.
 */
export function getCourseHoleGuidance(input: {
  playerId?: string;
  courseId: string | null;
  hole: number | null;
}): { text: string; typicalClub: string | null; bestLine: string | null; greenBehavior: string | null } | null {
  if (!CNS_RETRIEVAL_ENABLED || !input.courseId || input.hole == null) return null;
  try {
    const p = useCaddieMemoryStore.getState().getPlayer(input.playerId);
    const cm = p.courses[input.courseId];
    const hm = cm?.holes[input.hole];
    if (!hm) return null;
    // Honesty gate: don't surface "you usually..." from a single sample.
    if (hm.played < MIN_HOLE_PLAYS_FOR_GUIDANCE) return null;
    const parts: string[] = [];
    if (hm.typicalTeeClub) parts.push(`you usually tee ${hm.typicalTeeClub}`);
    if (hm.bestLine) parts.push(hm.bestLine);
    if (hm.greenBehavior) parts.push(`green ${hm.greenBehavior}`);
    if (parts.length === 0) return null;
    return {
      text: `From memory on hole ${input.hole} — ${parts.join('; ')}.`,
      typicalClub: hm.typicalTeeClub,
      bestLine: hm.bestLine,
      greenBehavior: hm.greenBehavior,
    };
  } catch {
    return null;
  }
}
