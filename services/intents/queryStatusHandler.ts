import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';
import { haversineYards, holeProgressYards, shotDistance, bearingDegrees } from '../../utils/geoDistance';
import { getCurrentLocation, getGreenCentroid, getTeeCentroid } from '../shotLocationService';
import { fetchWeatherAt, getCachedWeather, type WeatherSnapshot } from '../weatherService';
import { playsLikeDistance, playsLikePhrase } from '../../utils/playsLike';
import type { ShotLocation } from '../../store/roundStore';
import { getGreenYardages } from '../smartFinderService';

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

    // Pre-beta — distance/wind/carry queries are shot-intent signals; bump
    // GPS to active so the next answer reads from a fresh fix.
    if (topic === 'distance_to_green' || topic === 'green_front' || topic === 'green_back' ||
        topic === 'green_middle' || topic === 'wind' || topic === 'plays_like' ||
        topic === 'carry_check' || topic === 'shot_distance' || topic === 'hole_progress') {
      try { require('../gpsManager').bumpToActive('voice_query:' + topic); } catch {}
    }

    if (!round.isRoundActive && (topic === 'score' || topic === 'hole' || topic === 'ghost_match' || topic === 'shot_distance' || topic === 'hole_progress' || topic === 'distance_to_green' || topic === 'wind' || topic === 'conditions' || topic === 'weather' || topic === 'plays_like' || topic === 'green_front' || topic === 'green_back' || topic === 'green_middle') /* end_session, next_focus, swing_observation, tell_me_more, putt_analysis deliberately allowed off-round */) {
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

      case 'putt_analysis': {
        // 2026-05-22 — PuttingLab voice route. Pulls the freshest
        // glasses-attached frame (when present) + the player's last
        // utterance, runs the multimodal analysis, and speaks the
        // persona-aware summary back. Defensive: with no frames + no
        // read the service returns a course-context baseline so the
        // player still gets actionable feedback.
        const putting = await import('../puttingAnalysisService');
        const spoken = typeof intent.parameters.spoken_read === 'string'
          ? intent.parameters.spoken_read
          : null;
        const result = await putting.analyzePutt({ spoken_read: spoken });
        if (!result) {
          return {
            success: false,
            voice_response: "Couldn't run the putting analysis right now.",
            side_effects: ['query:putt_analysis:error'],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: result.voice_summary,
          side_effects: [`query:putt_analysis:conf_${result.confidence}`],
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

      case 'end_session': {
        // Phase J — voice trigger to end the active Cage Session. Reads cage
        // store directly to avoid circular import. If no active session,
        // gracefully decline.
        try {
          const { useCageStore } = await import('../../store/cageStore');
          const cage = useCageStore.getState();
          if (!cage.activeSession) {
            return {
              success: true,
              voice_response: "No session running — nothing to end.",
              side_effects: ['cage:end_session:no_active'],
              follow_up_needed: false,
            };
          }
          cage.endSession({ dominantMiss: null, rootCause: null, summary: null });
          const { router } = await import('expo-router');
          router.push('/cage/summary' as never);
          return {
            success: true,
            voice_response: "Session ended. Let me take a look.",
            side_effects: ['cage:end_session'],
            follow_up_needed: false,
          };
        } catch (err) {
          console.log('[queryStatusHandler] end_session failed:', err);
          return {
            success: false,
            voice_response: "Couldn't end the session.",
            side_effects: ['cage:end_session:error'],
            follow_up_needed: false,
          };
        }
      }

      case 'swing_observation': {
        // Phase K — replay primary issue observation from the most recent
        // session.
        try {
          const { useCageStore } = await import('../../store/cageStore');
          const last = useCageStore.getState().sessionHistory.slice(-1)[0];
          if (last?.primary_issue) {
            return {
              success: true,
              voice_response: `${last.primary_issue.name}. ${last.primary_issue.mechanical_breakdown}`,
              side_effects: ['cage:swing_observation'],
              follow_up_needed: false,
            };
          }
          return {
            success: true,
            voice_response: "I didn't see a clear primary issue from that session.",
            side_effects: ['cage:swing_observation:none'],
            follow_up_needed: false,
          };
        } catch {
          return { success: true, voice_response: "Couldn't pull that up.", side_effects: ['cage:swing_observation:error'], follow_up_needed: false };
        }
      }

      case 'tell_me_more': {
        // Phase K — expanded analysis. Plays the feel cue + drill recommendation
        // reason if both are populated.
        try {
          const { useCageStore } = await import('../../store/cageStore');
          const last = useCageStore.getState().sessionHistory.slice(-1)[0];
          if (last?.primary_issue) {
            const feel = last.primary_issue.feel_cue;
            const drill = last.drill_recommendation?.reason ?? '';
            return {
              success: true,
              voice_response: `${feel} ${drill}`.trim(),
              side_effects: ['cage:tell_me_more'],
              follow_up_needed: false,
            };
          }
          return {
            success: true,
            voice_response: "That's the main thing — nothing more to add.",
            side_effects: ['cage:tell_me_more:none'],
            follow_up_needed: false,
          };
        } catch {
          return { success: true, voice_response: "Couldn't pull that up.", side_effects: ['cage:tell_me_more:error'], follow_up_needed: false };
        }
      }

      case 'next_focus': {
        // Phase J — "what should I work on". If a Phase K Primary Issue is
        // populated on the most recent session, summarize it. Otherwise
        // honest placeholder.
        try {
          const { useCageStore } = await import('../../store/cageStore');
          const cage = useCageStore.getState();
          const last = cage.sessionHistory[cage.sessionHistory.length - 1];
          if (last?.primary_issue) {
            const issue = last.primary_issue;
            return {
              success: true,
              voice_response: `${issue.name}. ${issue.feel_cue}`,
              side_effects: ['cage:next_focus'],
              follow_up_needed: false,
            };
          }
          return {
            success: true,
            voice_response: "Analysis is coming soon — try the drills section in the meantime.",
            side_effects: ['cage:next_focus:placeholder'],
            follow_up_needed: false,
          };
        } catch {
          return {
            success: true,
            voice_response: "Analysis is coming soon.",
            side_effects: ['cage:next_focus:error'],
            follow_up_needed: false,
          };
        }
      }

      case 'green_front':
      case 'green_back':
      case 'green_middle': {
        const hole = context.current_hole ?? round.currentHole;
        const yards = await getGreenYardages(hole);
        const which = topic === 'green_front' ? 'front' : topic === 'green_back' ? 'back' : 'middle';
        const value = yards[which];
        if (value == null) {
          return {
            success: true,
            voice_response: `I don\'t have green coordinates for the ${which} of this hole.`,
            side_effects: [`query:${topic}:no_data`],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: `${value} to the ${which}.`,
          side_effects: [`query:${topic}`],
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

      // Phase R — hole history voice query
      case 'hole_history': {
        if (!round.activeCourseId || !round.currentHole) {
          return {
            success: true,
            voice_response: "I'd need an active round and a course I can match for that.",
            side_effects: ['query:hole_history_no_context'],
            follow_up_needed: false,
          };
        }
        const priorRounds = round.roundHistory.filter(r =>
          r.courseId === round.activeCourseId &&
          r.scores[round.currentHole] != null &&
          r.id !== round.currentRoundId,
        );
        if (priorRounds.length === 0) {
          return {
            success: true,
            voice_response: `This is your first time playing hole ${round.currentHole} here that I've got data on.`,
            side_effects: ['query:hole_history_first_time'],
            follow_up_needed: false,
          };
        }
        const par = round.courseHoles.find(h => h.hole === round.currentHole)?.par ?? 4;
        if (priorRounds.length === 1) {
          const r = priorRounds[0];
          const score = r.scores[round.currentHole];
          const v = score - par;
          const vStr = v === 0 ? 'paired it' : v > 0 ? `${v === 1 ? 'bogeyed' : v === 2 ? 'doubled' : `went +${v}`} it` : `went ${v} on it`;
          return {
            success: true,
            voice_response: `Last time, you ${vStr}.`,
            side_effects: ['query:hole_history_one'],
            follow_up_needed: false,
          };
        }
        // Multiple prior rounds — last 3 + average
        const lastThree = priorRounds.slice(-3);
        const labels = lastThree.map(r => {
          const v = r.scores[round.currentHole] - par;
          return v === 0 ? 'par' : v === 1 ? 'bogey' : v === 2 ? 'double' : v < 0 ? `${v}` : `+${v}`;
        });
        const avgVsPar = priorRounds.reduce((a, r) => a + (r.scores[round.currentHole] - par), 0) / priorRounds.length;
        const avgPhrase = Math.abs(avgVsPar) < 0.25 ? 'around par' : avgVsPar > 0 ? `over par by ${avgVsPar.toFixed(1)}` : `under par by ${Math.abs(avgVsPar).toFixed(1)}`;
        return {
          success: true,
          voice_response: `Last ${lastThree.length} times: ${labels.join(', ')}. Average here is ${avgPhrase}.`,
          side_effects: ['query:hole_history_multi'],
          follow_up_needed: false,
        };
      }

      // Phase S — carry feasibility check ("can I carry the bunker")
      case 'carry_check': {
        const hazardPhrase = String(intent.parameters.hazard_phrase ?? '').toLowerCase();
        if (!round.isRoundActive || !round.activeCourseId) {
          return {
            success: true,
            voice_response: "I'd need an active round and course geometry to call that.",
            side_effects: ['query:carry_no_context'],
            follow_up_needed: false,
          };
        }
        // Defer the heavy lookup to the carry-check service so we don't pull
        // all of courseGeometry into the handler module top-level imports.
        const { canPlayerCarry } = await import('../smartVisionOverlay');
        const { getHoleGeometry } = await import('../courseGeometryService');
        const geom = getHoleGeometry(round.activeCourseId, round.currentHole);
        if (!geom || !geom.tee) {
          return {
            success: true,
            voice_response: "I don't have geometry for this hole.",
            side_effects: ['query:carry_no_geometry'],
            follow_up_needed: false,
          };
        }
        const matchedHazard = geom.hazards.find(h =>
          h.location && (
            (hazardPhrase && h.label.toLowerCase().includes(hazardPhrase)) ||
            (!hazardPhrase && true)
          )
        );
        if (!matchedHazard?.location) {
          return {
            success: true,
            voice_response: hazardPhrase
              ? `I don't see a ${hazardPhrase} mapped on this hole.`
              : "I don't have hazard positions for this hole.",
            side_effects: ['query:carry_no_hazard_match'],
            follow_up_needed: false,
          };
        }
        // Use player's typical driver yardage from accumulated patterns; fallback
        // 230y if nothing observed yet.
        const driverYards = 230; // TODO: read from accumulated club distances when wired
        const result = canPlayerCarry(geom.tee, matchedHazard.location, driverYards);
        const voice = result.in_range
          ? `Yeah — about ${result.carry_yards} yards to clear it. You've got ${result.margin_yards} to spare with driver.`
          : `Pushing it — ${result.carry_yards} yards to carry, you're about ${Math.abs(result.margin_yards)} short with driver. Lay-up's the play.`;
        return {
          success: true,
          voice_response: voice,
          side_effects: [`query:carry:${matchedHazard.label}`],
          follow_up_needed: false,
        };
      }

      // Phase R — swing library lookup ("look at last Tuesday's swing")
      case 'look_at_swing': {
        const phrase = String(intent.parameters.swing_phrase ?? '');
        const { findSessionByRelativeDate, formatSessionSummary } = await import('../swingLibrary');
        const session = findSessionByRelativeDate(phrase || 'last');
        if (!session) {
          return {
            success: true,
            voice_response: "I don't have a swing in your library matching that.",
            side_effects: ['query:no_swing_match'],
            follow_up_needed: false,
          };
        }
        return {
          success: true,
          voice_response: formatSessionSummary(session),
          side_effects: [`query:open_swing:${session.id}`],
          follow_up_needed: false,
          tool_action: { type: 'open_url', url: `/swinglab/swing/${session.id}` },
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
