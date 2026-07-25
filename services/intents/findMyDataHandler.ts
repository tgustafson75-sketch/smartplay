import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { universalFind } from '../universalFind';

/**
 * 2026-07-25 (Tim — the app's whole point: ask the caddie to FIND/OPEN anything of YOURS). The precheck
 * routes "pull up my last scorecard / find my round at Mines / show my driver swings" here. We search
 * the user's own rounds + saved swings (services/universalFind), open the best match, and say what it is.
 * Offline + deterministic — local stores + local navigation, no network. (Courses are handled by
 * open_course; scorecard-photo ingest is a separate flow.)
 */
export const findMyDataHandler: IntentHandler = {
  intent_type: 'find_my_data',

  parameter_schema: {
    query: "what to find in the user's own data — a past round/scorecard/recap or a saved swing",
  },

  examples: [
    'pull up my last scorecard',
    'find my round at Mines',
    'show my driver swings',
    'open my last recap',
    'pull up my swings from Tuesday',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const query = String(intent.parameters.query ?? intent.raw_text ?? '').trim();
    const results = universalFind(query, 6);
    if (results.length === 0) {
      return {
        success: false,
        voice_response: "I couldn't find that in your rounds or swings yet.",
        side_effects: ['find_my_data:none'],
        follow_up_needed: false,
      };
    }
    const top = results[0];
    let routerMod: typeof import('expo-router') | null = null;
    try { routerMod = await import('expo-router'); } catch { /* unavailable in test envs */ }
    try { routerMod?.router.push(top.route as never); } catch { /* no-op */ }

    const noun = top.kind === 'round' ? 'round' : 'swing';
    const more = results.length > 1 ? ` I found ${results.length} — opening the closest.` : '';
    return {
      success: true,
      voice_response: `Here's your ${noun}: ${top.label}.${more}`,
      side_effects: [`find_my_data:${top.kind}:${top.id}`],
      follow_up_needed: false,
    };
  },
};
