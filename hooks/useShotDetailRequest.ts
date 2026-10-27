/**
 * 2026-10-27 (Phase SB4x) — A SCREEN'S ASK FOR THE SHOWN SWING'S BODY READ AND ARC (orchestrator/shotDetail
 * requestShotDetail), shared by the library swing screen and SmartMotion's review so both ask by one rule.
 *
 * The ask is made when the shot (or the screen's own `retrigger`: its toggles) changes, and again whenever
 * the shot's body read goes back to UNREAD under the screen — a Re-analyze clears every swing's read
 * (uploadRun.invalidateForReanalysis) but only re-reads swing 1, and the selection, the ids and the toggles
 * all stay the same, so nothing else would ask for swing 2's read again. A read LANDING does not ask again.
 *
 * 2026-10-27 (Phase SB5, recheck R1) — and again when a NEW ANALYSIS of the swing starts while the shot is
 * unread. A swing whose read failed (the pose stage threw or ran out of budget, no detector answered) is
 * already unread, so a Re-analyze's wipe is no change to it: "No body read for this swing — Re-analyze"
 * re-read swing 1 only and swing 2 came back with the same note.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { requestShotDetail, subscribeSwingRunStarts, swingRunStartsOf, type ArcRequest } from '../services/swing/orchestrator/shotDetail';

export type ShotDetailAsk = { arc?: ArcRequest };

export function useShotDetailRequest(r: {
  sessionId: string | null | undefined;
  /** The shot shown, or null when it cannot be read (no clip). */
  shotId: string | null | undefined;
  /** What to ask for, or null for nothing (the library is manual). */
  ask: ShotDetailAsk | null;
  /** The shot has no body read stored by today's code (storedShotBiomech === undefined). */
  unread: boolean;
  /** Anything else whose change is a new ask (the screen's toggles, its phase). */
  retrigger: string;
  /** The screen's "Reading…" holder: set to the shot while its ask is out. */
  setPending: (update: (cur: string | null) => string | null) => void;
}): void {
  const askRef = useRef(r.ask);
  askRef.current = r.ask;
  const setPendingRef = useRef(r.setPending);
  setPendingRef.current = r.setPending;
  const sid = r.sessionId;
  const starts = useSyncExternalStore(subscribeSwingRunStarts, () => (sid ? swingRunStartsOf(sid) : 0));
  // Counts the shot's read going back to unread under the screen, or a new analysis starting while it is
  // unread (not its landing): each is a new ask.
  const wipes = useRef({ unread: r.unread, shotId: r.shotId, starts, n: 0 });
  const w = wipes.current;
  if (w.shotId !== r.shotId) wipes.current = { unread: r.unread, shotId: r.shotId, starts, n: w.n };
  else wipes.current = { unread: r.unread, shotId: r.shotId, starts, n: r.unread && (!w.unread || w.starts !== starts) ? w.n + 1 : w.n };
  const wiped = wipes.current.n;
  const asking = r.ask != null;
  const arcKey = r.ask ? String(r.ask.arc) : '';
  const { sessionId, shotId, retrigger } = r;
  // 2026-10-27 (SB4x) — a LAYOUT effect: the "pending" mark lands before the frame is painted, so a screen
  // that says what the ask is doing ("Tracing the clubhead…") never flashes "could not be seen" first.
  useLayoutEffect(() => {
    const ask = askRef.current;
    if (!sessionId || !shotId || !ask) return;
    const id = shotId;
    const setPending = setPendingRef.current;
    setPending(() => id);
    const off = requestShotDetail(sessionId, id, {
      ...ask,
      onSettled: () => setPending((cur) => (cur === id ? null : cur)),
    });
    return () => { off(); setPending((cur) => (cur === id ? null : cur)); };
  }, [sessionId, shotId, asking, arcKey, retrigger, wiped]);
}
