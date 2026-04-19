/**
 * features/onboarding/data/clubs.ts
 *
 * Club definitions used in the bag-setup onboarding step.
 * Mirrors types/club.ts order; adds icon + default carry for UI rendering.
 */

import type { ClubName } from '../../../types/club';

export interface ClubDef {
  name: ClubName;
  icon: string;
  defaultDistance: number;
  category: 'wood' | 'hybrid' | 'iron' | 'wedge';
}

export const CLUB_DEFS: ClubDef[] = [
  { name: 'Driver', icon: '🏌️',  defaultDistance: 230, category: 'wood'   },
  { name: '3W',     icon: '🌲',  defaultDistance: 210, category: 'wood'   },
  { name: '5W',     icon: '🌲',  defaultDistance: 195, category: 'wood'   },
  { name: '3H',     icon: '🔀',  defaultDistance: 188, category: 'hybrid' },
  { name: '4H',     icon: '🔀',  defaultDistance: 180, category: 'hybrid' },
  { name: '5I',     icon: '⛳',  defaultDistance: 170, category: 'iron'   },
  { name: '6I',     icon: '⛳',  defaultDistance: 160, category: 'iron'   },
  { name: '7I',     icon: '⛳',  defaultDistance: 150, category: 'iron'   },
  { name: '8I',     icon: '⛳',  defaultDistance: 140, category: 'iron'   },
  { name: '9I',     icon: '⛳',  defaultDistance: 130, category: 'iron'   },
  { name: 'PW',     icon: '🪶',  defaultDistance: 115, category: 'wedge'  },
  { name: 'GW',     icon: '🪶',  defaultDistance: 100, category: 'wedge'  },
  { name: 'SW',     icon: '🪶',  defaultDistance:  85, category: 'wedge'  },
  { name: 'LW',     icon: '🪶',  defaultDistance:  70, category: 'wedge'  },
];
