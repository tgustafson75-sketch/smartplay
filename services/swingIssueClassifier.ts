import type { CanonicalIssue, SwingAnalysis } from './poseDetection';
import type { PrimaryIssue } from '../store/cageStore';

/**
 * Phase K — Aggregate per-swing analyses into a session-level Primary Issue.
 *
 * Strategy:
 * - Discard low-confidence analyses (per-swing) from primary-issue tally
 *   (their observations stay for context but don't drive the call).
 * - Tally `detected_issue` across remaining swings.
 * - Primary issue = most-frequent issue, weighted by severity (significant
 *   counts 3x, moderate 2x, minor 1x).
 * - When the top issue is `none` or has fewer than 2 occurrences across the
 *   session, return null Primary Issue (Mike sees "no clear primary issue
 *   from this session" — honest, not a forced call).
 * - When a primary issue is identified:
 *     - mechanical_breakdown = the LLM's per-swing observation (specific
 *       to what was actually visible in THAT swing's frames). Falls back
 *       to ISSUE_COACH_VOICE.mechanical only if observation is missing.
 *     - feel_cue = ISSUE_COACH_VOICE.feel (canonical per-fault drill cue;
 *       the LLM doesn't generate feel cues).
 *
 * 2026-05-16 — Tim reported five swings from three golfers producing the
 * same spoken analysis. Root cause was the classifier discarding each
 * swing's observation and substituting the canonical per-issue breakdown
 * string, so any two over_the_top swings (a common amateur fault) spoke
 * IDENTICALLY. Now the LLM's observation comes through verbatim.
 */

export const ISSUE_DISPLAY_NAME: Record<CanonicalIssue, string> = {
  club_face_open: 'Open Clubface at Impact',
  club_face_closed: 'Closed Clubface at Impact',
  swing_path_outside_in: 'Outside-In Swing Path',
  swing_path_inside_out: 'Inside-Out Swing Path',
  attack_angle_steep: 'Steep Angle of Attack',
  attack_angle_shallow: 'Shallow Angle of Attack',
  early_extension: 'Early Extension',
  over_the_top: 'Over-the-Top Transition',
  chicken_wing: 'Chicken Wing Through Impact',
  reverse_pivot: 'Reverse Pivot',
  none: 'No Clear Primary Issue',
};

export const ISSUE_CATEGORY: Record<CanonicalIssue, PrimaryIssue['category']> = {
  club_face_open: 'club_face',
  club_face_closed: 'club_face',
  swing_path_outside_in: 'swing_path',
  swing_path_inside_out: 'swing_path',
  attack_angle_steep: 'attack_angle',
  attack_angle_shallow: 'attack_angle',
  early_extension: 'setup',
  over_the_top: 'swing_path',
  chicken_wing: 'tempo',
  reverse_pivot: 'tempo',
  none: 'other',
};

/** Per-issue Coach voice. Mechanical breakdown reads in Kevin's voice — same
 *  character that authored the per-drill walkthroughs in Phase I. */
export const ISSUE_COACH_VOICE: Record<CanonicalIssue, { mechanical: string; feel: string }> = {
  club_face_open: {
    mechanical: "Your clubface is open at impact — the ball squirts right because the face never squares up. Grip and release timing are usually the cause.",
    feel: "Feel like the back of your lead hand points at the target through impact. Squares the face naturally.",
  },
  club_face_closed: {
    mechanical: "Your clubface is closed at impact — the ball pulls left because the face is shut at the moment of truth. Often a too-strong grip or early release.",
    feel: "Feel the toe of the club racing past your hands at impact. Wakes the face up.",
  },
  swing_path_outside_in: {
    mechanical: "Your club is approaching from outside the target line. The path comes across the ball, opening the face — that's the slice.",
    feel: "Think of swinging out toward right field. Feels exaggerated, but it's just neutral path.",
  },
  swing_path_inside_out: {
    mechanical: "Your club is coming from inside the target line and swinging out — that's the hook tendency. Path is too far in-to-out.",
    feel: "Feel like you're swinging toward left field. Brings the path back to neutral.",
  },
  attack_angle_steep: {
    mechanical: "You're chopping down on the ball — too steep an angle of attack. Big divots after the ball, ballooning trajectory.",
    feel: "Feel like you're sweeping the grass after the ball, not digging into it.",
  },
  attack_angle_shallow: {
    mechanical: "You're sweeping the ball — no compression, weak strike. Ball flight stays low and short of expected.",
    feel: "Feel like you're trapping the ball against the ground for an instant before the divot.",
  },
  early_extension: {
    mechanical: "Your hips are moving toward the ball at impact instead of rotating around. Spine angle stands up, club gets stuck.",
    feel: "Feel like your butt stays on the wall behind you through the swing. Hips rotate, not push forward.",
  },
  over_the_top: {
    mechanical: "Your club is coming over the plane on transition — shoulders fire before the lower body, club casts out. Classic slice ingredient.",
    feel: "Feel the lower body start the downswing. Hips lead, then arms follow. Slow it down to find it.",
  },
  chicken_wing: {
    mechanical: "Your lead arm is bending through impact — the elbow flies out instead of extending toward the target.",
    feel: "Feel both arms extending toward the target through impact. Long arms, tall finish.",
  },
  reverse_pivot: {
    mechanical: "Your weight is shifting backward on the downswing instead of forward. Robs power, exposes the swing to inconsistency.",
    feel: "Feel your front foot press into the ground as you start down. Weight goes forward, then rotates.",
  },
  none: { mechanical: '', feel: '' },
};

const SEVERITY_WEIGHT: Record<SwingAnalysis['severity'], number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  significant: 3,
};

// Phase J / live cage thresholds — tuned for multi-swing sessions where
// pattern consensus matters. Single-swing UPLOADS skip these and use the
// single-swing branch below.
const MIN_SESSION_SWINGS_FOR_PRIMARY = 3;
const MIN_OCCURRENCES_FOR_PRIMARY = 2;

/**
 * Roll up a session's per-swing analyses into one PrimaryIssue (or null).
 *
 * Phase V.6 — branched logic:
 *   - **Single-swing context** (upload flow, swingAnalyses.length === 1):
 *     surface a tentative result whenever the analysis isn't 'none'. Tag
 *     the resulting PrimaryIssue with the analysis's confidence so the
 *     consumer can prefix a 'tentative read' caveat for low-confidence.
 *     Fixes the upload bug where single uploads always returned null
 *     because MIN_SESSION_SWINGS=3 and MIN_OCCURRENCES=2 could never be
 *     met by a single swing.
 *   - **Multi-swing context** (live cage session): keep prior pattern
 *     consensus thresholds. If consensus fails, fall back to the highest-
 *     severity non-none swing as a 'low'-confidence primary issue rather
 *     than returning null — better than 'no clear issue' when we DO have
 *     a useful read. Honesty bar preserved via confidence='low'.
 */
export function classifySession(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
): PrimaryIssue | null {
  if (swingAnalyses.length === 0) return null;
  console.log('[classifier] enter, swings=' + swingAnalyses.length);

  // ── Single-swing branch (uploads). One read, one decision. ─────────
  if (swingAnalyses.length === 1) {
    const only = swingAnalyses[0];
    console.log('[classifier] single: detected=' + only.analysis.detected_issue + ' conf=' + only.analysis.confidence);
    if (only.analysis.detected_issue === 'none') return null;
    const voice = ISSUE_COACH_VOICE[only.analysis.detected_issue];
    const observationText = (only.analysis.observation ?? '').trim();
    return {
      issue_id: only.analysis.detected_issue,
      name: ISSUE_DISPLAY_NAME[only.analysis.detected_issue],
      category: ISSUE_CATEGORY[only.analysis.detected_issue],
      severity: only.analysis.severity === 'none' ? 'minor' : only.analysis.severity,
      occurrence_count: 1,
      visual_reference_path: null,
      // 2026-05-16 — per-swing observation if the LLM produced one;
      // canonical fallback only when it didn't.
      mechanical_breakdown: observationText || voice.mechanical,
      feel_cue: voice.feel,
      detected_in_shots: [only.swing_id],
      confidence: only.analysis.confidence,
    };
  }

  // ── Multi-swing branch. Pattern consensus across non-low / non-none. ─
  const tally: Record<string, { score: number; count: number; severity: SwingAnalysis['severity']; swing_ids: string[] }> = {};
  for (const { swing_id, analysis } of swingAnalyses) {
    if (analysis.confidence === 'low') continue;
    if (analysis.detected_issue === 'none') continue;
    const issue = analysis.detected_issue;
    const slot = tally[issue] ?? { score: 0, count: 0, severity: 'minor' as const, swing_ids: [] };
    slot.score += SEVERITY_WEIGHT[analysis.severity];
    slot.count += 1;
    slot.swing_ids.push(swing_id);
    if (SEVERITY_WEIGHT[analysis.severity] > SEVERITY_WEIGHT[slot.severity]) {
      slot.severity = analysis.severity;
    }
    tally[issue] = slot;
  }

  const ranked = Object.entries(tally)
    .map(([issue, data]) => ({ issue: issue as CanonicalIssue, ...data }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  console.log('[classifier] multi: consensus top=' + (top?.issue ?? 'none') + ' count=' + (top?.count ?? 0));

  if (top && swingAnalyses.length >= MIN_SESSION_SWINGS_FOR_PRIMARY && top.count >= MIN_OCCURRENCES_FOR_PRIMARY) {
    const voice = ISSUE_COACH_VOICE[top.issue];
    // 2026-05-16 — pick the most diagnostic observation from the swings
    // that detected the consensus issue. Highest-confidence first; falls
    // back to canonical only if no swing produced a usable observation.
    const observation = pickBestObservation(swingAnalyses, top.issue);
    return {
      issue_id: top.issue,
      name: ISSUE_DISPLAY_NAME[top.issue],
      category: ISSUE_CATEGORY[top.issue],
      severity: top.severity === 'none' ? 'minor' : top.severity,
      occurrence_count: top.count,
      visual_reference_path: null,
      mechanical_breakdown: observation || voice.mechanical,
      feel_cue: voice.feel,
      detected_in_shots: top.swing_ids,
      confidence: 'high',
    };
  }

  // ── Fallback: consensus didn't hit thresholds, but at least one swing
  // had a usable read. Surface the most severe non-none swing as a
  // low-confidence primary so the user gets a tentative read instead of
  // 'no clear issue'.
  const usable = swingAnalyses
    .filter(s => s.analysis.detected_issue !== 'none')
    .sort((a, b) => SEVERITY_WEIGHT[b.analysis.severity] - SEVERITY_WEIGHT[a.analysis.severity]);
  if (usable.length === 0) {
    console.log('[classifier] no usable swings — returning null');
    return null;
  }
  const fallback = usable[0];
  console.log('[classifier] tentative fallback: ' + fallback.analysis.detected_issue);
  const voice = ISSUE_COACH_VOICE[fallback.analysis.detected_issue];
  const fallbackObservation = (fallback.analysis.observation ?? '').trim();
  return {
    issue_id: fallback.analysis.detected_issue,
    name: ISSUE_DISPLAY_NAME[fallback.analysis.detected_issue],
    category: ISSUE_CATEGORY[fallback.analysis.detected_issue],
    severity: fallback.analysis.severity === 'none' ? 'minor' : fallback.analysis.severity,
    occurrence_count: 1,
    visual_reference_path: null,
    mechanical_breakdown: fallbackObservation || voice.mechanical,
    feel_cue: voice.feel,
    detected_in_shots: [fallback.swing_id],
    confidence: 'low',
  };
}

// 2026-05-16 — Pick the highest-confidence per-swing observation that
// matches the consensus issue. The user hears specific commentary on
// THEIR swing instead of canned per-issue text.
function pickBestObservation(
  swingAnalyses: { swing_id: string; analysis: SwingAnalysis }[],
  consensusIssue: CanonicalIssue,
): string {
  const matches = swingAnalyses
    .filter(s => s.analysis.detected_issue === consensusIssue)
    .filter(s => (s.analysis.observation ?? '').trim().length > 0);
  if (matches.length === 0) return '';
  // Higher confidence wins; ties broken by severity (more severe first).
  const confRank: Record<SwingAnalysis['confidence'], number> = { high: 3, medium: 2, low: 1 };
  const sevRank: Record<SwingAnalysis['severity'], number> = { significant: 3, moderate: 2, minor: 1, none: 0 };
  matches.sort((a, b) => {
    const c = confRank[b.analysis.confidence] - confRank[a.analysis.confidence];
    if (c !== 0) return c;
    return sevRank[b.analysis.severity] - sevRank[a.analysis.severity];
  });
  return (matches[0].analysis.observation ?? '').trim();
}
