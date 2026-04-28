export type ProactiveTriggerType =
  | 'round_start_handoff'
  | 'miss_streak_3'
  | 'good_streak_3'
  | 'rough_streak_3'
  | 'hole_transition_pattern_aware'
  | 'ghost_lead_swing'
  | 'front_9_summary';

export interface ProactiveTrigger {
  id: ProactiveTriggerType;
  message: string;
  is_proactive: true;
}

interface TriggerContext {
  holesPlayed: number;
  currentHole: number;
  recentScores: number[];   // last 3 hole scores relative to par (e.g. [-1, 0, 1])
  ghostDelta: number | null; // positive = ahead, negative = behind
  dominantMiss: string | null;
  firstName: string;
  mode: string;
}

const lastFiredAt: Partial<Record<ProactiveTriggerType, number>> = {};
const GLOBAL_DEBOUNCE_MS = 2 * 60 * 1000;
let lastAnyFiredAt = 0;

export function shouldFireProactive(ctx: TriggerContext): ProactiveTrigger | null {
  const now = Date.now();
  if (now - lastAnyFiredAt < GLOBAL_DEBOUNCE_MS) return null;

  const name = ctx.firstName || 'you';

  // round_start_handoff — fire once when hole 1 is entered
  if (ctx.currentHole === 1 && ctx.holesPlayed === 0) {
    if (!lastFiredAt.round_start_handoff) {
      return {
        id: 'round_start_handoff',
        message: `Alright${ctx.firstName ? ' ' + ctx.firstName : ''}. Course is yours. Let's go.`,
        is_proactive: true,
      };
    }
  }

  // good_streak_3 — three straight holes at or under par
  if (ctx.recentScores.length >= 3 && ctx.recentScores.slice(-3).every(v => v <= 0)) {
    const cooldown = 6 * 60 * 1000;
    if (!lastFiredAt.good_streak_3 || now - (lastFiredAt.good_streak_3 ?? 0) > cooldown) {
      return {
        id: 'good_streak_3',
        message: 'Three straight at or under. Trust what you\'re doing right now.',
        is_proactive: true,
      };
    }
  }

  // miss_streak_3 — three straight bogeys or worse
  if (ctx.recentScores.length >= 3 && ctx.recentScores.slice(-3).every(v => v >= 1)) {
    const cooldown = 8 * 60 * 1000;
    if (!lastFiredAt.miss_streak_3 || now - (lastFiredAt.miss_streak_3 ?? 0) > cooldown) {
      return {
        id: 'miss_streak_3',
        message: 'Forget the last three. One shot at a time — that\'s the whole job right now.',
        is_proactive: true,
      };
    }
  }

  // rough_streak_3 — three consecutive doubles or worse
  if (ctx.recentScores.length >= 3 && ctx.recentScores.slice(-3).every(v => v >= 2)) {
    const cooldown = 8 * 60 * 1000;
    if (!lastFiredAt.rough_streak_3 || now - (lastFiredAt.rough_streak_3 ?? 0) > cooldown) {
      return {
        id: 'rough_streak_3',
        message: 'Reset. Just this hole. Nothing before it counts.',
        is_proactive: true,
      };
    }
  }

  // ghost_lead_swing — ghost is ahead by exactly 1
  if (ctx.ghostDelta === 1 && ctx.holesPlayed >= 3) {
    const cooldown = 10 * 60 * 1000;
    if (!lastFiredAt.ghost_lead_swing || now - (lastFiredAt.ghost_lead_swing ?? 0) > cooldown) {
      return {
        id: 'ghost_lead_swing',
        message: 'Past you is up by one. This is the moment — swing through it.',
        is_proactive: true,
      };
    }
  }

  // front_9_summary — exactly after hole 9
  if (ctx.currentHole === 10 && ctx.holesPlayed === 9) {
    if (!lastFiredAt.front_9_summary) {
      const modeNote =
        ctx.mode === 'break_90' ? 'Back nine — stay smart.' :
        ctx.mode === 'break_80' ? 'Back nine. Birdies are there.' :
        ctx.mode === 'break_100' ? 'Back nine. Bogey and move.' :
        'Back nine. Let\'s build on it.';
      return {
        id: 'front_9_summary',
        message: `Front nine done. ${modeNote}`,
        is_proactive: true,
      };
    }
  }

  // hole_transition_pattern_aware — pattern miss note on new hole entry (holes 3+)
  if (ctx.currentHole >= 3 && ctx.dominantMiss && ctx.holesPlayed >= 2) {
    const cooldown = 12 * 60 * 1000;
    if (!lastFiredAt.hole_transition_pattern_aware || now - (lastFiredAt.hole_transition_pattern_aware ?? 0) > cooldown) {
      const missDir = ctx.dominantMiss === 'right' ? 'left side' : ctx.dominantMiss === 'left' ? 'right side' : 'center';
      return {
        id: 'hole_transition_pattern_aware',
        message: `Favor the ${missDir} off the tee — plenty of room to work with.`,
        is_proactive: true,
      };
    }
  }

  return null;
}

export function markProactiveFired(triggerId: ProactiveTriggerType): void {
  lastFiredAt[triggerId] = Date.now();
  lastAnyFiredAt = Date.now();
}

export function resetProactiveState(): void {
  (Object.keys(lastFiredAt) as ProactiveTriggerType[]).forEach(k => {
    delete lastFiredAt[k];
  });
  lastAnyFiredAt = 0;
}
