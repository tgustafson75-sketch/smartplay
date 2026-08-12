/**
 * 2026-08-12 (Tim) — "how are we going to capture that on a by-swing basis? By swing, by shot, by
 * hole, then a compilation at the end? … I always had this, but we needed to capture it, and
 * everything was always half built."
 *
 * The watch emits SWINGS. A round is made of SHOTS. They are not the same thing, and the gap between
 * them is the entire design problem: an IMU cannot tell a rehearsal from the real one. Every waggle
 * looks like a swing.
 *
 * So this module never tries to guess which swing was "the shot". It groups what the wrist actually
 * measured by HOLE, and reads the one thing that survives that ambiguity — TEMPO.
 *
 * WHY TEMPO IS THE RIGHT SIGNAL ON COURSE, and speed is not:
 *   - it is measured directly (backswing and downswing are times, no calibration needed)
 *   - it is meaningful in aggregate even if a practice swing slips in, because rehearsals and real
 *     swings share a player's rhythm — a fast waggle and a fast swing both say "quickening"
 *   - it degrades under fatigue and pressure BEFORE the player notices, which makes it a mental-game
 *     reading rather than a swing statistic
 *
 * That last point is the whole reason this exists. "Your average tempo was 3.1" is a stat nobody
 * acts on. "You held 3:1 through twelve, then quickened over the last six — that's where the bogeys
 * came from" is a caddie noticing something about YOU. It feeds the same mental read that eases the
 * risk posture ([[caddie-brain-lens]] — route it through the CNS, don't strand it on a card).
 *
 * Pure, synchronous, never throws. Quiet until there is genuinely enough to say.
 */

/** The shape we need from a watch swing — a subset of watchStore.SwingMetrics. */
export interface RoundSwing {
  timestamp: number;
  tempoRatio: number;
  /** Hole the swing happened on, tagged at capture. Absent on swings taken off-course. */
  hole?: number | null;
  club?: string | null;
}

/** Swings needed on a hole before its tempo means anything. One swing is an anecdote. */
const MIN_SWINGS_PER_HOLE = 2;
/**
 * Swings needed across the round before a baseline is trustworthy.
 *
 * 2026-08-12 — lowered from 8 for NINE-HOLE rounds. Tim is playing a nine-hole men's league
 * tonight, and a nine-hole round is a first-class case, not a truncated eighteen: leagues, twilight
 * and quick rounds are most of what a time-constrained golfer actually plays
 * ([[time-constrained-golfer-lens]]). At 8 the read would almost never fire on nine holes, because
 * the watch only sees full swings — putts and short chips don't register — so a nine-hole round
 * realistically produces 6-12 detected swings, not 18.
 */
const MIN_SWINGS_FOR_BASELINE = 6;
/**
 * How far off baseline a hole must run to be worth mentioning, as a fraction. Tempo naturally varies
 * hole to hole — a wedge is not a driver — so a small wobble is noise. 18% is roughly the difference
 * between a 3.0 and a 2.5, which a player can actually feel.
 */
const NOTABLE_DEVIATION = 0.18;
/**
 * The closing stretch compared against the early baseline — a THIRD of the round, not a fixed six.
 *
 * 2026-08-12 — fixed-6 was written for eighteen holes. On a nine-hole round it would have swallowed
 * two thirds of the round as "late", leaving three holes of baseline to compare against, which is
 * not a comparison. A third is the same shape at either length: holes 13-18 of an eighteen, holes
 * 7-9 of a nine.
 */
const lateHoleCount = (playedHoles: number): number => Math.max(3, Math.round(playedHoles / 3));

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const usable = (s: RoundSwing): boolean =>
  typeof s?.tempoRatio === 'number' && s.tempoRatio > 0.5 && s.tempoRatio < 10;

/** Swings grouped by the hole they happened on, oldest first. Off-course swings are dropped. */
export function groupSwingsByHole(swings: RoundSwing[]): Map<number, RoundSwing[]> {
  const out = new Map<number, RoundSwing[]>();
  for (const s of (swings ?? []).filter(usable)) {
    const h = s.hole;
    if (typeof h !== 'number' || h < 1 || h > 18) continue;
    const list = out.get(h) ?? [];
    list.push(s);
    out.set(h, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/** The player's tempo baseline for this round, or null when there isn't enough to claim one. */
export function roundTempoBaseline(swings: RoundSwing[]): number | null {
  const rs = (swings ?? []).filter(usable);
  if (rs.length < MIN_SWINGS_FOR_BASELINE) return null;
  return mean(rs.map(s => s.tempoRatio));
}

export interface HoleTempoFlag {
  hole: number;
  ratio: number;
  /** 'quick' = faster than baseline (the common pressure response); 'slow' = the reverse. */
  direction: 'quick' | 'slow';
  /** One short line for the active-round card. */
  text: string;
}

/**
 * A flag for THIS hole — only when it's genuinely off the player's own baseline.
 *
 * Deliberately returns null most of the time. A number on every hole is a stat readout, and a golfer
 * mid-round does not need one; a caddie speaks up when something changed. [[feels-like-a-real-caddie]]
 */
export function holeTempoFlag(
  swings: RoundSwing[],
  hole: number,
  baseline: number | null,
): HoleTempoFlag | null {
  if (baseline == null) return null;
  const onHole = (groupSwingsByHole(swings).get(hole) ?? []);
  if (onHole.length < MIN_SWINGS_PER_HOLE) return null;
  const ratio = mean(onHole.map(s => s.tempoRatio));
  const delta = (ratio - baseline) / baseline;
  if (Math.abs(delta) < NOTABLE_DEVIATION) return null;
  const direction: 'quick' | 'slow' = delta < 0 ? 'quick' : 'slow';
  return {
    hole,
    ratio: Math.round(ratio * 10) / 10,
    direction,
    text: direction === 'quick'
      ? 'Tempo quickened here — breathe and let it swing.'
      : 'Tempo slowed here — trust it and go.',
  };
}

export interface RoundTempoStory {
  /** False → say nothing. Not enough swings, or nothing worth reporting. */
  enough: boolean;
  baseline: number | null;
  earlyAvg: number | null;
  lateAvg: number | null;
  /** Positive = the closing stretch was QUICKER than the early baseline. */
  quickenedBy: number | null;
  /** One honest sentence for the recap, or null. */
  headline: string | null;
}

const NOT_ENOUGH: RoundTempoStory = {
  enough: false, baseline: null, earlyAvg: null, lateAvg: null, quickenedBy: null, headline: null,
};

/**
 * The end-of-round compilation: did tempo hold, or did it go late?
 *
 * Compares the closing stretch against everything before it. Reports ONLY a real move — a round
 * where tempo held is told that plainly rather than being handed a manufactured insight, because
 * "you were steady all day" is itself worth hearing and is true far more often than not.
 */
export function roundTempoStory(swings: RoundSwing[]): RoundTempoStory {
  const byHole = groupSwingsByHole(swings);
  const holes = [...byHole.keys()].sort((a, b) => a - b);
  const all = (swings ?? []).filter(usable);
  // 2026-08-12 — six holes, not nine: a nine-hole league round must qualify. Below six there isn't
  // enough of an arc for "early vs late" to mean anything at any round length.
  if (all.length < MIN_SWINGS_FOR_BASELINE || holes.length < 6) return NOT_ENOUGH;

  const lateStart = holes[Math.max(0, holes.length - lateHoleCount(holes.length))];
  const early: number[] = [];
  const late: number[] = [];
  for (const h of holes) {
    const ratios = (byHole.get(h) ?? []).map(s => s.tempoRatio);
    (h >= lateStart ? late : early).push(...ratios);
  }
  if (early.length < 3 || late.length < 3) return NOT_ENOUGH;

  const earlyAvg = mean(early);
  const lateAvg = mean(late);
  const baseline = mean(all.map(s => s.tempoRatio));
  const quickenedBy = earlyAvg - lateAvg; // positive = faster (lower ratio) late
  const rel = Math.abs(quickenedBy) / earlyAvg;

  const r = (n: number) => Math.round(n * 10) / 10;
  const headline =
    rel < NOTABLE_DEVIATION
      ? `Your tempo held at ${r(baseline)}:1 all the way in — that's the part most players lose late.`
      : quickenedBy > 0
        ? `You held ${r(earlyAvg)}:1 early and quickened to ${r(lateAvg)}:1 over the closing stretch — that's usually where the strokes go.`
        : `You slowed from ${r(earlyAvg)}:1 to ${r(lateAvg)}:1 late — steering it in rather than swinging through.`;

  return {
    enough: true,
    baseline: r(baseline),
    earlyAvg: r(earlyAvg),
    lateAvg: r(lateAvg),
    quickenedBy: r(quickenedBy),
    headline,
  };
}
