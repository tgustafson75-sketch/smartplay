/**
 * 2026-07-06 — Drill Check verdict (Tim — pro-video → drill loop MOAT, Phase 2:
 * "judge the analysis of the drill to what's expected").
 *
 * The moat: after a drill capture, grade the swing against the fault the drill is
 * supposed to FIX — using signals we already compute (the drill's id IS the
 * CanonicalIssue it targets, and SmartMotion already rolls the drill swings up into
 * a session primary_issue). No fabricated metric, no server round-trip.
 *
 * HONESTY BAR: this is directional and per-set — "the fault this drill targets
 * didn't show this set" / "it's lighter" / "still catching it." It NEVER claims a
 * swing is permanently fixed ("you fixed your slice"). A single drill set is
 * evidence of a rep going the right way, not a cure.
 */

export type DrillGrade = 'got_it' | 'closer' | 'not_yet';

export interface DrillVerdict {
  grade: DrillGrade;
  line: string;
}

// A drill targets a CanonicalIssue by id, but the classifier can roll a swing up to
// a RELATED canonical fault (e.g. over-the-top reads as the outside-in path / steep
// plane family). Match the target against its family so "still present" is honest,
// not a strict-id miss. Unlisted drills default to their own id only.
const DRILL_TARGET_FAULTS: Record<string, string[]> = {
  over_the_top: ['over_the_top', 'swing_path_outside_in', 'plane_too_steep'],
  swing_path_outside_in: ['swing_path_outside_in', 'over_the_top', 'plane_too_steep'],
  early_extension: ['early_extension', 'spine_angle_loss'],
  casting: ['casting', 'attack_angle_shallow'],
  sway: ['sway', 'reverse_pivot'],
};

export function targetsForDrill(drillId: string): string[] {
  return DRILL_TARGET_FAULTS[drillId] ?? [drillId];
}

/**
 * Derive the Drill Check verdict from the drill target + the session's rolled-up
 * primary issue. Returns null when it isn't a drill (no verdict to show).
 *
 * @param issueId   session primary_issue.issue_id, or null when analysis found no
 *                  dominant fault (that's the GOOD outcome for a drill).
 */
export function deriveDrillVerdict(input: {
  drillId: string;
  drillName?: string | null;
  issueId: string | null;
  issueName?: string | null;
  severity?: 'minor' | 'moderate' | 'significant' | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  /** 2026-07-07 (Tim — chunk honesty in the MOAT loop) — a strike the MOTION read
   *  can't see. A fat/thin/topped rep (or a ball that never launched) must NEVER grade
   *  'got_it' — we can't credit the drill as landing off a mishit. */
  contactMishit?: 'fat' | 'thin' | 'topped' | null;
  ballLaunched?: boolean | null;
}): DrillVerdict | null {
  if (!input.drillId) return null;
  const drill = input.drillName && input.drillName.trim() ? input.drillName.trim() : 'drill';
  const targets = targetsForDrill(input.drillId);
  const stillPresent = input.issueId != null && targets.includes(input.issueId);
  const faultName = input.issueName && input.issueName.trim() ? input.issueName.trim() : 'that fault';

  // A mishit means the rep can't be credited as the drill "landing", even if the
  // motion looked clean. Honest, non-green — reset and make ball-first contact.
  const mishit = input.contactMishit ?? null;
  if (mishit || input.ballLaunched === false) {
    const what = mishit === 'thin' ? 'thin' : mishit === 'topped' ? 'topped' : 'heavy';
    return {
      grade: 'closer',
      line: `Drill check: that rep was ${what} — I can't confirm the strike, so I can't credit the ${drill} yet. Reset and make ball-first contact.`,
    };
  }

  if (!stillPresent) {
    return {
      grade: 'got_it',
      line: `Drill check: clean — the fault this drill targets didn't show this set. That's the ${drill} move landing. Keep grooving it.`,
    };
  }
  // Target fault still dominant — grade how strongly.
  const light = input.severity === 'minor' || input.confidence === 'low';
  if (light) {
    return {
      grade: 'closer',
      line: `Drill check: closer — ${faultName} is lighter this set. One more with that same feel.`,
    };
  }
  return {
    grade: 'not_yet',
    line: `Drill check: still catching ${faultName} this set. Reset and run the ${drill} feel again.`,
  };
}
