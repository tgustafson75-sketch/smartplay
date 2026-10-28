/**
 * THE LAST STEP BEFORE THE BRAIN — ONE COPY, EVERY SURFACE.
 *
 * 2026-10-27 (Brain review B10). Four detectors sit between "this is a conversational turn" and the
 * brain call: a how-to question gets the curated SCREEN_HELP copy, "play <song>" opens the kid-safe
 * player, "sing me …" is reshaped into a playful attempt, and "explain that simply" is reshaped into
 * a plain-speak ask. They lived only in hooks/useVoiceCaddie, twice (the first turn and the follow-up
 * loop, in different orders). The earbud, the bottom-bar mic, the typed box and the watch went
 * through services/listeningSession, which had none of them: "play Sail by Awolnation" reached the
 * brain as prose and came back as a link, "sing me happy birthday" came back flat.
 *
 * ORDER IS PART OF THE CONTRACT: help first ("how do I play this" is a help question, not a request
 * for a song called "this"), then the song portal on the player's OWN words, then the two reshapes.
 */
import { detectHelpRequest, getScreenHelp } from '../screenHelp';
import { tryPlaySong } from '../playSongFlow';
import { detectSingRequest, buildSingMessage } from '../singAttempt';
import { detectPlainSpeakRequest, buildPlainSpeakPrefix } from '../plainSpeak';

/** A deterministic reply that replaces the brain turn, or null to go to the brain. */
export async function preBrainReply(transcript: string): Promise<string | null> {
  try {
    const help = detectHelpRequest(transcript);
    const h = help ? getScreenHelp(help.key) : null;
    if (h) return h.spoken;
  } catch (e) { console.log('[preBrain] screen help error (non-fatal):', e); }
  try {
    const song = await tryPlaySong(transcript);
    if (song) return song.spoken;
  } catch (e) { console.log('[preBrain] song portal error (non-fatal):', e); }
  return null;
}

/**
 * What the brain is asked, given what the player said. The reshapes rewrite the MESSAGE only — the
 * caller keeps the player's own words for everything else (history, the local fallback answer).
 */
export function shapeForBrain(transcript: string): string {
  let message = transcript;
  try {
    const sing = detectSingRequest(message);
    if (sing) message = buildSingMessage(sing.song);
  } catch { /* non-fatal — the literal transcript is a fine fallback */ }
  try {
    if (detectPlainSpeakRequest(message)) message = buildPlainSpeakPrefix() + message;
  } catch { /* non-fatal */ }
  return message;
}
