/**
 * 2026-09-12 (Tim) — SAY WHAT THE CAPTURE CANNOT DO, AND WHAT WOULD FIX IT.
 *
 * "Not letting things break and default and go around. If the user doesn't have their setting on the
 *  ideal, then part of our honesty is that we say: hey listen, we can analyze here, but you may not
 *  have these factors — if you switch your phone to sixty, you get more accuracy."
 *
 * The app already knew this and kept it to itself. `MIN_TRACE_FPS` has always decided whether a
 * departure trace can honestly be drawn, and when the answer is no, smartmotion returns null — the
 * line simply is not there. No wrong claim is made, which is the important half, but the player is
 * left to conclude the feature is broken rather than that their capture was too slow for it.
 *
 * A silent degrade is only half of honesty. The other half is telling someone what they are missing
 * and what would get it back, and this is the half that also happens to grow the product: nobody
 * changes a camera setting they were never told mattered.
 *
 * DELIBERATELY NOT A NAG. One note, stated once, tied to a real measured shortfall — never a banner,
 * never on a capture that was fine. [[no-push-nagging-no-ads]]
 */
import { MIN_TRACE_FPS, PREFERRED_CAPTURE_FPS } from './capture/captureFlags';

export interface CaptureQualityNote {
  /** True when the capture supports everything we offer to read from it. */
  ok: boolean;
  /** What we still CAN do. Never "this failed" — the analysis is real, just narrower. */
  can: string;
  /** What this capture cannot support, or null when nothing is missing. */
  missing: string | null;
  /** The concrete thing the player could change, or null when there is nothing to suggest. */
  fix: string | null;
}

const FINE: CaptureQualityNote = { ok: true, can: '', missing: null, fix: null };

/**
 * Judge a capture from the frame rate it actually achieved.
 *
 * `null` means UNKNOWN, not slow — the expo-camera path reports no frame rate at all. An unknown
 * rate must not produce a warning: telling a player their capture might be poor when we have not
 * measured it is a guess dressed as a finding. [[illustration-data-points]]
 */
export function captureQualityNote(capturedFps: number | null | undefined): CaptureQualityNote {
  if (capturedFps == null || !Number.isFinite(capturedFps) || capturedFps <= 0) return FINE;
  if (capturedFps >= MIN_TRACE_FPS) return FINE;

  return {
    ok: false,
    can: 'I can still read your tempo, your positions and the contact from this',
    missing: `at ${Math.round(capturedFps)} frames a second I can't honestly draw the ball's start direction — the club moves several feet between frames, so I'd be guessing at the line`,
    fix: `if your camera can record at ${MIN_TRACE_FPS} or ${PREFERRED_CAPTURE_FPS} frames a second, switch it over and I can show you where the ball actually started`,
  };
}

/**
 * The same note as one spoken sentence for the caddie, or null when the capture was fine.
 *
 * Written as something a person would say standing next to you, in the order a person would say it:
 * what I CAN do, then what I can't, then the fix. Leading with the limitation makes a working
 * analysis sound like a failure.
 */
export function captureQualityLine(capturedFps: number | null | undefined): string | null {
  const n = captureQualityNote(capturedFps);
  if (n.ok) return null;
  return `${n.can}, but ${n.missing}. ${n.fix![0].toUpperCase()}${n.fix!.slice(1)}.`;
}
