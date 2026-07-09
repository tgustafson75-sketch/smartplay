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
import { useRoundStore } from '../../store/roundStore';
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

// 2026-07-08 (Tim) — pull a stated yardage out of a club utterance, e.g. "5 hybrid from
// 215", "seven iron, 175 yards", "from 210 to the pin". Prefers an explicit "from N" /
// "N yards", then any bare 2-3 digit number in a plausible golf range. Returns null when
// there's no credible number so we never invent a distance.
export function parseStatedYardage(text: string): number | null {
  // 2026-07-08 (audit) — ONLY accept an EXPLICIT distance phrase ("from 215", "150 yards").
  // A bare number in a club utterance is dangerously ambiguous: "sand wedge, 56 degrees" (loft),
  // "7 iron into 22 mph wind" (wind), a hole number — all would be mis-captured as a yardage, and
  // setUserStatedYardage overrides live GPS at HIGH confidence for 5 minutes (yardageResolver
  // Tier 3). So no bare-number fallback: if they didn't say "from"/"yards", we don't guess.
  const t = text.toLowerCase();
  const pick = (n: number) => (n >= 20 && n <= 400 ? n : null);
  const from = t.match(/\bfrom\s+(\d{2,3})\b/);
  if (from) return pick(Number(from[1]));
  const yds = t.match(/\b(\d{2,3})\s*(?:yards?|yds?)\b/);
  if (yds) return pick(Number(yds[1]));
  return null;
}

// 2026-07-08 (Tim — "it asks which WEDGE when I said a hybrid") — when we couldn't resolve
// the club, don't blanket-assume a wedge. If the player clearly named an iron / hybrid /
// wood but we couldn't pin the number, ask about THAT family; only ask the wedge menu when
// they actually said "wedge"; otherwise a neutral prompt.
function clubClarifyPrompt(phrase: string): string {
  const p = phrase.toLowerCase();
  if (/\bwedge\b/.test(p)) return 'Which one — pitching, gap, sand, or lob wedge?';
  if (/\bhybrid|rescue\b/.test(p)) return 'Which hybrid — 2, 3, 4, or 5?';
  if (/\bwood\b/.test(p)) return 'Which wood — 3, 5, or 7?';
  if (/\biron\b/.test(p)) return 'Which iron?';
  return 'Which club?';
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

    const round = useRoundStore.getState();
    if (round.isRoundActive) {
      if (!parsed) {
        track('club_voice_ambiguous', { phrase: phrase.slice(0, 60) });
        return {
          success: false,
          voice_response: clubClarifyPrompt(phrase),
          side_effects: ['round:club_ambiguous'],
          follow_up_needed: true,
        };
      }
      round.setClub(parsed.club_id);
      // 2026-07-08 (Tim — "I say I'm using a 5 hybrid from 215 and it asks which wedge")
      // — capture a stated yardage in the SAME utterance ("... from 215") so the caddie
      // registers the whole plan (club AND distance), not just the club. setUserStatedYardage
      // is the same call the brain's plan_shot uses (conversationalToolDispatch).
      const statedYds = parseStatedYardage(String(intent.raw_text ?? phrase));
      if (statedYds != null) round.setUserStatedYardage(statedYds, 'user');
      track('club_switched', { club_id: parsed.club_id, club_type: parsed.club_type, source: 'voice' });
      return {
        success: true,
        voice_response: statedYds != null
          ? `Got it — ${clubLabel(parsed.club_id)} from ${statedYds}.`
          : `Got it, ${clubLabel(parsed.club_id)}.`,
        side_effects: [`round:club_switched:${parsed.club_id}`],
        follow_up_needed: false,
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
