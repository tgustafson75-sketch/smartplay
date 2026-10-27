/**
 * 2026-10-26 (Tim: "Re-analyze must run the CURRENT code on every swing; old issues must not survive")
 * — WHICH CODE PRODUCED A STORED BODY READ / CLUB ARC.
 *
 * A stored read used to be final forever: swing 2+ of an old reel kept the skeleton, arc and the fault
 * the verdict stage minted from that skeleton, whatever the body read or tracker had become since. The
 * store stamps every body read and arc it saves with these versions; a stored one with an older or a
 * missing stamp is UNREAD, so the swing is read again by today's code the next time a screen asks.
 *
 * Bump a number when the code behind it changes what it would store for the same clip.
 */
export const BODY_READ_VERSION = 1;
// 2: the tracker returns the measured grip with each head (2026-10-26). An arc without it draws no shaft, so a
// v1 arc is tracked again when its swing is next asked for, and is not drawn meanwhile (overlayVisibility).
export const CLUB_ARC_VERSION = 2;

export const bodyReadIsCurrent = (v: number | null | undefined): boolean =>
  typeof v === 'number' && v >= BODY_READ_VERSION;

export const clubArcIsCurrent = (v: number | null | undefined): boolean =>
  typeof v === 'number' && v >= CLUB_ARC_VERSION;

/**
 * 2026-10-27 (SB4x) — an arc is current by WHAT produced it. CLUB_ARC_VERSION 2 is the tracker's grip; a
 * vision arc never carries a grip and the vision path did not change, so asking again returns the same kind
 * of arc (on iOS, for money). A vision arc of any version stays current; a tracker arc must be today's.
 */
export const arcIsCurrent = (v: number | null | undefined, source: unknown): boolean =>
  source === 'vision' || clubArcIsCurrent(v);
