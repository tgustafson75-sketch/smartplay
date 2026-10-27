/**
 * 2026-10-27 (audit R8) — a horizontal paging ScrollView keeps its page when the window width changes.
 *
 * SmartMotion's review pager pages by window width. Unfolding or folding a Fold (or rotating) changes the
 * width; the ScrollView keeps its old pixel offset, so the player was left stranded between two pages until
 * they swiped. Re-seat the pager on the page it was on, at the new width, without animation.
 */
import { useEffect, useRef } from 'react';

export function usePagerKeepsPage(
  pager: { current: { scrollTo: (o: { x: number; animated: boolean }) => void } | null },
  page: number,
  width: number,
): void {
  const pageRef = useRef(page);
  pageRef.current = page;
  const lastWidth = useRef(width);
  useEffect(() => {
    if (width === lastWidth.current || width <= 0) return;
    lastWidth.current = width;
    pager.current?.scrollTo({ x: pageRef.current * width, animated: false });
  }, [pager, width]);
}
