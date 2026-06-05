import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';

function parseHole(raw: unknown, fallbackText: string): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 18) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\b(1[0-8]|[1-9])\b/);
    if (m) return parseInt(m[1], 10);
  }
  const m = fallbackText.match(/\bhole\s*(1[0-8]|[1-9])\b/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function parseNote(raw: unknown, fallbackText: string): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const idx = fallbackText.toLowerCase().indexOf('hole');
  if (idx < 0) return '';
  const tail = fallbackText.slice(idx).replace(/\bhole\s*(1[0-8]|[1-9])\b[:\-\s,]*/i, '').trim();
  return tail;
}

export const setHoleNoteHandler: IntentHandler = {
  intent_type: 'set_hole_note',

  parameter_schema: {
    hole: 'integer 1..18',
    note: 'short free-text context note for this hole',
  },

  examples: [
    "I'm on hole 4, tight fairway, wind left to right",
    'hole 7 dogleg left with trouble right',
    "we're on hole 12, downhill lie into wind",
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    const hole = parseHole(params.hole ?? params.hole_number, intent.raw_text);
    if (hole == null) {
      return {
        success: false,
        voice_response: 'Which hole should I tag?',
        side_effects: ['set_hole_note:hole_missing'],
        follow_up_needed: true,
      };
    }

    const note = parseNote(params.note ?? params.description, intent.raw_text);
    if (!note) {
      return {
        success: false,
        voice_response: `What should I remember on ${hole}?`,
        side_effects: ['set_hole_note:note_missing'],
        follow_up_needed: true,
      };
    }

    const round = useRoundStore.getState();
    round.setHoleNote(hole, note);
    if (round.isRoundActive && round.currentHole !== hole) {
      round.setCurrentHole(hole);
    }

    return {
      success: true,
      voice_response: `Got it. I'll keep that in mind on ${hole}.`,
      side_effects: ['set_hole_note:saved', `hole:${hole}`],
      follow_up_needed: false,
    };
  },
};
