/**
 * engine/utilityEngine.ts
 *
 * Handles environmental / condition questions: weather, wind, sunset.
 * Returns from local context — no external calls.
 */

import type { FocusContext } from './contextBuilder';

export const utilityEngine = (query: string, context: FocusContext): string => {
  const q = query.toLowerCase();
  const { environment } = context;

  if (q.includes('sunset') || q.includes('dark') || q.includes('light')) {
    if (environment.sunset) {
      return `Sun sets at ${environment.sunset}. Keep pace and you'll finish in good light.`;
    }
    return 'Sunset info isn\'t loaded — keep an eye on the light as you go.';
  }

  if (q.includes('wind')) {
    if (environment.wind) {
      return `Wind is ${environment.wind}. Factor that into your club selection.`;
    }
    return "Wind conditions aren't loaded right now. Play what you feel.";
  }

  if (q.includes('weather') || q.includes('rain') || q.includes('temperature')) {
    if (environment.weather) {
      return `Conditions: ${environment.weather}. Dress and plan accordingly.`;
    }
    return 'Conditions look steady out here — nothing unusual flagged.';
  }

  return "Conditions look fine right now. Stay focused on the shot.";
};
