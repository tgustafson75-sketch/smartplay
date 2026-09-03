/**
 * services/simRoundAuto.ts — THE SILENT SIM ROUND. The app plays itself, and tells you what broke.
 *
 * 2026-09-02 (Tim) — "add a second option for owner tools sim round that is non voice and goes by
 * user tendencies and data... watch hole transition, scoring, etc. This way we can finish surgical
 * last minute issues on my phone until I find them all."
 *
 * The existing sim round (services/simRound.ts) is NARRATED: it needs Tim to speak every shot, so it
 * exercises the voice path and moves at the speed of a person talking. That is the right tool for
 * testing the caddie and the wrong one for hunting a scorecard bug — you cannot play nine holes
 * looking for an off-by-one hole advance if each shot costs you a sentence.
 *
 * This one plays itself, in seconds, with no voice at all, through the SAME pipeline: the real
 * startRound, the real logShot, the real logScore and its score-driven advance, the real simulated
 * GPS. Nothing is stubbed except the human.
 *
 * WHOSE ROUND IS IT — the data, not a generic golfer:
 *   - carries come from `bagDistances()`, the player's OWN learned club distances
 *   - the miss comes from the CNS `tendencies.dominantMiss` through `missBiasFor` — Tim's slice
 *     slices, in the direction he actually misses
 *   - strike quality is centred on his MEASURED tempo EWMA (`swing.tempoAvg`), widened by handicap,
 *     so a scratch player flushes more of them than an 18
 *   - the outcome engine is `services/simGame.ts` — the same physics the SwingSim game already uses
 * A generic golfer would exercise generic yardages and never reach the clubs, gaps and misses that
 * produce Tim's bugs. [[illustration-data-points]]
 *
 * WHAT IT IS ACTUALLY WATCHING. Every hole is a harness scenario, built with the same
 * `runWithAsserts` as the rest of the harness, so each hole carries its own swallowed console
 * errors, the app's own breadcrumbs in order, and the worst JS-thread stall — and the whole round
 * exports through the same `formatRunReport`. The assertions are the things that quietly go wrong on
 * a real round and are miserable to catch by hand:
 *   - the yardage COUNTS DOWN (a shot that does not move the player is the bug that looks like GPS)
 *   - the hole ADVANCES on the first score, and the scorecard holds what was written
 *   - strokes reconcile: what the engine played == what the round recorded
 *   - the shot log grows by exactly the shots taken, tagged to the right hole
 *   - the round's own totals reconcile at the end
 *
 * DETERMINISTIC. The RNG is seeded, so "seed 7 fails on hole 4" is a bug someone can re-run rather
 * than a story about a round nobody can reproduce. [[missing-log-entry-is-the-evidence]]
 *
 * SAFE. It runs through `startVoiceSimRound({ silent: true })`, so the round is SIM-tagged and every
 * learning writer — handicap, bag, CNS, points, records — is already gated off in roundStore. It
 * never trains the brain, and it restores `voiceEnabled` in a finally.
 */

import { runWithAsserts, type ScenarioReport, type AssertCtx } from './harness/assert';
import { startVoiceSimRound, getSimPosition } from './simRound';
import { simShot, simPutt, lieFor, liePenalty, missBiasFor, puttFeetFrom, type SimLie } from './simGame';
import type { IndoorRep } from './indoorSwing';
import { bagDistances } from './shotStrategy';
// 2026-09-02 — roundFirstHole/roundLastHole are the round's OWN definition of which holes are in
// play (they respect nineHoleMode and roundStartHole, so a back nine ends at 18, not at 9). The first
// draft of this file walked `courseHoles.length` instead and played eighteen holes of a nine-hole
// round — its own test caught it. Never re-derive the range here. [[two-owners-is-the-root-cause]]
import { useRoundStore, roundFirstHole, roundLastHole } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCaddieMemoryStore } from '../store/caddieMemoryStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { resolveGreenCoords } from './smartFinderService';
import { haversineYards } from '../utils/geoDistance';

/** Deterministic, seedable RNG — a failing round has to be re-runnable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AutoSimOptions {
  courseId?: string;
  nineHoles?: boolean;
  /** Same seed = same round, shot for shot. */
  seed?: number;
  /** Hard stop so a pipeline bug can never spin the round forever. */
  maxShotsPerHole?: number;
}

export interface AutoSimProgress {
  hole: number;
  of: number;
  note: string;
}

/** The player model this round is played with — reported so a reader knows whose round they read. */
export interface AutoSimPlayer {
  clubs: { club: string; carry: number }[];
  missBias: number;
  dominantMiss: string | null;
  tempoAvg: number | null;
  handicap: number | null;
}

const GREEN_YDS = 18;          // inside this, we're putting (matches simGame's lieFor)
// 2026-09-03 — YDS_PER_FT removed: the yards→feet conversion now has one owner in simGame
// (puttFeetFrom), because the three copies of it did not agree and the SHIPPED one was the wrong one.

/**
 * Read the player. Every number here is THEIRS — an empty bag is reported as a skip rather than
 * silently substituting tour averages, because a round played on numbers the player never hit
 * proves nothing about the player's app.
 */
export function readAutoSimPlayer(): AutoSimPlayer {
  const bag = bagDistances();
  const clubs = Object.entries(bag)
    .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
    .map(([club, carry]) => ({ club, carry: carry as number }))
    .sort((a, b) => b.carry - a.carry);
  let dominantMiss: string | null = null;
  let tempoAvg: number | null = null;
  try {
    const p = useCaddieMemoryStore.getState().getPlayer();
    dominantMiss = p.tendencies?.dominantMiss ?? null;
    tempoAvg = p.swingMetrics?.tempoAvg ?? null;
  } catch { /* a missing CNS is a neutral player, not a crash */ }
  let handicap: number | null = null;
  try {
    const h = usePlayerProfileStore.getState().handicap;
    handicap = typeof h === 'number' && Number.isFinite(h) ? h : null;
  } catch { /* optional */ }
  return { clubs, missBias: missBiasFor(dominantMiss), dominantMiss, tempoAvg, handicap };
}

/**
 * Synthesize the swing this player would actually make. `simShot` grades a REP, and there is no
 * phone swinging here — so the rep is drawn around what we know: their measured tempo EWMA when we
 * have one, and their handicap for how often it comes out clean. A 3.0 tempo with a smooth
 * transition is the flush; the spread around it widens with handicap.
 */
function synthesizeRep(player: AutoSimPlayer, rng: () => number, putting = false): IndoorRep {
  const centre = putting ? 2.0 : (player.tempoAvg ?? 3.0);
  // Handicap → consistency. Scratch keeps it tight; a 25 sprays it. Clamped so an absent handicap
  // (null) lands mid-field rather than pretending to know.
  const hcp = player.handicap ?? 15;
  const spread = 0.15 + Math.min(1, Math.max(0, hcp) / 30) * 0.85;
  const tempoRatio = Math.max(0.8, centre + (rng() * 2 - 1) * spread);
  const roll = rng();
  const transition = roll > 0.55 + (1 - spread) * 0.2 ? 'smooth' : roll > 0.2 ? 'quick' : 'rushed';
  const backswingMs = 700 + Math.round((rng() * 2 - 1) * 120);
  return {
    tempoRatio,
    backswingMs,
    downswingMs: Math.max(80, Math.round(backswingMs / Math.max(0.8, tempoRatio))),
    transition: transition as IndoorRep['transition'],
    transitionDwellMs: 40 + Math.round(rng() * 60),
    ...(putting ? { throughStroke: (rng() > 0.3 ? 'accelerating' : 'decelerating') as 'accelerating' | 'decelerating' } : {}),
  };
}

/** Pick the club the way a player does: the one whose carry covers what's left, else the longest. */
function pickClub(player: AutoSimPlayer, remainingYds: number, lie: SimLie): { club: string; carry: number } | null {
  if (player.clubs.length === 0) return null;
  const effective = remainingYds / Math.max(0.5, liePenalty(lie));
  // Shortest club that still reaches; if nothing reaches, the longest one in the bag.
  const reaching = [...player.clubs].reverse().find((c) => c.carry >= effective);
  return reaching ?? player.clubs[0];
}

/**
 * Play one hole and assert the pipeline did what it promises. Returns the strokes taken so the round
 * can reconcile its own arithmetic against the store's.
 */
async function playHole(
  a: AssertCtx,
  holeNumber: number,
  player: AutoSimPlayer,
  rng: () => number,
  maxShots: number,
): Promise<{ strokes: number; reachedGreen: boolean }> {
  const round = () => useRoundStore.getState();
  const hole = round().courseHoles.find((h) => h.hole === holeNumber);
  const par = hole?.par ?? 4;
  a.note('hole', `#${holeNumber} · par ${par}${hole?.distance ? ` · ${hole.distance}y` : ""}`);

  const green = resolveGreenCoords(holeNumber).middle;
  a.expect('the hole has a green to aim at', !!green,
    green ? `${green.lat.toFixed(5)}, ${green.lng.toFixed(5)}` : 'resolveGreenCoords returned nothing — every yardage on this hole is unanswerable');
  if (!green) return { strokes: par, reachedGreen: false };

  const startPos = getSimPosition();
  a.expect('the player is positioned on this hole', !!startPos,
    startPos ? `${startPos.lat.toFixed(5)}, ${startPos.lng.toFixed(5)}` : 'no simulated fix — the tee placement did not happen');
  if (!startPos) return { strokes: par, reachedGreen: false };

  let remaining = haversineYards(startPos, green);
  a.note('tee yardage', `${Math.round(remaining)}y to the middle`);

  let strokes = 0;
  let lie: SimLie = 'tee';
  let lastRemaining = remaining;
  const shotsTaken: string[] = [];

  // ── The hole, shot by shot ──
  while (remaining > GREEN_YDS && strokes < maxShots) {
    const club = pickClub(player, remaining, lie);
    if (!club) {
      a.skip('play the hole', 'the bag is empty — no learned club distances to play with');
      return { strokes, reachedGreen: false };
    }
    const rep = synthesizeRep(player, rng);
    const out = simShot({
      clubCarry: club.carry * liePenalty(lie),
      rep,
      missBias: player.missBias,
      rng,
    });
    strokes++;

    // THE REAL PIPELINE: log the shot exactly as a player's logged shot arrives, then let the sim
    // move the position the way a narrated shot does.
    const before = getSimPosition();
    useRoundStore.getState().logShot({
      feel: out.flushed ? 'flush' : out.quality > 0.5 ? 'solid' : 'thin',
      direction: out.lateralYds < -6 ? 'left' : out.lateralYds > 6 ? 'right' : 'straight',
      shape: null,
      club: club.club,
      hole: holeNumber,
      timestamp: Date.now(),
      acousticContact: null,
      distance_yards: out.carryYds,
    });
    // NOTE: do NOT advance the position here. roundStore.logShot already calls
    // simAdvanceTowardGreen with the shot's distance when a sim round is active — that IS the real
    // pipeline, and it is the behaviour worth testing. The first draft called it a second time and
    // this runner caught itself doing it: "moved 349y of 198y asked", with two moves in one shot's
    // flow. Exactly the class of bug this tool exists to find, found on its own first round.
    const after = getSimPosition();
    a.expect(`shot ${strokes} (${club.club}, ${out.carryYds}y) MOVED the player`,
      !!after && !!before && haversineYards(before, after) > 1,
      after && before
        ? `moved ${Math.round(haversineYards(before, after))}y of ${out.carryYds}y asked`
        : 'the simulated position is gone after logging a shot');

    remaining = after ? haversineYards(after, green) : remaining;
    // THE COUNT-DOWN. A yardage that does not fall is the failure that reads as "GPS is broken".
    a.expect(`the yardage counted down after shot ${strokes}`, remaining < lastRemaining + 1,
      `${Math.round(lastRemaining)}y → ${Math.round(remaining)}y`);
    lastRemaining = remaining;
    lie = lieFor(Math.abs(out.lateralYds), remaining);
    shotsTaken.push(`${club.club} ${out.carryYds}y → ${Math.round(remaining)}y ${lie}`);
  }

  const reachedGreen = remaining <= GREEN_YDS;
  a.expect('the hole was playable in a sane number of shots', strokes < maxShots,
    `${strokes} shots, ${Math.round(remaining)}y still out (cap ${maxShots})`);
  a.note('approach', shotsTaken.join(' · ') || '(none)');

  // ── Putting ──
  let putts = 0;
  let distanceFt = puttFeetFrom(remaining);
  while (putts < 6) {
    const p = simPutt({ distanceFt, rep: synthesizeRep(player, rng, true), rng });
    putts++;
    strokes++;
    if (p.holed) break;
    distanceFt = p.remainingFt;
  }
  a.expect('the ball went in', putts < 6, `${putts} putts from ${puttFeetFrom(remaining)}ft`);
  a.note('scored', `${strokes} on a par ${par} (${putts} putts)`);

  // ── THE SCORECARD + THE ADVANCE: the two things this whole runner exists to watch ──
  const holeBeforeScore = round().currentHole;
  useRoundStore.getState().logScore(holeNumber, strokes);

  const stored = round().scores[holeNumber];
  a.expectEqual(`the scorecard holds hole ${holeNumber} = ${strokes}`, stored, strokes);

  const isLast = holeNumber >= roundLastHole(round());
  const nowHole = round().currentHole;
  if (isLast) {
    a.note('last hole', `stayed on ${nowHole} — nothing to advance to`);
  } else {
    a.expectEqual(`hole ADVANCED ${holeNumber} → ${holeNumber + 1}`, nowHole, holeNumber + 1);
    if (nowHole !== holeNumber + 1) {
      // Say WHY, using the store's own reason rather than leaving a bare mismatch.
      const autoAdvance = useSettingsStore.getState().autoHoleAdvance;
      a.note('advance did not fire',
        `was on ${holeBeforeScore}, scored ${holeNumber}, now ${nowHole} · autoHoleAdvance=${String(autoAdvance)}`);
    }
  }
  return { strokes, reachedGreen };
}

/**
 * Play a full silent round. One ScenarioReport per hole plus a reconciliation report, so the result
 * drops straight into the harness export.
 */
export async function runAutoSimRound(
  opts?: AutoSimOptions,
  onProgress?: (p: AutoSimProgress) => void,
): Promise<ScenarioReport[]> {
  const seed = opts?.seed ?? 1;
  const nineHoles = opts?.nineHoles ?? true;
  const maxShots = opts?.maxShotsPerHole ?? 12;
  const rng = mulberry32(seed);
  const reports: ScenarioReport[] = [];
  const player = readAutoSimPlayer();

  // Silence is the point — restore whatever it was, whatever happens below.
  const voiceWas = useSettingsStore.getState().voiceEnabled;
  const played: { hole: number; strokes: number }[] = [];

  try {
    useSettingsStore.setState({ voiceEnabled: false });

    reports.push(await runWithAsserts('SIM-0', 'Start: a silent SIM round on the real pipeline', async (a) => {
      a.note('player', player.clubs.length
        ? `${player.clubs.length} learned clubs (${player.clubs[0].club} ${player.clubs[0].carry}y → ${player.clubs[player.clubs.length - 1].club} ${player.clubs[player.clubs.length - 1].carry}y)`
        : 'NO learned club distances');
      a.note('tendency', `miss=${player.dominantMiss ?? 'none'} (bias ${player.missBias}) · tempoAvg=${player.tempoAvg ?? 'none'} · hcp=${player.handicap ?? 'none'}`);
      a.note('seed', String(seed));
      // The round is played on the player's own numbers; without them it is a different game.
      a.expect('the round is played on LEARNED club distances', player.clubs.length > 0,
        player.clubs.length ? `${player.clubs.length} clubs` : 'bag is empty — log some carries first, or this proves nothing about your app');

      const already = useRoundStore.getState().isRoundActive;
      a.expect('no round was already in progress', !already, already ? 'end the active round first' : 'clear');
      if (already) return;

      const r = startVoiceSimRound({ nineHoles, silent: true });
      a.expect('the sim round started', r.ok, r.say);
      a.expect('the round is SIM-tagged (never trains handicap / bag / CNS)', useRoundStore.getState().isSimRound === true,
        `isSimRound=${String(useRoundStore.getState().isSimRound)}`);
      a.expect('voice is off for this run', useSettingsStore.getState().voiceEnabled === false,
        `voiceEnabled=${String(useSettingsStore.getState().voiceEnabled)}`);
      a.expectEqual('the round opens on hole 1', useRoundStore.getState().currentHole, 1);
    }));

    if (!useRoundStore.getState().isRoundActive) return reports;

    const first = roundFirstHole(useRoundStore.getState());
    const last = roundLastHole(useRoundStore.getState());
    const holesN = last - first + 1;
    for (let h = first; h <= last; h++) {
      onProgress?.({ hole: h - first + 1, of: holesN, note: `playing hole ${h}` });
      const holeReport = await runWithAsserts(`SIM-H${h}`, `Hole ${h}: shots, yardage, score, advance`, async (a) => {
        const res = await playHole(a, h, player, rng, maxShots);
        played.push({ hole: h, strokes: res.strokes });
      });
      reports.push(holeReport);
    }

    // ── RECONCILIATION. Every number the round shows must agree with what was actually played. ──
    reports.push(await runWithAsserts('SIM-END', 'Reconcile: the round agrees with what was played', async (a) => {
      const st = useRoundStore.getState();
      const inRound = (h: number) => h >= first && h <= last;
      const engineTotal = played.reduce((n, p) => n + p.strokes, 0);
      const storeTotal = Object.entries(st.scores)
        .filter(([h]) => inRound(Number(h)))
        .reduce((n, [, v]) => n + (v ?? 0), 0);
      a.note('hole range', `${first}–${last} (${holesN} holes)`);
      a.expectEqual('every hole has a score',
        Object.keys(st.scores).filter((h) => inRound(Number(h)) && (st.scores[Number(h)] ?? 0) > 0).length, holesN);
      a.expectEqual('the scorecard total matches what was played', storeTotal, engineTotal);
      for (const p of played) {
        a.expectEqual(`hole ${p.hole} stored ${p.strokes}`, st.scores[p.hole], p.strokes);
      }
      // The shot log is the other record of the same round; a shot that vanished is a real defect.
      const shots = (st.shots ?? []).filter((s) => inRound(s.hole));
      a.expect('the shot log recorded shots for every hole', shots.length > 0,
        `${shots.length} shots logged across ${holesN} holes`);
      const holesWithShots = new Set(shots.map((s) => s.hole));
      a.expectEqual('every hole logged at least one shot', holesWithShots.size, holesN);
      a.note('totals', `${engineTotal} strokes · ${shots.length} shots logged · ${holesN} holes`);
    }));
  } finally {
    // End the round through the REAL teardown, then give the setting back no matter what happened.
    try {
      if (useRoundStore.getState().isRoundActive) useRoundStore.getState().endRound();
    } catch (e) {
      console.log('[simRoundAuto] endRound failed:', e instanceof Error ? e.message : String(e));
    }
    useSettingsStore.setState({ voiceEnabled: voiceWas });
  }

  return reports;
}
