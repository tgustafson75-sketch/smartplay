/**
 * 2026-06-13 — Down-the-line target rig math (pure, testable).
 *
 * The DTL setup is ONE element: the ball box + the aim line + the target end move
 * together when you grab the rig, and the target END free-floats on its own so you
 * can aim side-to-side and set depth (Tim). This module holds the geometry so the
 * EditableCageTargets gestures and the default framing both come from one tested
 * source.
 *
 * Default framing (Tim): the player fills ~2/3 of the frame and the ball + target
 * line sit in the outer 1/3, mirrored by handedness — RH camera-down-the-line puts
 * the ball in the RIGHT third, LH in the LEFT third. See memory:
 * framing-coach, left-handed-support, smartmotion-cage-findings.
 *
 * Pure, sync, never throws. No React/store.
 */

export interface RigPoint { x: number; y: number }
export interface BallArea { x: number; y: number; r: number }
export interface TargetRig { ball: BallArea; target: RigPoint }

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** The ball sits in the outer third; the target line runs straight up from it. */
const BALL_X_RH = 0.67;   // right third (player fills the left two-thirds)
const BALL_X_LH = 0.33;   // mirrored for lefties
const BALL_Y = 0.62;      // a bit below center — typical address height in a DTL frame
const BALL_R = 0.08;
const TARGET_Y = 0.12;    // near the top of the frame

/**
 * Handedness-aware default DTL rig: player two-thirds, ball + target line in the
 * outer third. The aim line is vertical (target directly above the ball) so it
 * reads as "straight" until the player drags the target end to aim.
 */
export function defaultDtlRig(handedness: 'right' | 'left'): TargetRig {
  const x = handedness === 'left' ? BALL_X_LH : BALL_X_RH;
  return { ball: { x, y: BALL_Y, r: BALL_R }, target: { x, y: TARGET_Y } };
}

/**
 * Rigidly translate the whole rig by (dx, dy) in NORMALIZED units — the ball and
 * the target move together, preserving the aim line's length and angle (the "one
 * element" move). The delta is clamped so BOTH the ball and the target stay on
 * frame, which keeps the rigid offset exact (no edge distortion).
 */
export function translateRig(ball: BallArea, target: RigPoint | null, dx: number, dy: number): TargetRig {
  if (!target) {
    // No target (face-on / putt without a flag) — just move the ball, clamped.
    return { ball: { ...ball, x: clamp01(ball.x + dx), y: clamp01(ball.y + dy) }, target: { x: clamp01(ball.x + dx), y: clamp01(ball.y + dy) } };
  }
  // Clamp the delta so neither point leaves [0,1].
  const minDx = Math.max(-ball.x, -target.x);
  const maxDx = Math.min(1 - ball.x, 1 - target.x);
  const minDy = Math.max(-ball.y, -target.y);
  const maxDy = Math.min(1 - ball.y, 1 - target.y);
  const cdx = Math.max(minDx, Math.min(maxDx, dx));
  const cdy = Math.max(minDy, Math.min(maxDy, dy));
  return {
    ball: { ...ball, x: ball.x + cdx, y: ball.y + cdy },
    target: { x: target.x + cdx, y: target.y + cdy },
  };
}

/** Move only the free-floating target end (aim side-to-side + depth). Clamped. */
export function moveTargetEnd(target: RigPoint, dx: number, dy: number): RigPoint {
  return { x: clamp01(target.x + dx), y: clamp01(target.y + dy) };
}
