import { proactiveDebounceMs } from './trustLevelService';
import type { TrustLevel } from '../store/trustLevelStore';

export type ProactiveTriggerType =
  | 'round_start_handoff'
  | 'miss_streak_3'
  | 'good_streak_3'
  | 'notable_hole'
  | 'rough_streak_3'
  | 'ghost_lead_swing'
  | 'front_9_summary';

export interface ProactiveTrigger {
  id: ProactiveTriggerType;
  /** Offline fallback ONLY. The caddie composes the real line from `directive`. */
  message: string;
  /**
   * 2026-09-01 (Tim, on the line that follows the on-course brief: "then a statement after like
   * I'm here for whatever you want to work on" — and his call, "if everything is coded as all smart
   * brain calls that's the consistent play").
   *
   * This file owns WHEN the caddie speaks unprompted. It should never have owned WHAT it says: a
   * fixed sentence at a recurring moment is heard twice by the second round.
   */
  directive: string;
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
  /**
   * 2026-09-10 (Tim, Hemet: "after a fucking par, when I don't get many fucking pars, there's no
   * fucking long term actual caddie type memory going on here") — THE HOLE HE JUST FINISHED.
   *
   * Every trigger above reasons about the last THREE holes relative to par, so a single good hole
   * could not be seen by any of them. `notable_hole` needs the one hole, and it needs the player's
   * own history on it — a par is only worth mentioning if a par is rare FOR THEM.
   *
   * Null when the hole is unknown or has no score yet; `avgScore`/`played` are null until the CNS
   * has seen the hole enough times to speak from (caddieMemoryRetrieval.MIN_HOLE_PLAYS_FOR_GUIDANCE).
   */
  lastHole?: {
    hole: number;
    strokes: number;
    par: number | null;
    /** The player's own scoring average on THIS hole at THIS course, from the CNS. */
    avgScore: number | null;
    /** How many times the CNS has seen them play it. */
    played: number | null;
    /** Mean over-par across the holes scored so far this round — "is a par rare today". */
    roundAvgOffset: number | null;
  } | null;
  /** Sim-report gap 5 — Trust Spectrum dampens proactive cadence at L2
   *  Companion (player wants Kevin available, not chatty). L1 is silent
   *  by separate gating (Quiet/Cockpit, minimal surface). L3 Active uses
   *  the standard cadence. Optional; call sites pass when known and we
   *  default to L3 standard. */
  trustLevel?: 1 | 2 | 3;
}

const lastFiredAt: Partial<Record<ProactiveTriggerType, number>> = {};
let lastAnyFiredAt = 0;

/**
 * How many recorded plays before the caddie will QUOTE a per-hole scoring average back at the
 * player. Deliberately stricter than caddieMemoryRetrieval.MIN_HOLE_PLAYS_FOR_GUIDANCE (2): that
 * one gates soft guidance ("you usually tee 3 wood"), this one gates a NUMBER said out loud as
 * fact. "You average 5.5 here" off two rounds is a coin toss wearing a decimal point.
 * [[illustration-data-points]]
 */
const MIN_HOLE_PLAYS_FOR_NOTABLE = 3;

/*
 * 2026-08-30 — GLOBAL_DEBOUNCE_MS and L2_DEBOUNCE_MS moved to trustLevelService.proactiveDebounceMs.
 *
 * They encoded a POLICY while looking like a constant: `trustLevel === 2 ? L2 : GLOBAL` gave L1 the
 * same two minutes as L3, so "Quiet · tap or type to talk" interrupted the player exactly as often
 * as voice-first mode, and twice as often as Companion. Sim-report gap 5 slowed L2 down and nobody
 * noticed L1 was never considered at all — the ternary has no branch for it.
 *
 * The interruption cost is shared across every trigger, so the interval belongs to the trust level.
 * This file still owns the CLOCK; it no longer owns the policy. [[two-owners-is-the-root-cause]]
 */

export function shouldFireProactive(ctx: TriggerContext): ProactiveTrigger | null {
  const now = Date.now();
  const debounce = proactiveDebounceMs(ctx.trustLevel);
  // null means "never speak unprompted", not "no delay" — the case the old ternary could not express.
  if (debounce === null) return null;
  if (now - lastAnyFiredAt < debounce) return null;

  const name = ctx.firstName || 'you';

  // round_start_handoff — fire once when hole 1 is entered
  if (ctx.currentHole === 1 && ctx.holesPlayed === 0) {
    if (!lastFiredAt.round_start_handoff) {
      return {
        id: 'round_start_handoff',
        directive: `The round is starting on hole 1${ctx.firstName ? ` and the player is ${ctx.firstName}` : ''}. Hand them the round in one short sentence — you are their caddie and you are ready. No question, no menu of options, no offer to help with anything.`,
        message: `Alright${ctx.firstName ? ' ' + ctx.firstName : ''}. Course is yours. Let's go.`,
        is_proactive: true,
      };
    }
  }

  /**
   * notable_hole — ONE hole that was good FOR THIS PLAYER.
   *
   * 2026-09-10 (Tim, Hemet: "after a fucking par, when I don't get many fucking pars, there's no
   * fucking long term actual caddie type memory going on here").
   *
   * Before this, every score trigger read the last THREE holes, and the only positive one required
   * three straight at or under par. A bogey golfer never strings three of those together, so the
   * proactive voice was a STRUCTURAL PESSIMIST: miss_streak_3 and rough_streak_3 fired all round,
   * good_streak_3 was unreachable, and a single par — the best thing that had happened all day —
   * produced silence. Tim's par landed right after miss_streak_3 had said "forget the last three",
   * which is why the caddie read as "we're still going, move on".
   *
   * "Notable" is measured against the player, never against par in the abstract:
   *   1. the CNS's own scoring average on THIS hole at THIS course (a full stroke better than the
   *      way they usually play it), which is the long-term memory he is asking for; or
   *   2. failing that, par-or-better on a day whose average hole is over par — a par IS the story
   *      when the round is running at bogey.
   *
   * A player who is level par all day never trips clause 2, so this stays quiet for the golfer for
   * whom a par is just Tuesday. The line itself comes from the brain via `directive` — it carries
   * the memory fact so the caddie can say something only a caddie who was there could say.
   */
  const lh = ctx.lastHole;
  if (lh && lh.par != null) {
    const offset = lh.strokes - lh.par;
    const beatsOwnAverage =
      lh.avgScore != null && lh.played != null && lh.played >= MIN_HOLE_PLAYS_FOR_NOTABLE &&
      lh.strokes <= lh.avgScore - 1;
    const parIsRareToday =
      offset <= 0 && lh.roundAvgOffset != null && lh.roundAvgOffset >= 0.75;
    if (beatsOwnAverage || parIsRareToday) {
      const cooldown = 5 * 60 * 1000;
      if (!lastFiredAt.notable_hole || now - (lastFiredAt.notable_hole ?? 0) > cooldown) {
        const label = offset === 0 ? 'par' : offset === -1 ? 'birdie' : offset === -2 ? 'eagle' : `${lh.strokes}`;
        const memoryFact = beatsOwnAverage
          ? `They average ${lh.avgScore!.toFixed(1)} on hole ${lh.hole} across ${lh.played} plays and just made ${lh.strokes}.`
          : `They just made ${label} on hole ${lh.hole} on a day that has otherwise been over par.`;
        return {
          id: 'notable_hole',
          directive:
            `${memoryFact} Acknowledge it in ONE short line, like a caddie who has walked this hole ` +
            `with them before — name what they actually did. Do not congratulate them generically, ` +
            `do not coach, do not mention the holes that went badly, and do not ask a question.`,
          message: beatsOwnAverage
            ? `That's a ${label} on a hole you usually play in ${lh.avgScore!.toFixed(1)}. That one counts.`
            : `${label.charAt(0).toUpperCase() + label.slice(1)} on ${lh.hole}. That's the one to remember today.`,
          is_proactive: true,
        };
      }
    }
  }

  // good_streak_3 — three straight holes at or under par
  if (ctx.recentScores.length >= 3 && ctx.recentScores.slice(-3).every(v => v <= 0)) {
    const cooldown = 6 * 60 * 1000;
    if (!lastFiredAt.good_streak_3 || now - (lastFiredAt.good_streak_3 ?? 0) > cooldown) {
      return {
        id: 'good_streak_3',
        directive: 'The player has just gone three straight holes at or under par. Say one short thing that keeps them in it without jinxing it. No question.',
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
        directive: `The player has missed three greens in a row${ghostBehind ? ' and is behind their own past round' : ''}. One short, steadying line — a caddie who has seen this before. No question.`,
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
        directive: `The player has been in trouble three holes running${ghostBehind ? ' and is behind their past round' : ''}. One short line to settle them and simplify the next shot. No question.`,
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
        directive: `The player's past-self round is ahead by ${lead}. One short line: this is the moment to go get it. No question.`,
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
        directive: `The front nine is done. ${modeNote} Sum it up in one short sentence and point them at the back nine. No question.`,
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
  const debounce = proactiveDebounceMs(trustLevel as TrustLevel | undefined);
  if (debounce === null) return false;
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
