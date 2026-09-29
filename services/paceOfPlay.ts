/**
 * 2026-09-29 (Tim: "in a live round, need an option to show pace of play, which could show how user
 * plays in these conditions") — PACE OF PLAY, ONE OWNER.
 *
 * Nothing measured pace before: the round kept its start time and each shot's timestamp, but no hole
 * times, and nothing computed elapsed / per-hole / projected finish. This is the one place that does.
 * The round bar's optional pace line and the caddie's `pace` context both read it, so what the player
 * sees and what the caddie says cannot disagree. [[two-owners-is-the-root-cause]]
 *
 * Pure: time and history are passed in, so it can be table-tested.
 */

/** A brisk-but-normal round: 4 hours 15 for 18. Per hole it is ~14.2 minutes. */
export const PACE_BENCHMARK_MIN_PER_HOLE = 255 / 18;
/** Minutes per hole beyond the benchmark before a round counts as SLOW for the history comparison. */
export const SLOW_MARGIN_MIN_PER_HOLE = 1.5;
/** Rounds needed on each side before "how you score when it's slow" says anything. */
export const PACE_HISTORY_MIN_ROUNDS = 2;

export interface LivePace {
  elapsedMin: number;
  holesCompleted: number;
  /** null until a hole has been completed — one hole in, a per-hole rate is noise. */
  minPerHole: number | null;
  /** Positive = behind a 4:15 pace, in minutes, at this point in the round. */
  vsBenchmarkMin: number | null;
  /** Epoch ms of the projected finish, or null until a rate exists. */
  projectedFinishAt: number | null;
  holesInRound: number;
}

/**
 * Live pace for the round in progress.
 *
 * `holeStartedAt` is when the player first arrived on each hole (roundStore stamps it). A hole is
 * COMPLETED once the player has moved on from it, so completed = holes in the round before the current
 * one. The per-hole rate uses the time to reach the current hole's start — it does not count the hole
 * in progress, which would read every hole as fast right after the tee shot.
 */
export function computeLivePace(input: {
  roundStartTime: number | null;
  holeStartedAt: Record<number, number>;
  currentHole: number;
  firstHole: number;
  lastHole: number;
  now: number;
}): LivePace | null {
  const { roundStartTime, holeStartedAt, currentHole, firstHole, lastHole, now } = input;
  if (!roundStartTime || now < roundStartTime) return null;
  const holesInRound = Math.max(1, lastHole - firstHole + 1);
  const elapsedMin = (now - roundStartTime) / 60_000;
  const holesCompleted = Math.max(0, Math.min(holesInRound, currentHole - firstHole));
  const reachedCurrentAt = holeStartedAt[currentHole] ?? null;
  if (holesCompleted < 1 || reachedCurrentAt == null || reachedCurrentAt < roundStartTime) {
    return { elapsedMin, holesCompleted, minPerHole: null, vsBenchmarkMin: null, projectedFinishAt: null, holesInRound };
  }
  const minPerHole = (reachedCurrentAt - roundStartTime) / 60_000 / holesCompleted;
  const vsBenchmarkMin = (minPerHole - PACE_BENCHMARK_MIN_PER_HOLE) * holesCompleted;
  const holesLeft = holesInRound - holesCompleted;
  const projectedFinishAt = reachedCurrentAt + holesLeft * minPerHole * 60_000;
  return { elapsedMin, holesCompleted, minPerHole, vsBenchmarkMin, projectedFinishAt, holesInRound };
}

/** "2:41" */
export function formatElapsed(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "4:22" / "12:05" — local wall-clock time, 12-hour, no Intl dependency. */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Compact line for the round bar: "2:41 · 14.8 min/hole · done ~4:22" (clock time of the finish). */
export function paceLine(p: LivePace, fmtClock: (epochMs: number) => string): string {
  const parts = [formatElapsed(p.elapsedMin)];
  if (p.minPerHole != null) parts.push(`${p.minPerHole.toFixed(1)} min/hole`);
  if (p.projectedFinishAt != null) parts.push(`done ~${fmtClock(p.projectedFinishAt)}`);
  return parts.join(' · ');
}

export interface PastRound {
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  scoreVsPar: number | null;
}

export interface PaceHistory {
  slowRounds: number;
  normalRounds: number;
  /** Average score vs par PER HOLE on slow rounds, and on the rest — null below the floor. */
  slowVsParPerHole: number | null;
  normalVsParPerHole: number | null;
  /** When there is not enough to compare, what is known and what would make it real. */
  note: string;
}

/**
 * How this player scores when the pace is slow vs normal, from their own finished rounds. Below the
 * floor it SAYS what it has and what it needs rather than going quiet ([[silence-is-not-an-answer]]).
 */
export function paceHistory(rounds: readonly PastRound[]): PaceHistory {
  const usable = rounds.filter((r) =>
    r.holesPlayed > 0 && r.scoreVsPar != null && r.endedAt > r.startedAt
    // A round left open overnight is not a pace reading.
    && (r.endedAt - r.startedAt) / 60_000 / r.holesPlayed < 45);
  const perHole = (r: PastRound) => (r.endedAt - r.startedAt) / 60_000 / r.holesPlayed;
  const slow = usable.filter((r) => perHole(r) > PACE_BENCHMARK_MIN_PER_HOLE + SLOW_MARGIN_MIN_PER_HOLE);
  const normal = usable.filter((r) => !slow.includes(r));
  const avg = (rs: PastRound[]) => rs.reduce((a, r) => a + (r.scoreVsPar as number) / r.holesPlayed, 0) / rs.length;
  const enough = slow.length >= PACE_HISTORY_MIN_ROUNDS && normal.length >= PACE_HISTORY_MIN_ROUNDS;
  return {
    slowRounds: slow.length,
    normalRounds: normal.length,
    slowVsParPerHole: enough ? avg(slow) : null,
    normalVsParPerHole: enough ? avg(normal) : null,
    note: enough
      ? ''
      : `${usable.length} timed round${usable.length === 1 ? '' : 's'} so far (${slow.length} slow, ${normal.length} at a normal pace) — ${PACE_HISTORY_MIN_ROUNDS} of each and I can compare how you score when it drags.`,
  };
}

export interface PaceContext {
  elapsed: string;
  holesCompleted: number;
  minPerHole: number | null;
  /** Positive = behind a 4:15 pace, minutes. */
  vsBenchmarkMin: number | null;
  projectedFinish: string | null;
  history: PaceHistory;
}

/**
 * What the caddie is told about pace — the SAME live numbers the round bar shows, plus the player's
 * own slow-vs-normal scoring. Sent on every in-round turn whether or not the bar line is switched on:
 * the toggle is about the screen, and "how's our pace?" is a fair question either way.
 */
export function paceContext(input: {
  isRoundActive: boolean;
  roundStartTime: number | null;
  holeStartedAt: Record<number, number> | null | undefined;
  currentHole: number;
  firstHole: number;
  lastHole: number;
  history: readonly PastRound[];
  now: number;
}): PaceContext | null {
  if (!input.isRoundActive) return null;
  const live = computeLivePace({
    roundStartTime: input.roundStartTime,
    holeStartedAt: input.holeStartedAt ?? {},
    currentHole: input.currentHole,
    firstHole: input.firstHole,
    lastHole: input.lastHole,
    now: input.now,
  });
  if (!live) return null;
  return {
    elapsed: formatElapsed(live.elapsedMin),
    holesCompleted: live.holesCompleted,
    minPerHole: live.minPerHole != null ? Math.round(live.minPerHole * 10) / 10 : null,
    vsBenchmarkMin: live.vsBenchmarkMin != null ? Math.round(live.vsBenchmarkMin) : null,
    projectedFinish: live.projectedFinishAt != null ? formatClock(live.projectedFinishAt) : null,
    history: paceHistory(input.history),
  };
}

/**
 * 2026-09-29 — pace of play for the round context (paceContext above, built on the client).
 * One line so the caddie can answer "how's our pace?" and "how do I play when it's slow?" from the
 * same numbers the round bar shows. Empty when there is nothing to say.
 */
type BrainPace = {
  elapsed?: string; holesCompleted?: number; minPerHole?: number | null; vsBenchmarkMin?: number | null;
  projectedFinish?: string | null;
  history?: { slowVsParPerHole?: number | null; normalVsParPerHole?: number | null; note?: string } | null;
} | null;
export function paceLineForBrain(pace: BrainPace): string {
  if (!pace || typeof pace !== 'object' || !pace.elapsed) return '';
  const parts = [`Pace of play: ${pace.elapsed} elapsed`];
  if (typeof pace.minPerHole === 'number') parts.push(`${pace.minPerHole} min/hole over ${pace.holesCompleted ?? 0} holes`);
  if (typeof pace.vsBenchmarkMin === 'number') {
    const m = pace.vsBenchmarkMin;
    parts.push(m > 2 ? `${m} min behind a 4:15 pace` : m < -2 ? `${-m} min ahead of a 4:15 pace` : 'on a 4:15 pace');
  }
  if (pace.projectedFinish) parts.push(`projected finish ~${pace.projectedFinish}`);
  const h = pace.history;
  if (h && typeof h.slowVsParPerHole === 'number' && typeof h.normalVsParPerHole === 'number') {
    parts.push(`their own history: ${(h.slowVsParPerHole * 18).toFixed(1)} over par per 18 on slow rounds vs ${(h.normalVsParPerHole * 18).toFixed(1)} at a normal pace`);
  } else if (h?.note) {
    parts.push(`history: ${h.note}`);
  }
  return `${parts.join(' | ')}\n`;
}

