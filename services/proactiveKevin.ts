export type ProactiveTriggerType =
  | 'round_start_handoff'
  | 'miss_streak_3'
  | 'good_streak_3'
  | 'rough_streak_3'
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
  /** Sim-report gap 5 — Trust Spectrum dampens proactive cadence at L2
   *  Companion (player wants Kevin available, not chatty). L1 is silent
   *  by separate gating (Quiet/Cockpit, minimal surface). L3 Active uses
   *  the standard cadence. Optional; call sites pass when known and we
   *  default to L3 standard. */
  trustLevel?: 1 | 2 | 3;
}

const lastFiredAt: Partial<Record<ProactiveTriggerType, number>> = {};
const GLOBAL_DEBOUNCE_MS = 2 * 60 * 1000;
// Sim-report gap 5 — L2 Companion debounce is 2× the standard so the
// player gets meaningfully fewer mid-round bumps. Devon's complaint:
// triggers landing right before his shot.
const L2_DEBOUNCE_MS = 4 * 60 * 1000;
let lastAnyFiredAt = 0;

export function shouldFireProactive(ctx: TriggerContext): ProactiveTrigger | null {
  const now = Date.now();
  const debounce = ctx.trustLevel === 2 ? L2_DEBOUNCE_MS : GLOBAL_DEBOUNCE_MS;
  if (now - lastAnyFiredAt < debounce) return null;

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
      // Phase V.7+ — ghost-aware reset copy. When playing against past-you
      // and behind, name the ghost so Kevin proves he's tracking both arcs
      // at once. Generic line otherwise.
      const ghostBehind = ctx.ghostDelta != null && ctx.ghostDelta < 0;
      return {
        id: 'miss_streak_3',
        message: ghostBehind
          ? `Past ${name} got through this stretch. So can current ${name}. One shot.`
          : 'Forget the last three. One shot at a time — that\'s the whole job right now.',
        is_proactive: true,
      };
    }
  }

  // rough_streak_3 — three consecutive doubles or worse. Cooldown halved
  // from 8min to 4min — when score variance is collapsing fast, single-fire
  // means Kevin goes silent the very next hole if it's also a triple. The
  // worst competitive moment shouldn't be the silent one.
  if (ctx.recentScores.length >= 3 && ctx.recentScores.slice(-3).every(v => v >= 2)) {
    const cooldown = 4 * 60 * 1000;
    if (!lastFiredAt.rough_streak_3 || now - (lastFiredAt.rough_streak_3 ?? 0) > cooldown) {
      // Phase V.7+ — ghost-aware harder reset.
      const ghostBehind = ctx.ghostDelta != null && ctx.ghostDelta < 0;
      return {
        id: 'rough_streak_3',
        message: ghostBehind
          ? 'Past you saved holes worse than this. Reset. Just this one.'
          : 'Reset. Just this hole. Nothing before it counts.',
        is_proactive: true,
      };
    }
  }

  // ghost_lead_swing — ghost is ahead by 1 or more (was exact ===1 which
  // went silent at the very moment Tim needed it most: when past-self had
  // pulled ahead by 2 or 3 and the gap was actually closeable).
  if (ctx.ghostDelta != null && ctx.ghostDelta >= 1 && ctx.holesPlayed >= 3) {
    const cooldown = 10 * 60 * 1000;
    if (!lastFiredAt.ghost_lead_swing || now - (lastFiredAt.ghost_lead_swing ?? 0) > cooldown) {
      const delta = ctx.ghostDelta;
      const lead = delta === 1 ? 'one' : delta === 2 ? 'two' : `${delta}`;
      return {
        id: 'ghost_lead_swing',
        message: `Past you is up by ${lead}. This is the moment — swing through it.`,
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

  // 2026-08-07 (Tim — "hole rundown is PULL not pushed"; verifier caught this as still live). The
  // hole_transition_pattern_aware auto-push (a "favor the {side} off the tee" note on every hole entry) was
  // supposed to be removed in the PULL-not-push change but survived here — a player past the cooldown with a
  // dominantMiss still got it auto-spoken leaving a hole. Removed: the on-course miss guidance now surfaces
  // on DEMAND through the shot read (SmartFinder/localStatus favor the safe side), not as an unsolicited push.
  return null;
}

/**
 * 2026-08-21 — ONE CLOCK FOR EVERY UNPROMPTED WORD.
 *
 * shouldFireProactive has always enforced a global debounce, so the score-streak and
 * hole-transition triggers space themselves. But two OTHER proactive voices — the GPS
 * stop-detection read and the tee-box auto-brief — never consulted it. They had their own
 * once-per-hole gates and were individually well behaved, which is exactly why this was invisible:
 * every trigger was correct by its own rule, and nothing owned the sum of them.
 *
 * The player does not experience four triggers. They experience a caddie that talks. Interruption
 * has a cost, that cost is shared across every source, and it belongs on one clock.
 *
 * These two functions are also the substrate the intervention threshold needs: the moment there is a
 * single place that decides whether to speak, "was this worth interrupting for?" becomes a question
 * with somewhere to live.
 */
export function mayInterject(trustLevel?: number): boolean {
  const debounce = trustLevel === 2 ? L2_DEBOUNCE_MS : GLOBAL_DEBOUNCE_MS;
  return Date.now() - lastAnyFiredAt >= debounce;
}

/** Record an unprompted utterance that did NOT come from a named trigger (tee brief, stop read). */
export function noteInterjection(): void {
  lastAnyFiredAt = Date.now();
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
