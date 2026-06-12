/**
 * 2026-06-11 — Framing Coach. "Is the golfer fully in frame, ready to swing?"
 *
 * Tim's ask: the Golf Fix app knows when you're in frame before you start. Years
 * on, we have the piece it needed — on-device MediaPipe pose. detectPoseFromBase64
 * gives 33 landmarks with a per-joint in-frame confidence; project to COCO-17 and
 * this pure function reads "are head AND feet visible, body centred" from a single
 * live preview frame. The setup loop polls a frame every ~800ms, runs pose, and
 * shows a cue: searching → "step back, feet are cut off" → "✓ framed, start swinging".
 *
 * On-thesis (north star): the phone's own camera + AI confirm the capture is good
 * BEFORE the swing — no extra hardware, and it doubles as the ball-box auto-anchor
 * (feetCenter → place the box below the feet on the center line).
 *
 * Pure + deterministic so it unit-tests; thresholds want an on-device cage tune.
 */

export interface FramingKeypoint {
  name: string;
  x: number; // normalized 0..1 (left→right)
  y: number; // normalized 0..1 (top→bottom)
  score: number; // 0..1 in-frame confidence
}

export type FramingStatus = 'no_person' | 'partial' | 'framed';
export type FramingReason =
  | 'none'
  | 'no_person'
  | 'feet_cut'
  | 'head_cut'
  | 'too_left'
  | 'too_right';

export interface FramingResult {
  status: FramingStatus;
  reason: FramingReason;
  /** Short spoken/printed cue for the HUD. */
  message: string;
  /** Midpoint of the two ankles (normalized) when both feet are seen — the
   *  anchor for auto-placing the ball box below the feet. Null otherwise. */
  feetCenter: { x: number; y: number } | null;
  /** Body horizontal centre (avg of shoulders+hips), for the "move left/right" cue. */
  bodyCenterX: number | null;
}

const MIN_SCORE = 0.3;          // a joint below this isn't reliably in-frame
const TOP_CUT_Y = 0.04;         // nose this close to the top edge = head likely cut
const BOTTOM_CUT_Y = 0.97;      // ankle this close to the bottom edge = feet at/over the edge
const CENTER_LO = 0.2;          // body centre left of this = too far left
const CENTER_HI = 0.8;          // body centre right of this = too far right

function find(kp: FramingKeypoint[], name: string): FramingKeypoint | null {
  const k = kp.find((p) => p.name === name);
  return k && k.score >= MIN_SCORE ? k : null;
}

/**
 * Evaluate framing from one frame's keypoints. Order of checks is the order we
 * coach: first "is anyone there", then head, then feet (the usual miss — phone
 * too low / golfer too close), then left/right centring.
 */
export function evaluateFraming(keypoints: FramingKeypoint[]): FramingResult {
  const nose = find(keypoints, 'nose');
  const lSh = find(keypoints, 'left_shoulder');
  const rSh = find(keypoints, 'right_shoulder');
  const lHip = find(keypoints, 'left_hip');
  const rHip = find(keypoints, 'right_hip');
  const lAnk = find(keypoints, 'left_ankle');
  const rAnk = find(keypoints, 'right_ankle');

  // Torso = the anchor that says "a person is actually here" (vs a few stray,
  // low-confidence points). Need at least one shoulder AND one hip.
  const hasTorso = (lSh || rSh) && (lHip || rHip);
  if (!hasTorso) {
    return { status: 'no_person', reason: 'no_person', message: 'Step into frame', feetCenter: null, bodyCenterX: null };
  }

  const cxParts = [lSh, rSh, lHip, rHip].filter(Boolean) as FramingKeypoint[];
  const bodyCenterX = cxParts.reduce((s, k) => s + k.x, 0) / cxParts.length;

  // Head — present and not jammed against the top edge.
  if (!nose || nose.y <= TOP_CUT_Y) {
    return { status: 'partial', reason: 'head_cut', message: 'Tilt up — your head is cut off', feetCenter: null, bodyCenterX };
  }

  // Feet — both ankles seen and not at/over the bottom edge (the common miss).
  const feetSeen = lAnk && rAnk;
  const feetAtEdge = (lAnk && lAnk.y >= BOTTOM_CUT_Y) || (rAnk && rAnk.y >= BOTTOM_CUT_Y);
  if (!feetSeen || feetAtEdge) {
    return { status: 'partial', reason: 'feet_cut', message: 'Step back — I can’t see your feet', feetCenter: null, bodyCenterX };
  }

  const feetCenter = { x: (lAnk.x + rAnk.x) / 2, y: (lAnk.y + rAnk.y) / 2 };

  // Left/right centring (last — only nags once head+feet are in).
  if (bodyCenterX < CENTER_LO) {
    return { status: 'partial', reason: 'too_left', message: 'Center up — move right a touch', feetCenter, bodyCenterX };
  }
  if (bodyCenterX > CENTER_HI) {
    return { status: 'partial', reason: 'too_right', message: 'Center up — move left a touch', feetCenter, bodyCenterX };
  }

  return { status: 'framed', reason: 'none', message: 'In frame — start swinging', feetCenter, bodyCenterX };
}
