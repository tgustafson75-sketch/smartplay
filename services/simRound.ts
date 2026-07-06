/**
 * 2026-07-04 (Tim) — VOICE SIM ROUND. "I can basically do a sim round with Menifee
 * Palms because I know it in my head... say 'hey, I got this many yards with this
 * club' and it registers a whole sim round... walk through nine holes talking
 * narratively through the whole round." And: "if we can sim that way, that's level
 * one to having basically a golf game within the app."
 *
 * How it works — the REAL pipeline, driven by narration:
 *   - startVoiceSimRound() suppresses the real GPS watcher, seeds a simulated fix
 *     at hole 1's tee, and starts the round through the REAL startRound() (marked
 *     simulated). Every surface — SmartFinder yardages, the caddie brain, voice
 *     tools, score-driven hole advance — runs live on the simulated position.
 *   - When the player narrates a shot with a distance ("driver, 230"), the logged
 *     shot MOVES the simulated position that far toward the current green, so
 *     "what's my yardage?" counts down like a real hole. That position-follows-
 *     narration loop is the golf-game level-one mechanic.
 *   - Logging a score auto-advances the hole (the score-driven rule); the sim
 *     jumps the position to the next tee.
 *   - Ending the round restores the real GPS watcher. The round record is tagged
 *     SIM and every learning writer (handicap, bag, CNS, points, records) is
 *     gated off in roundStore — a sim round never trains the brain.
 *
 * Bundled Palms data carries real surveyed tee + F/M/B coords for all 18 holes,
 * so yardages are honest to the actual course.
 */

import { getBundledHoles, getCourse } from '../data/courses';
import { useRoundStore } from '../store/roundStore';
import { setSimulatedFix, clearSimulatedFix, resolveGreenCoords } from './smartFinderService';
import { haversineYards, bearingDegrees, destinationPoint } from '../utils/geoDistance';
import { logHarnessEvent } from './simulatedGPS';

let simActive = false;
let holeUnsub: (() => void) | null = null;
// 2026-07-05 (Tim's first sim-round log: "moved 270y toward green, ~1372y LEFT" on a
// ~350y hole) — simAdvanceTowardGreen read getLastFix(), which returned the REAL
// last GPS fix (Tim's house, ~1600y from the course) instead of the simulated tee.
// The sim's position is now tracked HERE, authoritatively: set at every tee placement
// and every narrated move. Never read back from the GPS cache.
let simPos: { lat: number; lng: number } | null = null;

/** 2026-07-04 (Tim — "does the sim go to a log so you can review the output?") —
 *  every sim event goes BOTH to the live harness ticker AND the persisted issue
 *  log (kind 'sim_round'), so the post-run Owner Tools → Issue Log → Send export
 *  carries the full narrated-round trace alongside the voice turns. */
function simLog(detail: string, extra?: Record<string, unknown>): void {
  logHarnessEvent('sim_round', detail);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../store/issueLogStore') as typeof import('../store/issueLogStore'))
      .useIssueLogStore.getState().addAppEvent(detail, extra, 'sim_round');
  } catch { /* persistence is best-effort */ }
}

export function isVoiceSimRoundActive(): boolean {
  return simActive || useRoundStore.getState().isSimRound;
}

/** Place the simulated player at the given hole's tee. */
function placeAtTee(holeNumber: number): void {
  const round = useRoundStore.getState();
  const h = round.courseHoles.find((x) => x.hole === holeNumber);
  if (!h || !h.teeLat || !h.teeLng) return;
  simPos = { lat: h.teeLat, lng: h.teeLng };
  setSimulatedFix(simPos, 4);
  simLog(`positioned at hole ${holeNumber} tee`, { hole: holeNumber });
}

/**
 * Start a narrated sim round. Defaults to Menifee Palms, 9 holes.
 * Returns a short spoken confirmation (or an honest failure line).
 */
export function startVoiceSimRound(opts?: { courseId?: string; nineHoles?: boolean }): { ok: boolean; say: string } {
  const courseId = opts?.courseId ?? 'local:palms';
  const nineHoles = opts?.nineHoles ?? true;
  const round = useRoundStore.getState();
  if (round.isRoundActive) {
    return { ok: false, say: "You've already got a round going — end it first, then say start a sim round." };
  }
  const holes = getBundledHoles(courseId);
  if (holes.length === 0) {
    return { ok: false, say: "I don't have that course's hole data for a sim round yet." };
  }
  const courseName = getCourse(courseId.replace(/^local:/, ''))?.name ?? 'Sim Course';

  // 1. The simulator owns the fix — suppress the real watcher first so a real
  //    GPS fix can't fight the simulated position mid-round.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./gpsManager') as typeof import('./gpsManager')).stopGpsManager();
  } catch { /* non-fatal — setSimulatedFix overrides regardless */ }

  // 2. REAL round start (the whole point: exercise the live pipeline), tagged SIM.
  useRoundStore.getState().startRound(courseName, holes, {
    nineHole: nineHoles,
    isCompetition: false,
    notes: 'SIM round — narrated, simulated GPS',
    goal: null,
    courseId,
    courseLocation: holes[0]?.teeLat ? { lat: holes[0].teeLat, lng: holes[0].teeLng } : null,
    mode: 'free_play',
    simulated: true,
  });
  simActive = true;

  // 3. Tee of hole 1 + follow hole changes (score-driven advance jumps the fix
  //    to the next tee, exactly like walking there).
  placeAtTee(1);
  holeUnsub?.();
  let lastHole = 1;
  holeUnsub = useRoundStore.subscribe((s) => {
    if (!s.isRoundActive || !s.isSimRound) return;
    if (s.currentHole !== lastHole) {
      lastHole = s.currentHole;
      placeAtTee(s.currentHole);
    }
  });

  simLog(`started: ${courseName}, ${nineHoles ? 9 : 18} holes (voice-narrated)`, { courseId });
  return {
    ok: true,
    say: `Sim round at ${courseName}, ${nineHoles ? 'nine' : 'eighteen'} holes. You're on the first tee — tell me your shots and I'll move you down the hole.`,
  };
}

/**
 * Advance the simulated position `distanceYds` toward the current green.
 * Called from logShot when a sim round is active and the narrated shot carried a
 * distance. Clamps 3y short of the pin so the "yardage" read stays sensible until
 * the score is logged.
 */
export function simAdvanceTowardGreen(distanceYds: number): void {
  if (!isVoiceSimRoundActive()) return;
  if (!Number.isFinite(distanceYds) || distanceYds <= 0) return;
  const round = useRoundStore.getState();
  // 2026-07-05 — use the sim's OWN tracked position (see simPos note above). If it's
  // somehow unset (app restarted mid-sim), re-anchor at the current hole's tee.
  if (!simPos) {
    const h = round.courseHoles.find((x) => x.hole === round.currentHole);
    if (!h || !h.teeLat || !h.teeLng) return;
    simPos = { lat: h.teeLat, lng: h.teeLng };
  }
  const green = resolveGreenCoords(round.currentHole).middle;
  if (!green) return;
  const from = simPos;
  const remaining = haversineYards(from, green);
  const step = Math.min(distanceYds, Math.max(0, remaining - 3));
  if (step <= 0) return;
  const brg = bearingDegrees(from, green);
  const next = destinationPoint(from, brg, step);
  simPos = next;
  setSimulatedFix(next, 4);
  simLog(`moved ${Math.round(step)}y toward green (hole ${round.currentHole}, ~${Math.round(remaining - step)}y left)`, { hole: round.currentHole, stated_yds: Math.round(distanceYds), moved_yds: Math.round(step), remaining_yds: Math.round(remaining - step) });
}

/** End the sim round cleanly: restore real GPS. Round teardown is endRound's job. */
export function stopVoiceSimRound(): void {
  simActive = false;
  simPos = null;
  holeUnsub?.();
  holeUnsub = null;
  clearSimulatedFix();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void (require('./gpsManager') as typeof import('./gpsManager')).startGpsManager();
  } catch { /* non-fatal */ }
  simLog('ended — real GPS restored');
}
