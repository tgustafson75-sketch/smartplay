/**
 * 2026-09-11 — THE PACK FROM LIVE STATE, composed once.
 *
 * services/bagPack is pure on purpose, so somebody has to read the stores and hand it the course and
 * the ladder. There will be more than one caller — the Fit Profile's auto-pack chip today, the Play
 * tab and the caddie's "what should I bring" answer next — and two hand-built compositions of the
 * same bag is how the rangefinder came to say 205 while the card clubbed him to 180.
 * [[two-owners-is-the-root-cause]]
 *
 * Never throws; returns a null pack rather than a guess when there is no bag to reason about.
 */
import type { PackedBag, PackClub, PackHole } from './bagPack';

export interface LiveBagPack {
  pack: PackedBag | null;
  courseName: string | null;
  /** True when the USGA cap is in force, so a surface can cite the rule beside the count. */
  competition: boolean;
}

const EMPTY: LiveBagPack = { pack: null, courseName: null, competition: false };

/**
 * The holes to pack for: the round in progress first, then the course he has chosen on the Play tab,
 * then the last course he was on. Empty when none of those is known, which bagPack reports honestly
 * as "your full bag" rather than dressing up as a course read.
 */
function liveHoles(): { holes: PackHole[]; courseName: string | null } {
  try {
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    const { getBundledHoles } = require('../data/courses') as typeof import('../data/courses');
    const r = useRoundStore.getState();
    const map = (list: { par?: number; distance?: number }[]): PackHole[] =>
      (list ?? [])
        .map((h) => ({ par: Number(h?.par ?? 0), yards: Number(h?.distance ?? 0) }))
        .filter((h) => h.par > 0 && h.yards > 0);

    const active = map(r.courseHoles ?? []);
    if (active.length > 0) return { holes: active, courseName: r.activeCourse ?? null };

    const courseId = r.pendingStartCourseId ?? r.activeCourseId ?? null;
    if (courseId) {
      const bundled = map(getBundledHoles(courseId) ?? []);
      if (bundled.length > 0) return { holes: bundled, courseName: r.activeCourse ?? null };
    }
    return { holes: [], courseName: r.activeCourse ?? null };
  } catch {
    return { holes: [], courseName: null };
  }
}

/** Everything he owns, with the carry, the usage and the work status the packer breaks ties on. */
function liveOwned(): PackClub[] {
  const { useClubBagStore } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
  const { useClubStatsStore, clubIdToClubName } = require('../store/clubStatsStore') as typeof import('../store/clubStatsStore');
  const st = useClubStatsStore.getState();

  /**
   * The work status, through the module that owns it. A club he is fat with does not get left at
   * home for it — the course still asks for the yardage — but it loses a tie to one he trusts, and
   * that is a judgement the packer should not be making a second copy of.
   */
  const work = (() => {
    try {
      const { clubWorkStatuses } = require('./clubWork') as typeof import('./clubWork');
      const { normalizeClub } = require('./clubNormalize') as typeof import('./clubNormalize');
      const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
      const r = useRoundStore.getState();
      const shots = [...(r.roundHistory ?? []).flatMap((x) => x.shots ?? []), ...(r.shots ?? [])].slice(-400);
      const map = new Map<string, { strong: boolean; needsWork: boolean }>();
      for (const w of clubWorkStatuses({ shots: shots as never, normalize: normalizeClub })) {
        map.set(w.club, { strong: w.status === 'strong', needsWork: w.status === 'needs_work' });
      }
      return map;
    } catch { return new Map<string, { strong: boolean; needsWork: boolean }>(); }
  })();

  return useClubBagStore.getState().bagList().map((c) => {
    const name = clubIdToClubName(c.club_id);
    const key = name ?? c.club_id;
    const w = work.get(key);
    return {
      club: key,
      yards: name && st.hasDistance(name) ? Math.round(st.carryFor(name)) : 0,
      everUsed: name ? st.everUsed(name as never) : undefined,
      strong: w?.strong,
      needsWork: w?.needsWork,
    };
  });
}

/** Compose the pack for right now. */
export function liveBagPack(): LiveBagPack {
  try {
    const { packBagForCourse } = require('./bagPack') as typeof import('./bagPack');
    const { carryLimitFor } = require('../store/clubBagStore') as typeof import('../store/clubBagStore');
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');

    const owned = liveOwned();
    if (owned.length === 0) return EMPTY;
    const { holes, courseName } = liveHoles();
    /**
     * 2026-09-11 (Tim) — "if in competition only be allowed to add 14 and cite USGA." The flag is
     * written by the Play tab's competition chip the moment it is tapped, rather than at startRound,
     * precisely so the bag packed BEFORE the round is capped too.
     */
    const competition = !!useRoundStore.getState().isCompetition;
    return {
      pack: packBagForCourse({ holes, owned, courseName, limit: carryLimitFor(competition) }),
      courseName,
      competition,
    };
  } catch {
    return EMPTY;
  }
}
