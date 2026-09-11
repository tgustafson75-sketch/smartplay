/**
 * A CLUB IS NOT A YARDAGE.
 *
 * 2026-09-11 (Tim). "Clubs have different tendencies for users — sometimes logical, sometimes feel
 * for the lie or situation or comfort level. Each club in the bag essentially has characteristics
 * real and received… I carry a 5 wood, a 5 iron, and a 5 hybrid. They all have different purpose.
 * If Caddie knows I am not on the fairway and likely not a great lie, don't suggest the wood based
 * on distance. The iron is better to get out, but user and caddie can consider if the lie allows
 * better for the hybrid based on the goal and layout."
 *
 * ─── WHAT WAS MISSING ──────────────────────────────────────────────────────────────────────────
 *
 * cnsShotRead.pickClub had ZERO references to lie, location, rough or sand. It chose on yardage —
 * with plays-like, risk posture, green room and the distance-control gap layered on, all of which
 * are real, and none of which know that a 5 wood out of deep rough is the wrong tool at any
 * distance. Three clubs that go the same number are one club to a yardage-only picker.
 *
 * ─── AND A FALSE SIGNAL TO BE CAREFUL OF ───────────────────────────────────────────────────────
 *
 * roundStore's `currentLocationType` looks like the answer and is not. Its fairway branch is a
 * DEFAULT — "not within tee radius, not within green radius" — so deep rough, a bunker and the
 * trees all report 'fairway'. Reading that as a good lie would green-light the wood in exactly the
 * situation Tim is describing, and it is the MAJORITY case. So 'fairway' is treated here as
 * UNKNOWN, and only a real signal — what the player said, or the lie camera — sets a lie.
 * [[nobody-chose-cage-the-default-did]]
 *
 * ─── THE RULE ──────────────────────────────────────────────────────────────────────────────────
 *
 * An unknown lie makes NO claim. It must not penalise the wood (that would invent a bad lie) and it
 * must not bless it. The caddie can ask; the engine stays quiet. A claim only happens on evidence.
 * [[illustration-data-points]]
 *
 * PURE. No stores, no network — the caller passes the lie and the bag.
 */

/** What the ball is sitting on, only ever set from a real signal. */
export type Lie = 'tee' | 'fairway' | 'light_rough' | 'heavy_rough' | 'sand' | 'hardpan' | 'unknown';

/** What KIND of club this is — the first real characteristic, before any number. */
export type ClubClass = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter' | 'other';

export function clubClassOf(club: string | null | undefined): ClubClass {
  if (!club) return 'other';
  const c = club.trim().toUpperCase();
  if (c === 'DRIVER' || c === 'DR' || c === '1W') return 'driver';
  if (c === 'PUTTER' || c === 'P') return 'putter';
  if (/^\d+W$/.test(c) || /\bWOOD\b/.test(c)) return 'wood';
  if (/^\d+H$/.test(c) || /\bHYBRID\b/.test(c) || /\bRESCUE\b/.test(c)) return 'hybrid';
  if (['PW', 'AW', 'GW', 'SW', 'LW'].includes(c) || /\bWEDGE\b/.test(c)) return 'wedge';
  if (/^\d+I$/.test(c) || /\bIRON\b/.test(c)) return 'iron';
  return 'other';
}

/**
 * How playable each class is from each lie. 1 = the right tool, 0 = the wrong one.
 *
 * This is ordinary golf, not a model: a fairway wood needs the ball sitting up, because its sole is
 * wide and its leading edge is high; a hybrid's smaller head and steeper entry get through rough a
 * wood cannot; an iron digs. The numbers exist to ORDER clubs from a given lie, never to be shown
 * to the player as a score.
 */
const PLAYABILITY: Record<Exclude<Lie, 'unknown'>, Record<ClubClass, number>> = {
  //            driver wood  hybrid iron  wedge putter other
  tee:         { driver: 1.0, wood: 1.0, hybrid: 1.0, iron: 1.0, wedge: 1.0, putter: 0.1, other: 1.0 },
  fairway:     { driver: 0.8, wood: 1.0, hybrid: 1.0, iron: 1.0, wedge: 1.0, putter: 0.1, other: 1.0 },
  light_rough: { driver: 0.3, wood: 0.55, hybrid: 0.9, iron: 1.0, wedge: 1.0, putter: 0.1, other: 0.7 },
  heavy_rough: { driver: 0.05, wood: 0.15, hybrid: 0.5, iron: 0.85, wedge: 1.0, putter: 0.05, other: 0.4 },
  sand:        { driver: 0.0, wood: 0.1, hybrid: 0.3, iron: 0.7, wedge: 1.0, putter: 0.05, other: 0.3 },
  hardpan:     { driver: 0.3, wood: 0.4, hybrid: 0.7, iron: 1.0, wedge: 0.9, putter: 0.1, other: 0.6 },
};

/** Below this a club is the wrong tool from here, whatever the yardage says. */
export const POOR_FROM_LIE = 0.6;

/**
 * How playable this club is from this lie.
 *
 * Returns NULL for an unknown lie — not 1, and not 0. A missing signal is not evidence of a good
 * lie OR a bad one, and every caller must be able to tell the difference.
 */
export function playabilityFromLie(club: string | null | undefined, lie: Lie): number | null {
  if (lie === 'unknown') return null;
  const table = PLAYABILITY[lie];
  return table ? table[clubClassOf(club)] : null;
}

/**
 * The lie the player told us, from their own words.
 *
 * Ordered most specific first, because "buried in the rough" is heavy rough and "rough" alone is
 * not. Returns 'unknown' rather than guessing — the whole point is that a claim needs evidence.
 */
export function lieFromWords(text: string | null | undefined): Lie {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (/\b(bunker|sand trap|in the sand|beach)\b/.test(t)) return 'sand';
  if (/\b(hardpan|bare lie|bare dirt|on dirt|no grass)\b/.test(t)) return 'hardpan';
  if (/\b(buried|plugged|sitting down|deep rough|thick rough|heavy rough|fescue|gnarly|jungle)\b/.test(t)) return 'heavy_rough';
  if (/\b(light rough|first cut|short rough|sitting up)\b/.test(t)) return 'light_rough';
  if (/\brough\b/.test(t)) return 'light_rough';
  if (/\b(fairway|short grass|middle of the fairway)\b/.test(t)) return 'fairway';
  if (/\b(on the tee|teed up|tee box)\b/.test(t)) return 'tee';
  return 'unknown';
}

/**
 * 2026-09-11 — a `lieFromTurf` helper lived here briefly, mapping services/acousticsAnalyzer's
 * TurfInteraction ('sand' | 'rough' | 'hardpan' | 'grass') onto a lie. The orphan guard refused it,
 * correctly: the turf read happens AFTER the strike and lands in an analysis result, not anywhere
 * the next club decision can reach — and by then the player has walked to the ball.
 *
 * Deleted rather than given an invented caller. The signal is real and is a genuine future tie-in
 * if the analysis result is ever recorded against the shot; it was not worth half-wiring today.
 * [[orphans-are-live-bugs-not-dead-code]]
 */

export interface ClubCharacter {
  club: string;
  klass: ClubClass;
  /** REAL — from the registered bag. The equipment profile, finally connected to a decision. */
  loftDeg: number | null;
  brand: string | null;
  model: string | null;
  /** RECEIVED — how often they actually reach for it, and from where. */
  uses: number;
  roundUses: number;
  /** How playable it is from the lie in front of them. Null when the lie is unknown. */
  playability: number | null;
}

export interface ClubCharacterInput {
  club: string;
  lie?: Lie;
  specs?: { brand?: string | null; model?: string | null; loft?: string | null } | null;
  uses?: number;
  roundUses?: number;
}

/** Loft as a number, from the free text the bag scan or the player typed ("52°", "10.5 deg"). */
export function loftDegrees(loft: string | null | undefined): number | null {
  if (!loft) return null;
  const m = String(loft).match(/(\d{1,2}(?:\.\d)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 70 ? n : null;
}

export function clubCharacter(input: ClubCharacterInput): ClubCharacter {
  return {
    club: input.club,
    klass: clubClassOf(input.club),
    loftDeg: loftDegrees(input.specs?.loft),
    brand: input.specs?.brand ?? null,
    model: input.specs?.model ?? null,
    uses: Math.max(0, Math.round(input.uses ?? 0)),
    roundUses: Math.max(0, Math.round(input.roundUses ?? 0)),
    playability: playabilityFromLie(input.club, input.lie ?? 'unknown'),
  };
}

/**
 * Why this club and not the one the yardage alone would have picked.
 *
 * Said the way Tim described it — the iron gets you OUT, and the hybrid is the live question rather
 * than a forbidden one: "user and caddie can consider if the lie allows better for the hybrid."
 * Never a lecture, and never a number read aloud.
 */
export function describeLieChoice(chosen: string, rejected: string, lie: Lie): string | null {
  if (lie === 'unknown') return null;
  const ck = clubClassOf(chosen);
  const rk = clubClassOf(rejected);
  if (ck === rk) return null;
  const where =
    lie === 'sand' ? 'out of sand'
    : lie === 'heavy_rough' ? 'out of that rough'
    : lie === 'light_rough' ? 'out of the rough'
    : lie === 'hardpan' ? 'off a bare lie'
    : null;
  if (!where) return null;
  if (rk === 'wood' || rk === 'driver') {
    return ck === 'hybrid'
      ? `${chosen} rather than the ${rejected} — the hybrid gets through ${where}, the wood needs it sitting up.`
      : `${chosen} rather than the ${rejected} — get it out first; a wood ${where} is the miss.`;
  }
  if (rk === 'hybrid' && ck === 'iron') {
    // Names the lie, like every other branch — a caddie says WHERE you are, not just what to take.
    return `${chosen} rather than the ${rejected} ${where} — if the lie is better than it looks the hybrid is the play, but the iron gets it out.`;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

export interface LieChoice {
  /** The club that works from a poor lie — gets it out, whatever the ball is sitting in. */
  safeClub: string;
  /** The club the yardage wants, if the lie turns out to be good. */
  ifGoodLieClub: string;
  /** The caddie's line, offering both. */
  say: string;
  /** True when a camera read would genuinely settle it, so the caddie can offer that too. */
  cameraWouldHelp: boolean;
}

/**
 * WHEN WE DO NOT KNOW THE LIE, ASK — DO NOT GUESS.
 *
 * 2026-09-11 (Tim). "Caddie can offer: 'we could go with an iron here to get out, or if you feel we
 * have a good lie, let's go with hybrid.' That way no computer vision is needed. Could offer user to
 * open TightLie for a full analysis."
 *
 * This is a better answer than the one this file started with. The lie is the single most important
 * thing about a shot that the app CANNOT reliably measure — currentLocationType defaults to
 * 'fairway', and the camera read needs the player to stop and point a phone at the ball. Requiring
 * a known lie would have meant staying silent in the majority case.
 *
 * So the caddie does what a real caddie does when he is walking up behind you: names both clubs and
 * lets the player, who is standing over the ball, answer. The player's answer is better data than
 * any sensor, it costs one sentence, and it turns a guess into a conversation.
 *
 * Returns null when there is nothing to offer — a known lie (just pick), or no meaningfully
 * different club at this number. An offer made every shot is nagging. [[feels-like-a-real-caddie]]
 */
export function offerFromUnknownLie(input: {
  /** What the yardage alone chose. */
  yardageClub: string | null | undefined;
  /** Carry yards by club, to find an alternative at a similar number. */
  bag: Record<string, number>;
  /** The lie, if it is actually known. A known lie needs no offer. */
  lie?: Lie;
  /** How far apart two clubs may be and still be "the same shot". */
  toleranceYards?: number;
}): LieChoice | null {
  const { yardageClub, bag } = input;
  if (!yardageClub) return null;
  if ((input.lie ?? 'unknown') !== 'unknown') return null;

  // Only lie-SENSITIVE clubs raise the question. Nobody needs to be asked about a 9 iron.
  const klass = clubClassOf(yardageClub);
  if (klass !== 'wood' && klass !== 'driver') return null;

  const want = bag[yardageClub];
  if (typeof want !== 'number' || !Number.isFinite(want) || want <= 0) return null;
  const tol = input.toleranceYards ?? 18;

  /**
   * The alternative is the most lie-TOLERANT club that still covers roughly the same number. A
   * hybrid first, because that is the club the question is usually about; an iron if there is no
   * hybrid, because an iron always gets it out.
   */
  const candidates = Object.entries(bag)
    .filter(([c, y]) => typeof y === 'number' && y > 0 && c !== yardageClub && Math.abs(y - want) <= tol)
    .map(([c, y]) => ({ club: c, yards: y, klass: clubClassOf(c) }))
    .filter((c) => c.klass === 'hybrid' || c.klass === 'iron')
    .sort((a, b) => {
      if (a.klass !== b.klass) return a.klass === 'hybrid' ? -1 : 1;
      return Math.abs(a.yards - want) - Math.abs(b.yards - want);
    });
  const alt = candidates[0];
  if (!alt) return null;

  const gap = Math.round(want - alt.yards);
  const shortfall = gap > 4 ? `${gap} less, but ` : '';
  return {
    safeClub: alt.club,
    ifGoodLieClub: yardageClub,
    say: `We could take the ${alt.club} here — ${shortfall}you're sure of getting it out — or if you feel you've got a good lie, the ${yardageClub} is the number.`,
    // A camera read settles exactly this question, and only this one.
    cameraWouldHelp: true,
  };
}
