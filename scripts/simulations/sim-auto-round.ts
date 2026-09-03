/**
 * 2026-07-29 (Tim — "a version that runs the auto movement by club distance and user tendencies").
 *
 * Auto-plays a full round with NO device: a synthetic player walks each hole shot-by-shot, choosing a
 * club by the distance remaining and striking it through the app's REAL outcome engine
 * (services/simGame.ts — the same simShot / simPutt / lieFor / missBias the on-device SwingSim uses).
 * The result is shaped by two levers, exactly as Tim asked:
 *   • CLUB DISTANCE — a bag of per-club carries drives club selection + the shot's base carry.
 *   • USER TENDENCIES — the CNS dominant-miss (slice/hook) biases every shot's lateral offline via
 *     missBiasFor(), and a skill level sets the rep-quality distribution (tempo + transition), which is
 *     what simShot turns into flush-vs-fat + dispersion.
 *
 * Deterministic: seeded RNG (pass --seed=N), so a run is reproducible. Pure node — no RN, no fetch.
 *
 * Run:
 *   npx tsx scripts/simulations/sim-auto-round.ts                 # default player, mock course
 *   npx tsx scripts/simulations/sim-auto-round.ts --skill=0.8 --miss=hook --seed=7 --log
 *   npx tsx scripts/simulations/sim-auto-round.ts --holes=9
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IndoorRep } from '../../services/indoorSwing';
import { simShot, simPutt, lieFor, liePenalty, missBiasFor, scoreName, restingDistanceYds, type SimLie } from '../../services/simGame';

// ─── Args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (k: string, d: string): string => {
  const hit = argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const SKILL = Math.max(0.05, Math.min(1, parseFloat(argVal('skill', '0.62'))));   // 0..1 mean rep quality
const MISS = argVal('miss', 'slice');                                              // slice | hook | neutral
const SEED = parseInt(argVal('seed', '42'), 10);
const HOLES_WANTED = parseInt(argVal('holes', '18'), 10);
const SHOW_LOG = argv.includes('--log');

// ─── Seeded RNG (mulberry32) — reproducible without Math.random ────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// ─── The synthetic player: a bag of REAL-shaped carries + tendencies ───────────
// Yardages are a realistic mid-handicap ladder; on-device this is the player's LEARNED bag
// (shotStrategy.bagDistances() from clubStatsStore). Here it's an explicit, honest default.
interface Club { name: string; carry: number }
const BAG: Club[] = [
  { name: 'Driver', carry: 250 }, { name: '3-wood', carry: 230 }, { name: '5-wood', carry: 215 },
  { name: '4-iron', carry: 200 }, { name: '5-iron', carry: 190 }, { name: '6-iron', carry: 180 },
  { name: '7-iron', carry: 170 }, { name: '8-iron', carry: 160 }, { name: '9-iron', carry: 148 },
  { name: 'PW', carry: 135 }, { name: 'GW', carry: 120 }, { name: 'SW', carry: 100 }, { name: 'LW', carry: 78 },
].sort((a, b) => b.carry - a.carry);
const missBias = missBiasFor(MISS);

// A rep drawn from the player's skill: tempo near the 3:1 benchmark (2:1 for putts), transition +
// through-stroke by skill-weighted probability. simShot/simPutt read these to compute quality.
function drawRep(isPutt: boolean): IndoorRep {
  const benchmark = isPutt ? 2.0 : 3.0;
  const tempoRatio = benchmark + (rng() * 2 - 1) * (1 - SKILL) * benchmark * 0.6;
  const tr = rng();
  const transition: IndoorRep['transition'] = tr < SKILL ? 'smooth' : tr < SKILL + 0.25 ? 'quick' : 'snatched';
  const backswingMs = Math.round(700 + rng() * 200);
  return {
    tempoRatio: Math.max(0.5, tempoRatio),
    backswingMs,
    downswingMs: Math.max(120, Math.round(backswingMs / Math.max(1.2, tempoRatio))),
    transition,
    transitionDwellMs: Math.round(40 + rng() * 60),
    throughStroke: isPutt ? (rng() < SKILL ? 'accelerating' : 'decelerating') : undefined,
    impactSource: 'gyro+accel',
  };
}

// Club selection by distance remaining: the club whose carry is nearest the target, driver off the
// tee for long par 4s/5s. Below the shortest carry, take the wedge and let simShot's 55% floor scale it.
function pickClub(remainingYds: number, isTee: boolean): Club {
  if (isTee && remainingYds > BAG[0].carry * 0.9) return BAG[0]; // driver on anything long off the tee
  let best = BAG[BAG.length - 1];
  let bestErr = Infinity;
  for (const c of BAG) {
    const err = Math.abs(c.carry - remainingYds);
    if (err < bestErr) { bestErr = err; best = c; }
  }
  return best;
}

interface ShotLog { hole: number; stroke: number; club: string; carry: number; lateral: number; lie: SimLie; remaining: number }

function playHole(par: number, yards: number): { strokes: number; log: ShotLog[] } {
  const log: ShotLog[] = [];
  let remaining = yards;
  let lieMult = 1;         // penalty carried from the previous shot's lie
  let strokes = 0;
  const MAX_STROKES = par + 6;

  // Full-swing phase until we reach the green.
  const shortestCarry = BAG[BAG.length - 1].carry;
  while (strokes < MAX_STROKES) {
    const isTee = strokes === 0;
    const club = pickClub(remaining, isTee);
    // FINESSE: inside the shortest full club, don't swing full (that overshoots a short pitch and, with
    // abs(), oscillates forever). Model a controlled wedge whose TARGET carry is the distance itself —
    // simShot's noise/quality then leaves a realistic short remainder that converges.
    const isFinesse = remaining < shortestCarry;
    const targetCarry = isFinesse ? remaining : club.carry;
    const rep = drawRep(false);
    const out = simShot({ clubCarry: targetCarry * lieMult, rep, missBias, rng });
    strokes++;
    // New distance to target: overshoot is possible (abs). Lateral is this shot's offline.
    // The pin is a point: how far short/long, against how far offline. See restingDistanceYds —
    // the old `Math.abs(remaining - carry)` scored every offline approach as a stone-dead one.
    remaining = restingDistanceYds(remaining, out.carryYds, out.lateralYds);
    const lie = lieFor(Math.abs(out.lateralYds), remaining);
    log.push({ hole: 0, stroke: strokes, club: club.name, carry: out.carryYds, lateral: out.lateralYds, lie, remaining: Math.round(remaining) });
    lieMult = liePenalty(lie);
    if (lie === 'green' || lie === 'holed' || remaining <= 18) break;
  }

  // Putting phase: convert the leftover (yards) to feet and roll it in.
  let feet = Math.max(2, Math.round(remaining * 3));
  let putts = 0;
  while (feet > 0 && putts < 4 && strokes < MAX_STROKES + 2) {
    const rep = drawRep(true);
    const p = simPutt({ distanceFt: feet, rep, rng });
    strokes++; putts++;
    log.push({ hole: 0, stroke: strokes, club: 'Putter', carry: feet, lateral: 0, lie: p.holed ? 'holed' : 'green', remaining: p.remainingFt });
    if (p.holed) { feet = 0; break; }
    feet = p.remainingFt;
  }
  if (feet > 0) strokes++; // tap-in cleanup so no hole is left unfinished

  // Hard cap at par+6 — a real player picks up; no phantom 12s from a bad convergence tail.
  return { strokes: Math.min(strokes, par + 6), log };
}

// ─── Course: real mock holes if present, else a default par-72 18 ──────────────
interface Hole { hole: number; par: number; yards: number }
function loadHoles(): Hole[] {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../__mocks__/mockRound.json'), 'utf-8');
    const j = JSON.parse(raw) as { holes: { holeNumber: number; par: number; expectedYardage: number }[] };
    if (Array.isArray(j.holes) && j.holes.length) {
      return j.holes.map(h => ({ hole: h.holeNumber, par: h.par, yards: h.expectedYardage }));
    }
  } catch { /* fall through to default */ }
  const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const yds  = [410, 395, 175, 540, 430, 380, 200, 560, 415, 405, 445, 165, 510, 420, 390, 190, 435, 525];
  return pars.map((par, i) => ({ hole: i + 1, par, yards: yds[i] }));
}

// ─── Run ───────────────────────────────────────────────────────────────────────
const allHoles = loadHoles();
const holes = allHoles.slice(0, Math.min(HOLES_WANTED, allHoles.length));

console.log('='.repeat(64));
console.log(`AUTO-MOVEMENT ROUND SIM — club distance + user tendencies`);
console.log(`player: skill=${SKILL.toFixed(2)}  miss=${MISS} (bias ${missBias >= 0 ? '+' : ''}${missBias})  seed=${SEED}  holes=${holes.length}`);
console.log('='.repeat(64));

let totalStrokes = 0;
let totalPar = 0;
const scoreCounts: Record<string, number> = {};
for (const h of holes) {
  const { strokes, log } = playHole(h.par, h.yards);
  totalStrokes += strokes; totalPar += h.par;
  const name = scoreName(strokes, h.par);
  scoreCounts[name] = (scoreCounts[name] ?? 0) + 1;
  console.log(`H${String(h.hole).padStart(2)}  par ${h.par}  ${h.yards}y  →  ${String(strokes).padStart(2)}  ${name}`);
  if (SHOW_LOG) {
    for (const s of log) {
      const off = s.club === 'Putter' ? `${s.carry}ft putt` : `${s.club} ${s.carry}y (${s.lateral >= 0 ? '+' : ''}${s.lateral}y)`;
      console.log(`      ${s.stroke}. ${off.padEnd(26)} → ${s.lie}${s.lie === 'holed' ? '' : ` (${s.remaining}${s.club === 'Putter' ? 'ft' : 'y'} left)`}`);
    }
  }
}

const vsPar = totalStrokes - totalPar;
console.log('-'.repeat(64));
console.log(`TOTAL  ${totalStrokes}  (par ${totalPar}, ${vsPar > 0 ? '+' + vsPar : vsPar === 0 ? 'E' : vsPar})`);
console.log(`scores: ${Object.entries(scoreCounts).map(([k, v]) => `${v}× ${k}`).join(', ')}`);

/**
 * Sanity guards so this doubles as a harness check (non-zero exit on absurd output).
 *
 * 2026-09-03 — THE OLD BAND COULD NOT FAIL. It accepted par-18 through par+108, i.e. anything from
 * 54 to 180 on a par 72. It printed "✓ plausible" over a mid-handicap player averaging 72.6 and
 * going under par in 8 of 20 seeded rounds — which is how the one-dimensional distance bug survived
 * in the engine for two months with a green harness on top of it. A check that only proves the
 * total is a number reads exactly like a check that proves the total is right.
 *
 * The band now brackets golf. Nobody of any skill shoots 10 under in this engine, and a scoring
 * average past +3/hole means the shot model has stopped converging rather than that the player is
 * bad. Both edges are reachable, which is the whole point. [[break-test-every-guard-you-write]]
 */
let ok = true;
// Skill-aware at the low end: SKILL 1.0 means a flawless rep on every swing, and a 60 for that
// player is a legitimate outcome rather than a broken engine. A flat floor called that a defect.
// A mid rep (0.62) is bracketed near -10, which the fixed engine does not come close to.
const lowFloor = totalPar - Math.round(4 + SKILL * 10);
if (totalStrokes < lowFloor || totalStrokes > totalPar + holes.length * 3) {
  console.log(`\n✗ IMPLAUSIBLE TOTAL for skill ${SKILL} — engine or wiring off`); ok = false;
}
console.log(ok ? '\n✓ Round complete (plausible).' : '\n✗ Round produced implausible output.');
process.exit(ok ? 0 : 1);
