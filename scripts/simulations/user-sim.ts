/**
 * SmartPlay Caddie — VIRTUAL USER TEST (market simulation).
 *
 * 2026-08-19 (Tim, pre-launch: "run a full code user test simulation amongst a hundred users using
 * all functions and all utilities in the app in different manners, mid to high handicappers…
 * We have to start doing some market testing to find bugs, and we're gonna start with virtual").
 *
 * ── WHY THIS IS NOT run-sim.ts ──────────────────────────────────────────────────────────────────
 * run-sim.ts is a GUARD harness: it greps source text to prove a fix is still present. It has caught
 * a lot, but by construction it cannot catch what this is for — twice this week a guard was found
 * PINNING a defect's own source string, green on the bug. A grep cannot see a NaN, an "undefined"
 * rendered into a sentence, a ladder that sorts wrong for a left-hander, or a score computed from a
 * sample too thin to mean anything.
 *
 * So this harness EXECUTES the real modules with realistic data and asserts INVARIANTS — properties
 * that must hold for every player, not expected outputs for one. Expected-output tests encode what
 * we already believe; invariants find what we never thought to believe.
 *
 * ── THE POPULATION ──────────────────────────────────────────────────────────────────────────────
 * 100 personas, deterministic from a seed (no Math.random anywhere — a failure must be reproducible
 * by seed alone, or it is noise). Mid-to-high handicappers chasing 80: index 8–26, both handednesses,
 * incomplete and duplicated bags, slicers and hookers, players who type "52" and players who say
 * "fifty two degree", metric thinkers, net-and-mat range users, cage users, thin-data newcomers and
 * players with 400 logged shots.
 *
 * Every persona runs an end-to-end journey across the app's utilities and every step is checked.
 *
 * ── READING A FAILURE ───────────────────────────────────────────────────────────────────────────
 * Each finding prints the persona seed, the stage, and the offending value. Re-run with
 * `--only=<seed>` to replay that single player.
 */

import { normalizeClub, digitizeNumberWords, isFullSwingClub } from '../../services/clubNormalize';
import { clubTendencies, describeClubTendency, describeBagTendencies, type TendencyShot } from '../../services/clubTendency';
import { inferCameraAngle } from '../../services/cameraAngleInference';
import { compareSwings, unreadableMetrics } from '../../services/swingComparisonEngine';
import { benchmarkIdealBiomech, clubCategoryFor, withinBenchmark } from '../../services/swingBenchmarks';
import { deriveDrillVerdict, targetsForDrill } from '../../services/drillVerdict';
import { generatePatternInsights, learnedMissDirection, detectPatternShift } from '../../services/patternDetection';
import { classifySession, classifyByPrimaryFault } from '../../services/swingIssueClassifier';
import { buildPoseSwingRead } from '../../services/swing/poseSwingRead';
import { poseReadToPrimaryIssue } from '../../services/swing/poseReadVerdict';
import {
  segmentsFromStrikes, segmentsFromVideoSwings, correlateStrikesWithVideo,
  filterReboundStrikes, mergeSwingDetections,
} from '../../services/swing/swingSegmentation';
import { fullCarryYards, estimateCarryYards } from '../../services/swing/carryEstimate';
import { computeTraceDirection, buildShotTrace } from '../../services/swing/ballTrace';
import { evaluateFraming } from '../../services/swing/framingCheck';
import { watchSwingToRep, watchTransitionGrade, RepDedupe } from '../../services/swing/watchRep';
import { composeFitProfile, recommendFlex, recommendBallCategory } from '../../services/practice/fitProfile';
import { composeFitGap } from '../../services/practice/fitGap';
import { buildGoalPlan } from '../../services/practice/goalPlan';
import { buildInterleavedPlan, getFocus, isInterleaved } from '../../services/practice/sessionPlan';
import { getShotShape, readActualLaunch, compareShotShape } from '../../services/practice/shotShapes';
import { composePreroundPlan, preroundReadiness } from '../../services/practice/preroundPlan';
import { computePointsPerformance, estimateSessionPoints } from '../../services/practice/pointsPerformance';
import { summarizeOpenRange } from '../../services/practice/openRangeStats';
import { CLUB_ORDER } from '../../store/clubStatsStore';

// React Native injects this global; pure modules guard dev-only logging behind it.
(globalThis as Record<string, unknown>).__DEV__ = false;

// The issue classifier narrates to console. Useful on device, unreadable across 100 players — mute it
// for the run so the findings report is the only output.
const REAL_LOG = console.log;
console.log = () => {};

// ── Deterministic RNG ────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const CLUB_ID: Record<string, string> = {
  Driver: 'DR', '3 Wood': '3W', '5 Wood': '5W', '4 Hybrid': '4H', '5 Iron': '5I', '6 Iron': '6I',
  '7 Iron': '7I', '8 Iron': '8I', '9 Iron': '9I', 'Pitching Wedge': 'PW', 'Gap Wedge': 'GW',
  'Sand Wedge': 'SW', 'Lob Wedge': 'LW', Putter: 'PT',
};
const clubIdFor = (name: string) => CLUB_ID[name] ?? name;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const chance = (r: Rng, p: number) => r() < p;

// ── Findings ─────────────────────────────────────────────────────────────────────────────────────
interface Finding { seed: number; stage: string; issue: string; detail: string; severity: 'bug' | 'suspicious'; }
const findings: Finding[] = [];
const seen = new Set<string>();
function report(seed: number, stage: string, issue: string, detail: string, severity: Finding['severity'] = 'bug') {
  // Dedupe by CLASS (stage+issue), keeping the first player who hit it — 100 players hitting one bug
  // is one bug, and a wall of duplicates buries the other nine.
  const key = stage + '|' + issue;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ seed, stage, issue, detail, severity });
}

// ── Generic invariants every user-facing value must satisfy ──────────────────────────────────────
const BAD_TOKENS = ['undefined', 'NaN', 'null', '[object Object]', 'Infinity'];
/** Any string a player can READ must never leak a JS artefact. This one check has historically been
 *  the cheapest way to find a formatting path fed by a missing value. */
function checkText(seed: number, stage: string, label: string, text: unknown) {
  if (typeof text !== 'string') return;
  for (const t of BAD_TOKENS) {
    // Word-boundary so a legitimate "nullify"/"undefined behaviour" phrasing isn't flagged.
    if (new RegExp(`\\b${t.replace(/[[\]]/g, '\\$&')}\\b`).test(text)) {
      report(seed, stage, `player-visible text contains "${t}"`, `${label}: ${JSON.stringify(text).slice(0, 160)}`);
    }
  }
}
/** Every number that reaches a player must be finite. null is fine (honest "we don't know"); NaN is not. */
function checkNum(seed: number, stage: string, label: string, v: unknown, lo?: number, hi?: number) {
  if (v == null) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    report(seed, stage, 'non-finite number', `${label} = ${String(v)}`);
    return;
  }
  if (lo != null && v < lo) report(seed, stage, 'number below its stated range', `${label} = ${v} (min ${lo})`);
  if (hi != null && v > hi) report(seed, stage, 'number above its stated range', `${label} = ${v} (max ${hi})`);
}
/** Walk an arbitrary result object and apply both checks — catches fields nobody thought to assert. */
function deepCheck(seed: number, stage: string, root: unknown, path = '') {
  if (root == null) return;
  if (typeof root === 'string') { checkText(seed, stage, path || 'value', root); return; }
  if (typeof root === 'number') { checkNum(seed, stage, path || 'value', root); return; }
  if (Array.isArray(root)) { root.forEach((v, i) => deepCheck(seed, stage, v, `${path}[${i}]`)); return; }
  if (typeof root === 'object') {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      deepCheck(seed, stage, v, path ? `${path}.${k}` : k);
    }
  }
}

// ── Persona ──────────────────────────────────────────────────────────────────────────────────────
const CLUB_SPOKEN = [
  'driver', 'three wood', '3 wood', 'five wood', 'two hybrid', 'four hybrid', 'hybrid',
  'four iron', '4 iron', '4i', 'five iron', 'six iron', 'seven iron', '7 iron', '7i', 'eight iron',
  'nine iron', 'pitching wedge', 'pw', 'gap wedge', 'fifty two degree', '52', 'fifty six', '56 degree',
  'sand wedge', 'sw', 'lob wedge', 'sixty degree', 'putter', 'eighteen degree driving iron',
  'my seven', 'the 7', 'ten point five driver', '3-wood', 'A wedge', 'u t i l i t y',
];
/** `detected_issue` — the CANONICAL issue taxonomy the classifier's maps are keyed on. */
const CANONICAL = ['club_face_open', 'club_face_closed', 'swing_path_outside_in', 'swing_path_inside_out',
  'attack_angle_steep', 'attack_angle_shallow', 'early_extension', 'over_the_top', 'chicken_wing',
  'reverse_pivot', 'none'] as const;
/** `primary_fault` — a DIFFERENT vocabulary (body faults), deliberately kept separate here. Conflating
 *  the two is exactly the class of mistake this app has shipped before, so the sim must not do it. */
const FAULTS = ['early_extension', 'sway', 'reverse_pivot', 'plane_too_steep', 'plane_too_flat',
  'head_movement', 'spine_angle_loss', 'chicken_wing', 'none'] as const;
/** Issue ids that a session persisted by an OLDER build could still carry. Real devices hold months of
 *  saved swings; a taxonomy that shifted under them is the realistic way an unknown id reaches a map. */
const LEGACY_ISSUE_IDS = ['sway', 'spine_angle_loss', 'plane_too_steep', 'casting', 'over_the_top_v1', ''] as const;
const DRILLS = ['chair-drill', 'towel-under-arms', 'feet-together', 'pump-drill', 'wall-drill', 'tempo-1-2-3', 'gate-drill', 'unknown-drill-id'] as const;

interface Persona {
  seed: number; rng: Rng; handicap: number; hand: 'right' | 'left';
  bag: { club: string; carry: number; measured: boolean; stated: boolean }[];
  shots: TendencyShot[]; sessionShots: number; thinData: boolean;
}

function makePersona(seed: number): Persona {
  const rng = mulberry32(seed);
  const handicap = int(rng, 8, 26);
  const hand: 'right' | 'left' = chance(rng, 0.12) ? 'left' : 'right';
  const thinData = chance(rng, 0.25); // a quarter of the market is brand new — the honesty stress case

  // A bag as real players actually have one: gaps, duplicates, missing wedges, quirky names.
  const base: [string, number][] = [
    ['Driver', 250 - handicap * 4], ['3 Wood', 225 - handicap * 3.5], ['5 Wood', 210 - handicap * 3],
    ['4 Hybrid', 195 - handicap * 3], ['5 Iron', 180 - handicap * 3], ['6 Iron', 170 - handicap * 2.8],
    ['7 Iron', 158 - handicap * 2.6], ['8 Iron', 146 - handicap * 2.4], ['9 Iron', 133 - handicap * 2.2],
    ['Pitching Wedge', 120 - handicap * 2], ['Gap Wedge', 105 - handicap * 1.8],
    ['Sand Wedge', 90 - handicap * 1.6], ['Lob Wedge', 72 - handicap * 1.4], ['Putter', 0],
  ];
  const bag = base
    .filter(() => chance(rng, 0.85)) // most players are missing something
    .map(([club, carry]) => ({
      club,
      carry: Math.max(0, Math.round(carry + (rng() - 0.5) * 12)),
      measured: !thinData && chance(rng, 0.45),
      stated: chance(rng, 0.3),
    }));
  if (chance(rng, 0.15) && bag.length > 2) bag.push({ ...bag[int(rng, 0, bag.length - 1)]! }); // duplicate club

  // Shot history. A tendency-biased population: slicers, hookers, and the genuinely straight.
  const bias = pick(rng, ['fade', 'draw', 'straight'] as const);
  const n = thinData ? int(rng, 0, 5) : int(rng, 20, 400);
  const shots: TendencyShot[] = [];
  for (let i = 0; i < n; i++) {
    const c = bag.length ? pick(rng, bag).club : 'Driver';
    const shapeRoll = rng();
    shots.push({
      club: chance(rng, 0.08) ? pick(rng, CLUB_SPOKEN) : c, // sometimes logged by voice, in player words
      shape: shapeRoll < 0.7 ? bias : pick(rng, ['draw', 'straight', 'fade'] as const),
      direction: pick(rng, ['left', 'right', 'straight', null] as const),
      distance_yards: chance(rng, 0.85) ? int(rng, 40, 300) : null,
      measuredCarry: chance(rng, 0.4) ? int(rng, 40, 290) : null,
    });
  }
  return { seed, rng, handicap, hand, bag, shots, sessionShots: int(rng, 1, 9), thinData };
}

// ── Journey stages ───────────────────────────────────────────────────────────────────────────────

/** 1. Onboarding + voice: the player names their clubs, typed and spoken. */
function stageClubIdentity(p: Persona) {
  const S = 'club-identity';
  for (const raw of CLUB_SPOKEN) {
    const a = normalizeClub(raw);
    if (a != null) {
      // Idempotence: feeding a canonical name back must not change it. A normalizer that isn't
      // idempotent will silently split one club into two rows downstream (tendencies, ladders, bag).
      const b = normalizeClub(a);
      if (b !== a) report(p.seed, S, 'normalizeClub is not idempotent', `"${raw}" → "${a}" → "${b}"`);
      checkText(p.seed, S, `normalizeClub("${raw}")`, a);
    }
    // Number-words must reach the digit parser (the 08-17 root cause).
    const digits = digitizeNumberWords(raw);
    checkText(p.seed, S, `digitizeNumberWords("${raw}")`, digits);
    if (/\b(fifty|sixty|eighteen|seventeen)\b/.test(raw) && !/\d/.test(digits)) {
      report(p.seed, S, 'spoken number never became a digit', `"${raw}" → "${digits}"`);
    }
    // A driver is a full-swing club; a putter is not. Anything that normalizes to Putter must agree.
    if (a === 'Putter' && isFullSwingClub(raw)) {
      report(p.seed, S, 'putter classified as a full-swing club', `"${raw}"`);
    }
  }
}

/** 2. The bag ladder + fitting utilities. */
function stageBag(p: Persona) {
  const S = 'bag/fitting';
  const profile = composeFitProfile(p.bag.map(b => ({ club: b.club, yards: b.carry, measured: b.measured, stated: b.stated })));
  deepCheck(p.seed, S, profile);
  // The ladder is the spine of every distance answer: it must be strictly descending and unique.
  for (let i = 1; i < profile.ladder.length; i++) {
    const prev = profile.ladder[i - 1]!, cur = profile.ladder[i]!;
    if (cur.yards > prev.yards) {
      report(p.seed, S, 'fit ladder is not ordered longest→shortest', `${prev.club} ${prev.yards}y then ${cur.club} ${cur.yards}y`);
    }
  }
  const names = profile.ladder.map(c => c.club);
  if (new Set(names).size !== names.length) {
    report(p.seed, S, 'the same club appears twice in the ladder', names.join(' · '));
  }
  if (names.includes('Putter')) report(p.seed, S, 'putter is in the full-swing ladder', names.join(' · '));
  // A gap must actually sit between its two bounding clubs.
  for (const g of profile.gaps) {
    checkNum(p.seed, S, 'gap.gapYards', g.gapYards, 0);
    const lo = profile.ladder.find(c => c.club === g.lower)?.yards;
    const hi = profile.ladder.find(c => c.club === g.upper)?.yards;
    if (lo != null && hi != null && !(g.centerYards >= Math.min(lo, hi) && g.centerYards <= Math.max(lo, hi))) {
      report(p.seed, S, 'gap centre falls outside the clubs that bound it', `${g.lower} ${lo}y ↔ ${g.upper} ${hi}y, centre ${g.centerYards}y`);
    }
  }
  const driver = p.bag.find(b => b.club === 'Driver');
  if (driver) {
    const flex = recommendFlex(driver.carry, driver.measured);
    if (flex) { checkText(p.seed, S, 'flex.note', flex.note); checkText(p.seed, S, 'flex.flex', flex.flex); }
    const ball = recommendBallCategory(driver.carry, p.handicap);
    deepCheck(p.seed, S, ball, 'ball');
  }
  const dialed = new Set(p.bag.filter(b => b.measured || b.stated).map(b => b.club));
  const gapReport = composeFitGap({
    owned: p.bag.map(b => ({ club_id: clubIdFor(b.club), name: b.club, brand: chance(p.rng, 0.5) ? 'Titleist' : undefined })) as never,
    gaps: profile.gaps,
    overlaps: profile.overlaps,
    hasDistance: (name: string) => dialed.has(name),
    clubOrder: CLUB_ORDER as readonly string[],
  });
  deepCheck(p.seed, S, gapReport, 'fitGap');
  for (const f of (gapReport.findings ?? [])) {
    // A finding must name a club the player actually owns — recommending against a club that isn't
    // in the bag is the kind of thing a player notices immediately.
    const named = (f as { club?: string | null }).club;
    if (named && !p.bag.some(b => b.club === named)) {
      report(p.seed, S, 'fit-gap finding names a club the player does not own', `${String((f as {kind?:string}).kind)} → ${named}`);
    }
  }
}

/** 3. Carry maths — the number the player acts on. */
function stageCarry(p: Persona) {
  const S = 'carry';
  const CLUBS = ['D', '3W', '5W', '4H', '5I', '6I', '7I', '8I', '9I', 'PW', 'GW', 'SW', 'LW', 'PT', 'unknown'] as const;
  for (const c of CLUBS) {
    const full = fullCarryYards(c as never, p.handicap, null);
    checkNum(p.seed, S, `fullCarryYards(${c})`, full, 1, 400);
    if (c === 'PT' && full != null) report(p.seed, S, 'putter reports a full carry', `PT → ${full}y`);
    // Effort must be monotonic: more effort can never carry less.
    let prev = -1;
    for (const effort of [10, 25, 50, 75, 90, 100]) {
      const est = estimateCarryYards(c as never, effort, p.handicap, null);
      checkNum(p.seed, S, `estimateCarryYards(${c},${effort}%)`, est, 0, 400);
      if (est != null) {
        if (est < prev) report(p.seed, S, 'more effort produced LESS carry', `${c}: ${effort}% → ${est}y after ${prev}y`);
        prev = est;
        if (full != null && est > full) report(p.seed, S, 'partial-effort carry exceeds full carry', `${c}: ${effort}% → ${est}y vs full ${full}y`);
      }
    }
    // A learned carry must win over the chart, for every club the player has actually measured.
    const learned = 137;
    const withLearned = fullCarryYards(c as never, p.handicap, learned);
    if (c !== 'PT' && c !== 'unknown' && withLearned !== learned) {
      report(p.seed, S, 'a measured carry did not override the standard chart', `${c}: learned ${learned}y → ${String(withLearned)}y`);
    }
  }
}

/** 4. Per-club tendencies — what the caddie tells the player their club does. */
function stageTendencies(p: Persona) {
  const S = 'tendencies';
  const carryFor = (club: string) => p.bag.find(b => b.club === club)?.carry ?? null;
  const ts = clubTendencies(p.shots, carryFor, normalizeClub as never);
  deepCheck(p.seed, S, ts);
  for (const t of ts) {
    checkNum(p.seed, S, `${t.club}.shapeShare`, t.shapeShare, 0, 1);
    checkNum(p.seed, S, `${t.club}.n`, t.n, 0);
    if (t.shapeN > t.n) report(p.seed, S, 'graded sample exceeds total sample', `${t.club}: shapeN ${t.shapeN} > n ${t.n}`);
    if (t.missN > t.n) report(p.seed, S, 'miss sample exceeds total sample', `${t.club}: missN ${t.missN} > n ${t.n}`);
    // The evidence bar is the whole point: no shape claim off a handful of shots.
    if (t.shape != null && (t.shapeN < 4 || t.shapeShare < 0.6)) {
      report(p.seed, S, 'a shape was claimed below the stated evidence bar', `${t.club}: shape ${t.shape} from ${t.shapeN} shots at ${(t.shapeShare * 100).toFixed(0)}%`);
    }
    // Identity must already be canonical — a raw spoken name here means one club split into rows.
    if (normalizeClub(t.club) !== t.club) {
      report(p.seed, S, 'tendency keyed on a non-canonical club name', `"${t.club}" normalizes to "${String(normalizeClub(t.club))}"`);
    }
    const d = describeClubTendency(t);
    if (d != null) checkText(p.seed, S, `describeClubTendency(${t.club})`, d);
  }
  const dupes = ts.map(t => t.club).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupes.length) report(p.seed, S, 'the same club produced two tendency rows', dupes.join(','));
  for (const line of describeBagTendencies(ts)) checkText(p.seed, S, 'bag tendency line', line);
}

/** 5. A range session: strikes, video swings, fusion, segmentation. */
function stageRangeSession(p: Persona) {
  const S = 'range-session';
  const r = p.rng;
  const durMs = int(r, 8000, 90000);
  const nStrikes = int(r, 0, 6);
  const strikes = Array.from({ length: nStrikes }, (_, i) => ({
    timeMs: Math.min(durMs - 200, int(r, 500, durMs - 500)),
    peakDb: -1 * int(r, 5, 60),
    attackMs: int(r, 1, 30),
    confidence: pick(r, ['high', 'medium', 'low'] as const),
  })).sort((a, b) => a.timeMs - b.timeMs);
  const nVideo = int(r, 0, 6);
  const videoSwings = Array.from({ length: nVideo }, () => ({
    timeSec: int(r, 1, Math.max(2, Math.floor(durMs / 1000) - 1)),
    confidence: chance(r, 0.5) ? ('high' as const) : ('low' as const), // the locator is BINARY
  })).sort((a, b) => a.timeSec - b.timeSec);

  const checkSegs = (label: string, segs: ReturnType<typeof segmentsFromStrikes>) => {
    deepCheck(p.seed, S, segs, label);
    segs.forEach((sg, i) => {
      checkNum(p.seed, S, `${label}[${i}].startMs`, sg.startMs, 0, durMs);
      checkNum(p.seed, S, `${label}[${i}].endMs`, sg.endMs, 0, durMs);
      checkNum(p.seed, S, `${label}[${i}].strikeMs`, sg.strikeMs, 0, durMs);
      if (!(sg.startMs <= sg.strikeMs && sg.strikeMs <= sg.endMs)) {
        report(p.seed, S, 'strike falls outside its own segment window', `${label}[${i}] ${sg.startMs}/${sg.strikeMs}/${sg.endMs}`);
      }
      if (sg.endMs <= sg.startMs) report(p.seed, S, 'segment window has no duration', `${label}[${i}] ${sg.startMs}→${sg.endMs}`);
      if (sg.index !== i + 1) report(p.seed, S, 'segment indexes are not 1..n in order', `${label}[${i}].index = ${sg.index}`);
      if (sg.confidence === 'low' && sg.confirmed) {
        report(p.seed, S, 'a low-confidence segment is marked confirmed', `${label}[${i}]`);
      }
    });
  };
  checkSegs('fromStrikes', segmentsFromStrikes(strikes, durMs));
  checkSegs('fromVideo', segmentsFromVideoSwings(videoSwings, durMs));
  checkSegs('fused', correlateStrikesWithVideo(filterReboundStrikes(strikes), videoSwings, durMs, { recoverUnmatchedHighConf: true }));

  // The 08-18/19 invariant: fusion must never LOSE a swing that a signal actually saw.
  const fused = correlateStrikesWithVideo(filterReboundStrikes(strikes), videoSwings, durMs);
  if (videoSwings.length > 0 && fused.length === 0) {
    report(p.seed, S, 'fusion returned nothing despite located video swings', `video ${videoSwings.length}, strikes ${strikes.length}`);
  }
  // Fusion must UPGRADE a low video swing the mic corroborated, or moving the gate changed nothing.
  const coincident = [{ timeSec: 5, confidence: 'low' as const }];
  const heard = [{ timeMs: 5000, peakDb: -12, attackMs: 4, confidence: 'high' as const }];
  const up = correlateStrikesWithVideo(heard, coincident, 12000);
  if (up[0] && up[0].confidence === 'low') {
    report(p.seed, S, 'a heard strike did not upgrade its low video swing', `confidence stayed ${up[0].confidence}`);
  }
  const rebounds = filterReboundStrikes(strikes);
  if (rebounds.length > strikes.length) report(p.seed, S, 'rebound filter INVENTED strikes', `${strikes.length} → ${rebounds.length}`);
  const merged = mergeSwingDetections(videoSwings);
  deepCheck(p.seed, S, merged, 'merge');
  if (merged.length > videoSwings.length) report(p.seed, S, 'the swing merger INVENTED swings', `${videoSwings.length} → ${merged.length}`);
}

/** 6. Pose read → verdict → the sentence the player is shown. */
function stagePoseRead(p: Persona) {
  const S = 'pose-read';
  const r = p.rng;
  const maybe = <T,>(v: T): T | null => (chance(r, 0.3) ? null : v); // real reads are patchy
  const bio = {
    hipTurnDeg: maybe(int(r, 10, 70)), shoulderTurnDeg: maybe(int(r, 40, 120)),
    shoulderTiltDeg: maybe(int(r, 5, 45)), weightShiftPct: maybe(int(r, -30, 95)),
    spineAngleDeltaDeg: maybe(int(r, 0, 30)), headDriftPxNorm: maybe(r() * 0.2),
    hipSlideRatio: maybe(r() * 2.5), sequencingScore: maybe(int(r, 0, 100)),
    frames: [], verdicts: { hipTurn: null, shoulderTurn: null, weightShift: null, posture: null, shoulderTilt: null, sequencing: null },
    metric_confidence: { hipTurn: r(), shoulderTurn: r(), weightShift: r(), spineAngleDelta: r(), shoulderTilt: r(), sequencing: r() },
  };
  const tempo = chance(r, 0.25) ? null : {
    ratio: chance(r, 0.15) ? null : Number((1 + r() * 5).toFixed(2)),
    backswingMs: int(r, 300, 1400), downswingMs: int(r, 120, 600),
    topMs: int(r, 300, 1400), sequencingScore: maybe(int(r, 0, 100)),
  };
  const read = buildPoseSwingRead(bio as never, tempo as never);
  deepCheck(p.seed, S, read);
  if (read.usable && read.dimensions.length === 0) {
    report(p.seed, S, 'read claims to be usable with zero dimensions', 'usable=true, dimensions=[]');
  }
  if (!read.usable && read.dimensions.length > 0) {
    report(p.seed, S, 'read claims unusable yet produced dimensions', `dimensions=${read.dimensions.length}`, 'suspicious');
  }
  for (const d of read.dimensions) {
    checkText(p.seed, S, `dimension(${d.key}).note`, d.note);
    checkText(p.seed, S, `dimension(${d.key}).label`, d.label);
    if (d.display != null) checkText(p.seed, S, `dimension(${d.key}).display`, d.display);
    if (!['strength', 'solid', 'watch', 'needs_work'].includes(d.verdict)) {
      report(p.seed, S, 'dimension verdict outside its enum', `${d.key} → ${String(d.verdict)}`);
    }
  }
  for (const f of read.faults) {
    checkText(p.seed, S, `fault(${f.key}).evidence`, f.evidence);
    checkText(p.seed, S, `fault(${f.key}).label`, f.label);
  }
  const pi = poseReadToPrimaryIssue(read);
  if (pi) deepCheck(p.seed, S, pi, 'primaryIssue');
  // A read with nothing measured must not manufacture a fault to lead with.
  const empty = buildPoseSwingRead({ ...bio, hipTurnDeg: null, shoulderTurnDeg: null, shoulderTiltDeg: null, weightShiftPct: null, spineAngleDeltaDeg: null, headDriftPxNorm: null, hipSlideRatio: null, sequencingScore: null } as never, null);
  if (empty.faults.length > 0) {
    report(p.seed, S, 'faults produced from an entirely unmeasured swing', `${empty.faults.length} fault(s) with no metrics`);
  }
  return bio;
}

/** 7. Comparison — self vs past self and vs the tour benchmark. */
function stageComparison(p: Persona, bio: Record<string, unknown>) {
  const S = 'comparison';
  const r = p.rng;
  const wrap = (b: unknown) => ({
    source: 'video', confidence: 80, frames: [], biomechanics: b, swingVerdict: null, reason: 'sim',
    age_band: 'adult', mirrored: p.hand === 'left',
    joint_confidence: { hip: 0.9, shoulder: 0.9, knee: 0.7, wrist: 0.7, ankle: 0.7, head: 0.7 }, partial_view: false,
  });
  const older = { ...bio };
  for (const k of Object.keys(older)) if (chance(r, 0.35) && k !== 'frames' && k !== 'verdicts' && k !== 'metric_confidence') (older as Record<string, unknown>)[k] = null;

  for (const kind of ['self_vs_self', 'self_vs_pro', 'self_vs_amateur', 'self_vs_avatar'] as const) {
    const ref = kind === 'self_vs_pro' && chance(r, 0.5) ? null : wrap(older);
    const res = compareSwings({ current: wrap(bio) as never, reference: ref as never, kind, club: pick(r, ['Driver', '7 Iron', 'Sand Wedge', null] as const) });
    deepCheck(p.seed, S, { overall_match: res.overall_match, takeaways: res.takeaways, voice_summary: res.voice_summary }, kind);
    checkNum(p.seed, S, `${kind}.overall_match`, res.overall_match, 0, 100);
    const usable = res.metrics.filter(m => m.current != null && m.reference != null);
    // The invariant behind the "0 MATCH" report: never assert a score off a sample too thin to average.
    if (res.overall_match != null && usable.length < 2) {
      report(p.seed, S, 'a match score was asserted from fewer than two readable metrics', `${kind}: ${res.overall_match}% from ${usable.length} metric(s)`);
    }
    if (res.overall_match === 0 && usable.length < 2) {
      report(p.seed, S, 'a confident 0% match from a near-empty comparison', `${kind}: ${usable.length} usable metric(s)`);
    }
    for (const m of res.metrics) {
      checkText(p.seed, S, `${kind}.${m.key}.verdict`, m.verdict);
      checkNum(p.seed, S, `${kind}.${m.key}.match_score`, m.match_score, 0, 100);
      // A metric with a missing side cannot honestly claim better/worse.
      if ((m.current == null || m.reference == null) && (m.direction === 'better' || m.direction === 'worse')) {
        report(p.seed, S, 'direction claimed on a metric with a missing side', `${kind}.${m.key}: ${m.direction} (cur ${String(m.current)}, ref ${String(m.reference)})`);
      }
    }
    for (const t of res.takeaways) checkText(p.seed, S, `${kind}.takeaway`, t);
    checkText(p.seed, S, `${kind}.voice_summary`, res.voice_summary);
    const gaps = unreadableMetrics(res);
    if (gaps.length + usable.length !== res.metrics.length) {
      report(p.seed, S, 'readable + unreadable does not account for every metric', `${gaps.length}+${usable.length} ≠ ${res.metrics.length}`);
    }
    if (res.benchmark) {
      checkText(p.seed, S, `${kind}.benchmark.framing`, res.benchmark.framing);
      for (const f of res.benchmark.focuses) { checkText(p.seed, S, 'benchmark focus note', f.note); checkText(p.seed, S, 'benchmark feel', f.feel); }
    }
  }
  // Benchmarks themselves
  for (const c of ['Driver', '7 Iron', 'Lob Wedge', null]) {
    const cat = clubCategoryFor(c as never);
    const ideal = benchmarkIdealBiomech(cat);
    deepCheck(p.seed, S, ideal, `benchmark(${String(c)})`);
    const w = withinBenchmark('shoulderTurn' as never, 90, cat);
    if (w != null && typeof w !== 'boolean') report(p.seed, S, 'withinBenchmark returned a non-boolean', String(w), 'suspicious');
  }
}

/** 8. Round play — pattern insights the caddie speaks between holes. */
function stageRound(p: Persona) {
  const S = 'round';
  const r = p.rng;
  const holes = int(r, 1, 18);
  const shots = Array.from({ length: int(r, 0, 90) }, () => ({
    feel: pick(r, ['flush', 'solid', 'fat', 'thin', 'heel', 'toe', 'pure', 'topped', null] as const),
    direction: pick(r, ['left', 'straight', 'right', null] as const),
    shape: pick(r, ['draw', 'straight', 'fade', null] as const),
    club: chance(r, 0.1) ? null : pick(r, p.bag.length ? p.bag.map(b => b.club) : ['7 Iron']),
    hole: int(r, 1, holes), timestamp: 1_700_000_000_000 + int(r, 0, 10_000_000),
    acousticContact: null, distance_yards: chance(r, 0.7) ? int(r, 30, 300) : null,
  }));
  const scores: Record<number, number> = {};
  for (let h = 1; h <= holes; h++) if (chance(r, 0.8)) scores[h] = int(r, 2, 10);
  const insights = generatePatternInsights(shots as never, { scores, handicap: p.handicap, dominantMiss: pick(r, ['left', 'right', 'straight', null] as const) });
  deepCheck(p.seed, S, insights);
  const miss = learnedMissDirection(shots as never);
  if (miss != null && !['left', 'right'].includes(miss)) report(p.seed, S, 'learnedMissDirection outside its enum', String(miss));
  // Pattern shift reads ROUNDS, not shots: build a believable season of them.
  const rounds = Array.from({ length: int(r, 0, 9) }, () => ({
    shots: Array.from({ length: int(r, 1, 40) }, () => ({
      direction: pick(r, ['left', 'straight', 'right', null] as const),
      club: chance(r, 0.1) ? null : pick(r, p.bag.length ? p.bag.map(b => b.club) : ['7 Iron']),
    })),
  }));
  const shift = detectPatternShift(rounds);
  if (shift) deepCheck(p.seed, S, shift, 'patternShift');
  if (rounds.length < 4 && shift != null) {
    report(p.seed, S, 'a pattern shift was claimed from too few rounds', `${rounds.length} round(s)`);
  }
  // Session classification over a realistic multi-swing capture.
  const analyses = Array.from({ length: int(r, 0, 6) }, (_, i) => ({
    swing_id: `sw${i}`,
    analysis: {
      primary_fault: pick(r, FAULTS),
      detected_issue: pick(r, CANONICAL),
      severity: pick(r, ['minor', 'moderate', 'significant'] as const),
      confidence: pick(r, ['high', 'medium', 'low'] as const),
      observation: 'simulated observation',
    },
  }));
  const cls = classifySession(analyses as never);
  if (cls) deepCheck(p.seed, S, cls, 'classifySession');
  if (analyses.length === 0 && cls != null) {
    report(p.seed, S, 'a session issue was classified from zero swings', 'expected null');
  }
  for (const f of FAULTS) {
    const c = classifyByPrimaryFault([{ swing_id: 'sw1', analysis: { primary_fault: f, detected_issue: pick(r, CANONICAL), severity: 'moderate', confidence: 'high', observation: 'sim' } }] as never);
    if (c) deepCheck(p.seed, S, c, `classifyByPrimaryFault(${f})`);
  }
}

/** 8b. Re-opening a swing saved by an OLDER build.
 *
 * Every one of these players has months of saved sessions. The classifier keys three lookup tables on
 * `detected_issue`, and nothing between a persisted session and those tables re-validates the id — so
 * a taxonomy that moved (a fault renamed, retired, or written by a build that predates the current
 * enum) is the realistic way an unknown string arrives. Two distinct failure modes fall out of one
 * bad id: `ISSUE_COACH_VOICE[id].feel` THROWS, and `ISSUE_DISPLAY_NAME[id]` quietly renders the word
 * "undefined" into a coaching sentence. */
function stageLegacyData(p: Persona) {
  const S = 'legacy-sessions';
  for (const id of LEGACY_ISSUE_IDS) {
    const analyses = [{
      swing_id: 'legacy-1',
      analysis: {
        primary_fault: 'sway', detected_issue: id, severity: 'moderate', confidence: 'medium',
        observation: 'saved by an earlier build',
      },
    }];
    try {
      const out = classifySession(analyses as never);
      if (out) deepCheck(p.seed, S, out, `classifySession("${id}")`);
    } catch (e) {
      report(p.seed, S, 'a swing saved under an older issue id CRASHES the classifier',
        `detected_issue "${id}" → ${(e as Error).message}`);
    }
    try {
      const c = classifyByPrimaryFault([{ swing_id: 'legacy-1', analysis: { primary_fault: id, detected_issue: id, severity: 'moderate', confidence: 'medium', observation: 'saved by an earlier build' } }] as never);
      if (c) deepCheck(p.seed, S, c, `classifyByPrimaryFault("${id}")`);
    } catch (e) {
      report(p.seed, S, 'an older primary_fault CRASHES the fault classifier', `"${id}" → ${(e as Error).message}`);
    }
  }
}

/** 9. Practice: drills, plans, points, open-range stats. */
function stagePractice(p: Persona) {
  const S = 'practice';
  const r = p.rng;
  for (const drillId of DRILLS) {
    const targets = targetsForDrill(drillId);
    deepCheck(p.seed, S, targets, `targets(${drillId})`);
    const v = deriveDrillVerdict({
      drillId, drillName: drillId.replace(/-/g, ' '),
      issueId: pick(r, [...FAULTS, null] as const),
      severity: pick(r, ['minor', 'moderate', 'significant', null] as const),
      confidence: pick(r, ['high', 'medium', 'low', null] as const),
      contactMishit: pick(r, ['fat', 'thin', 'topped', null] as const),
      ballLaunched: pick(r, [true, false, null] as const),
    });
    if (v) {
      deepCheck(p.seed, S, v, `drillVerdict(${drillId})`);
      if (!['got_it', 'closer', 'not_yet'].includes(v.grade)) {
        report(p.seed, S, 'drill grade outside its enum', `${drillId} → ${String(v.grade)}`);
      }
    }
  }
  // A mishit can never be credited as the drill landing — the honesty rule this module exists for.
  for (const mishit of ['fat', 'thin', 'topped'] as const) {
    const v = deriveDrillVerdict({ drillId: 'chair-drill', issueId: 'early_extension', severity: 'moderate', confidence: 'high', contactMishit: mishit, ballLaunched: false });
    if (v && v.grade === 'got_it') {
      report(p.seed, S, 'a mishit was graded as the drill landing', `${mishit} contact → got_it`);
    }
  }
  // Practice plans, across the realistic span of "how much time do I actually have".
  for (const key of ['irons', 'short_game', 'contact_lowpoint', 'driver_distance', 'driver_speed', 'hands_transition', 'putting', 'not-a-focus']) {
    const focus = getFocus(key);
    if (!focus) continue;
    for (const reps of [0, 1, 7, 30, 120]) {
      const plan = buildInterleavedPlan(focus, reps);
      deepCheck(p.seed, S, plan, `sessionPlan(${key},${reps})`);
      if (plan.length !== Math.max(0, reps)) {
        report(p.seed, S, 'the practice plan produced the wrong number of reps', `${key}: asked ${reps}, got ${plan.length}`);
      }
      plan.forEach((rep, i) => {
        // PracticeRep.index is 0-based by design (sessionPlan.ts) — assert contiguity, not a base.
        if (rep.index !== i) report(p.seed, S, 'practice rep indexes are not contiguous', `${key}[${i}].index = ${rep.index}`);
        checkText(p.seed, S, 'rep.club', rep.club);
      });
      // A multi-club focus must actually ROTATE clubs — that is the whole point of interleaving.
      // Interleaving is only meaningful once the plan is long enough to rotate at least twice.
      if (plan.length >= focus.blockSize * 2 && focus.clubs.length > 1 && !isInterleaved(plan, focus)) {
        report(p.seed, S, 'a multi-club practice plan did not interleave', `${key}: ${reps} reps, clubs ${[...new Set(plan.map(x => x.club))].join("/")}`);
      }
    }
  }
  for (const goal of ['break_80', 'break_90', 'break_100'] as const) {
    for (const loc of ['full', 'range_only', 'putting_green', 'home'] as const) {
      const gp = buildGoalPlan({ goal: goal as never, daysPerWeek: int(r, 1, 7), minutesPerSession: int(r, 5, 120), location: loc as never, deadlineDays: chance(r, 0.4) ? int(r, 1, 120) : null });
      deepCheck(p.seed, S, gp, `goalPlan(${goal},${loc})`);
    }
  }
  for (const minutes of [0, 5, 12, 20, 45, 90]) {
    const pre = composePreroundPlan({ minutes, focus: pick(r, ['tempo', 'contact', 'driver'] as const) as never });
    deepCheck(p.seed, S, pre, `preround(${minutes})`);
    const steps = (pre as { steps?: unknown[] }).steps ?? [];
    const readiness = preroundReadiness(steps.length, int(r, 0, steps.length));
    checkNum(p.seed, S, 'preroundReadiness', readiness, 0, 1);
  }
  if (preroundReadiness(0, 5) !== 0) report(p.seed, S, 'readiness from zero steps is not zero', String(preroundReadiness(0, 5)));
  for (const swings of [0, 1, 50, 5000, -3]) {
    const pts = estimateSessionPoints(swings);
    checkNum(p.seed, S, `estimateSessionPoints(${swings})`, pts, 0);
  }
  deepCheck(p.seed, S, computePointsPerformance({
    sessions: Array.from({ length: int(r, 0, 20) }, () => ({ atMs: 1_700_000_000_000 - int(r, 0, 90) * 86_400_000, swings: int(r, 0, 80) })),
    rounds: Array.from({ length: int(r, 0, 10) }, () => ({ atMs: 1_700_000_000_000 - int(r, 0, 90) * 86_400_000, score: int(r, 72, 110) })),
    nowMs: 1_700_000_000_000,
  } as never), 'points');
  deepCheck(p.seed, S, summarizeOpenRange(Array.from({ length: int(r, 0, 40) }, () => ({
    club: chance(r, 0.15) ? null : pick(r, p.bag.length ? p.bag.map(b => b.club) : ['7 Iron']),
    tier: pick(r, ['flight', 'contact', 'none'] as const),
    tempoRatio: chance(r, 0.3) ? null : Number((r() * 5).toFixed(2)),
    divergenceDeg: chance(r, 0.4) ? null : Number(((r() - 0.5) * 60).toFixed(1)),
  })) as never), 'openRange');
}

/** 10. Capture utilities: framing, camera angle, watch reps, traces, shot shapes. */
function stageCapture(p: Persona) {
  const S = 'capture';
  const r = p.rng;
  const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score });
  // Framing + angle inference across body positions, including partial views.
  for (let i = 0; i < 8; i++) {
    const wide = chance(r, 0.5);
    const spread = wide ? 0.22 : 0.04;
    const frame = {
      keypoints: [
        kp('left_shoulder', 0.5 - spread, 0.35), kp('right_shoulder', 0.5 + spread, 0.35),
        kp('left_hip', 0.5 - spread * 0.6, 0.6), kp('right_hip', 0.5 + spread * 0.6, 0.6),
        kp('left_ankle', 0.48, 0.92, chance(r, 0.7) ? 0.8 : 0.1),
        kp('right_ankle', 0.52, 0.92, chance(r, 0.7) ? 0.8 : 0.1),
        kp('nose', 0.5, 0.25),
      ],
    };
    const res = evaluateFraming(frame.keypoints as never);
    deepCheck(p.seed, S, res, 'framing');
    if (res?.feetCenter) { checkNum(p.seed, S, 'feetCenter.x', res.feetCenter.x, 0, 1); checkNum(p.seed, S, 'feetCenter.y', res.feetCenter.y, 0, 1); }
    const angle = inferCameraAngle([frame, frame] as never);
    if (angle != null && !['face_on', 'down_the_line'].includes(angle)) {
      report(p.seed, S, 'inferCameraAngle outside its enum', String(angle));
    }
    // The detector must be decisive on an unambiguous view — silence here means the toggle removal regresses.
    if (wide && angle !== 'face_on') {
      report(p.seed, S, 'a clearly face-on frame did not read as face-on', `spread ${spread}, got ${String(angle)}`, 'suspicious');
    }
    if (!wide && angle !== 'down_the_line') {
      report(p.seed, S, 'a clearly stacked frame did not read as down-the-line', `spread ${spread}, got ${String(angle)}`, 'suspicious');
    }
  }
  if (inferCameraAngle([] as never) != null) report(p.seed, S, 'camera angle asserted from zero frames', 'expected null');

  // Watch reps + dedupe: one physical swing must never become two.
  const dedupe = new RepDedupe();
  for (let i = 0; i < 6; i++) {
    const sw = { backswingMs: int(r, 200, 1500), downswingMs: int(r, 80, 700), tempoRatio: Number((r() * 5).toFixed(2)), timestamp: 1_700_000_000_000 + i * 1000 };
    const rep = watchSwingToRep(sw as never, 'full' as never);
    if (rep) {
      deepCheck(p.seed, S, rep, 'watchRep');
      // One physical swing read by BOTH IMUs must credit exactly one rep.
      const tookWatch = dedupe.take('watch', sw.timestamp);
      const tookPhoneEcho = dedupe.take('phone', sw.timestamp + 40);
      if (tookWatch && tookPhoneEcho) {
        report(p.seed, S, 'one swing credited twice across the two IMUs', `watch then phone 40ms later at ${sw.timestamp}`);
      }
    }
    const g = watchTransitionGrade(sw as never);
    if (g != null) checkText(p.seed, S, 'watchTransitionGrade', String(g));
  }
  if (watchSwingToRep({ backswingMs: 0, downswingMs: 0, tempoRatio: 0 } as never, 'full' as never) != null) {
    report(p.seed, S, 'a zero-duration watch swing became a rep', 'backswing 0 / downswing 0');
  }

  // Traces + intended shot shapes.
  const ball = { x: 0.5, y: 0.8 };
  for (let i = 0; i < 6; i++) {
    const dep = { x: r(), y: r() * 0.8 };
    const dir = computeTraceDirection(ball as never, dep as never, chance(r, 0.5) ? { x: 0.5, y: 0.1 } : null as never);
    if (dir) { deepCheck(p.seed, S, dir, 'traceDirection'); checkNum(p.seed, S, 'divergenceDeg', dir.divergenceDeg, -180, 180); }
    const launch = readActualLaunch(ball as never, dep as never);
    if (launch) deepCheck(p.seed, S, launch, 'actualLaunch');
    const def = getShotShape(pick(r, ['straight', 'draw', 'fade', 'low', 'high', 'nope'] as const));
    if (def) {
      const verdict = compareShotShape(def as never, launch as never);
      deepCheck(p.seed, S, verdict, 'shotShapeVerdict');
      checkText(p.seed, S, 'shotShape.feedback', verdict.feedback);
    }
  }
  const trace = buildShotTrace([{ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.4 }], ball, { x: 0.5, y: 0.1 });
  deepCheck(p.seed, S, trace, 'shotTrace');
  // Points outside the frame are not measurements and must never enter the drawn line.
  const dirty = buildShotTrace([{ x: 0.5, y: 0.6 }, { x: 9, y: -4 }, { x: NaN, y: 0.3 }], ball, null);
  deepCheck(p.seed, S, dirty, 'shotTrace(dirty)');
}

// ── Runner ───────────────────────────────────────────────────────────────────────────────────────
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? Number(onlyArg.split('=')[1]) : null;
const COUNT = Number(process.argv.find(a => a.startsWith('--n='))?.split('=')[1] ?? 100);
const seeds = only != null ? [only] : Array.from({ length: COUNT }, (_, i) => 1000 + i * 7919);

let crashed = 0;
const stages: [string, (p: Persona) => unknown][] = [
  ['club-identity', stageClubIdentity], ['bag/fitting', stageBag], ['carry', stageCarry],
  ['tendencies', stageTendencies], ['range-session', stageRangeSession],
  ['round', stageRound], ['legacy-sessions', stageLegacyData], ['practice', stagePractice], ['capture', stageCapture],
];

for (const seed of seeds) {
  const p = makePersona(seed);
  for (const [name, fn] of stages) {
    try { fn(p); }
    catch (e) {
      crashed++;
      report(seed, name, 'THREW an exception on realistic input', (process.env.SIM_STACK ? String((e as Error).stack) : `${(e as Error).message}`).slice(0, 700));
    }
  }
  // These two are chained (a comparison needs the pose read's biomech).
  try {
    const bio = stagePoseRead(p) as Record<string, unknown>;
    try { stageComparison(p, bio); }
    catch (e) { crashed++; report(seed, 'comparison', 'THREW an exception on realistic input', `${(e as Error).message}`.slice(0, 200)); }
  } catch (e) {
    crashed++; report(seed, 'pose-read', 'THREW an exception on realistic input', `${(e as Error).message}`.slice(0, 200));
  }
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
const bugs = findings.filter(f => f.severity === 'bug');
const sus = findings.filter(f => f.severity === 'suspicious');
console.log = REAL_LOG;
console.log(`\n=== SmartPlay virtual market test — ${seeds.length} players, mid-to-high handicap ===\n`);
if (findings.length === 0) {
  console.log('No invariant violations across the simulated population.\n');
} else {
  const show = (list: Finding[], title: string) => {
    if (!list.length) return;
    console.log(`${title} (${list.length})\n`);
    for (const f of list) {
      console.log(`  [${f.stage}] ${f.issue}`);
      console.log(`      ${f.detail}`);
      console.log(`      replay: npx tsx scripts/simulations/user-sim.ts --only=${f.seed}\n`);
    }
  };
  show(bugs, 'BUGS');
  show(sus, 'SUSPICIOUS (verify before acting)');
}
console.log(`Players: ${seeds.length}  ·  distinct issues: ${findings.length} (${bugs.length} bug, ${sus.length} suspicious)  ·  exceptions: ${crashed}`);
process.exit(bugs.length > 0 || crashed > 0 ? 1 : 0);
