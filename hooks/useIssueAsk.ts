/**
 * 2026-10-27 (Phase SB4x) — THE LIBRARY SWING SCREEN'S "ASKED TO SEE THE ISSUE" AND THE FAULT TIME IT HOLDS.
 *
 *   issueAsked      the player asked to see this swing's issue (Issue chip, Fault-moment pill), or the
 *                   replay stopped there with Highlight on: the ring needs the body read, so it is asked for
 *                   (faultSpotlight.shotDetailRequestFor).
 *   faultSecRef     the second the replay stops on (read by the playback callback, created once).
 *   askedFaultSec   a Fault-moment pill's time held as the fault when no moment could be computed.
 *
 * All of it belongs to ONE swing on screen: `reviewKey` (the swing, its layout, the shot shown). The ask is
 * KEYED to that swing, not a flag reset by an effect: an effect runs after the commit, so the request made
 * in that same commit for the NEXT swing saw the old swing's `true` and asked it for a body read nobody
 * wanted. A pill-held time is dropped with its swing (a re-split that reuses `_shot_0` keeps the shot id,
 * so the fault-moment effect does not rewrite it, and the replay kept stopping at the old swing's second).
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export function useIssueAsk(reviewKey: string): {
  issueAsked: boolean;
  /** Marks the swing on screen NOW (safe from a callback created once). */
  markIssueAsked: () => void;
  faultSecRef: MutableRefObject<number | null>;
  askedFaultSec: number | null;
  /** A Fault-moment pill's time, held as the fault for this swing. */
  holdAskedFault: (sec: number) => void;
  /** The computed moment took over (the screen's fault-moment effect wrote faultSecRef). */
  clearAskedFault: () => void;
} {
  const keyRef = useRef(reviewKey);
  keyRef.current = reviewKey;
  const [askedKey, setAskedKey] = useState<string | null>(null);
  const [askedFault, setAskedFault] = useState<{ key: string; sec: number } | null>(null);
  const faultSecRef = useRef<number | null>(null);
  /** faultSecRef holds a pill's time (not a computed moment). */
  const pillHeldRef = useRef(false);
  const markIssueAsked = useCallback(() => setAskedKey(keyRef.current), []);
  const holdAskedFault = useCallback((sec: number) => {
    faultSecRef.current = sec;
    pillHeldRef.current = true;
    setAskedFault({ key: keyRef.current, sec });
  }, []);
  const clearAskedFault = useCallback(() => { pillHeldRef.current = false; setAskedFault(null); }, []);
  useEffect(() => {
    if (pillHeldRef.current) { faultSecRef.current = null; pillHeldRef.current = false; }
    setAskedKey(null);
    setAskedFault(null);
  }, [reviewKey]);
  return {
    issueAsked: askedKey !== null && askedKey === reviewKey,
    markIssueAsked,
    faultSecRef,
    askedFaultSec: askedFault && askedFault.key === reviewKey ? askedFault.sec : null,
    holdAskedFault,
    clearAskedFault,
  };
}
