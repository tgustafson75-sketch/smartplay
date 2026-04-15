// Shared in-memory player profile — module singleton, no Zustand needed.
// All imports share the same object reference within a session.

export type CommonMiss = 'right' | 'left' | null;

export interface PlayerProfile {
  commonMiss: CommonMiss;
  tempoConsistency: number | null; // 0–100
  preferredStrategy: 'safe' | 'aggressive' | null;
  miss: 'left' | 'right' | 'none' | null;
  strength: 'straight' | null;
  lastUpdated: number | null; // Date.now() timestamp
}

export const playerProfile: PlayerProfile = {
  commonMiss: null,
  tempoConsistency: null,
  preferredStrategy: null,
  miss: null,
  strength: null,
  lastUpdated: null,
};
