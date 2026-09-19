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
 * 2026-09-19 (a field report from a brand-new player's FIRST swing, Pixel 8a) — THE CLUBHEAD NOTE.
 *
 *     clubpath_arc_too_sparse { detected: 2, rejected: "too_few", framesSampled: 14 }
 *
 * The arc gate classifies its own refusal into four reasons, and one of them — `too_few` — is
 * documented in the gate as "the model genuinely could not see the head. A CAPTURE problem: light,
 * angle, frame rate." That is the player's to fix, and we wrote it to a log.
 *
 * So they recorded their first swing, got a skeleton with no swing path and no explanation, and
 * were left to work out whether the feature is broken or they are. That is the exact silent degrade
 * this file exists to end; it just had not been extended past frame rate.
 *
 * ONLY for `too_few`. `cluster` and `scatter` mean we found points and they were the ball or the
 * grip or a background object — a mis-detection, OUR problem, and telling someone to add light for
 * it sends them to fix something that is not broken. Silence stays right for those.
 *
 * Same shape and the same order as the note above, because it is the same conversation: what I CAN
 * read, what I could not, what would get it back. [[feels-like-a-real-caddie]]
 * [[smartmotion-metrics-honesty]]
 */
export function clubheadUnreadableNote(): CaptureQualityNote {
  return {
    ok: false,
    can: 'I can read your tempo, your positions and the contact from this',
    missing: "I couldn't pick the clubhead out clearly enough to draw your swing path — it blurs through the downswing",
    fix: `more light on the club, or record from a step further back — and if your camera can do ${PREFERRED_CAPTURE_FPS} frames a second, that is what makes the path readable`,
  };
}

/**
 * 2026-09-19 — THE SAME TIP, BEFORE THE FIRST SWING INSTEAD OF AFTER IT.
 *
 * Tim's call on the 09-19 report: ask for the frame rate up front rather than explaining the miss
 * afterwards. Front-loading it is worth more than the apology — the player changes one setting once
 * and every swing after it is readable.
 *
 * WORDED AS A CAPABILITY, NEVER AS A VERDICT ON THEIR PHONE. At this point nothing has been
 * recorded, so nothing has been measured, and this file's own rule is that an unmeasured capture
 * must not produce a warning — "telling a player their capture might be poor when we have not
 * measured it is a guess dressed as a finding". So it says what unlocks the path; it does not say
 * their camera is slow. A device already on 60 loses nothing by hearing it once.
 */
export function beforeFirstCaptureTip(): string {
  return `One thing before you swing: if your camera can record at ${PREFERRED_CAPTURE_FPS} frames a second, turn that on. It is what lets me draw the path your clubhead actually took — at ${MIN_TRACE_FPS} the head moves too far between frames to read honestly.`;
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
