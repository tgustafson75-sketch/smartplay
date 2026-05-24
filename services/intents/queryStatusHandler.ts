import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';
import { haversineYards, holeProgressYards, shotDistance, bearingDegrees } from '../../utils/geoDistance';
import { getCurrentLocation, getGreenCentroid, getTeeCentroid } from '../shotLocationService';
import { fetchWeatherAt, getCachedWeather, type WeatherSnapshot } from '../weatherService';
import { playsLikeDistance, playsLikePhrase } from '../../utils/playsLike';
import type { ShotLocation } from '../../store/roundStore';
import { getGreenYardages, resolveGreenCoords } from '../smartFinderService';
// 2026-05-24 — Flow A (GPS-verify) — getOneShotFix is the only GPS
// accessor that exposes accuracy_m. shotLocationService.getCurrentLocation()
// strips to { lat, lng }, so it can't drive the soft-GPS tell. Importing
// directly from gpsManager for the yardage handler enrichment.
import { getOneShotFix } from '../gpsManager';

// 2026-05-24 — Voice-language localization for distance_to_green
// responses. Source of truth for `lang` is AppContext.language, which
// voiceCommandRouter populates from the classifier-detected utterance
// language (api/voice-intent.ts emits es/zh on Spanish/Chinese triggers).
// English text is preserved verbatim from the prior implementation so
// the default path has zero regression; es/zh siblings translate the
// same meaning (green-middle yardage, soft-GPS hedge, no-green hint,
// no-GPS hint). Lookup falls back to en on any unrecognized value.
//
// NOTE: this localizes the TEXT only. The TTS voice model is still
// selected from Settings (services/voiceService.ts → /api/voice), so
// es/zh text spoken under an English Settings language plays through
// eleven_monolingual_v1 with an English voice. Voice-model threading
// is a separate follow-up.
const TTS_STRINGS = {
  en: {
    noGreen: "I don't have the green location for this hole — try marking it next time you pass through.",
    noGps: 'No GPS lock yet — give it a few seconds and try again.',
    distance: (y: number) => `${y} yards to the middle of the green.`,
    softGps: (y: number) => `${y} yards to the middle of the green — but my GPS is a little soft right now.`,
  },
  es: {
    noGreen: 'No tengo la ubicación del green para este hoyo — intenta marcarla la próxima vez que pases.',
    noGps: 'Aún no tengo señal GPS — espera unos segundos e intenta otra vez.',
    distance: (y: number) => `${y} yardas al centro del green.`,
    softGps: (y: number) => `${y} yardas al centro del green — pero mi GPS está un poco débil ahora.`,
  },
  zh: {
    noGreen: '这洞的果岭位置我还没有数据——下次经过时可以试试标记一下。',
    noGps: '还没有GPS信号——等几秒再试一次。',
    distance: (y: number) => `到果岭中心${y}码。`,
    softGps: (y: number) => `到果岭中心${y}码——不过我的GPS信号现在有点弱。`,
  },
} as const;

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

      case 'shot_strategy': {
        // 2026-05-22 — Caddie Brain: "what's the play here". Routes
        // through smartAnalysisEngine.analyze({kind:'shot_strategy'}) →
        // metaCourseIntelligence.recommendShot which composes 8 signals
        // (geometry, GPS, wind, vision, lie, ghost, golfer model, recent
        // shots) into one strategic recommendation.
        const engine = await import('../smartAnalysisEngine');
        const lieHint = typeof intent.parameters.lie_hint === 'string'
          ? intent.parameters.lie_hint
          : null;
        const targetYards = typeof intent.parameters.target_yards === 'number'
          ? intent.parameters.target_yards
          : null;
        const env = await engine.analyze({
          kind: 'shot_strategy',
          lie_hint: lieHint,
          target_yards: targetYards,
        });
        return {
          success: env.status !== 'error',
          voice_response: env.voice_summary,
          side_effects: [`query:shot_strategy:conf_${env.confidence}`],
          follow_up_needed: false,
        };
      }

      case 'swing_compare': {
        // 2026-05-22 — Caddie Brain: compare current vs reference swing.
        // For voice-only (no video URI from voice), we describe the
        // capability and route to UI when needed. Future enhancement:
        // pull the most-recent uploaded swing's clipUri automatically.
        const against =
          intent.parameters.against === 'self_previous' ? 'self_previous' :
          intent.parameters.against === 'tour_median' ? 'tour_median' :
          intent.parameters.against === 'amateur_good' ? 'amateur_good' : 'tour_median';
        try {
          const swingLib = await import('../swingLibrary');
          const entries = swingLib.getLibrary('all');
          if (entries.length < 1) {
            return {
              success: true,
              voice_response:
                "You haven't uploaded a swing to the library yet. Record one in SmartMotion and try again.",
              side_effects: ['query:swing_compare:no_swings'],
              follow_up_needed: false,
            };
          }
          // For voice path, surface a quick acknowledgement; full
          // analysis kicks off when caller passes video URI explicitly
          // (UI button flow). This keeps the voice response immediate.
          return {
            success: true,
            voice_response:
              against === 'tour_median'
                ? 'Pulling up your latest swing to compare against the tour median. Opening swing library.'
                : 'Comparing your most recent swing to your previous one. Opening the library now.',
            side_effects: [`query:swing_compare:${against}`],
            follow_up_needed: false,
            tool_action: { type: 'open_url', url: '/swinglab/library' },
          };
        } catch (e) {
          console.log('[swing_compare] failed:', e);
          return {
            success: false,
            voice_response: "Couldn't open the swing library right now.",
            side_effects: ['query:swing_compare:error'],
            follow_up_needed: false,
          };
        }
      }

      case 'team_progress': {
        // 2026-05-22 — Captain extension: roll up recent swing trends
        // across every teammate (excludes coaches). Reads junior-swing
        // history per teammate and constructs a single warm sentence
        // the captain can hear during practice without opening the app.
        const famMod = await import('../../store/familyStore');
        const family = famMod.useFamilyStore.getState();
        const teamName = family.team_name;
        const roster = family.teamRoster(teamName || undefined);
        const teammates = roster.filter((m) => m.relationship === 'teammate');
        if (teammates.length === 0) {
          return {
            success: true,
            voice_response:
              teamName
                ? `No teammates on ${teamName} yet. Add them in Settings → Team Captain.`
                : "No team set up yet. Open Team Captain in Settings to add teammates.",
            side_effects: ['query:team_progress:empty'],
            follow_up_needed: false,
          };
        }
        const analyzer = await import('../juniorSwingAnalyzer');
        let totalLatest = 0;
        let totalEarlier = 0;
        let withTrend = 0;
        const standouts: { name: string; delta: number }[] = [];
        for (const m of teammates) {
          const history = await analyzer.getMemberSwingHistory(m.id);
          if (history.length === 0) continue;
          const latest = history[history.length - 1];
          totalLatest += latest.overallScore;
          if (history.length >= 2) {
            const earlier = history[history.length - 2];
            totalEarlier += earlier.overallScore;
            withTrend++;
            const delta = latest.overallScore - earlier.overallScore;
            if (Math.abs(delta) >= 5) {
              standouts.push({ name: m.firstName, delta });
            }
          }
        }
        const withSwings = teammates.filter(async (m) => (await analyzer.getMemberSwingHistory(m.id)).length > 0).length;
        if (totalLatest === 0) {
          return {
            success: true,
            voice_response:
              `${teamName || 'The team'} hasn't logged any swings yet. Start recording and we'll start tracking.`,
            side_effects: ['query:team_progress:no_swings'],
            follow_up_needed: false,
          };
        }
        const avgLatest = Math.round(totalLatest / teammates.length);
        const avgTrendDelta = withTrend > 0 ? Math.round((totalLatest - totalEarlier) / withTrend) : 0;
        standouts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        const top = standouts.slice(0, 2);
        const trendBit =
          withTrend === 0 ? '' :
          avgTrendDelta > 0 ? ` Team's trending up about ${avgTrendDelta} points on average.` :
          avgTrendDelta < 0 ? ` Team's down about ${Math.abs(avgTrendDelta)} points lately — let's reset tomorrow.` :
          ` Team's holding steady.`;
        const standoutBit =
          top.length === 0 ? '' :
          ' ' + top.map((s) => `${s.name} ${s.delta > 0 ? 'up' : 'down'} ${Math.abs(s.delta)}`).join(', ') + '.';
        return {
          success: true,
          voice_response:
            `${teamName || 'Team'} averaging ${avgLatest} across ${teammates.length} player${teammates.length === 1 ? '' : 's'}.${trendBit}${standoutBit}`,
          side_effects: [`query:team_progress:avg_${avgLatest}`],
          follow_up_needed: false,
        };
      }

      case 'family_progress': {
        // Read the named family member's recent junior-swing history
        // and speak a brief progress summary. Lookups: voice intent
        // passes `member_name`; we map that to the roster via family
        // store's findByName. Falls back to the active member when
        // no name given (e.g. "how's HER progress" mid-session).
        const famMod = await import('../../store/familyStore');
        const family = famMod.useFamilyStore.getState();
        const requested = String(intent.parameters.member_name ?? '').trim();
        const member = requested
          ? family.findByName(requested)
          : family.getMember(family.active_member_id);
        if (!member) {
          return {
            success: false,
            voice_response: requested
              ? `I don\'t have ${requested} on the family roster yet.`
              : "Tell me which family member — say their name.",
            side_effects: ['query:family_progress:no_member'],
            follow_up_needed: true,
          };
        }
        const analyzer = await import('../juniorSwingAnalyzer');
        const history = await analyzer.getMemberSwingHistory(member.id);
        if (history.length === 0) {
          return {
            success: true,
            voice_response: `No swings logged for ${member.firstName} yet. Record one and I\'ll start tracking progress.`,
            side_effects: ['query:family_progress:empty'],
            follow_up_needed: false,
          };
        }
        const latest = history[history.length - 1];
        const trend = history.length >= 3
          ? buildSimpleTrend(history.slice(-5).map(h => h.overallScore))
          : null;
        const progressBit = trend ? ` ${trend}.` : '';
        return {
          success: true,
          voice_response:
            `${member.firstName}: last swing scored ${latest.overallScore}.` +
            (latest.wins[0] ? ` Big win — ${latest.wins[0]}` : '') +
            progressBit,
          side_effects: [`query:family_progress:${member.id}`],
          follow_up_needed: false,
        };
      }

      case 'family_analysis': {
        // Trigger junior-swing analysis on the freshest capture for the
        // named member. The submitVisionFrame pipeline has already
        // stamped golfer_id; we just kick analysis + speak the result.
        const famMod = await import('../../store/familyStore');
        const family = famMod.useFamilyStore.getState();
        const requested = String(intent.parameters.member_name ?? '').trim();
        const member = requested
          ? family.findByName(requested)
          : family.getMember(family.active_member_id);
        if (!member) {
          return {
            success: false,
            voice_response: requested
              ? `I don\'t have ${requested} on the family roster yet.`
              : "Tell me whose swing — say their name.",
            side_effects: ['query:family_analysis:no_member'],
            follow_up_needed: true,
          };
        }
        const notes = typeof intent.parameters.notes === 'string' ? intent.parameters.notes : null;
        const analyzer = await import('../juniorSwingAnalyzer');
        const result = await analyzer.speakJuniorAnalysis(member.id, notes);
        if (!result) {
          return {
            success: false,
            voice_response: `Couldn\'t analyze ${member.firstName}\'s swing right now.`,
            side_effects: ['query:family_analysis:error'],
            follow_up_needed: false,
          };
        }
        // speakJuniorAnalysis already piped the coachComment through
        // voiceService; the returned voice_response is a no-op but keep
        // it populated for the trace log + any text-display surface.
        return {
          success: true,
          voice_response: result.coachComment,
          side_effects: [`query:family_analysis:${member.id}:score_${result.overallScore}`],
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
        return {
          success: true,
          voice_response: result.caddieComment,
          side_effects: [`query:putt_analysis:score_${result.overallScore}`],
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
        // 2026-05-24 — Flow A (GPS-verify): RAW haversine yardage to the
        // middle of the green, never plays-like adjusted. This is the
        // Golfshot-comparable number Tim cross-checks during the test
        // round. Three upgrades from the prior implementation:
        //   1. resolveGreenCoords (Mark Green override > courseHoles >
        //      geometry cache) replaces getGreenCentroid (courseHoles
        //      only). Player-marked pin wins, matching the rest of the
        //      yardage pipeline.
        //   2. getOneShotFix replaces getCurrentLocation so we have
        //      accuracy_m for the soft-GPS tell.
        //   3. accuracy_m > 15 (the same threshold subscribePoorSignal
        //      uses) appends "...but my GPS is a little soft right now"
        //      so the player knows when to take the number with a
        //      grain of salt.
        const greenHole = context.current_hole ?? round.currentHole;
        const resolved = resolveGreenCoords(greenHole);
        const green = resolved.middle;
        // 2026-05-24 — Lang is the classifier-detected utterance language
        // threaded through voiceCommandRouter; falls back to 'en' when
        // unset (older Vercel route, English transcript, or no triggers
        // matched). The bracket access is safe because TTS_STRINGS has
        // entries for all three values + the 'en' fallback guards
        // anything unexpected.
        const lang: 'en' | 'es' | 'zh' = context.language ?? 'en';
        const t = TTS_STRINGS[lang] ?? TTS_STRINGS.en;
        if (!green) {
          return {
            success: true,
            voice_response: t.noGreen,
            side_effects: ['query:distance_to_green:no_green', `lang:${lang}`],
            follow_up_needed: false,
          };
        }
        // 5-second freshness for the voice query — cache hit feels
        // responsive, stale cache (>5s) refreshes inline. Defaults to
        // OS-reported accuracy when GPS is locked.
        const fix = await getOneShotFix({ maxAgeMs: 5_000 });
        if (!fix) {
          return {
            success: true,
            voice_response: t.noGps,
            side_effects: ['query:distance_to_green:no_gps', `lang:${lang}`],
            follow_up_needed: false,
          };
        }
        const here: ShotLocation = { lat: fix.lat, lng: fix.lng };
        const yds = Math.round(haversineYards(here, green));
        // Soft-GPS tell threshold matches the existing
        // subscribePoorSignal threshold in gpsManager.ts:436-462 (>15m
        // sustained accuracy triggers a poor-signal toast today). Null
        // accuracy_m means the OS didn't report a value — keep silent
        // rather than guessing.
        const SOFT_GPS_ACCURACY_M = 15;
        const softGps = typeof fix.accuracy_m === 'number' && fix.accuracy_m > SOFT_GPS_ACCURACY_M;
        return {
          success: true,
          voice_response: softGps ? t.softGps(yds) : t.distance(yds),
          side_effects: [
            'query:distance_to_green',
            `gps_accuracy_m:${typeof fix.accuracy_m === 'number' ? Math.round(fix.accuracy_m) : 'unknown'}`,
            `green_source:${resolved.source}`,
            `lang:${lang}`,
          ],
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

      // 2026-05-24 — Meta glasses voice-exchange recall. The user asks
      // "what did Meta say?" and Tank/Kevin repeats the most recent
      // assistant reply that's bucketed to the current hole (or any
      // unattributed entry as a fallback). Data comes from
      // services/metaGlassesIngest.ts via JSON import. Localized
      // wrappers; the ai_response text itself is whatever Meta said
      // (Meta AI replies are usually English even when the user spoke
      // Spanish — that's Meta's choice, not ours).
      case 'what_did_meta_say': {
        const lang: 'en' | 'es' | 'zh' = context.language ?? 'en';
        const ctx = round.externalContext?.filter((c) =>
          c.source === 'meta_glasses' &&
          (c.hole === context.current_hole || !c.hole)
        );
        if (!ctx?.length) {
          const noNotes =
            lang === 'es' ? 'Aún no tengo notas de Meta AI para este hoyo.'
            : lang === 'zh' ? '这洞还没有Meta AI的笔记。'
            : "I don't have any Meta AI notes for this hole yet.";
          return {
            success: true,
            voice_response: noNotes,
            side_effects: ['query:what_did_meta_say:empty', `lang:${lang}`],
            follow_up_needed: false,
          };
        }
        const last = ctx[ctx.length - 1];
        const wrapped =
          lang === 'es' ? `En este hoyo, Meta dijo: ${last.ai_response}`
          : lang === 'zh' ? `这洞上,Meta 说:${last.ai_response}`
          : `On this hole, Meta said: ${last.ai_response}`;
        return {
          success: true,
          voice_response: wrapped,
          side_effects: ['query:what_did_meta_say', `lang:${lang}`, `meta_entries:${ctx.length}`],
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

/**
 * 2026-05-22 — Trend phrase for the family_progress query. Looks at the
 * last few overallScore values; returns a warm one-sentence read of
 * direction. Conservative — when scores are flat we say so.
 */
function buildSimpleTrend(scores: number[]): string {
  if (scores.length < 2) return '';
  const first = scores[0];
  const last = scores[scores.length - 1];
  const diff = last - first;
  if (Math.abs(diff) < 3) return 'Trending steady — staying consistent';
  if (diff > 0) return `Up ${diff} points over the last ${scores.length} swings`;
  return `Down ${Math.abs(diff)} points lately — just need a couple clean reps`;
}
