/**
 * 2026-06-13 — Scene-read sensor truth (Smart Finder "meta scene read").
 *
 * The camera (sent to the multimodal brain) sees the SCENE — trees, water, sky,
 * foliage moving. This composes the SENSOR TRUTH the brain must ground that read in,
 * so the answer is honest: the camera says "leaves are moving"; the weather API says
 * "12 mph from the SW" — we give the brain the NUMBER so it never fabricates one.
 *
 * Pure-ish (reads gpsManager + weatherService caches; never network, never throws).
 * Offline-safe: cached weather + last GPS fix. Returns null block when there's truly
 * nothing to ground (no weather, no fix) — the brain then reads the image alone.
 * See memory: smartfinder-unified-brain-read, no-deferred-wiring-placeholders.
 */

import { getLastFix } from './gpsManager';
import { getCachedWeatherEvenIfStale } from './weatherService';
import { classifyAccuracy } from './smartFinderService';

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function cardinal(deg: number): string {
  return CARDINALS[Math.round(((deg % 360) / 22.5)) % 16];
}

export interface SceneSensorContext {
  /** Newline-joined sensor-truth block for the brain's context (or null if empty). */
  block: string | null;
  /** Short image caption hint. */
  caption: string;
  /** True when a real measured wind speed is available (so the brain can cite it). */
  hasWind: boolean;
}

/**
 * Compose the honest sensor truth for a scene read. `targetYards` (optional) is the
 * player-chosen/locked distance to the target; when present it's stated so the brain
 * can factor it. NOTHING here is inferred from pixels — only measured sensor values.
 */
export function buildSceneSensorContext(opts?: { targetYards?: number | null }): SceneSensorContext {
  const lines: string[] = [];
  let hasWind = false;

  const fix = getLastFix();
  if (fix && typeof fix.lat === 'number' && typeof fix.lng === 'number') {
    const q = classifyAccuracy(fix.accuracy_m, fix.timestamp);
    const weather = getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng });
    if (weather) {
      const mph = Math.round(weather.wind_speed_mph ?? 0);
      if (mph >= 1 && weather.wind_direction_deg != null) {
        hasWind = true;
        lines.push(`Measured wind: ${mph} mph from the ${cardinal(weather.wind_direction_deg)} (use THIS number — do not estimate wind from the image).`);
      } else if (mph < 1) {
        lines.push('Measured wind: calm.');
      }
      if (typeof weather.temp_f === 'number') lines.push(`Temp: ${Math.round(weather.temp_f)}°F.`);
      if (typeof weather.conditions === 'string' && weather.conditions) lines.push(`Conditions: ${weather.conditions}.`);
    }
    if (q.level === 'weak') lines.push('(GPS is a bit soft right now.)');
  }

  if (typeof opts?.targetYards === 'number' && opts.targetYards > 0) {
    lines.push(`Target distance: ${Math.round(opts.targetYards)} yards.`);
  }

  return {
    block: lines.length > 0 ? `SENSOR TRUTH (measured — ground the scene read in these):\n${lines.join('\n')}` : null,
    caption: 'Scene the player is looking at from their position.',
    hasWind,
  };
}
