/**
 * 2026-10-28 (recheck VC-4) — WHICH STATES DROP A TAP — the mic badge dims for exactly these.
 *
 * CaddieMicBadge dimmed to 40% for opening / listening / thinking, "mirroring sessionInFlight". But
 * listeningSession.toggle() handles 'listening' BEFORE that guard — a tap there is "I'm done" (endCaptureEarly
 * + the got-it cue) — and a genuine tap during 'opening' skips the go-ahead cue and opens the mic
 * (skipOpenCue; until 10-28 it was queued as the endpoint). So the badge read as locked at the one moment it was the stop button, and the
 * player waited on VAD in the wind instead of tapping. e3a6e54f (06-24) fixed it once ("listening no
 * longer DIMS the badge — backwards"); a rollback restored it. 'thinking' is the only state where a
 * non-echo tap falls to swallowedTap('session_in_flight'). Keep this in step with listeningSession.toggle().
 */
export function tapIsDroppedIn(s: string): boolean {
  return s === 'thinking';
}

