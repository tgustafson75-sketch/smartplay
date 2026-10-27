/**
 * services/swing/faultSpotlight.ts — WHERE and WHEN a diagnosed fault shows on the swing video.
 *
 * 2026-10-10 (Tim, after the SmartBay build: "the pointing out and highlighting of issues I've wanted
 * for many months"). Every analysed swing already stores the frame its fault was read from
 * (`SwingShot.detected_issue_timestamps_sec`, written per shot by videoUpload) and the joints each fault
 * lives in (`FAULT_REGION_JOINTS`). No screen played to that moment or pointed at that place: the frame
 * sat in a thumbnail and a "FAULT MOMENT" time pill. This is the pure half the swing screens draw from:
 *
 *   faultMomentFor   the second in the clip to stop on — the read's own frame when it has one, else
 *                    the swing phase the fault lives in, taken from the motion anchors measured off the
 *                    hands (never a fixed fraction of the clip).
 *   faultCaption     the name and the one thing to look at, for the callout over the video.
 *   spotlightRing    the circle around the fault's joints in the pose frame at that moment.
 *
 * The skeleton itself stays opt-in (Tim, 10-10: gate it behind the player asking). The ring only needs
 * the pose frame the run already computed for the shot on screen, so it adds no analysis work.
 */
import type { PoseFrame } from '../poseAnalysisApi';
import { ISSUE_DISPLAY_NAME } from '../swingIssueClassifier';

// 2026-07-06 (Tim: "if the turn is wrong or the hips don't move, it needs to
// go orange or red, kinda like GolfFix, so you see the AREA of error") —
// map each diagnosable fault to the joints whose skeleton region renders hot.
// Derived from the fault's biomechanical home, not fabricated per-frame error
// detection: the ANALYSIS names the fault; this paints WHERE that fault lives.
export const FAULT_REGION_JOINTS: Record<string, string[]> = {
  over_the_top:          ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  swing_path_outside_in: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  swing_path_inside_out: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  plane_too_flat:        ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  plane_too_steep:       ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  attack_angle_steep:    ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  attack_angle_shallow:  ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  casting:               ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  club_face_open:        ['left_wrist', 'right_wrist'],
  club_face_closed:      ['left_wrist', 'right_wrist'],
  chicken_wing:          ['left_elbow', 'left_wrist', 'right_elbow', 'right_wrist'],
  early_extension:       ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  sway:                  ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  reverse_pivot:         ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
  spine_angle_loss:      ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'],
  head_movement:         ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'],
  // 2026-08-09 (elite fault engine) — arm + finish faults.
  lead_arm_bent:         ['left_shoulder', 'left_elbow', 'left_wrist', 'right_shoulder', 'right_elbow', 'right_wrist'],
  poor_finish:           ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
};

/** The part of the swing a fault shows in. */
export type FaultPhase = 'top' | 'transition' | 'impact' | 'through' | 'finish';

/**
 * Every fault the overlay can paint (`FAULT_REGION_JOINTS`) — its phase and the one thing to look at.
 * Kept in step with FAULT_REGION_JOINTS by a guard: a fault that can be painted but not timed would
 * highlight a body part at a random moment.
 */
export const FAULT_SPOTLIGHT: Record<string, { phase: FaultPhase; look: string }> = {
  over_the_top:          { phase: 'transition', look: 'The club comes down outside the line it went back on' },
  swing_path_outside_in: { phase: 'transition', look: 'The club cuts across the ball from outside' },
  swing_path_inside_out: { phase: 'transition', look: 'The club drops too far inside coming down' },
  casting:               { phase: 'transition', look: 'The wrists let the angle go early' },
  plane_too_flat:        { phase: 'top',        look: 'The club gets behind you at the top' },
  plane_too_steep:       { phase: 'top',        look: 'The club gets too upright at the top' },
  sway:                  { phase: 'top',        look: 'The hips slide away instead of turning' },
  reverse_pivot:         { phase: 'top',        look: 'The weight stays on the lead side going back' },
  lead_arm_bent:         { phase: 'top',        look: 'The lead arm folds at the top' },
  early_extension:       { phase: 'impact',     look: 'The hips push in toward the ball' },
  spine_angle_loss:      { phase: 'impact',     look: 'You stand up out of your posture' },
  head_movement:         { phase: 'impact',     look: 'The head moves off the ball' },
  attack_angle_steep:    { phase: 'impact',     look: 'The club chops down too steeply' },
  attack_angle_shallow:  { phase: 'impact',     look: 'The club sweeps instead of compressing' },
  club_face_open:        { phase: 'impact',     look: 'The face is open at impact' },
  club_face_closed:      { phase: 'impact',     look: 'The face is closed at impact' },
  chicken_wing:          { phase: 'through',    look: 'The lead elbow folds through the ball' },
  poor_finish:           { phase: 'finish',     look: 'The swing stops at the ball' },
};

/** True for a fault the review can stop on and point at. 'none', 'no_clear_fault', 'no_launch' → false. */
export function isSpotlightFault(faultId: string | null | undefined): faultId is string {
  return !!faultId && Object.prototype.hasOwnProperty.call(FAULT_SPOTLIGHT, faultId);
}

export interface FaultMoment {
  /** Absolute clip seconds. */
  sec: number;
  /** 'read' = the frame the diagnosis was read from; 'phase' = the fault's swing phase, from motion. */
  source: 'read' | 'phase';
}

/** Swing anchors in clip ms (services/swing/poseMotion.deriveSwingAnchors). */
export interface AnchorsMs { startMs: number; topMs: number; impactMs: number; endMs: number }

/**
 * The moment to stop on. The read's own fault frame wins when it lies inside the swing; otherwise the
 * fault's phase on the measured anchors. Null when there is no real fault or nothing to time it by.
 */
export function faultMomentFor(args: {
  faultId: string | null | undefined;
  /** `SwingShot.detected_issue_timestamps_sec` (absolute clip seconds; legacy arrays >2 already dropped). */
  readTimestampsSec: readonly number[];
  anchors: AnchorsMs | null;
  /** The located swing window, absolute clip seconds. */
  windowStartSec: number;
  windowEndSec: number;
}): FaultMoment | null {
  const { faultId, readTimestampsSec, anchors, windowStartSec, windowEndSec } = args;
  if (!isSpotlightFault(faultId)) return null;
  const lo = windowStartSec - 0.05;
  // The replay loops back at the window's end, so a moment in its last few frames could never be
  // stopped on: everything is held at least 60ms inside it.
  const hi = windowEndSec - 0.06;
  const read = readTimestampsSec.find((t) => Number.isFinite(t) && t >= lo && t <= hi);
  if (read !== undefined) return { sec: read, source: 'read' };
  if (!anchors) return null;
  const { topMs, impactMs, endMs } = anchors;
  if (![topMs, impactMs, endMs].every(Number.isFinite)) return null;
  const phase = FAULT_SPOTLIGHT[faultId].phase;
  const ms =
    phase === 'top' ? topMs
    : phase === 'transition' ? topMs + (impactMs - topMs) * 0.4
    : phase === 'impact' ? impactMs
    : phase === 'through' ? impactMs + Math.max(0, endMs - impactMs) * 0.3
    : endMs;
  const sec = Math.min(ms / 1000, hi);
  return sec >= lo ? { sec, source: 'phase' } : null;
}

/**
 * 2026-10-16 — THE FAULT PAUSE, ONE RULE FOR BOTH REVIEW SCREENS (the swing library and SmartMotion's
 * review each copied the same crossing logic, and both kept the ring up away from the fault).
 *
 * What a playback tick means for the fault stop. `latched` is the one-stop-per-pass latch: set when the
 * replay stops on the fault (or the player jumps to it), released once playback is back before it — the
 * tail loop, a restart, a scrub — unless it is our own seek back landing (`selfSeeking`). A stop needs
 * the setting on, playback running, and a real crossing (not a seek that jumped over the fault).
 */
export function faultPauseTick(t: {
  faultSec: number | null;
  posSec: number;
  /** The previous tick's position; < 0 before the first tick. */
  lastPosSec: number;
  playing: boolean;
  enabled: boolean;
  latched: boolean;
  selfSeeking: boolean;
}): 'stop' | 'unlatch' | null {
  const f = t.faultSec;
  if (f == null) return null;
  if (t.posSec < f - 0.25 && !t.selfSeeking) return 'unlatch';
  if (t.playing && t.enabled && !t.latched && t.lastPosSec >= 0 && t.lastPosSec < f && t.posSec >= f - 0.02
    && t.posSec - t.lastPosSec < 0.45) return 'stop';
  return null;
}

/**
 * Whether the screen is HELD ON THE FAULT — the only time the ring and the "Paused on the issue" card
 * show. Always within a couple of frames of the fault: the old rule let the `atIssue` flag alone keep the
 * card and ring up while the player scrubbed to Address / Top / Finish (Lily's 4075 screenshots), because
 * nothing but playing cleared it.
 *   atIssue  the replay stopped there, or the player jumped there — shown whether or not the review
 *            pauses (a player who switched the pause off and jumps to the fault still sees what is wrong);
 *   paused   merely paused on the fault frame — shown only while this review pauses on the fault (the
 *            "Pause on issue" toggle; until 10-27 the Issue chip).
 */
export function heldOnFault(h: { faultSec: number | null; posSec: number; paused: boolean; atIssue: boolean; pausing: boolean }): boolean {
  if (h.faultSec == null) return false;
  return Math.abs(h.posSec - h.faultSec) < 0.08 && (h.atIssue || (h.paused && h.pausing));
}

/**
 * 2026-10-27 (Tim: "Tapping Issue did not highlight the area") — THE ISSUE CHIP SHOWS THE ISSUE, every tap.
 * It was a toggle for "stop on the fault this review" (10-16), and it starts ON: the first tap turned the
 * review OFF (the chip struck through) and never jumped or highlighted — only a second tap did. Stopping on
 * the fault during playback is the "Pause on issue" toggle's; the chip leaves the review's pause as it is.
 */
export function issueChipPress(enabled: boolean): { enabled: boolean; jumpToFault: boolean } {
  return { enabled, jumpToFault: true };
}

/** Why the screen is held on the fault: the replay stopped there, or the player asked to see it. */
export type IssueHold = 'stop' | 'jump' | null;

/**
 * Whether the ring shows. Only held on the fault, and only over a real body read with the fault's joints
 * (a ring on a guessed spot is worse than none). The saved Highlight setting governs the PASSIVE stop (the
 * replay pausing there by itself); a player who asked to see the issue (Issue chip, Fault-moment pill)
 * always gets the ring — a setting turned off weeks ago must not answer that tap with nothing.
 */
export function spotlightShows(s: { held: boolean; hold: IssueHold; highlight: boolean; hasPose: boolean; faultJoints: number }): boolean {
  return s.held && s.hasPose && s.faultJoints > 0 && (s.hold === 'jump' || s.highlight);
}

/**
 * What the library swing screen asks THE shot run for (orchestrator/shotDetail.requestShotDetail), or null
 * for nothing. Only on the player's ask (the library is manual, Tim 06-15): a swing other than the first,
 * Body / Swing Trace on — or the player asking to see the issue, since the ring is drawn from the body read
 * and swing 1's was otherwise never asked for. An Issue ask wants the body read only: no arc, free or paid.
 */
export function shotDetailRequestFor(w: { idx: number; showSkeleton: boolean; traceAsked: boolean; issueAsked: boolean }): { arc?: boolean | 'tracker' } | null {
  if (w.traceAsked) return { arc: true };
  if (w.idx > 0 || w.showSkeleton) return { arc: 'tracker' };
  // `{}` meant arc: undefined, which the shot run reads as `true` — the PAID fallback (shotDetail.runShotDetail).
  return w.issueAsked ? { arc: false } : null;
}

/**
 * The line a screen shows when the player wants the body (to ring the issue, or the skeleton) and there is
 * none: the read is on the way, or it came back with nothing (the clip is gone, or no body was found) and
 * the honest next step is Re-analyze. Never silence.
 */
export function bodyReadNote(n: { wanted: boolean; hasPose: boolean; pending: boolean }): 'reading' | 'no_read' | null {
  if (!n.wanted || n.hasPose) return null;
  return n.pending ? 'reading' : 'no_read';
}

/**
 * The second a jump holds as the fault: the computed moment, else (the Fault-moment pill on a swing with no
 * moment — no anchors yet, or the stored frame belongs to another fault) the time the player tapped. A bare
 * seek there held nothing: no ring, no caption.
 */
export function issueJumpSec(faultMomentSec: number | null, askedSec?: number | null): number | null {
  if (faultMomentSec != null) return faultMomentSec;
  return typeof askedSec === 'number' && Number.isFinite(askedSec) ? askedSec : null;
}

type FaultRead = { primary_fault?: string | null; detected_issue?: string | null; issue_id?: string | null; severity?: string | null; detected_in_shots?: readonly string[] | null } | null | undefined;
type ShotOnScreen = { id: string; practice?: { reason: string; restoredByUser?: boolean } | null } | null | undefined;
/**
 * The fault painted and timed on the swing ON SCREEN (library swing screen). Every swing — the first too —
 * uses its own per-swing read when it has one (audit R7: swing 1 showed the session headline, which can be
 * another swing's, so its own stored fault frame was discarded and SmartMotion named a different fault for
 * the same swing). The headline stands in only for a legacy first swing with no per-swing read.
 */
export function swingFaultOnScreen(idx: number, sessionHeadline: FaultRead, shotRead: FaultRead, shot?: ShotOnScreen): { faultId: string | null; severe: boolean } {
  if (shotRead) {
    const own = shotRead.primary_fault ?? (shotRead.detected_issue && shotRead.detected_issue !== 'none' ? shotRead.detected_issue : null);
    return { faultId: own ?? null, severe: shotRead.severity === 'significant' };
  }
  if (headlineStandsIn(idx, sessionHeadline, shot)) return { faultId: sessionHeadline?.primary_fault ?? sessionHeadline?.issue_id ?? null, severe: sessionHeadline?.severity === 'significant' };
  return { faultId: null, severe: false };
}

/**
 * 2026-10-27 (seam review of SB3a/b/d) — may the session headline stand in for swing 1's own read? Only for a
 * legacy swing 1: not a demoted practice swing (SB3b skips its read, so it has none — the headline is the
 * COUNTED swings'), and not when the headline names other swings only (SB3a clears every per-swing read at a
 * Re-analyze, so a swing 1 whose new read failed has none either). An empty / missing detected_in_shots is
 * unknown (an older build's headline): it still stands in.
 */
function headlineStandsIn(idx: number, headline: FaultRead, shot: ShotOnScreen): boolean {
  if (idx !== 0 || !headline) return false;
  if (shot?.practice && shot.practice.restoredByUser !== true) return false;
  const named = headline.detected_in_shots;
  return !shot || !Array.isArray(named) || named.length === 0 || named.includes(shot.id);
}

/**
 * Where the callout sits so it never covers what it points at: the head, and the hands high at the top of
 * the swing or in transition, live in the upper part of the frame — those captions go to the bottom.
 */
export function calloutAtBottom(faultId: string): boolean {
  const joints = FAULT_REGION_JOINTS[faultId] ?? [];
  const phase = FAULT_SPOTLIGHT[faultId]?.phase;
  return joints.includes('nose') || phase === 'top' || phase === 'transition';
}

/** The callout over the video: the fault's name and the one thing to look at. */
export function faultCaption(faultId: string): { name: string; look: string } {
  const named = (ISSUE_DISPLAY_NAME as Record<string, string>)[faultId];
  const name = named ?? faultId.split('_').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return { name, look: FAULT_SPOTLIGHT[faultId]?.look ?? '' };
}

/**
 * The ring around a fault's joints in one pose frame, in the frame's own coordinate space scaled by
 * (sx, sy). Centred on the visible fault joints, sized to enclose them with a margin proportional to
 * the player (shoulder width), so it reads the same filmed close or from eight feet. Null when fewer
 * than one fault joint is visible — a ring on a guessed spot is worse than none.
 */
export function spotlightRing(
  frame: PoseFrame,
  joints: readonly string[],
  sx: number,
  sy: number,
  minScore = 0.2,
): { cx: number; cy: number; r: number } | null {
  const pts = frame.keypoints
    .filter((k) => k.name != null && joints.includes(k.name) && k.score >= minScore)
    .map((k) => ({ x: k.x * sx, y: k.y * sy }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const spread = Math.max(0, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const ls = frame.keypoints.find((k) => k.name === 'left_shoulder' && k.score >= minScore);
  const rs = frame.keypoints.find((k) => k.name === 'right_shoulder' && k.score >= minScore);
  const shoulder = ls && rs ? Math.hypot((ls.x - rs.x) * sx, (ls.y - rs.y) * sy) : 0;
  // No shoulders (turned away, out of frame): a quarter of the player's visible height stands in.
  const ys = frame.keypoints.filter((k) => k.score >= minScore && Number.isFinite(k.y)).map((k) => k.y * sy);
  const bodyH = ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
  const scale = shoulder > 0 && Number.isFinite(shoulder) ? shoulder : bodyH > 0 ? bodyH * 0.25 : spread;
  if (!(scale > 0)) return null;
  const r = Math.max(spread + scale * 0.25, scale * 0.45);
  return Number.isFinite(r) && r > 0 ? { cx, cy, r } : null;
}

/**
 * 2026-10-27 — the fault the library's BODY tiles are toned from, for the swing on screen. Same rule as
 * swingFaultOnScreen: the swing's own read; the session headline only for a legacy swing 1 with none. It fell
 * back to the headline for EVERY swing, so swing 3's tiles were coloured by another swing's fault.
 */
export function swingBodyFaultRead(
  idx: number,
  sessionHeadline: FaultRead,
  shotRead: FaultRead,
  shot?: ShotOnScreen,
): { primary_fault: string | null; detected_issue: string } | null {
  if (shotRead) return { primary_fault: shotRead.primary_fault ?? null, detected_issue: shotRead.detected_issue ?? 'none' };
  if (sessionHeadline && headlineStandsIn(idx, sessionHeadline, shot)) return { primary_fault: sessionHeadline.primary_fault ?? null, detected_issue: sessionHeadline.issue_id ?? 'none' };
  return null;
}
