import { useEffect, useState } from 'react';
import { useRoundStore } from '../store/roundStore';
import { fetchWeatherAt, getCachedWeather, type WeatherSnapshot } from '../services/weatherService';
import { getCurrentLocation } from '../services/shotLocationService';
import { shotBearingDeg } from '../services/windRelative';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Phase C — Returns the current player weather snapshot and the best-known shot
 * bearing for the current hole. Used by Caddie-home surfaces (WindArrow). Refreshes
 * every 5 minutes; serves cached weather between refreshes for instant render.
 *
 * Returns { weather: null, shotBearingDeg: null } until the first fetch resolves
 * and the round provides a current hole.
 */
export function useCurrentWeather(): {
  weather: WeatherSnapshot | null;
  shotBearingDeg: number | null;
} {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);

  useEffect(() => {
    if (!isRoundActive) {
      setWeather(null);
      setBearing(null);
      return;
    }
    let cancelled = false;

    async function refresh() {
      const here = await getCurrentLocation();
      if (!here || cancelled) return;
      const cached = getCachedWeather(here);
      if (cached) setWeather(cached);
      const fresh = await fetchWeatherAt(here);
      if (!cancelled && fresh) setWeather(fresh);

      // 2026-08-24 — was its own tee→green derivation, the FOURTH copy of this calculation in the
      // app. services/windRelative owns it, and it now prefers the line actually being played
      // (player→green) over the card's tee→green, so SmartFinder's plays-like and the caddie's club
      // cannot disagree about which way the wind is blowing on the same shot.
      if (!cancelled) setBearing(shotBearingDeg(currentHole));
    }

    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isRoundActive, currentHole]);

  return { weather, shotBearingDeg: bearing };
}
