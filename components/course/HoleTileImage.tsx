/**
 * 2026-09-23 (Tim — "we should not end up in error states ever. We need correct images not no
 * images where appropriate").
 *
 * One hole's satellite tile, with the same rules SmartVision uses (services/mapboxImagery.holeTile):
 * the exact cached file when it is on disk, else the live URL; if that fails to load, this hole's
 * cached tile at another size, then the live tile (when a cached file was what failed), then ONE
 * retry of it (most failures are a dropped request). A live tile is saved for next time.
 * Only after all of that does `fallback` show — and it is never a picture of somewhere else.
 *
 * Replaces the course-detail grid's decorative gradient (every hole looked the same) and the recap
 * hole view's live-only thumbnail (blank with no signal, even when the hole was cached).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { holeTile, fetchHoleImagery, urlForFrame, tileSizeForPrefetch, type HoleImageryInput } from '../../services/mapboxImagery';

type Props = {
  input: HoleImageryInput;
  /**
   * Requested tile size. Default: the size round prep caches (SmartVision's, once measured; else
   * 600x500), so a built course's holes come straight off disk — a grid of 18 thumbnails costs no
   * requests. Drawn with cover/contain into whatever box `style` gives it.
   */
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  /** Shown only when no tile can be drawn (no coordinates, or nothing loads with no signal). */
  fallback?: React.ReactNode;
};

export default function HoleTileImage({ input, width: w, height: h, style, resizeMode = 'cover', fallback = null }: Props) {
  const { courseId, holeNumber, tee, green, par, yardage } = input;
  const cached = tileSizeForPrefetch();
  const width = w ?? cached?.width ?? 600;
  const height = h ?? cached?.height ?? 500;
  const tile = useMemo(
    () => holeTile({ courseId, holeNumber, tee, green, par, yardage }, { width, height }),
    // Coordinates by value: a new object with the same numbers must not rebuild the tile (the grid
    // re-renders on every touch — that re-fetching is what made these thumbnails flash white).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseId, holeNumber, tee?.lat, tee?.lng, green?.lat, green?.lng, par, yardage, width, height],
  );
  const candidates = useMemo(() => {
    if (!tile) return [] as string[];
    const live = urlForFrame(tile.frame);
    const out = [tile.uri];
    if (tile.fallback) out.push(tile.fallback.uri);
    // A cached FILE that will not load (truncated by an app kill mid-write) → the live tile.
    if (live && !out.includes(live)) out.push(live);
    if (live) out.push(`${live}${live.includes('?') ? '&' : '?'}retry=1`);
    return out;
  }, [tile]);
  // The attempt belongs to ONE candidate list: a new list starts at 0 on its first render (a reset
  // in an effect would paint one frame of the old list's later entry — triple-check).
  const listKey = candidates.join('|');
  const [state, setState] = useState<{ key: string; attempt: number }>({ key: listKey, attempt: 0 });
  const attempt = state.key === listKey ? state.attempt : 0;

  // A live tile is also saved (fetchHoleImagery writes the exact file), so the next open is free.
  useEffect(() => {
    if (tile && /^https:/.test(tile.uri)) {
      void fetchHoleImagery({ courseId, holeNumber, tee, green, par, yardage }, { width, height }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile]);

  const uri = candidates[attempt];
  if (!uri) return <>{fallback}</>;
  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setState({ key: listKey, attempt: attempt + 1 })}
    />
  );
}
