import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { useGhostStore } from '../../store/ghostStore';

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

    if (!round.isRoundActive && (topic === 'score' || topic === 'hole' || topic === 'ghost_match')) {
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

      case 'weather': {
        return {
          success: true,
          voice_response: 'I don\'t have live weather yet — check the hole view for wind.',
          side_effects: ['query:weather:unavailable'],
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
