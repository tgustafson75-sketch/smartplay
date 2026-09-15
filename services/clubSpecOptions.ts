/**
 * 2026-09-14 (Tim) — "Include dropdowns for Shaft Brand and weight for each club and grip size."
 *
 * ONE OWNER FOR WHAT A CLUB'S SPEC FIELDS MAY SAY.
 *
 * The bag already held brand / model / loft — what is stamped on the HEAD. What it never held is the
 * half of a fitting that actually changes how a club plays: the shaft in it and the grip on it. A
 * player with three drivers (services/clubVariantPerformance) is comparing SHAFTS, and until now the
 * app could show him which driver scores better without being able to say what was different about it.
 *
 * WHY LISTS AND NOT FREE TEXT. A typed shaft brand is unusable downstream — "Project X", "project x",
 * "PX" and "ProjectX" are four brands to any comparison. These are the values the app will reason
 * over, so they are a closed set with an explicit escape hatch ('Other'), not a text field.
 *
 * WEIGHT IS FAMILY-SCOPED, because the ranges do not overlap: a driver shaft is 40-80 g and an iron
 * shaft is 85-130 g, and offering one list for both invites a 50 g 7-iron that no consumer could
 * sanity-check. The family comes from services/clubBagReconcile — the one catalog — rather than a
 * second parser here.
 *
 * HONEST BY OMISSION: every one of these is optional and starts unset. A blank shaft weight means we
 * do not know it, and nothing may infer one from the club type. [[illustration-data-points]]
 */
import { clubFamily, type ClubFamily } from './clubBagReconcile';

/** The escape hatch, spelled once. A value not on a list is still a real value. */
export const SPEC_OTHER = 'Other';

/**
 * Shaft manufacturers, not shaft models. "Dynamic Gold" is a True Temper model and belongs in the
 * club's model/notes, not here — mixing the two is how a list stops being a set you can group by.
 * 'Stock (OEM)' is the honest answer for most bags off a rack and is deliberately first after the
 * majors, because a player who does not know the answer should not have to pick a wrong one.
 */
export const SHAFT_BRANDS: readonly string[] = [
  'Stock (OEM)',
  'True Temper',
  'KBS',
  'Project X',
  'Nippon',
  'Fujikura',
  'Mitsubishi',
  'Graphite Design',
  'UST Mamiya',
  'Aldila',
  'Accra',
  'Autoflex',
  'LA Golf',
  'Aerotech',
  'Oban',
  SPEC_OTHER,
] as const;

/**
 * Grip sizes. The wrap counts are on the list because they are how a real grip gets sized — a
 * standard grip built up with tape is the commonest "midsize" in amateur golf, and a list that
 * offered only the four factory sizes would push the player into the nearest wrong one.
 */
export const GRIP_SIZES: readonly string[] = [
  'Undersize',
  'Standard',
  'Standard +1 wrap',
  'Standard +2 wraps',
  'Midsize',
  'Jumbo',
  SPEC_OTHER,
] as const;

/** Driver / fairway / hybrid shafts — graphite, and light. */
const WOOD_WEIGHTS: readonly string[] = ['40g', '50g', '60g', '70g', '80g', SPEC_OTHER];
/** Iron and wedge shafts — steel at the top of the range, graphite at the bottom. */
const IRON_WEIGHTS: readonly string[] = ['55g', '65g', '75g', '85g', '95g', '105g', '115g', '125g', SPEC_OTHER];

/**
 * The shaft weights a given club can honestly take, or an empty list when the question does not
 * apply. The PUTTER returns [] deliberately: putter shaft weight is not a spec players carry in
 * their head, and an empty list means the surface renders no control rather than an unanswerable one.
 */
export function shaftWeightsFor(club_id: string): readonly string[] {
  const fam: ClubFamily = clubFamily(club_id);
  if (fam === 'PT') return [];
  if (fam === 'DR' || fam === 'W' || fam === 'H') return WOOD_WEIGHTS;
  if (fam === 'I' || fam === 'WEDGE') return IRON_WEIGHTS;
  return [];
}

/** True when the club takes a shaft-weight answer at all — so a caller need not compare to []. */
export function hasShaftWeight(club_id: string): boolean {
  return shaftWeightsFor(club_id).length > 0;
}
