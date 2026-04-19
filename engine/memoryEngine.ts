/**
 * engine/memoryEngine.ts
 *
 * Local-first memory and personalization layer for Focus Mode.
 *
 * All functions are pure — no React, no storage, no side-effects.
 * The caller (CaddieContext) is responsible for persisting via AsyncStorage.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShotRecord {
  result: 'left' | 'right' | 'straight' | 'center';
  club?: string;
  distance?: number;
  hole?: number;
}

export interface MemoryProfile {
  /** Dominant miss direction derived from shot history */
  tendencies: 'left' | 'right' | 'neutral';
  /**
   * Learned average carry distance per club.
   * Values are rolling averages stored as numbers, not arrays.
   * e.g. { '7 iron': 152, 'Driver': 234 }
   */
  clubDistances: Record<string, number>;
  /**
   * Raw shot samples per club, capped at SAMPLE_CAP to stay lightweight.
   * Used internally to compute rolling averages without keeping all history.
   */
  _clubSamples: Record<string, number[]>;
  /** Full shot history (last HISTORY_CAP shots) */
  shotHistory: ShotRecord[];
  /**
   * Per-club shot result history for confidence scoring.
   * Managed by learningEngine — capped at PERFORMANCE_CAP per club.
   */
  clubPerformance: Record<string, Array<'straight' | 'left' | 'right'>>;
  preferences: {
    /** 'short' = 1-sentence max; 'long' = full explanation */
    responseLength: 'short' | 'long';
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Keep at most this many shot history entries */
const HISTORY_CAP = 200;
/** Keep at most this many samples per club for rolling average */
const SAMPLE_CAP  = 20;
/** Minimum shots before a tendency is considered reliable */
const TENDENCY_MIN = 3;

// ─── Factory ──────────────────────────────────────────────────────────────────

export const createMemoryProfile = (): MemoryProfile => ({
  tendencies:      'neutral',
  clubDistances:   {},
  _clubSamples:    {},
  shotHistory:     [],
  clubPerformance: {},
  preferences:     { responseLength: 'short' },
});

// ─── Shot Recording ───────────────────────────────────────────────────────────

/**
 * Record a new shot and recalculate tendencies.
 * Returns a new MemoryProfile — does NOT mutate the input.
 */
export const updateMemoryWithShot = (
  memory: MemoryProfile,
  shot: ShotRecord,
): MemoryProfile => {
  const updatedHistory = [...memory.shotHistory, shot].slice(-HISTORY_CAP);

  // Recalculate tendency from recent shots only (last 20 for responsiveness)
  const recent = updatedHistory.slice(-20);
  const right = recent.filter((s) => s.result === 'right').length;
  const left  = recent.filter((s) => s.result === 'left').length;

  let tendencies: MemoryProfile['tendencies'] = 'neutral';
  if (recent.length >= TENDENCY_MIN) {
    if (right > left && right / recent.length >= 0.4) tendencies = 'right';
    else if (left > right && left / recent.length >= 0.4) tendencies = 'left';
  }

  // If this shot includes a distance + club, also update the rolling average
  if (shot.club && shot.distance != null) {
    return updateClubDistance(
      { ...memory, shotHistory: updatedHistory, tendencies },
      shot.club,
      shot.distance,
    );
  }

  return { ...memory, shotHistory: updatedHistory, tendencies };
};

// ─── Club Distance Tracking ───────────────────────────────────────────────────

/**
 * Record a new distance sample for a club.
 * Maintains a rolling average capped at SAMPLE_CAP samples.
 */
export const updateClubDistance = (
  memory: MemoryProfile,
  club: string,
  distance: number,
): MemoryProfile => {
  const existing = memory._clubSamples[club] ?? [];
  const samples  = [...existing, distance].slice(-SAMPLE_CAP);
  const avg      = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);

  return {
    ...memory,
    _clubSamples:  { ...memory._clubSamples,  [club]: samples },
    clubDistances: { ...memory.clubDistances, [club]: avg },
  };
};

// ─── Preference Helpers ───────────────────────────────────────────────────────

export const setResponseLength = (
  memory: MemoryProfile,
  length: 'short' | 'long',
): MemoryProfile => ({
  ...memory,
  preferences: { ...memory.preferences, responseLength: length },
});

// ─── Read Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the learned carry distance for a club, or null if not enough data.
 * Requires at least 2 samples before trusting the average.
 */
export const getLearnedDistance = (
  memory: MemoryProfile,
  club: string,
): number | null => {
  const samples = memory._clubSamples[club];
  if (!samples || samples.length < 2) return null;
  return memory.clubDistances[club] ?? null;
};

/**
 * Find the best matching club for a given yardage using learned distances.
 * Falls back to null if no learned distances are available yet.
 */
export const getBestClubForYardage = (
  memory: MemoryProfile,
  yardage: number,
): string | null => {
  const entries = Object.entries(memory.clubDistances);
  if (entries.length === 0) return null;

  // Only use clubs with at least 2 samples
  const reliable = entries.filter(([club]) => {
    const s = memory._clubSamples[club];
    return s && s.length >= 2;
  });
  if (reliable.length === 0) return null;

  let bestClub = reliable[0][0];
  let bestDiff = Math.abs(reliable[0][1] - yardage);
  for (const [club, dist] of reliable) {
    const diff = Math.abs(dist - yardage);
    if (diff < bestDiff) { bestDiff = diff; bestClub = club; }
  }
  return bestClub;
};
