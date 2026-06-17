import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';

function parsePutts(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : null;
  }
  if (typeof raw === 'string') {
    const MAP: Record<string, number> = {
      zero: 0, none: 0, 'chip-in': 0, chipin: 0,
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    };
    const lower = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (MAP[lower] !== undefined) return MAP[lower];
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 0 && n <= 6) return n;
  }
  return null;
}

export const logPuttsHandler: IntentHandler = {
  intent_type: 'log_putts',

  parameter_schema: {
    num_putts: 'integer 0..6',
    hole_number: 'optional integer 1..18',
  },

  examples: [
    '2 putts',
    'I one-putted',
    'three putts',
    'no putts chip-in',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "Start a round first.",
        side_effects: ['logPutts:no_active_round'],
        follow_up_needed: false,
      };
    }

    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    const hole = (typeof params.hole_number === 'number' && params.hole_number >= 1 && params.hole_number <= 18)
      ? params.hole_number
      : round.currentHole;

    const putts = parsePutts(params.num_putts) ?? parsePutts(intent.raw_text);
    if (putts === null) {
      return {
        success: false,
        voice_response: "How many putts? Tell me a number.",
        side_effects: ['logPutts:unparsable'],
        follow_up_needed: true,
      };
    }

    round.logPutts(hole, putts);
    track('log_putts_voice', { hole, putts });

    const reply = putts === 0
      ? 'Chip-in — logged.'
      : putts === 1
        ? 'One putt — logged.'
        : `${putts} putts — logged.`;

    return {
      success: true,
      voice_response: reply,
      side_effects: [`logPutts:hole_${hole}:putts_${putts}`],
      follow_up_needed: false,
    };
  },
};
