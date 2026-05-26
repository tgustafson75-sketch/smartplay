/**
 * Phase 109 — On-course shot logging via voice.
 *
 * "I hit driver 240 left" / "7-iron 165 to the green" / "drove it 260 in the
 * fairway" → parses club + distance + outcome and calls roundStore.logShot
 * so the shot appears in stats, scorecard, and recap immediately.
 *
 * Gated on an active round. If the user logs without one, the handler
 * responds honestly rather than silently failing.
 *
 * Position capture: uses smartFinderService.lastFix when available, else
 * the gpsManager last cached fix. Both are kept current by the shotDetection
 * round-active subscription chain shipped in Phase 107.
 *
 * The conversational orchestrator (services/conversationalLoggingOrchestrator)
 * remains the path for auto-detected shots ("a swing was detected, what'd
 * you hit?"). This handler is the proactive path — user volunteers the
 * shot data without waiting for detection.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useRoundStore, type ShotResult, type ShotLocation } from '../../store/roundStore';
import { parseSpokenClub, clubLabel } from '../clubRecognition';
import { getLastFix as getSmartFinderLastFix } from '../smartFinderService';
import { getLastFix as getGpsLastFix } from '../gpsManager';
import { track } from '../analytics';

// Map outcome phrases to ShotResult.outcome where it's a direct match;
// everything else is a free-form note attached via raw_utterance.
function parseOutcome(phrase: string | undefined): {
  outcome: ShotResult['outcome'] | undefined;
  direction: ShotResult['direction'] | undefined;
} {
  if (!phrase) return { outcome: undefined, direction: undefined };
  const p = phrase.toLowerCase().trim();
  let outcome: ShotResult['outcome'] | undefined;
  let direction: ShotResult['direction'] | undefined;

  // Direction tokens (left/right/straight) — easy direct matches.
  if (/\bleft\b/.test(p)) direction = 'left';
  else if (/\bright\b/.test(p)) direction = 'right';
  else if (/\b(straight|down the middle|fairway center)\b/.test(p)) direction = 'straight';

  // Outcome categories. Best-guess mapping from natural language to the
  // ShotOutcome enum. Caller retains the verbatim phrase via raw_utterance
  // so any precision loss here is recoverable in recap.
  if (/\b(on the green|green|on green|stuck it|close to (the )?pin|on)\b/.test(p)) outcome = 'clean';
  else if (/\bin the (rough|deep)\b/.test(p)) outcome = 'clean';
  else if (/\bin the (sand|bunker|trap)\b/.test(p)) outcome = 'clean';
  else if (/\b(o\.?b\.?|out of bounds)\b/.test(p)) outcome = 'ob';
  else if (/\b(water|drink|red stake|yellow stake)\b/.test(p)) outcome = 'water';
  else if (/\b(hazard|lateral hazard)\b/.test(p)) outcome = 'hazard_drop';
  else if (/\bunplayable\b/.test(p)) outcome = 'unplayable';
  else if (/\b(lost|never found)\b/.test(p)) outcome = 'lost';
  else if (/\b(in the (fairway|short grass)|fairway)\b/.test(p)) outcome = 'clean';
  else if (direction != null) outcome = 'clean';

  return { outcome, direction };
}

function snapshotLocation(): ShotLocation | null {
  const sf = getSmartFinderLastFix();
  if (sf) return sf.location;
  const gps = getGpsLastFix();
  if (gps) return { lat: gps.lat, lng: gps.lng };
  return null;
}

function noActiveRound(): IntentResult {
  return {
    success: false,
    voice_response: "You're not in a round right now — start a round and I'll log shots as you go.",
    side_effects: ['logShot:no_active_round'],
    follow_up_needed: false,
  };
}

export const logShotHandler: IntentHandler = {
  intent_type: 'log_shot',

  parameter_schema: {
    club_phrase: 'verbatim club name from the user (driver / 7-iron / pitching wedge / putter / etc.)',
    distance_yards: 'integer yards if mentioned',
    outcome_phrase: 'verbatim outcome description if any (left, right, on the green, in the rough, etc.)',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    'I hit driver 240 left',
    'hit 7-iron 165 to the green',
    '8-iron 150 in the rough',
    'drove it 260 in the fairway',
    'smoked a 5-iron 200 right',
    'putted it close',
    'log a shot, 7-iron, 165, on the green',
    'tee shot driver 290',
  ],

  async execute(intent): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) return noActiveRound();

    const params = intent.parameters as {
      club_phrase?: string;
      distance_yards?: number;
      outcome_phrase?: string;
      raw_utterance?: string;
    };
    const clubPhrase = String(params.club_phrase ?? intent.raw_text ?? '').trim();
    const parsedClub = parseSpokenClub(clubPhrase);
    if (!parsedClub) {
      track('log_shot_ambiguous_club', { phrase: clubPhrase.slice(0, 60) });
      return {
        success: false,
        voice_response: "Got the shot — which club?",
        side_effects: ['logShot:ambiguous_club'],
        follow_up_needed: true,
      };
    }

    const distance =
      typeof params.distance_yards === 'number' && Number.isFinite(params.distance_yards)
        ? Math.max(0, Math.round(params.distance_yards))
        : undefined;
    const { outcome, direction } = parseOutcome(params.outcome_phrase);
    const location = snapshotLocation();

    const shotsThisHole = round.shots.filter((s) => (s.hole_number ?? s.hole) === round.currentHole);
    const shotInHoleIndex = shotsThisHole.length + 1;
    const shotInRoundIndex = round.shots.length + 1;

    const shot: ShotResult = {
      id: `${Date.now()}_voice`,
      hole: round.currentHole,
      hole_number: round.currentHole,
      club: parsedClub.club_id,
      timestamp: Date.now(),
      feel: null,
      direction: direction ?? null,
      shape: null,
      acousticContact: null,
      distance_yards: distance ?? null,
      outcome: outcome ?? 'clean',
      raw_utterance: params.raw_utterance ?? intent.raw_text ?? clubPhrase,
      logged_via: 'voice',
      gps_location: location,
      start_location: location,
      end_location: null,
      shot_in_hole_index: shotInHoleIndex,
      shot_in_round_index: shotInRoundIndex,
    };

    round.logShot(shot);
    track('shot_logged_voice', {
      club_id: parsedClub.club_id,
      club_type: parsedClub.club_type,
      distance_yards: distance ?? null,
      outcome: outcome ?? 'clean',
      direction: direction ?? null,
      had_gps: location != null,
    });

    // 2026-05-25 — Fix N: toast confirmation in addition to voice
    // response. In L5 Cockpit the voice ack can be missed (background
    // noise, brief utterance, audio routed to earpiece) and Tim flagged
    // tonight that he couldn't tell when shot-log captured. Toast is
    // a deterministic visual confirmation that fires for every success.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require('../../store/toastStore') as typeof import('../../store/toastStore');
      const directionTag = direction ? ` · ${direction}` : '';
      const distTag = distance != null ? ` · ${distance}y` : '';
      t.useToastStore.getState().show(`${clubLabel(parsedClub.club_id)}${distTag}${directionTag}`);
    } catch (e) { console.log('[logShot] toast failed (non-fatal):', e); }

    const distancePart = distance != null ? `${distance}` : null;
    const outcomePart = outcome === 'ob' ? 'OB'
                       : outcome === 'water' ? 'water'
                       : outcome === 'hazard_drop' ? 'hazard'
                       : outcome === 'unplayable' ? 'unplayable'
                       : outcome === 'lost' ? 'lost'
                       : direction ?? null;
    const lineParts = [`${clubLabel(parsedClub.club_id)}`, distancePart, outcomePart].filter(Boolean) as string[];
    const voice = `Got it — ${lineParts.join(', ')}.`;

    return {
      success: true,
      voice_response: voice,
      side_effects: [`logShot:logged:${parsedClub.club_id}`],
      follow_up_needed: false,
    };
  },
};
