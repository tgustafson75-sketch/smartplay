/**
 * 2026-05-22 — Learning Golfer Model.
 *
 * Persistent tendency database that builds a snapshot of WHO this golfer
 * is from the data the app already collects — round history, cage
 * sessions, recent analyses, profile setup. Output is fed back into the
 * brain.ts system prompt builder so the caddie's coaching gets MORE
 * specific the more the golfer plays.
 *
 * Architecture:
 *   inputs            ──┐
 *   ─ roundHistory     │
 *   ─ cage sessionHist │   →   buildGolferModel()   →   GolferModel snapshot
 *   ─ recent analyses  │                              (in-memory + AsyncStorage)
 *   ─ profile baseline ┘
 *                                                    ↓
 *                                       describeForPrompt() → string
 *                                                    ↓
 *                                       (brain.ts system prompt context)
 *
 * Design discipline:
 *   - The model is DERIVED, not authoritative. We never mutate the
 *     underlying stores. Every recompute reads fresh; cache is purely
 *     for performance.
 *   - Conservative recommendations. With <5 rounds + <3 cage sessions
 *     the snapshot says "still getting to know you" — better than
 *     overfitting to noise.
 *   - Persona-neutral. The describeForPrompt() output is facts; the
 *     persona system prompt converts them into voice.
 *   - Honest decay. Tendencies older than DECAY_DAYS get half-weight so
 *     last-week's slice doesn't haunt a player who fixed it.
 *
 * Not in scope (next sprints):
 *   - On-device fine-tune of recommendations (we hand facts to the
 *     model; the model writes the prose).
 *   - Clustering similar holes / similar courses across the player's
 *     history (would need a backend job).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoundStore, type RoundRecord, type ShotResult } from '../store/roundStore';
import { useCageStore, type CageSession } from '../store/cageStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { getRecentAnalyses } from './smartAnalysisEngine';
import { devLog } from './devLog';

// ─── Types ───────────────────────────────────────────────────────────────

export type MissDirection = 'left' | 'right' | 'straight' | 'unknown';
export type MissType =
  | 'slice' | 'hook' | 'pull' | 'push'
  | 'thin' | 'fat' | 'topped' | 'varies' | 'unknown';

export interface TendencyDistribution {
  /** Count of each value in the rolling sample. */
  counts: Record<string, number>;
  /** Sample size. */
  total: number;
  /** Most-frequent value when total >= MIN_SAMPLE; null otherwise. */
  dominant: string | null;
  /** Fraction (0..1) of total taken up by the dominant value. */
  dominant_share: number;
}

export interface ClubDistanceProfile {
  /** Club name as it appears on ShotResult.club. */
  club: string;
  /** Median observed yardage. null when no GPS-measured shots logged. */
  median_yd: number | null;
  /** Sample count (shots with a measurable distance for this club). */
  sample_size: number;
}

export interface PuttingTrend {
  /** Average putts per hole (last 5 rounds, when available). */
  avg_putts_per_hole: number | null;
  /** Most-recent PuttingAnalysis overallScore. */
  latest_overall_score: number | null;
  /** Average overallScore across recent putting analyses. */
  rolling_overall: number | null;
  sample_size: number;
}

export interface MentalTrend {
  /** Count of mental-check analyses in the rolling window. */
  recent_checks: number;
  /** Most common detected state across them. */
  prevailing_state: 'stressed' | 'locked_in' | 'neutral' | 'unknown';
}

export interface GolferModel {
  /** Snapshot timestamp (ms). */
  generated_at: number;
  /** Player display name when known. */
  first_name: string;
  /** Goal context from profile (e.g. "Break 90"). */
  goal: string | null;
  /** Self-reported / derived miss patterns. */
  miss_direction: MissDirection;
  miss_type: MissType;
  /** Distribution of shot directions across the rolling window. */
  direction_distribution: TendencyDistribution;
  /** Distribution of shot feels (flush/fat/thin/...). */
  feel_distribution: TendencyDistribution;
  /** Per-club distance medians. */
  club_distances: ClubDistanceProfile[];
  /** Scoring trend: average score-vs-par last 5 rounds. null if <2. */
  avg_score_vs_par: number | null;
  /** Putting analytics. */
  putting: PuttingTrend;
  /** Mental coaching signal from smartAnalysisEngine history. */
  mental: MentalTrend;
  /** Total data points considered (rounds + cage sessions + analyses). */
  data_points: number;
  /** True when we have enough data to be specific. <X means coach plays it safe. */
  is_confident: boolean;
  /** One-paragraph human-readable summary the brain.ts system prompt
   *  can drop in verbatim. */
  prompt_snippet: string;
}

// ─── Tunables ────────────────────────────────────────────────────────────

/** Below this combined sample size, the model is "still learning" and
 *  describeForPrompt() returns a neutral baseline instead of specifics. */
const MIN_CONFIDENT_DATA_POINTS = 30;

/** Window for "recent" round / cage history. */
const RECENT_ROUNDS = 5;
const RECENT_CAGE_SESSIONS = 10;

/** Tendencies older than this get half-weight in distributions. */
const DECAY_DAYS = 30;
const DECAY_CUTOFF_MS = DECAY_DAYS * 24 * 60 * 60 * 1000;

/** AsyncStorage key for the persisted snapshot. */
const SNAPSHOT_KEY = 'golfer-model-v1';

// ─── In-memory cache ─────────────────────────────────────────────────────

let memoSnapshot: GolferModel | null = null;
let memoBuiltAt = 0;
const MEMO_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build (or return the cached) GolferModel snapshot. The 5-minute memo
 * makes this safe to call from per-render React paths — first call
 * computes; subsequent calls within TTL are O(1).
 *
 * @param force - skip the memo and recompute
 */
export function buildGolferModel(force = false): GolferModel {
  if (!force && memoSnapshot && Date.now() - memoBuiltAt < MEMO_TTL_MS) {
    return memoSnapshot;
  }
  const round = useRoundStore.getState();
  const cage = useCageStore.getState();
  const profile = usePlayerProfileStore.getState();

  const recentRounds = round.roundHistory.slice(-RECENT_ROUNDS);
  const recentSessions = cage.sessionHistory.slice(-RECENT_CAGE_SESSIONS);
  const recentAnalyses = getRecentAnalyses(20);

  const allShots: ShotResult[] = [
    ...round.shots, // current round
    ...recentRounds.flatMap(r => r.shots ?? []),
  ];
  const cageShots = recentSessions.flatMap(s => s.shots ?? []);

  // ─── Direction distribution (recent shots, decayed) ──────────────────
  const directionDist = buildDistribution(
    allShots
      .filter(s => s.direction != null)
      .map(s => ({ value: s.direction as string, ts: s.timestamp })),
  );

  // ─── Feel distribution ────────────────────────────────────────────────
  const feelDist = buildDistribution(
    [
      ...allShots.filter(s => s.feel != null).map(s => ({ value: s.feel as string, ts: s.timestamp })),
      ...cageShots
        .filter(s => s.acousticContact != null)
        .map(s => ({ value: s.acousticContact!.contact, ts: s.timestamp })),
    ],
  );

  // ─── Club distances (median per club from GPS-measured shots) ─────────
  const clubDistances = computeClubDistances(allShots);

  // ─── Scoring trend ────────────────────────────────────────────────────
  const avgScoreVsPar = recentRounds.length >= 2
    ? avg(recentRounds.map(r => r.scoreVsPar))
    : null;

  // ─── Putting trend ────────────────────────────────────────────────────
  const puttsPerHole = recentRounds
    .map(r => avgPuttsForRound(r))
    .filter((v): v is number => v != null);
  const puttingAnalyses = recentAnalyses.filter(a => a.kind === 'putting');
  const putting: PuttingTrend = {
    avg_putts_per_hole: puttsPerHole.length > 0 ? round1(avg(puttsPerHole)) : null,
    latest_overall_score: puttingAnalyses.length > 0
      ? puttingAnalyses[puttingAnalyses.length - 1].confidence
      : null,
    rolling_overall: puttingAnalyses.length >= 2
      ? Math.round(avg(puttingAnalyses.map(a => a.confidence)))
      : null,
    sample_size: puttingAnalyses.length,
  };

  // ─── Mental trend ─────────────────────────────────────────────────────
  const mentalEntries = recentAnalyses.filter(a => a.kind === 'mental_check');
  const mental: MentalTrend = {
    recent_checks: mentalEntries.length,
    prevailing_state: prevalentMentalState(mentalEntries.map(m => m.voice_summary)),
  };

  // ─── Miss inference (combine self-reported + distribution dominant) ───
  const profileDir = profile.dominantMiss;
  const observedDir =
    directionDist.dominant === 'left' ? 'left' :
    directionDist.dominant === 'right' ? 'right' :
    directionDist.dominant === 'straight' ? 'straight' : null;
  const missDirection: MissDirection =
    (profileDir as MissDirection | null) ?? observedDir ?? 'unknown';
  const missType: MissType = (profile.missType as MissType | null) ?? inferMissType(feelDist, observedDir);

  const dataPoints = recentRounds.length + recentSessions.length + recentAnalyses.length;
  const isConfident = dataPoints >= MIN_CONFIDENT_DATA_POINTS;

  const snapshot: GolferModel = {
    generated_at: Date.now(),
    first_name: profile.firstName || 'the player',
    goal: profile.goal ?? null,
    miss_direction: missDirection,
    miss_type: missType,
    direction_distribution: directionDist,
    feel_distribution: feelDist,
    club_distances: clubDistances,
    avg_score_vs_par: avgScoreVsPar,
    putting,
    mental,
    data_points: dataPoints,
    is_confident: isConfident,
    prompt_snippet: '', // populated below so we can reference everything else
  };
  snapshot.prompt_snippet = describeForPrompt(snapshot);

  memoSnapshot = snapshot;
  memoBuiltAt = Date.now();
  // Fire-and-forget persistence so future cold starts have something to
  // show before the in-memory cache rebuilds. Errors logged, never throw.
  void AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)).catch(e =>
    devLog('[golferModel] persist failed (non-fatal): ' + String(e)),
  );
  devLog(
    `[golferModel] built points=${dataPoints} confident=${isConfident} ` +
    `dir=${missDirection} type=${missType} avg_vs_par=${avgScoreVsPar ?? '—'}`,
  );
  return snapshot;
}

/**
 * Read the persisted snapshot from disk. Cheap; useful at app start to
 * have something to feed the prompt before the first computed snapshot
 * lands. Returns null on first launch.
 */
export async function readPersistedGolferModel(): Promise<GolferModel | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as GolferModel) : null;
  } catch {
    return null;
  }
}

/**
 * Format the model into a paragraph the brain.ts system prompt can
 * inject verbatim. Always returns SOMETHING — falls back to a baseline
 * when data is too thin for specifics.
 */
export function describeForPrompt(model: GolferModel): string {
  if (!model.is_confident) {
    const goalBit = model.goal ? ` Their stated goal is to ${model.goal}.` : '';
    return `Player tendencies — still building a picture (${model.data_points} data points so far).${goalBit} Keep advice general and ask before assuming patterns.`;
  }
  const parts: string[] = [];
  parts.push(`Player: ${model.first_name}.`);
  if (model.goal) parts.push(`Goal: ${model.goal}.`);
  if (model.miss_direction !== 'unknown') {
    parts.push(`Dominant miss direction: ${model.miss_direction}.`);
  }
  if (model.miss_type !== 'unknown') {
    parts.push(`Miss type: ${model.miss_type}.`);
  }
  if (model.feel_distribution.dominant) {
    parts.push(
      `Most-common contact feel: ${model.feel_distribution.dominant} ` +
      `(${Math.round(model.feel_distribution.dominant_share * 100)}% of recent shots).`,
    );
  }
  if (model.avg_score_vs_par != null) {
    const v = model.avg_score_vs_par;
    parts.push(`Average score over last ${RECENT_ROUNDS} rounds: ${v >= 0 ? '+' : ''}${round1(v)} vs par.`);
  }
  if (model.putting.avg_putts_per_hole != null) {
    parts.push(`Avg putts/hole: ${model.putting.avg_putts_per_hole}.`);
  }
  if (model.putting.rolling_overall != null) {
    parts.push(`Recent putting confidence index: ${model.putting.rolling_overall}.`);
  }
  if (model.mental.recent_checks >= 2) {
    parts.push(`Recent mental state trend: ${model.mental.prevailing_state}.`);
  }
  if (model.club_distances.length > 0) {
    const top = model.club_distances.slice(0, 5)
      .map(c => `${c.club}=${c.median_yd ?? '?'}y`)
      .join(', ');
    parts.push(`Typical club distances: ${top}.`);
  }
  parts.push('Match coaching specificity to this — don\'t over-explain what they already know.');
  return parts.join(' ');
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function buildDistribution(
  samples: { value: string; ts: number }[],
): TendencyDistribution {
  const now = Date.now();
  const counts: Record<string, number> = {};
  let total = 0;
  for (const s of samples) {
    const weight = (now - s.ts) > DECAY_CUTOFF_MS ? 0.5 : 1;
    counts[s.value] = (counts[s.value] ?? 0) + weight;
    total += weight;
  }
  // Round counts for display.
  const rounded: Record<string, number> = {};
  let dominant: string | null = null;
  let max = 0;
  for (const [v, n] of Object.entries(counts)) {
    rounded[v] = Math.round(n * 10) / 10;
    if (n > max) { max = n; dominant = v; }
  }
  const MIN_SAMPLE = 5;
  return {
    counts: rounded,
    total: Math.round(total * 10) / 10,
    dominant: total >= MIN_SAMPLE ? dominant : null,
    dominant_share: total > 0 ? max / total : 0,
  };
}

function computeClubDistances(shots: ShotResult[]): ClubDistanceProfile[] {
  const byClub: Map<string, number[]> = new Map();
  for (const s of shots) {
    if (!s.club) continue;
    const yd =
      typeof s.distance_yards === 'number' && s.distance_yards > 0
        ? s.distance_yards
        : null;
    if (yd == null) continue;
    const arr = byClub.get(s.club) ?? [];
    arr.push(yd);
    byClub.set(s.club, arr);
  }
  const out: ClubDistanceProfile[] = [];
  for (const [club, dists] of byClub.entries()) {
    out.push({
      club,
      median_yd: dists.length > 0 ? Math.round(median(dists)) : null,
      sample_size: dists.length,
    });
  }
  // Sort by median descending so the prompt's "top 5" reads driver → wedges.
  out.sort((a, b) => (b.median_yd ?? 0) - (a.median_yd ?? 0));
  return out;
}

function avgPuttsForRound(r: RoundRecord): number | null {
  const putts = Object.values(r.putts);
  if (putts.length === 0) return null;
  return avg(putts);
}

function prevalentMentalState(
  voiceSummaries: string[],
): MentalTrend['prevailing_state'] {
  if (voiceSummaries.length === 0) return 'unknown';
  let stressed = 0, locked = 0, neutral = 0;
  for (const v of voiceSummaries) {
    const lower = v.toLowerCase();
    if (/\bbreath|breathe|reset|three breaths|smallest target/.test(lower)) stressed++;
    else if (/\brhythm|stay in this rhythm|one shot at a time/.test(lower)) locked++;
    else neutral++;
  }
  if (stressed > locked && stressed > neutral) return 'stressed';
  if (locked > stressed && locked > neutral) return 'locked_in';
  return 'neutral';
}

function inferMissType(
  feel: TendencyDistribution,
  dir: 'left' | 'right' | 'straight' | null,
): MissType {
  // Pure feel-based inference. When direction is mixed, fall back to
  // feel-dominant. When both are present, combine into slice/hook/etc.
  if (!feel.dominant) return 'unknown';
  if (feel.dominant === 'fat' || feel.dominant === 'thin' || feel.dominant === 'topped') {
    return feel.dominant as MissType;
  }
  if (dir === 'right' && feel.dominant === 'pure') return 'push';
  if (dir === 'left' && feel.dominant === 'pure') return 'pull';
  if (dir === 'right') return 'slice';
  if (dir === 'left') return 'hook';
  return 'varies';
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const n of arr) s += n;
  return s / arr.length;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
