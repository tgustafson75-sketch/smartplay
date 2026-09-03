/**
 * 2026-06-13 — "play [song]" flow (clean music portal, Tim/Cecily).
 *
 * Detects a play-a-song request, searches the kid-safe server endpoint
 * (services/songPortal), and opens JUST that song in the clean in-app player
 * (app/jukebox) via the imperative router. Returns a spoken line so the caddie
 * confirms it ("Pulling up X 🎵") or honestly says it couldn't find it.
 *
 * Narrow detection: "play"/"put on" as the request verb, with golf "play" phrases
 * (play a round / play golf / play it safe / play through …) explicitly excluded so it
 * never hijacks on-course chatter. Distinct from singAttempt (caddie performs).
 */

import { router } from 'expo-router';
import { searchSong } from './songPortal';
import { detectPlaySongRequest } from './musicIntent';

export { detectPlaySongRequest };

/**
 * 2026-09-03 (Tim) — "then Caddie ingests, or asks the user if they want to ingest that to the
 * pre-shot routine."
 *
 * His pre-round is a real ritual: open the app, put the song on, get his tempo right. A song he
 * reaches for before a round IS part of that routine, so the caddie should be able to keep it
 * rather than make him re-ask every time.
 *
 * Kept as a short-lived CANDIDATE rather than saved outright. Saving silently would put whatever he
 * happened to play into a routine he then hears read back to him, and one curious search would live
 * there forever. So the caddie offers, and `routine_save` (queryStatusHandler) prefers this over the
 * raw last-caddie-line when it is fresh — which is what turns "Pulling up Sail. 🎵" into a routine
 * entry worth reading. [[hands-free-zero-setup-is-the-product]]
 */
export type RoutineSongCandidate = { text: string; title: string; at: number };
let songCandidate: RoutineSongCandidate | null = null;
/** Fresh for ten minutes — long enough to say "save that", short enough not to surprise anyone. */
const CANDIDATE_TTL_MS = 10 * 60 * 1000;

export function takeSongRoutineCandidate(now: number = Date.now()): RoutineSongCandidate | null {
  if (!songCandidate) return null;
  if (now - songCandidate.at > CANDIDATE_TTL_MS) { songCandidate = null; return null; }
  return songCandidate;
}
/** Test seam. */
export function _setSongRoutineCandidate(c: RoutineSongCandidate | null): void { songCandidate = c; }

/**
 * If `raw` is a play-song request, search + open the clean player and return the
 * spoken confirmation. Returns null when it isn't a play request (caller continues
 * to the brain). Best-effort: honest line when no match / search fails.
 */
export async function tryPlaySong(raw: string): Promise<{ spoken: string } | null> {
  const req = detectPlaySongRequest(raw);
  if (!req) return null;
  const match = await searchSong(req.query);
  if (!match) {
    return { spoken: `I couldn't find "${req.query}" — try it again with the artist's name too.` };
  }
  try {
    router.push(
      `/jukebox?videoId=${encodeURIComponent(match.videoId)}&title=${encodeURIComponent(match.title)}` as never,
    );
  } catch { /* navigation best-effort; the spoken line still confirms */ }

  // Offer it for the routine — but only when it is not already in there. Repeating the offer every
  // time he plays his own pre-round song is nagging, and this app does not nag. [[no-push-nagging-no-ads]]
  const routineText = `Put on ${match.title}${match.channelTitle ? ` (${match.channelTitle})` : ''}`;
  songCandidate = { text: routineText, title: match.title, at: Date.now() };
  let alreadySaved = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prof = (require('../store/playerProfileStore') as typeof import('../store/playerProfileStore'))
      .usePlayerProfileStore.getState();
    const existing = (prof.preRoundRoutine ?? '').toLowerCase();
    alreadySaved = existing.includes(match.title.toLowerCase());
  } catch { /* offering anyway is the harmless direction */ }

  return {
    spoken: alreadySaved
      ? `Pulling up ${match.title}. 🎵`
      : `Pulling up ${match.title}. 🎵 Say "save that as my routine" and I'll make it part of your pre-round.`,
  };
}
