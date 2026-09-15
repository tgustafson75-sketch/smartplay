/**
 * 2026-09-14 (Tim) — "tempo would be really helpful with feel and other things like Hank Haney I
 * believe has a youtube video where he swears on full swing it to say one hundred and one, one or
 * certain songs that have matching tempo for a good swing. There is a simple app for that I tried.
 * It was neat but not a useful app as a standalone. Only is this have grounding in known caddy truth"
 *
 * IT HAS GROUNDING, AND OURS IS DIFFERENT FROM THE STANDALONE IN ONE WAY THAT MATTERS.
 *
 * The grounding: Tour Tempo (Novosel) established the 3:1 backswing:downswing ratio across tour
 * players and teaches it with TONES at fixed frame counts — 24/8, 21/7, 27/9 at 30 fps, all with an
 * eight-frame downswing. `app/swinglab/tempo-trainer` already uses exactly those presets. A spoken
 * count is the same idea carried by syllables instead of beeps, which is how it is taught in person
 * when nobody has a metronome: a long count going back, a short one coming down.
 *
 * Why the standalone app Tim tried was "neat but not useful": it hands you a PRESET. It has never
 * seen you swing, so the cadence it sets is somebody else's. SmartPlay measures the real backswing
 * and downswing in milliseconds (services/smartTempo), so the count can be chosen to fit HIS swing —
 * and, more usefully, to fit the swing he is trying to build.
 *
 * WHAT THIS IS NOT. It does not claim a count makes you swing better, and it does not pick a song.
 * It answers one question honestly: at this duration, what can a human actually say at a comfortable
 * speaking rate? That is arithmetic, not coaching theory. [[illustration-data-points]]
 *
 * PURE / SYNC / never throws.
 */

/**
 * Comfortable speaking rate. Conversational English runs about four to six syllables a second;
 * 170-260 ms per syllable is the band where a count is sayable without rushing or dragging. Outside
 * it the count stops being a rhythm aid and becomes a tongue-twister or a drawl.
 */
const MIN_MS_PER_SYLLABLE = 170;
const MAX_MS_PER_SYLLABLE = 260;

/** Counts a golfer can actually say, shortest first. Syllables are counted as spoken. */
const COUNTS: readonly { say: string; syllables: number }[] = [
  { say: 'one … two', syllables: 2 },
  { say: 'one … two … three', syllables: 3 },
  { say: 'one-and-two', syllables: 3 },
  { say: 'one hundred and one', syllables: 5 },
  { say: 'one one-thousand … two', syllables: 6 },
];

export interface TempoCount {
  /** What to say during the BACKSWING. */
  back: string;
  /** What to say at the strike — always one short syllable, because the downswing is ~250 ms. */
  down: string;
  /** Milliseconds per syllable this count implies at his measured backswing. */
  msPerSyllable: number;
  /**
   * The count fits a comfortable speaking rate. When false, `back` is the closest available and the
   * note says plainly that it will not be sayable — which is itself the tempo read.
   */
  comfortable: boolean;
  /** One honest sentence about the fit. */
  note: string;
}

/**
 * A count matched to a measured backswing.
 *
 * `downswingMs` is accepted and deliberately not used to choose words: a tour-standard downswing is
 * about a quarter of a second, which is one syllable for everybody. Splitting it would invent a
 * distinction the clock does not support.
 */
export function countForBackswing(backswingMs: number, downswingMs?: number): TempoCount | null {
  if (!Number.isFinite(backswingMs) || backswingMs <= 0) return null;
  void downswingMs;

  const rate = (c: { syllables: number }) => backswingMs / c.syllables;
  const comfortable = COUNTS.filter((c) => {
    const ms = rate(c);
    return ms >= MIN_MS_PER_SYLLABLE && ms <= MAX_MS_PER_SYLLABLE;
  });

  if (comfortable.length > 0) {
    // The longest count that still fits — more syllables means finer-grained rhythm to hold on to.
    const best = comfortable[comfortable.length - 1];
    const ms = Math.round(rate(best));
    return {
      back: best.say,
      down: 'hit',
      msPerSyllable: ms,
      comfortable: true,
      note: `Say "${best.say}" going back and "hit" at the ball — about ${ms} ms a syllable, which is normal speaking pace for your backswing of ${Math.round(backswingMs)} ms.`,
    };
  }

  /**
   * NOTHING FITS, AND THAT IS THE USEFUL ANSWER.
   *
   * A backswing too short to count is a backswing too short — the count failing is the same finding
   * the ratio gives, arriving in a form a player can feel. Saying "just say it faster" would hide
   * exactly the thing worth telling him.
   */
  const shortest = COUNTS[0];
  const longest = COUNTS[COUNTS.length - 1];
  const tooQuick = rate(shortest) < MIN_MS_PER_SYLLABLE;
  const pick = tooQuick ? shortest : longest;
  const ms = Math.round(rate(pick));
  return {
    back: pick.say,
    down: 'hit',
    msPerSyllable: ms,
    comfortable: false,
    note: tooQuick
      ? `Your backswing is ${Math.round(backswingMs)} ms — too quick to count out loud at all (even "${shortest.say}" would need ${ms} ms a syllable). That is the read: there is no room in it yet. Lengthen the load first, then the count becomes possible.`
      : `Your backswing is ${Math.round(backswingMs)} ms — long enough that even "${longest.say}" leaves ${ms} ms a syllable, which drags. Shorten the load and the count tightens up with it.`,
  };
}

/**
 * The count for the tempo he is AIMING at, not the one he has.
 *
 * This is the half that makes it a training aid rather than a readout: hold his real downswing —
 * which is the physiologically fixed part, and the reason Tour Tempo's presets all keep it at eight
 * frames — and count the backswing the target ratio would want.
 */
export function countForTarget(downswingMs: number, targetRatio: number): TempoCount | null {
  if (!Number.isFinite(downswingMs) || downswingMs <= 0) return null;
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) return null;
  return countForBackswing(downswingMs * targetRatio, downswingMs);
}
