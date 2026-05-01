import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';
import { haversineYards, holeProgressYards, shotDistance, bearingDegrees } from '../../utils/geoDistance';
import { getCurrentLocation, getGreenCentroid, getTeeCentroid } from '../shotLocationService';
import { fetchWeatherAt, getCachedWeather, type WeatherSnapshot } from '../weatherService';
import { playsLikeDistance, playsLikePhrase } from '../../utils/playsLike';
import type { ShotLocation } from '../../store/roundStore';

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function compassDirFromDeg(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[idx];
}

/**
 * Best-available shot bearing for the current moment. Prefers tee→green for the
 * current hole; falls back to the bearing of the player's most recent same-hole
 * shot start_location → current location. Returns null when no reference exists.
 */
function currentShotBearingDeg(
  round: { courseHoles: { hole: number; teeLat: number; teeLng: number; middleLat: number; middleLng: number; frontLat: number; frontLng: number; backLat: number; backLng: number }[]; shots: { hole: number; start_location?: ShotLocation | null; gps_location?: ShotLocation | null }[] },
  currentHole: number,
): number | null {
  const teeLoc = getTeeCentroid(currentHole);
  const greenLoc = getGreenCentroid(currentHole);
  if (teeLoc && greenLoc) return bearingDegrees(teeLoc, greenLoc);
  // Fallback: last shot start → current player location is unavailable here without
  // an awaited GPS call. Return null and let the caller phrase accordingly.
  return null;
}

export const queryStatusHandler: IntentHandler = {
  intent_type: 'query_status',

  parameter_schema: {
    query_topic: 'one of: score, hole, ghost_match, weather, pattern',
  },

  examples: [
    'what\'s my score',
    'tell me my score',
    'what hole am I on',
    'how am I doing',
    'how am I doing against the ghost',
  ],

  async execute(intent: VoiceIntent, context: AppContext): Promise<IntentResult> {
    const topic = String(intent.parameters.query_topic ?? '').toLowerCase();
    const round = useRoundStore.getState();

    if (!round.isRoundActive && (topic === 'score' || topic === 'hole' || topic === 'ghost_match' || topic === 'shot_distance' || topic === 'hole_progress' || topic === 'distance_to_green' || topic === 'wind' || topic === 'conditions' || topic === 'weather' || topic === 'plays_like')) {
      return {
        success: true,
        voice_response: 'You\'re not in a round yet. Want to start one?',
        side_effects: ['no_active_round'],
        follow_up_needed: false,
      };
    }

    switch (topic) {
      case 'score': {
        const total = round.getTotalScore();
        const vsPar = round.getScoreVsPar();
        const holesPlayed = round.getHolesPlayed();
        const vsParText = vsPar === 0 ? 'even' : vsPar > 0 ? '+' + vsPar : String(vsPar);
        return {
          success: true,
          voice_response: `Through ${holesPlayed}, you're ${total} — ${vsParText}.`,
          side_effects: ['query:score'],
          follow_up_needed: false,
        };
      }

      case 'hole': {
        const par = round.getCurrentPar();
        return {
          success: true,
          voice_response: par
            ? `You're on hole ${context.current_hole}, par ${par}.`
            : `You're on hole ${context.current_hole}.`,
          side_effects: ['query:hole'],
          follow_up_needed: false,
        };
      }

      case 'ghost_match': {
        const ghostText = useGhostStore.getState().getSummaryText();
        return {
          success: true,
          voice_response: ghostText && ghostText.trim().length > 0
            ? ghostText
            : 'No ghost loaded for this round.',
          side_effects: ['query:ghost_match'],
          follow_up_needed: false,
        };
      }

      case 'weather':
      case 'conditions': {
        const here = await getCurrentLocation();
        const w = here ? (getCachedWeather(here) ?? await fetchWeatherAt(here)) : null;
        if (!w) {
          return {
            success: true,
            voice_response: 'I can\'t pull weather right now.',
            side_effects: ['query:conditions:unavailable'],
            follow_up_needed: false,
          };
        }
        const conds = w.description ?? w.conditions ?? 'fair';
        const temp = w.temp_f != null ? `${Math.round(w.temp_f)}°` : null;
        return {
          success: true,
          voice_response: temp
            ? `${conds}, ${temp}, wind ${Math.round(w.wind_speed_mph)}.`
            : `${conds}, wind ${Math.round(w.wind_speed_mph)}.`,
          side_effects: ['query:conditions'],
          follow_up_needed: false,
        };
      }

      case 'wind': {
        const here = await getCurrentLocation();
        const w = here ? (getCachedWeather(here) ?? await fetchWeatherAt(here)) : null;
        if (!w || w.wind_direction_deg == null) {
          return {
            success: true,
            voice_response: 'I can\'t read the wind right now.',
            side_effects: ['query:wind:unavailable'],
            follow_up_needed: false,
          };
        }
        if (w.wind_speed_mph < 3) {
          return {
            success: true,
            voice_response: 'Pretty calm out there — barely any wind.',
            side_effects: ['query:wind:calm'],
            follow_up_needed: false,
          };
        }
        const bearing = currentShotBearingDeg(round, context.current_hole ?? round.currentHole);
        if (bearing == null) {
          return {
            success: true,
            voice_response: `${Math.round(w.wind_speed_mph)} miles per hour out of the ${compassDirFromDeg(w.wind_direction_deg)}.`,
            side_effects: ['query:wind:no_bearing'],
            follow_up_needed: false,
          };
        }
        // Decompose
        const windTo = (w.wind_direction_deg + 180) % 360;
        let rel = windTo - bearing;
        rel = ((rel + 540) % 360) - 180;
        const along = Math.cos(rel * Math.PI / 180) * w.wind_speed_mph;
        const cross = Math.sin(rel * Math.PI / 180) * w.wind_speed_mph;
        const phrase =
          Math.abs(along) > Math.abs(cross) * 1.5
            ? (along < 0 ? `${Math.round(Math.abs(along))} into your face`
                          : `${Math.round(along)} at your back`)
            : `${Math.round(Math.abs(cross))} crosswind from the ${cross > 0 ? 'left' : 'right'}`;
        return {
          success: true,
          voice_response: phrase + '.',
          side_effects: ['query:wind'],
          follow_up_needed: false,
        };
      }

      case 'plays_like': {
        const here = await getCurrentLocation();
        const w = here ? (getCachedWeather(here) ?? await fetchWeatherAt(here)) : null;
        // Determine the actual yardage: explicit param > distance to green
        const param = intent.parameters.target_yards;
        let actual: number | null = typeof param === 'number' && param > 0 ? param : null;
        if (actual == null) {
          const green = getGreenCentroid(context.current_hole ?? round.currentHole);
          if (here && green) actual = Math.round(haversineYards(here, green));
        }
        if (actual == null) {
          return {
            success: true,
            voice_response: 'Tell me a number — like "plays like 150" — and I\'ll work it out.',
            side_effects: ['query:plays_like:no_yardage'],
            follow_up_needed: false,
          };
        }
        if (!w) {
          return {
            success: true,
            voice_response: `${actual} actual — no weather to factor in.`,
            side_effects: ['query:plays_like:no_weather'],
            follow_up_needed: false,
          };
        }
        const bearing = currentShotBearingDeg(round, context.current_hole ?? round.currentHole);
        const breakdown = playsLikeDistance(actual, w, bearing);
        const phrase = playsLikePhrase(breakdown);
        return {
          success: true,
          voice_response: phrase
            ? `${actual} actual, plays like ${breakdown.plays_like_yards} — ${phrase}.`
            : `${actual} actual, plays like ${breakdown.plays_like_yards}.`,
          side_effects: ['query:plays_like'],
          follow_up_needed: false,
        };
      }

      case 'shot_distance': {
        const lastShot = round.shots[round.shots.length - 1];
        if (!lastShot) {
          return {
            success: true,
            voice_response: 'No shots logged yet on this round.',
            side_effects: ['query:shot_distance:empty'],
            follow_up_needed: false,
          };
        }
        const yds = shotDistance(lastShot);
        if (yds == null) {
          return {
            success: true,
            voice_response: lastShot.distance_yards
              ? `That one was about ${lastShot.distance_yards} yards.`
              : 'I don\'t have GPS for that shot — log the next one and I\'ll measure it.',
            side_effects: ['query:shot_distance:no_gps'],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: `That shot was ${Math.round(yds)} yards.`,
          side_effects: ['query:shot_distance'],
          follow_up_needed: false,
        };
      }

      case 'hole_progress': {
        const currentHole = context.current_hole ?? round.currentHole;
        const holeShots = round.shots.filter(s => s.hole === currentHole);
        if (holeShots.length === 0) {
          return {
            success: true,
            voice_response: 'No shots on this hole yet.',
            side_effects: ['query:hole_progress:empty'],
            follow_up_needed: false,
          };
        }
        const total = holeProgressYards(holeShots);
        if (total <= 0) {
          return {
            success: true,
            voice_response: 'I don\'t have GPS for the shots on this hole yet.',
            side_effects: ['query:hole_progress:no_gps'],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: `You've covered ${Math.round(total)} yards on this hole, across ${holeShots.length} shot${holeShots.length === 1 ? '' : 's'}.`,
          side_effects: ['query:hole_progress'],
          follow_up_needed: false,
        };
      }

      case 'distance_to_green': {
        const greenHole = context.current_hole ?? round.currentHole;
        const green = getGreenCentroid(greenHole);
        if (!green) {
          return {
            success: true,
            voice_response: 'I don\'t know the green location for this hole yet.',
            side_effects: ['query:distance_to_green:no_green'],
            follow_up_needed: false,
          };
        }
        const here = await getCurrentLocation();
        if (!here) {
          return {
            success: true,
            voice_response: 'I can\'t read your location right now — try again in a moment.',
            side_effects: ['query:distance_to_green:no_gps'],
            follow_up_needed: false,
          };
        }
        const yds = Math.round(haversineYards(here, green));
        return {
          success: true,
          voice_response: `${yds} yards to the middle of the green.`,
          side_effects: ['query:distance_to_green'],
          follow_up_needed: false,
        };
      }

      case 'pattern': {
        const recentShots = round.shots.slice(-5);
        if (recentShots.length === 0) {
          return {
            success: true,
            voice_response: 'No shots logged yet — nothing to read into.',
            side_effects: ['query:pattern:empty'],
            follow_up_needed: false,
          };
        }
        const directions = recentShots.map(s => s.direction).filter(Boolean);
        const left = directions.filter(d => d === 'left').length;
        const right = directions.filter(d => d === 'right').length;
        const lean = left > right ? 'leaning left' : right > left ? 'leaning right' : 'pretty balanced';
        return {
          success: true,
          voice_response: `Last ${recentShots.length} shots, you're ${lean}.`,
          side_effects: ['query:pattern'],
          follow_up_needed: false,
        };
      }

      default:
        return {
          success: false,
          voice_response: 'What about it — score, hole, the ghost, your pattern?',
          side_effects: ['query:unknown_topic'],
          follow_up_needed: true,
        };
    }
  },
};
