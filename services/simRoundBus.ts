/**
 * 2026-08-08 (Tim — "can't change club in sim mode"). The SwingSim game screen has tap-chips, but your
 * hands are ON the phone swinging it like a club — voice is the only natural way to switch. This tiny
 * bus (same pattern as smartMotionRecordBus) lets the voice clubChangeHandler reach the mounted game:
 * the screen registers a resolver; the handler calls it and speaks an HONEST result ("got it" vs "not
 * in your sim bag" — the sim can only play clubs with learned distances).
 */

let simGameActive = false;
let clubResolver: ((clubId: string) => boolean) | null = null;

export function setSimGameActive(v: boolean): void {
  simGameActive = v;
  if (!v) clubResolver = null;
}
export function isSimGameActive(): boolean { return simGameActive; }

/** The game screen registers this on mount; returns true when the club was applied. */
export function registerSimClubResolver(fn: ((clubId: string) => boolean) | null): void {
  clubResolver = fn;
}

/** Voice → game. Returns 'applied' | 'not_in_bag' | 'no_game'. */
export function requestSimClubChange(clubId: string): 'applied' | 'not_in_bag' | 'no_game' {
  if (!simGameActive || !clubResolver) return 'no_game';
  try { return clubResolver(clubId) ? 'applied' : 'not_in_bag'; } catch { return 'no_game'; }
}
