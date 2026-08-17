/**
 * 2026-08-17 (Tim — "the Caddie mic… goes 'I'm here.' and then right away almost goes 'I didn't
 * catch that.' It's got a completely, honestly, kinda broken behavior").
 *
 * WHY a capture came back with no words, and what the caddie is allowed to SAY about it.
 *
 * captureUtterance used to answer "no transcript" with a bare `null`, so ten different outcomes —
 * the microphone was held by the app's other recorder and never opened, permission was refused,
 * Whisper 502'd, the player genuinely said nothing — all arrived identical. listeningSession read
 * that null as "I didn't hear you" and spoke "Didn't catch that." for every one of them. For the
 * mic-busy case that sentence is simply false: nothing was ever recorded, so there was nothing to
 * catch, and it tells the player to repeat themselves into a microphone that is still not theirs.
 *
 * Pure + dependency-free (no react-native / expo / store imports) so both the runtime modules and a
 * jest test import it freely — the same no-drift pattern as services/voice/endsAsQuestion.ts and
 * services/caddieAckLines.ts. [[feels-like-a-real-caddie]] [[illustration-data-points]]
 */

/** Why a capture produced no transcript. `null` means it succeeded. */
export type CaptureBail =
  /** Another recorder holds the mic — NOTHING was recorded. Never report this as "didn't catch that". */
  | 'mic_busy'
  | 'no_permission'
  /** Deliberately cancelled via stopCapture() — the caller asked for this. */
  | 'cancelled'
  | 'no_uri'
  /** Recorded, but too short / small / large to be worth a transcribe round-trip. */
  | 'too_short'
  | 'too_small'
  | 'too_large'
  /** The mic worked; /api/transcribe failed. A connection problem, not a listening problem. */
  | 'transcribe_failed'
  /** An exception mid-capture (an audio-session reconfigure killing the recording, typically). */
  | 'error'
  /** The genuine article: the mic recorded fine and the transcript came back empty. */
  | 'empty';

/** What the caddie should say about it. */
export type CaptureBailResponse =
  /** Say nothing — the user caused this on purpose, or is already being prompted by the OS. */
  | 'silent'
  /** Own it: the microphone failed. Never blame the player's voice for our own dead mic. */
  | 'mic_trouble'
  /** Name it as a connection failure (the caller's line is evidence-aware and won't blame a good signal). */
  | 'connection'
  /** "Didn't catch that." — true only when the mic was genuinely open and heard nothing usable. */
  | 'didnt_catch';

/**
 * The one place that decides what an empty capture means. Every branch is deliberate:
 *
 *   mic_busy / error / no_uri  → the microphone never produced audio. Ours to own.
 *   transcribe_failed          → the mic was fine; the network wasn't. Say the true one.
 *   cancelled                  → the user shushed us. Silence is the correct response.
 *   no_permission              → the OS is already asking (or the user has refused); talking over
 *                                that with a mic complaint just adds noise to a dialog.
 *   too_short/small/large/empty→ we really did record and really did get nothing usable.
 */
export function responseForCaptureBail(bail: CaptureBail | null): CaptureBailResponse {
  switch (bail) {
    case 'mic_busy':
    case 'error':
    case 'no_uri':
      return 'mic_trouble';
    case 'transcribe_failed':
      return 'connection';
    case 'cancelled':
    case 'no_permission':
      return 'silent';
    default:
      // 'empty' | 'too_short' | 'too_small' | 'too_large' | null
      return 'didnt_catch';
  }
}

/**
 * True when the microphone itself failed and a single fresh attempt is worth making.
 *
 * Bounded on purpose. A capture that genuinely heard nothing is NOT retried — re-opening the mic on
 * someone who simply didn't speak is the hot-mic behavior the 2026-08-12 standdown fix removed.
 */
export function shouldRetryCapture(bail: CaptureBail | null): boolean {
  return bail === 'mic_busy' || bail === 'error';
}
