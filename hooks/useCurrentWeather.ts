import { useEffect, useState } from 'react';
import { useRoundStore } from '../store/roundStore';
import { fetchWeatherAt, getCachedWeather, type WeatherSnapshot } from '../services/weatherService';
import { getCurrentLocation, getTeeCentroid, getGreenCentroid } from '../services/shotLocationService';
import { bearingDegrees } from '../utils/geoDistance';

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

      const tee = getTeeCentroid(currentHole);
      const green = getGreenCentroid(currentHole);
      if (tee && green && !cancelled) setBearing(bearingDegrees(tee, green));
      else if (!cancelled) setBearing(null);
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
