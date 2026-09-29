/**
 * 2026-09-28 — may the cold-start OTA reload the app RIGHT NOW?
 *
 * components/UpdateAvailableBanner reloads straight into a freshly downloaded update inside the first
 * 20s of a launch, unless a round or a voice session is live. "Voice session" meant the listening
 * store only — and the caddie tab's avatar mic (useVoiceCaddie) never writes that store, nor does the
 * app-open opener. So on the first launch after an OTA the reload could fire in the middle of the
 * player's first ask: 700ms of overlay, then the runtime torn down under the recording.
 *
 * Pure so it can be tested; the banner asks it twice — when the update is ready, and again the
 * instant before the reload, because a tap can land inside the 700ms overlay.
 */
export const AUTO_APPLY_WINDOW_MS = 20_000;

export interface AutoApplyInputs {
  ready: boolean;
  inRound: boolean;
  /** The listening-session store is not idle (earbud / bottom-bar mic). */
  sessionActive: boolean;
  /** Anything is playing, capturing, or holding the mic (the avatar path included). */
  audioBusy: boolean;
  /** ms since the player last started a turn, or null if never this process. */
  msSinceUserTurn: number | null;
  sinceLaunchMs: number;
}

export function mayAutoApplyUpdate(i: AutoApplyInputs): boolean {
  if (!i.ready || i.inRound || i.sessionActive || i.audioBusy) return false;
  if (i.sinceLaunchMs >= AUTO_APPLY_WINDOW_MS) return false;
  // The player has already started talking to us this launch — they are using the app, not waiting
  // on it. The manual banner offers the update instead.
  if (i.msSinceUserTurn !== null) return false;
  return true;
}
