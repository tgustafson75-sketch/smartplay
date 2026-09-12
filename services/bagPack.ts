/**
 * 2026-09-11 (Tim) — AUTO-SPOOL THE BAG FOR THIS COURSE.
 *
 * "Course engine could have a chip that you could auto spool your bag for that course." And:
 * "add a cover recommendations by course if the user would like to say, what should I bring for
 * this course? And again it's tied into tendencies or skill level at the beginning by default."
 *
 * bagRecommendation already answers the retrospective question — which clubs did the work at a
 * course you have PLAYED. Its own header calls the forward-looking half "B2 … NOT built here."
 * This is B2: given the holes and your ladder, which clubs should be in the bag BEFORE you tee off,
 * including at a course you have never seen. That is the case that matters, because it is the one
 * where you cannot just remember.
 *
 * It is also what makes the Sunday bag real. "You're gonna have a three-club bag on a par-three
 * nine-hole course" — a par-3 nine asks for four or five clubs and nothing else, and a packer that
 * reasons from the actual holes arrives there on its own rather than being told about beginners.
 *
 * PURE / SYNC / OFFLINE-SAFE / never throws. Holes and ladder in, a bag out. [[caddie-brain-lens]]
 */
import { GAP_YARDS } from './practice/fitProfile';

/** The minimum a course needs to tell us. Callers map CourseHole / Hole onto this. */
export interface PackHole {
  par: number;
  /** Yards from the tee being played. 0/absent holes are skipped rather than guessed at. */
  yards: number;
}

export interface PackClub {
  /** Canonical club name ('Driver', '7I', 'SW', 'Putter'). */
  club: string;
  /** Carry in yards. Putter carries nothing and is handled separately. */
  yards: number;
  /**
   * Has he swung it anywhere — range, drill, video, another course? A club he has never hit is the
   * last one to pack, whatever the yardage chart says it would cover.
   */
  everUsed?: boolean;
  /** From clubWork: a club that needs work is still packed if the course asks for it, but it loses ties. */
  needsWork?: boolean;
  /** From clubWork: a strong club wins ties. */
  strong?: boolean;
}

export interface PackedBag {
  /** What to put in the bag, long → short, putter last. */
  carry: string[];
  /** Owned clubs left at home. */
  leave: string[];
  /** The USGA cap that was applied, or null when none was. */
  limit: number | null;
  /** True when the cap actually forced a club out (rather than merely being present). */
  limitBit: boolean;
  headline: string;
  reasons: string[];
  /** Holes the pack could reason about. Zero means the answer is a fallback, and it says so. */
  holesRead: number;
}

/** A putter goes in the bag on every course ever played. It is never a candidate for trimming. */
const PUTTER = 'Putter';

/**
 * Greenside and part-shot yardages every course demands regardless of its card. Without these a
 * course of long par 4s would pack four woods and no wedge, which is nobody's bag.
 */
const SHORT_GAME_YARDS = [40, 70, 100];

function isPutter(club: string): boolean { return club === PUTTER || club.toUpperCase() === 'PUTTER'; }

/**
 * The yardages this course will actually ask you to hit, played forward from the tee.
 *
 * Deliberately coarse. A precise simulation of every hole would be a false precision — we do not
 * know the wind, the pin or whether he takes on the corner. What we DO know reliably is the shape
 * of the demand: a 520-yard par 5 asks for a tee ball, a long second and a wedge; a 155-yard par 3
 * asks for one club and asks for it nine times.
 */
export function demandYardages(holes: PackHole[], longestCarry: number): number[] {
  const out: number[] = [];
  const tee = Math.max(150, longestCarry);
  for (const h of holes ?? []) {
    const yards = typeof h?.yards === 'number' && h.yards > 0 ? h.yards : 0;
    const par = typeof h?.par === 'number' && h.par > 0 ? h.par : 0;
    if (!yards || !par) continue;
    if (par <= 3) {
      // A par 3 is one club, and the yardage on the card is the yardage you face.
      out.push(yards);
      continue;
    }
    // Tee shot, then whatever is left. Par 5s get a long second before the approach.
    out.push(tee);
    let left = yards - tee;
    if (par >= 5) {
      const second = Math.min(left, tee);
      out.push(second);
      left -= second;
    }
    if (left > 20) out.push(left);
  }
  return out;
}

export interface PackInput {
  holes: PackHole[];
  /** Everything he owns, with carries. */
  owned: PackClub[];
  /** USGA_CLUB_LIMIT in competition, null otherwise. */
  limit?: number | null;
  courseName?: string | null;
}

/**
 * Choose the bag for a course. Never throws; with no holes it falls back to "carry what you own,
 * trimmed to the limit" and SAYS that is what it did rather than inventing a course-specific story.
 */
export function packBagForCourse(input: PackInput): PackedBag {
  const owned = (input.owned ?? []).filter(c => c && typeof c.club === 'string' && c.club.length > 0);
  const limit = input.limit ?? null;
  const putter = owned.find(c => isPutter(c.club));
  const swingable = owned.filter(c => !isPutter(c.club) && typeof c.yards === 'number' && c.yards > 0);
  const unrated = owned.filter(c => !isPutter(c.club) && !(typeof c.yards === 'number' && c.yards > 0));
  const holes = (input.holes ?? []).filter(h => h && typeof h.par === 'number' && typeof h.yards === 'number' && h.yards > 0);
  const where = input.courseName ? ` for ${input.courseName}` : '';

  const finish = (carry: string[], reasons: string[], headline: string, limitBit: boolean): PackedBag => {
    const keep = new Set(carry);
    return {
      carry,
      leave: owned.map(c => c.club).filter(c => !keep.has(c)),
      limit, limitBit, headline, reasons, holesRead: holes.length,
    };
  };

  if (swingable.length === 0) {
    return finish(
      putter ? [PUTTER] : [],
      ['No carry distances yet — set your ladder in the Fit Profile and the packer can reason about a course.'],
      'Not enough bag data to pack for a course yet.',
      false,
    );
  }

  const longest = Math.max(...swingable.map(c => c.yards));
  const demand = holes.length > 0
    ? [...demandYardages(holes, longest), ...SHORT_GAME_YARDS]
    : [];

  /**
   * Score each club by how much of the course's demand it is the BEST answer to. A club nothing
   * asks for scores zero and is left at home — which is exactly the "dead weight" the whole bag
   * feature exists to find, arrived at from the holes rather than from a hunch.
   */
  const score = new Map<string, number>();
  for (const c of swingable) score.set(c.club, 0);
  for (const want of demand) {
    let best: PackClub | null = null;
    let bestDiff = Infinity;
    for (const c of swingable) {
      const diff = Math.abs(c.yards - want);
      if (diff < bestDiff - 0.001) { bestDiff = diff; best = c; }
      else if (best && Math.abs(diff - bestDiff) <= 0.001 && tieBreak(c, best) > 0) { best = c; }
    }
    // A "best" club 40 yards off the number is not an answer — it is a gap, and packing it would
    // hide the gap rather than report it.
    if (best && bestDiff <= GAP_YARDS) score.set(best.club, (score.get(best.club) ?? 0) + 1);
  }

  const ranked = [...swingable].sort((a, b) => {
    const d = (score.get(b.club) ?? 0) - (score.get(a.club) ?? 0);
    if (d !== 0) return d;
    return tieBreak(b, a);
  });

  let picked = holes.length > 0
    ? ranked.filter(c => (score.get(c.club) ?? 0) > 0)
    : [...ranked];

  /**
   * A pack of two clubs is not a bag. Even a par-3 nine wants something either side of the stock
   * number for a long hole and a short one, plus a wedge you can chip with. Top up from the ranked
   * list rather than from a fixed list of club names, so the floor is filled with HIS clubs.
   */
  const FLOOR = holes.length > 0 ? Math.min(4, ranked.length) : ranked.length;
  for (const c of ranked) {
    if (picked.length >= FLOOR) break;
    if (!picked.includes(c)) picked.push(c);
  }

  // Fill gaps inside the packed range — a set with a 45-yard hole in it is a set you will be
  // between clubs with all day, and that is the complaint the Fit Profile already names.
  picked = fillGaps(picked, ranked);

  let limitBit = false;
  const capped = limit != null ? Math.max(1, limit - (putter ? 1 : 0)) : null;
  if (capped != null && picked.length > capped) {
    limitBit = true;
    picked = picked.slice(0, capped);
  }

  const carry = [...picked].sort((a, b) => b.yards - a.yards).map(c => c.club);
  if (putter) carry.push(PUTTER);

  const reasons: string[] = [];
  if (holes.length === 0) {
    reasons.push('No hole yardages for this course yet, so this is your full bag rather than a course read.');
  } else {
    const par3s = holes.filter(h => h.par <= 3).length;
    const longest3 = Math.max(0, ...holes.filter(h => h.par <= 3).map(h => h.yards));
    reasons.push(`${holes.length} holes read · ${par3s} par 3${par3s === 1 ? '' : 's'}${par3s > 0 ? `, longest ${longest3}y` : ''}.`);
    const benched = ranked.filter(c => !picked.includes(c));
    const neverAsked = benched.filter(c => (score.get(c.club) ?? 0) === 0);
    if (neverAsked.length) {
      reasons.push(`Nothing on this card asks for ${neverAsked.map(c => c.club).join(', ')} — leave ${neverAsked.length === 1 ? 'it' : 'them'} at home.`);
    }
    const needy = picked.filter(c => c.needsWork);
    if (needy.length) {
      reasons.push(`${needy.map(c => c.club).join(', ')} ${needy.length === 1 ? 'is' : 'are'} in the bag because the course asks for ${needy.length === 1 ? 'it' : 'them'} — play ${needy.length === 1 ? 'it' : 'them'} conservatively.`);
    }
  }
  if (unrated.length) {
    reasons.push(`No carry set for ${unrated.map(c => c.club).join(', ')} — the packer can't place ${unrated.length === 1 ? 'it' : 'them'} until you do.`);
  }
  if (limitBit) {
    reasons.push(`Competition: trimmed to ${limit} clubs. USGA Rule 4.1b(1) — starting a round with more is two strokes per hole, up to four.`);
  }

  const headline = holes.length > 0
    ? `${carry.length} club${carry.length === 1 ? '' : 's'}${where} — ${holes.length} holes.`
    : `${carry.length} club${carry.length === 1 ? '' : 's'} — full bag${where}.`;

  return finish(carry, reasons, headline, limitBit);
}

/** Positive when `a` should beat `b` on an otherwise equal footing. */
function tieBreak(a: PackClub, b: PackClub): number {
  const rank = (c: PackClub) => (c.strong ? 2 : 0) + (c.everUsed === false ? -2 : 0) + (c.needsWork ? -1 : 0);
  return rank(a) - rank(b);
}

/**
 * Add back any club that closes a gap wider than GAP_YARDS inside the packed range. Only clubs from
 * `ranked` (i.e. owned) are ever added — this never invents a club he does not have.
 */
function fillGaps(picked: PackClub[], ranked: PackClub[]): PackClub[] {
  let out = [...picked];
  for (let pass = 0; pass < 4; pass++) {
    const sorted = [...out].sort((a, b) => b.yards - a.yards);
    let filled = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].yards - sorted[i + 1].yards;
      if (gap <= GAP_YARDS) continue;
      const centre = (sorted[i].yards + sorted[i + 1].yards) / 2;
      const fill = ranked
        .filter(c => !out.includes(c) && c.yards < sorted[i].yards && c.yards > sorted[i + 1].yards)
        .sort((a, b) => Math.abs(a.yards - centre) - Math.abs(b.yards - centre))[0];
      if (fill) { out.push(fill); filled = true; break; }
    }
    if (!filled) break;
  }
  return out;
}
