import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore, roundFirstHole, roundLastHole } from '../../store/roundStore';

const HOME_PATH = '/(tabs)/caddie';

export const navigateHandler: IntentHandler = {
  intent_type: 'navigate',

  parameter_schema: {
    direction: 'one of: back, home, close, exit, next_hole, previous_hole, main_menu',
  },

  examples: [
    'go back',
    'home',
    'main menu',
    'next hole',
    'previous hole',
    'close this',
    'close smart motion',
    'exit',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const direction = String(intent.parameters.direction ?? '').toLowerCase();

    let routerMod: typeof import('expo-router') | null = null;
    try { routerMod = await import('expo-router'); } catch { /* unavailable in test envs */ }

    switch (direction) {
      case 'back': {
        try { routerMod?.router.back(); } catch { /* no-op */ }
        return ok('Going back.', ['navigate:back']);
      }
      case 'home':
      case 'main_menu': {
        try { routerMod?.router.replace(HOME_PATH as never); } catch { /* no-op */ }
        return ok('Heading home.', ['navigate:home']);
      }
      case 'close':
      case 'exit': {
        // 2026-06-16 (Tim — "close Smart Motion" → white screen) — closing a TOOL
        // goes HOME to the caddie (the universal hub), deterministically. The old
        // router.back() white-screened when the tool wasn't pushed over a resolvable
        // stack entry (voice-opened tools often aren't). Home is always valid and
        // matches the model "the caddie screen is the home for everything." Replace
        // (not push) so we don't stack a home on top of the tool.
        try { routerMod?.router.replace(HOME_PATH as never); } catch { /* no-op */ }
        return ok(null, ['navigate:close']);
      }
      case 'next_hole': {
        const round = useRoundStore.getState();
        if (!round.isRoundActive) return notInRound();
        // 2026-07-24 (full-app audit) — cap at the 9-hole-aware total, not the physical courseHoles.length.
        // 2026-08-08 (2-week audit O4 — back nine): `nineHoleMode ? 9` predated the back-nine range fix, so
        // from hole 12 "next hole" computed min(13,9)=9, ANNOUNCED "Hole 9." and setCurrentHole clamped it
        // back to 10 — dragged the round backward while naming a hole it never went to. Use the round's
        // REAL range (roundFirstHole/roundLastHole: back nine = 10..18, front nine = 1..9, full = 1..N).
        const maxHole = roundLastHole(round);
        const next = Math.min(round.currentHole + 1, maxHole);
        if (next === round.currentHole) {
          return ok(`You're already on the last hole.`, ['navigate:next_hole:noop']);
        }
        round.setCurrentHole(next);
        return ok(`Hole ${next}.`, ['navigate:next_hole:' + next]);
      }
      case 'previous_hole': {
        const round = useRoundStore.getState();
        if (!round.isRoundActive) return notInRound();
        // 2026-08-08 (O4) — floor at the round's FIRST hole (10 on a back nine), not a hardcoded 1.
        const prev = Math.max(round.currentHole - 1, roundFirstHole(round));
        if (prev === round.currentHole) {
          return ok(`Already on hole ${prev}.`, ['navigate:previous_hole:noop']);
        }
        round.setCurrentHole(prev);
        return ok(`Hole ${prev}.`, ['navigate:previous_hole:' + prev]);
      }
      default:
        return {
          success: false,
          voice_response: 'Where to — back, home, next hole?',
          side_effects: ['navigate:unknown:' + direction],
          follow_up_needed: true,
        };
    }
  },
};

function ok(voice: string | null, side_effects: string[]): IntentResult {
  return { success: true, voice_response: voice, side_effects, follow_up_needed: false };
}

function notInRound(): IntentResult {
  return ok('Not in a round yet — start one first.', ['navigate:not_in_round']);
}
