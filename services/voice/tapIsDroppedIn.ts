/**
 * 2026-10-28 (recheck VC-4) — WHICH STATES DROP A TAP — the mic badge dims for exactly these.
 *
 * CaddieMicBadge dimmed to 40% for opening / listening / thinking, "mirroring sessionInFlight". But
 * listeningSession.toggle() handles 'listening' BEFORE that guard — a tap there is "I'm done" (endCaptureEarly
 * + the got-it cue) — and a genuine tap during 'opening' skips the go-ahead cue and opens the mic
 * (skipOpenCue; until 10-28 it was queued as the endpoint). So the badge read as locked at the one moment it was the stop button, and the
 * player waited on VAD in the wind instead of tapping. e3a6e54f (06-24) fixed it once ("listening no
 * longer DIMS the badge — backwards"); a rollback restored it. 'thinking' is the only state where a
 * non-echo tap falls to swallowedTap('session_in_flight'). A typed or watch turn sets the same 'thinking'
 * in the shared store and toggle() drops its taps too (swallowedTap('typed_turn_in_flight')), so the rule
 * holds on every path. Keep this in step with listeningSession.toggle().
 */
export function tapIsDroppedIn(s: string): boolean {
  return s === 'thinking';
}


/**
 * 2026-10-28 (recheck VC-R2-3) — WHERE A TAP ON KEVIN'S FACE GOES WHILE A LISTENING SESSION IS LIVE.
 *
 * The badge, the bottom-bar mic and the earbud all reach listeningSession.toggle(); the Caddie-tab
 * avatar reaches useVoiceCaddie.handleMicPress. Since 08-17 the avatar deferred to toggle() only in
 * 'listening' and FORCE-CLOSED every other in-flight state. So during 'opening' — which the avatar
 * paints as idle, so it is exactly when he taps the face to start talking — the face killed the turn
 * he had just opened with the badge, while the same tap on the badge meant "I'm ready" and opened the
 * mic. Three surfaces, three meanings for one tap.
 *
 * A session toggle() opened is owned by toggle() in every state it can be in: 'session' hands the tap
 * to it. 'force_close' is kept for the one case toggle() cannot reach — a session still marked in
 * flight with its state back at 'idle', i.e. hung — so the face can never be trapped (07-30). 'tab'
 * means no session: the tab's own tap-to-talk runs.
 */
export type AvatarTapRoute = 'session' | 'force_close' | 'tab';
export function avatarTapRoute(state: string, inFlight: boolean): AvatarTapRoute {
  if (state !== 'idle') return 'session';
  return inFlight ? 'force_close' : 'tab';
}

/**
 * 2026-10-28 (recheck VC-R2-5) — how a mic control LOOKS for a session state, for every mic that taps
 * toggle(): the header badge and the bottom-bar mic. The badge dimmed for a dropped tap and the bar
 * did not, so the bar read as live while toggle() was ignoring it. One look, one owner.
 */
export const DROPPED_TAP_OPACITY = 0.4;
export function micTapLook(s: string): { opacity: number; dropped: boolean } {
  const dropped = tapIsDroppedIn(s);
  return { opacity: dropped ? DROPPED_TAP_OPACITY : 1, dropped };
}
