/**
 * engine/contextBuilder.ts
 *
 * Builds a unified FocusContext from live play-screen state.
 * Pure function — no React, no network, no global state.
 */

import type { MemoryProfile } from './memoryEngine';
import type { RoundState } from './roundEngine';
import type { PersonalityProfile } from './personalityEngine';
import type { IdentityProfile } from './identityEngine';

export interface FocusContext {
  hole: number;
  distance: number | null;
  shots: Array<{ result: string; club?: string; hole?: number; distance?: number }>;
  player: {
    tendencies: 'left' | 'right' | 'neutral';
  };
  environment: {
    weather: string | null;
    wind: string | null;
    sunset: string | null;
  };
  services: {
    restrooms: string[];
    clubhouse: string | null;
    food: string | null;
  };
  round: {
    startTime: number | null;
  };
  /** Hole note / hazard text from course data */
  holeNote: string | null;
  /** Persistent memory profile — tendencies, club distances, preferences */
  memory: MemoryProfile | null;
  /** Live round intelligence — streak, momentum, pressure */
  roundState: RoundState | null;
  /** Active caddie personality */
  personality: PersonalityProfile | null;
  /** Long-term player identity */
  identity: IdentityProfile | null;
}

const deriveTendencies = (
  shots: Array<{ result: string }>,
): 'left' | 'right' | 'neutral' => {
  if (!shots || shots.length === 0) return 'neutral';
  const rightMiss = shots.filter((s) => s.result === 'right').length;
  const leftMiss  = shots.filter((s) => s.result === 'left').length;
  if (rightMiss > leftMiss) return 'right';
  if (leftMiss > rightMiss) return 'left';
  return 'neutral';
};

export const buildFocusContext = ({
  hole,
  distance,
  shots,
  weather,
  wind,
  sunset,
  courseData,
  roundStartTime,
  holeNote,
  memory,
}: {
  hole: number;
  distance?: number | null;
  shots?: Array<{ result: string; club?: string; hole?: number; distance?: number }>;
  weather?: string | null;
  wind?: string | null;
  sunset?: string | null;
  courseData?: {
    restrooms?: string[];
    clubhouse?: string | null;
    food?: string | null;
  } | null;
  roundStartTime?: number | null;
  holeNote?: string | null;
  memory?: MemoryProfile | null;
  roundState?: RoundState | null;
  personality?: PersonalityProfile | null;
  identity?: IdentityProfile | null;
}): FocusContext => ({
  hole,
  distance: distance ?? null,
  shots: shots ?? [],
  player: {
    tendencies: deriveTendencies(shots ?? []),
  },
  environment: {
    weather: weather ?? null,
    wind:    wind    ?? null,
    sunset:  sunset  ?? null,
  },
  services: {
    restrooms: courseData?.restrooms ?? [],
    clubhouse: courseData?.clubhouse ?? null,
    food:      courseData?.food      ?? null,
  },
  round: {
    startTime: roundStartTime ?? null,
  },
  holeNote:    holeNote    ?? null,
  memory:      memory      ?? null,
  roundState:  roundState  ?? null,
  personality: personality ?? null,
  identity:    identity    ?? null,
});
