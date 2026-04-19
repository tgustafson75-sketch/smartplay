/**
 * features/smartCaddie/utils/distanceBuckets.ts
 *
 * Classifies a yardage value into a bucketed label and club category.
 * Used throughout SmartCaddieEngine to apply bucket-specific logic
 * without repeating raw yardage comparisons everywhere.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DistanceBucket =
  | 'danger_zone'    // < 90 yds  — partial shots, high error rate
  | 'partial_wedge'  // 90–119 yds — less-than-full wedge
  | 'scoring_full'   // 120–149 yds — scoring range, full iron
  | 'long_approach'  // ≥ 150 yds — long iron / hybrid / wood
  // Extended buckets (used by getBucketMeta internally)
  | 'wedge'          // alias kept for legacy callers
  | 'short_iron'
  | 'mid_iron'
  | 'long_iron'
  | 'fairway'
  | 'driver';

export type ShotShape = 'punch' | 'knock_down' | 'full_swing' | 'three_quarter' | 'easy_swing';

export interface BucketMeta {
  bucket: DistanceBucket;
  label: string;          // human-readable
  defaultClub: string;    // fallback club if no player data
  voiceHint: string;      // caddie one-liner for this range
  preferredShape: ShotShape;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_THRESHOLDS: Array<{ max: number; meta: BucketMeta }> = [
  {
    max: 100,
    meta: {
      bucket: 'wedge',
      label: 'Wedge Distance',
      defaultClub: 'PW',
      voiceHint: 'Let the loft do the work.',
      preferredShape: 'easy_swing',
    },
  },
  {
    max: 140,
    meta: {
      bucket: 'short_iron',
      label: 'Short Iron',
      defaultClub: '9 Iron',
      voiceHint: 'Pick a spot and commit.',
      preferredShape: 'full_swing',
    },
  },
  {
    max: 180,
    meta: {
      bucket: 'mid_iron',
      label: 'Mid Iron',
      defaultClub: '7 Iron',
      voiceHint: 'Smooth tempo, full finish.',
      preferredShape: 'full_swing',
    },
  },
  {
    max: 220,
    meta: {
      bucket: 'long_iron',
      label: 'Long Iron',
      defaultClub: '5 Iron',
      voiceHint: 'Ball forward, full turn.',
      preferredShape: 'three_quarter',
    },
  },
  {
    max: 260,
    meta: {
      bucket: 'fairway',
      label: 'Fairway Wood',
      defaultClub: '3 Wood',
      voiceHint: 'Fairway first — give yourself a look.',
      preferredShape: 'full_swing',
    },
  },
  {
    max: Infinity,
    meta: {
      bucket: 'driver',
      label: 'Driver Distance',
      defaultClub: 'Driver',
      voiceHint: 'Pick a clear target. Smooth and through.',
      preferredShape: 'full_swing',
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Classify a yardage into its DistanceBucket metadata. */
export function getBucketMeta(yards: number): BucketMeta {
  for (const { max, meta } of BUCKET_THRESHOLDS) {
    if (yards <= max) return meta;
  }
  return BUCKET_THRESHOLDS[BUCKET_THRESHOLDS.length - 1].meta;
}

/**
 * Primary distance classifier used by SmartCaddieEngine.
 * Returns one of four play-context buckets:
 *   'danger_zone'    < 90 yds
 *   'partial_wedge'  90–119 yds
 *   'scoring_full'   120–149 yds
 *   'long_approach'  ≥ 150 yds
 */
export const getDistanceBucket = (yards: number): DistanceBucket => {
  if (yards < 90)  return 'danger_zone';
  if (yards < 120) return 'partial_wedge';
  if (yards < 150) return 'scoring_full';
  return 'long_approach';
};

/** Alias — returns the four-bucket classification via getDistanceBucket. */
export function classifyDistance(yards: number): DistanceBucket {
  return getDistanceBucket(yards);
}

/**
 * Returns a player-adjusted yardage after accounting for elevation,
 * wind estimate, and a simple temperature delta.
 *
 * Adjustments are intentionally conservative — GPS accuracy is ±5 yds
 * so we round to the nearest 5 to avoid false precision.
 */
export function adjustedYardage(params: {
  rawYards: number;
  /** Positive = uphill (plays longer), negative = downhill */
  elevationFt?: number;
  /** Positive = headwind, negative = tailwind (mph) */
  windMph?: number;
  /** Fahrenheit; normal baseline is 72°F */
  tempF?: number;
}): number {
  const { rawYards, elevationFt = 0, windMph = 0, tempF = 72 } = params;

  // 1 ft of elevation ≈ 0.5 yds of play distance
  const elevAdj = elevationFt * 0.5;

  // 1 mph headwind ≈ 1 yd longer; tailwind ≈ 0.7 yd shorter
  const windAdj = windMph >= 0 ? windMph * 1.0 : windMph * 0.7;

  // Cold air is denser — roughly 1 yd shorter per 10°F below 72°F
  const tempAdj = ((72 - tempF) / 10) * 1;

  const adjusted = rawYards + elevAdj + windAdj + tempAdj;

  // Round to nearest 5 yards
  return Math.round(adjusted / 5) * 5;
}

/**
 * Returns the midpoint of a yardage bucket range — useful for
 * selecting a representative distance when no GPS is available.
 */
export function bucketMidpoint(bucket: DistanceBucket): number {
  const midpoints: Record<DistanceBucket, number> = {
    danger_zone:    65,
    partial_wedge: 105,
    scoring_full:  135,
    long_approach: 175,
    // legacy aliases
    wedge:      80,
    short_iron: 120,
    mid_iron:   160,
    long_iron:  200,
    fairway:    240,
    driver:     280,
  };
  return midpoints[bucket];
}
