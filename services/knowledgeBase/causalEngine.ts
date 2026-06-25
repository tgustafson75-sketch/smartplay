/**
 * CAUSAL ENGINE — the "first-domino" fault ranker.
 *
 * The standing coaching principle: the EARLIEST correctable constraint in the
 * swing is the highest-value fix; downstream faults are usually SYMPTOMS of it
 * and resolve once the root is addressed. So when several faults are detected,
 * the caddie should prescribe ONE primary intervention (the earliest-causal /
 * highest-priority fault) and treat the rest as downstream — unless a
 * downstream fault is flagged as independently persistent.
 *
 * Priority ladder (5 = earliest cause / fix first, 1 = latest symptom):
 *   P5 ROOT INPUTS        — grip, alignment, ball position, setup/posture.
 *   P4 BODY STABILITY     — posture-through-swing, balance, weight/pressure.
 *   P3 MOTION ARCHITECTURE— takeaway, shoulder turn, hip turn, connection.
 *   P2 TRANSITION         — over-the-top, casting, early-extension, stall.
 *   P1 SYMPTOMS           — face / strike / ball-flight OUTCOMES.
 *
 * Pure data + pure functions. No React, no Node — importable client & server.
 * Fault keys are the `id`s used by the golf-knowledge modules (and a set of
 * common plain-language aliases) so detectors can pass either.
 */

import type { KBEntry } from './schema';

export type FaultPriority = 1 | 2 | 3 | 4 | 5;

/**
 * Priority of each known fault. Higher = earlier cause = fix first.
 * Keyed by KBEntry id AND by common bare fault words so either resolves.
 */
export const FAULT_PRIORITY: Record<string, FaultPriority> = {
  // ── P5: ROOT INPUTS (setup) ──────────────────────────────────────────────
  'setup.grip.neutral': 5,
  'setup.alignment': 5,
  'setup.ball-position': 5,
  'setup.posture': 5,
  'setup.distance-from-ball': 5,
  grip: 5,
  alignment: 5,
  aim: 5,
  'ball-position': 5,
  setup: 5,

  // ── P4: BODY STABILITY ───────────────────────────────────────────────────
  'fs.finish.balance': 4,
  'fs.finish.hanging-back': 4,
  balance: 4,
  posture: 4,
  weight: 4,
  'weight-shift': 4,

  // ── P3: MOTION ARCHITECTURE ──────────────────────────────────────────────
  'fs.architecture.takeaway': 3,
  'fs.architecture.shoulder-turn': 3,
  'fs.architecture.connection': 3,
  'fs.backswing.flat': 3,
  'fs.backswing.upright': 3,
  'fs.backswing.across-the-line': 3,
  'fs.backswing.flying-elbow': 3,
  takeaway: 3,
  'shoulder-turn': 3,
  'hip-turn': 3,
  turn: 3,
  connection: 3,
  'restricted-backswing': 3,
  'flying-elbow': 3,

  // ── P2: TRANSITION ───────────────────────────────────────────────────────
  'fs.transition.over-the-top': 2,
  'fs.transition.casting': 2,
  'fs.transition.early-extension': 2,
  'fs.transition.stall': 2,
  'over-the-top': 2,
  casting: 2,
  'early-extension': 2,
  stall: 2,

  // ── P1: SYMPTOMS (outcomes) ──────────────────────────────────────────────
  'fs.finish.chicken-wing': 1,
  'contact.dispersion-centroid': 1,
  'contact.low-point': 1,
  'contact.compression': 1,
  'bf.face-to-path': 1,
  'bf.start-direction-face': 1,
  'bf.gear-effect': 1,
  'chicken-wing': 1,
  slice: 1,
  hook: 1,
  pull: 1,
  push: 1,
  fat: 1,
  thin: 1,
  flip: 1,
};

/**
 * Known cause → effect chains. Each chain is ordered EARLIEST-CAUSE FIRST.
 * Used to (a) prefer a root that is upstream of detected symptoms and (b)
 * explain the rationale. Keys are a mix of ids and bare fault words; the ranker
 * normalizes both.
 */
export const CAUSAL_CHAINS: string[][] = [
  // The classic slice/pull machine.
  [
    'fs.architecture.shoulder-turn', // restricted backswing / poor trail load
    'fs.backswing.upright',
    'fs.transition.over-the-top', // arms dominate, steep shaft
    'fs.transition.casting',
    'bf.face-to-path', // slice / pull outcome
  ],
  // Early-extension → loss of room → flip / chicken-wing strike scatter.
  [
    'setup.posture',
    'fs.transition.early-extension',
    'fs.transition.stall',
    'fs.finish.chicken-wing',
    'contact.dispersion-centroid',
  ],
  // Fat/thin low-point machine.
  [
    'setup.ball-position',
    'fs.finish.hanging-back',
    'contact.low-point',
    'contact.compression',
  ],
  // Aim/face → start-direction error.
  [
    'setup.alignment',
    'setup.grip.neutral',
    'bf.start-direction-face',
  ],
];

/** Normalize a fault key: lowercase, hyphenate, strip surrounding noise. */
function normFault(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '-');
}

/** Priority of a fault, defaulting to P1 (symptom) when unknown. */
export function faultPriority(fault: string): FaultPriority {
  const f = normFault(fault);
  if (FAULT_PRIORITY[fault] != null) return FAULT_PRIORITY[fault];
  if (FAULT_PRIORITY[f] != null) return FAULT_PRIORITY[f];
  return 1;
}

/**
 * For a set of detected faults, find a causal chain that contains two or more
 * of them and return the EARLIEST member present in that chain — that member
 * is upstream of the others, so it's the better primary even if priorities tie.
 * Returns null when no chain links two of the faults.
 */
function earliestInSharedChain(faults: string[]): string | null {
  const present = new Set(faults.map(normFault));
  // Build a quick id→normalized lookup so we match chain ids by either form.
  const matchesFault = (chainKey: string): string | null => {
    const nk = normFault(chainKey);
    for (const f of faults) {
      if (normFault(f) === nk) return f;
    }
    // Also allow a bare word to match an id ending (e.g. 'over-the-top' vs id).
    for (const f of faults) {
      if (normFault(f) === nk || nk.endsWith(normFault(f))) return f;
    }
    return present.has(nk) ? nk : null;
  };

  let best: { fault: string; chainLen: number } | null = null;
  for (const chain of CAUSAL_CHAINS) {
    const hits: string[] = [];
    for (const key of chain) {
      const m = matchesFault(key);
      if (m) hits.push(m);
    }
    if (hits.length >= 2) {
      // earliest in this chain is the first hit (chain is cause-first ordered)
      const earliest = hits[0];
      if (!best || chain.length > best.chainLen) {
        best = { fault: earliest, chainLen: chain.length };
      }
    }
  }
  return best?.fault ?? null;
}

export interface FaultRanking {
  /** The single highest-value intervention — fix this first. */
  primary: string;
  /** Priority of the primary fault (5 root … 1 symptom). */
  priority: FaultPriority;
  /** The remaining faults, treated as downstream symptoms. */
  downstream: string[];
  /** One-line explanation of why `primary` was chosen. */
  rationale: string;
}

/**
 * Rank a set of detected faults into one primary intervention + downstream
 * symptoms, applying the first-domino rule:
 *   1. If two faults sit on a known causal chain, the earliest one wins
 *      (it is upstream of the others).
 *   2. Otherwise the highest PRIORITY (earliest ladder rung) wins.
 *   3. Ties break toward the first-listed fault (detector's own confidence).
 */
export function rankFaults(faults: string[]): FaultRanking {
  const cleaned = faults.map(f => f.trim()).filter(Boolean);

  if (cleaned.length === 0) {
    return {
      primary: '',
      priority: 1,
      downstream: [],
      rationale: 'No faults detected.',
    };
  }

  if (cleaned.length === 1) {
    return {
      primary: cleaned[0],
      priority: faultPriority(cleaned[0]),
      downstream: [],
      rationale: 'Single fault detected — address it directly.',
    };
  }

  // Rule 1: prefer the earliest fault on a shared causal chain.
  const chainRoot = earliestInSharedChain(cleaned);

  let primary: string;
  let rationale: string;
  if (chainRoot) {
    primary = chainRoot;
    rationale =
      'Earliest fault on a known cause→effect chain — the other detected faults are likely downstream symptoms of it. Fix the root first.';
  } else {
    // Rule 2: highest priority wins; Rule 3: first-listed breaks ties.
    primary = cleaned.reduce((best, f) =>
      faultPriority(f) > faultPriority(best) ? f : best,
    cleaned[0]);
    rationale =
      'Highest-priority (earliest-correctable) fault chosen as the primary fix; the rest are treated as downstream symptoms unless independently persistent.';
  }

  const downstream = cleaned.filter(f => f !== primary);

  return {
    primary,
    priority: faultPriority(primary),
    downstream,
    rationale,
  };
}

/**
 * Convenience: given the golf-knowledge corpus, resolve a ranking's `primary`
 * fault id to its KBEntry (so the caddie can speak the principle). Returns
 * undefined if the fault isn't a known KBEntry id (e.g. a bare word alias).
 */
export function entryForFault(faultId: string, corpus: KBEntry[]): KBEntry | undefined {
  return corpus.find(e => e.id === faultId);
}
