import { useEffect } from 'react';
import { useRestModeStore } from '../store/restModeStore';

/**
 * 2026-07-24 (Tim — universal screen timeout for battery, but "no regression"). Blocks the auto-rest
 * black-out while `active` is true — for the moments dimming would be wrong: a swing video is playing,
 * a capture/analysis is running, etc. Ref-counted in restModeStore so multiple suppressors compose and
 * a component that unmounts mid-suppress can never leave rest stuck off (the cleanup always pops).
 *
 *   useRestSuppress(isPlaying)   // rest won't engage while the clip plays; resumes when paused
 */
export function useRestSuppress(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { pushSuppress, popSuppress } = useRestModeStore.getState();
    pushSuppress();
    return () => popSuppress();
  }, [active]);
}

export default useRestSuppress;
