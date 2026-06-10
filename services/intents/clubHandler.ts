/**
 * Phase BL — Cage-session club voice intents.
 *
 * Three handlers, all gated on an active cage session:
 *   - club_change : "switching to 6-iron" / "going to PW" / "now I'm on driver"
 *   - club_query  : "what club am I on" / "what's my current club"
 *   - club_menu   : "show clubs" / "club menu" / "switch club" — opens picker
 *
 * If invoked outside an active cage session, each responds with an honest
 * "you're not in a cage session right now" rather than silently failing.
 * Confidence is set per-handler to reflect how likely the parse is correct.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useCageStore } from '../../store/cageStore';
import { parseSpokenClub, clubLabel } from '../clubRecognition';
import { useClubSelectionStore } from '../../store/clubSelectionStore';
import { isSmartMotionActive, emitSmartMotionCommand } from '../smartMotionRecordBus';
import { track } from '../analytics';

function noActiveSession(): IntentResult {
  return {
    success: false,
    voice_response: "You're not in a cage session right now — start one and I'll track your clubs.",
    side_effects: ['cage:no_active_session'],
    follow_up_needed: false,
  };
}

export const clubChangeHandler: IntentHandler = {
  intent_type: 'club_change',

  parameter_schema: {
    club_phrase: 'verbatim phrase naming the new club (e.g. "6-iron", "pitching wedge", "driver", "3 wood")',
  },

  examples: [
    'switching to 6-iron',
    'going to pitching wedge',
    "now I'm on driver",
    "I'm hitting the 8 iron",
    'switch to my 5 wood',
    'going driver',
    "I'll grab the gap wedge",
  ],

  async execute(intent): Promise<IntentResult> {
    const phrase = String(intent.parameters.club_phrase ?? intent.raw_text ?? '').trim();
    const parsed = parseSpokenClub(phrase);

    // 2026-06-09 — Hands-free club tagging on the Smart Motion screen (no cage
    // session needed there). Update the shared club store so the HUD + ball
    // speed reflect it. "scan/what/this club" with no named club → trigger the
    // camera club detector.
    if (isSmartMotionActive()) {
      if (parsed) {
        useClubSelectionStore.getState().setLastClub(parsed.club_id);
        // Keep putt mode in sync with the spoken club, exactly like the picker
        // and the camera club-scan do: putter → analyze as a putt; any other
        // club → clear back to a full-swing read. Without this, a hands-free
        // "switch to putter" updated the HUD chip but left the analysis on the
        // swing path (a putt read on a driver, or vice versa).
        emitSmartMotionCommand(parsed.club_id === 'PT' ? 'puttOn' : 'puttOff');
        track('club_switched', { club_id: parsed.club_id, club_type: parsed.club_type, source: 'voice' });
        return {
          success: true,
          voice_response: parsed.club_id === 'PT' ? 'Putter — putt mode on.' : `Got it, ${clubLabel(parsed.club_id)}.`,
          side_effects: [`smartmotion:club_switched:${parsed.club_id}`],
          follow_up_needed: false,
        };
      }
      if (/\b(scan|detect|what|which|this|read)\b/.test(phrase.toLowerCase())) {
        emitSmartMotionCommand('scanClub');
        return {
          success: true,
          voice_response: 'Reading your club — hold it up.',
          side_effects: ['smartmotion:club_scan'],
          follow_up_needed: false,
        };
      }
      return {
        success: false,
        voice_response: 'Which club — say the club or show it and say scan.',
        side_effects: ['smartmotion:club_ambiguous'],
        follow_up_needed: true,
      };
    }

    const cage = useCageStore.getState();
    if (!cage.activeSession) {
      return noActiveSession();
    }

    if (!parsed) {
      track('club_voice_ambiguous', { phrase: phrase.slice(0, 60) });
      return {
        success: false,
        voice_response: "Which one — pitching, gap, sand, or lob wedge?",
        side_effects: ['cage:club_ambiguous'],
        follow_up_needed: true,
      };
    }

    cage.setActiveClub(parsed.club_id, 'voice', 'high');
    track('club_switched', {
      club_id: parsed.club_id,
      club_type: parsed.club_type,
      source: 'voice',
    });

    return {
      success: true,
      voice_response: `Got it, ${clubLabel(parsed.club_id)}.`,
      side_effects: [`cage:club_switched:${parsed.club_id}`],
      follow_up_needed: false,
    };
  },
};

export const clubQueryHandler: IntentHandler = {
  intent_type: 'club_query',

  parameter_schema: {},

  examples: [
    'what club am I on',
    "what's my current club",
    'which club am I hitting',
    'what am I on',
    'what club',
  ],

  async execute(): Promise<IntentResult> {
    const cage = useCageStore.getState();
    if (!cage.activeSession) {
      return noActiveSession();
    }

    const club = cage.activeSession.currentClub ?? cage.activeSession.club;
    return {
      success: true,
      voice_response: `You're on ${clubLabel(club)}.`,
      side_effects: ['cage:club_queried'],
      follow_up_needed: false,
    };
  },
};

export const clubMenuHandler: IntentHandler = {
  intent_type: 'club_menu',

  parameter_schema: {},

  examples: [
    'show clubs',
    'club menu',
    'switch club',
    'change club',
    'open the club picker',
  ],

  async execute(): Promise<IntentResult> {
    const cage = useCageStore.getState();
    if (!cage.activeSession) {
      return noActiveSession();
    }

    cage.setClubMenuOpen(true);
    return {
      success: true,
      voice_response: 'Pick one.',
      side_effects: ['cage:club_menu_open'],
      follow_up_needed: false,
    };
  },
};
