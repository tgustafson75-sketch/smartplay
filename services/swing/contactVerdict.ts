/**
 * 2026-10-05 — CONTACT HONESTY, in the one read.
 *
 * SmartMotion has called a chunk a chunk since 07-07 (Tim: "chunk honesty, propagate everywhere"): a
 * fat / thin / topped strike — from the model's own contact_read or the player's feel note — is the
 * headline, because the motion can look fine on a swing that was hit heavy. That rule lived in the
 * SmartMotion SCREEN, so the same clip read from the Swing Library could headline "over the top" while
 * SmartMotion said "heavy contact". It is the read's rule now (services/videoUpload), for every swing.
 *
 * And a ball the camera SAW never leave its spot ('no_launch', SmartMotion's ball-departure check) is
 * evidence about the clip that no re-read can overturn — the read keeps it.
 */
import type { PrimaryIssue } from '../../store/swingSessionStore';

export type Mishit = 'fat' | 'thin' | 'topped';

/** The headlines that name the STRIKE, not the swing. */
export const CONTACT_ISSUE_IDS = ['no_launch', 'heavy_contact', 'thin_contact', 'topped_contact'];

/** A self-reported mishit in a free-text feel note — the human's read wins. */
export function mishitFromFeel(feelText: string | null | undefined): Mishit | null {
  const f = (feelText ?? '').toLowerCase();
  return /\b(fat|chunk|chunked|chunky|heavy|duff|duffed|dug|dig)\b/.test(f) ? 'fat'
    : /\b(thin|thinned|skull|skulled|blade|bladed|skinny)\b/.test(f) ? 'thin'
    : /\b(top|topped|topping|worm|worm.?burner)\b/.test(f) ? 'topped'
    : null;
}

export function mishitFromRead(contactRead: string | null | undefined): Mishit | null {
  return contactRead === 'fat' || contactRead === 'thin' || contactRead === 'topped' ? contactRead : null;
}

export function contactMishitFaultId(m: Mishit): string {
  return m === 'thin' ? 'thin_contact' : m === 'topped' ? 'topped_contact' : 'heavy_contact';
}

function contactMishitName(m: Mishit): string {
  return m === 'thin' ? 'Thin Contact' : m === 'topped' ? 'Topped' : 'Heavy / Fat Contact';
}

/** The saved headline for a contact mishit. A fat/thin/topped strike is a scoring-relevant miss → significant. */
export function contactMishitIssue(m: Mishit): PrimaryIssue {
  return {
    issue_id: contactMishitFaultId(m),
    name: contactMishitName(m),
    category: 'other',
    severity: 'significant',
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: m === 'fat'
      ? 'Heavy contact — the club caught the ground before the ball. That saps distance and consistency even when the body motion looks fine.'
      : m === 'thin'
        ? 'Thin contact — caught the ball above center. The motion can look clean; low-point control is the thing to groove.'
        : 'Topped — the club caught the top of the ball, usually a low-point / posture-through-impact issue.',
    feel_cue: 'Ball-first contact: feel the low point just AHEAD of the ball. Put a towel a few inches behind the ball you have to miss — the classic groove drill.',
    detected_in_shots: [],
    confidence: 'medium',
  } as PrimaryIssue;
}

/** A ball that never left its spot — a duff or whiff, whatever the body did. */
export function noLaunchIssue(): PrimaryIssue {
  return {
    issue_id: 'no_launch',
    name: 'Ball Didn’t Launch',
    category: 'other',
    severity: 'significant',
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: 'The ball never left its spot — a duff, heavy hit, or whiff. The body motion can look fine; the strike is what to groove.',
    feel_cue: 'Make ball-first contact — feel the low point just ahead of the ball. Re-record and I\'ll read the next one.',
    detected_in_shots: [],
    confidence: 'medium',
  } as PrimaryIssue;
}

/**
 * The read's final say on the headline: the player's feel, then the model's contact read (first swing
 * that has one), then the swing fault the classifier chose. A stored 'no_launch' stands unless a named
 * mishit replaces it.
 */
export function applyContactHonesty(
  classified: PrimaryIssue | null,
  contactReads: (string | null | undefined)[],
  feelNote: string | null | undefined,
  storedIssueId: string | null | undefined,
): PrimaryIssue | null {
  const m = mishitFromFeel(feelNote) ?? contactReads.map(mishitFromRead).find((x): x is Mishit => x != null) ?? null;
  if (m) return contactMishitIssue(m);
  if (storedIssueId === 'no_launch') return noLaunchIssue();
  return classified;
}
