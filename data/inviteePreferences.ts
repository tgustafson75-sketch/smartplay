/**
 * 2026-05-25 — Per-invitee display-name overrides.
 *
 * Tim invites friends/family to test SmartPlay; some prefer a non-default
 * salutation ("Uncle Mike" instead of "Michael"). This map lets Tim
 * pre-set the caddie's display name for known emails BEFORE the invitee
 * even signs in. When the player's email matches a key here, the
 * caddie addresses them by `displayName` instead of the firstName
 * derived from sign-in / OAuth profile.
 *
 * Override hierarchy (lowest → highest):
 *   1. firstName derived from sign-in (Google profile, manual entry)
 *   2. displayName from this map (if email matches) — applied here
 *   3. user-spoken "call me X" intent (writes to a future override
 *      slot in playerProfileStore — TODO when the intent lands)
 *
 * Editing: lowercase the email key for case-insensitive lookup.
 * notes is owner-only context — Tim's reminder of why this entry
 * exists (relationship, course, group). Not surfaced to other users.
 */

export interface InviteePreference {
  /** What the caddie should call this person. */
  displayName: string;
  /** Owner-only memo: relationship, group, course context. */
  notes?: string;
  /** 2026-05-25 — Fix AF: coach refinement authorization. When true,
   *  this invitee can use the "remember this" / "add to brain" voice
   *  trigger to ingest refined instructional definitions into the
   *  caddie brain. No entry sets it today; a vetted instructor can be
   *  added with this flag flipped on. */
  coachMode?: boolean;
}

const INVITEE_PREFERENCES: Record<string, InviteePreference> = {
  'm.hayes@snet.net': {
    displayName: 'Uncle Mike',
    notes: "Tim's uncle. Default to 'Uncle Mike' until he says otherwise. Android. 2026-05-25 weekend invitee.",
  },
  'tomhayes55@hotmail.com': {
    displayName: 'Uncle Tommy',
    notes: "Tim's uncle, weekend HOST. Default to 'Uncle Tommy' until he says otherwise. Android. 2026-05-25 weekend invitee.",
  },
  // 2026-08-26 — an outside instructor's real email address shipped here, in the app
  // bundle on every device, carrying coachMode=true — a live authorization to write into
  // the caddie brain. Both the persona and the arrangement are gone. The coachMode flag
  // stays on the interface: it is the mechanism for vetting a future instructor, and it
  // now grants nothing to nobody until an entry deliberately sets it.
};

/**
 * Look up a display-name override for the given email. Returns null
 * when the email isn't in the map. Case-insensitive on the email key
 * because sign-in providers (Google, Apple) normalize differently.
 */
export function getInviteeDisplayName(email: string | null | undefined): string | null {
  if (!email) return null;
  const entry = INVITEE_PREFERENCES[email.trim().toLowerCase()];
  return entry?.displayName ?? null;
}

/**
 * 2026-05-25 — Fix AF: is this email authorized for coach-refinement?
 * True when the invitee entry has coachMode:true. Used by
 * coachRefineHandler to gate the "remember this" voice trigger so
 * arbitrary testers don't pollute the coach knowledge base.
 */
export function isInviteeCoach(email: string | null | undefined): boolean {
  if (!email) return false;
  const entry = INVITEE_PREFERENCES[email.trim().toLowerCase()];
  return entry?.coachMode === true;
}

/**
 * Resolve the caddie's salutation for the current player. Pass the
 * email AND the default firstName (from playerProfileStore); the
 * helper returns the override when applicable, else the default.
 * Single call site means future name-override sources (e.g. voice
 * "call me X") can layer in without touching every consumer.
 */
export function resolveCaddieSalutation(
  email: string | null | undefined,
  defaultFirstName: string,
): string {
  const override = getInviteeDisplayName(email);
  return override ?? defaultFirstName;
}
