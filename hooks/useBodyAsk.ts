/**
 * 2026-10-27 (Phase SB5, recheck R2-1) — THE LIBRARY SWING SCREEN'S "READ IT AGAIN" (faultSpotlight
 * olderBodyReadNote), keyed to the swing on screen like the issue ask (hooks/useIssueAsk), so it never
 * carries to the next swing (nor back to this one after paging away).
 *
 * EVERY TAP IS A NEW ASK. It was one key: a tapped read that did not land (the pose stage threw, ran out of
 * budget, no detector answered) stores nothing, so the older read stays and the note offers "Read it again"
 * again — and the second tap set the same key, React kept the state, the request's retrigger did not move,
 * and the lit button asked for nothing. `bodyAskTaps` counts the taps on this swing; it goes in the retrigger.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useBodyAsk(reviewKey: string): {
  /** The player asked to read the swing on screen again. */
  bodyAsked: boolean;
  /** Taps on this swing (0 when not asked): each one is a new ask. */
  bodyAskTaps: number;
  askBody: () => void;
} {
  const keyRef = useRef(reviewKey);
  keyRef.current = reviewKey;
  const [ask, setAsk] = useState<{ key: string; n: number } | null>(null);
  const askBody = useCallback(() => {
    const key = keyRef.current;
    setAsk((a) => ({ key, n: (a?.key === key ? a.n : 0) + 1 }));
  }, []);
  // Paging away drops it, as the issue ask does: back on the swing, the library is manual again.
  useEffect(() => { setAsk(null); }, [reviewKey]);
  const bodyAsked = ask !== null && ask.key === reviewKey;
  return { bodyAsked, bodyAskTaps: bodyAsked ? ask.n : 0, askBody };
}
