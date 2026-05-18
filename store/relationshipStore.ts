import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

// ─── TYPES ────────────────────────────────

export interface Observation {
  id: string;
  type: 'technical' | 'mental' | 'pattern' | 'strength';
  content: string;
  // Examples:
  // "hands tight on pure shots"
  // "loses focus after water holes"
  // "completely trusts 7 iron"
  // "spirals after 3 bad holes"
  timestamp: number;
  usedInAdvice: number;
  // Carlos never sees this
  // Kevin uses it silently
}

export interface HeroMoment {
  id: string;
  clipUri: string | null;
  hole: number;
  club: string;
  courseName: string;
  conditions: string;
  timestamp: number;
  kevinSaid: string;
  // Always: "Got it. That's yours."
  carlosNote: string | null;
  // Optional tag from Carlos
}

export interface Breakthrough {
  id: string;
  description: string;
  timestamp: number;
  roundNumber: number;
  // Examples:
  // "First time breaking 90"
  // "First round no spiral"
  // "First pure shot saved to reel"
}

export type MentalState =
  | 'confident'
  | 'neutral'
  | 'tight'
  | 'spiraling';

// ─── STATE ────────────────────────────────

interface RelationshipState {
  roundsTogether: number;
  sessionsTogether: number;

  // Kevin's private notes on Carlos
  // Never surfaced to user
  // Only informs Kevin's advice
  observations: Observation[];

  // Pure shot moments Carlos saved
  heroMoments: HeroMoment[];

  // Confidence by club 0–1
  confidenceByClub: Record<string, number>;

  // Spiral and mental tracking
  currentMentalState: MentalState;
  consecutiveBadHoles: number;
  spiralTriggers: string[];

  // Relationship milestones
  breakthroughs: Breakthrough[];
  firstPureShot: number | null;
  firstBreak90: number | null;
  firstRoundNoSpiral: number | null;

  // ─── ACTIONS ────────────────────────────

  incrementRounds: () => void;
  incrementSessions: () => void;

  // Kevin silently files an observation
  addObservation: (
    obs: Omit<Observation, 'id' | 'timestamp' | 'usedInAdvice'>,
  ) => void;

  // "Kevin did you get that?" → returns Kevin's response
  addHeroMoment: (
    moment: Omit<HeroMoment, 'id' | 'timestamp' | 'kevinSaid'>,
  ) => string;

  updateMentalState: (holescore: number, par: number) => void;
  resetSpiral: () => void;

  recordBreakthrough: (
    description: string,
    roundNumber: number,
  ) => void;

  updateClubConfidence: (club: string, score: number) => void;

  // Returns top 3 observations for brain prompt. PURE READ — does
  // not increment `usedInAdvice`. After the caller has actually
  // fed these to the brain, it should call markObservationsUsed(ids)
  // to record the use. Previously this getter mutated state on
  // every call, which double-counted under StrictMode re-renders
  // and any caller that read twice for the same prompt.
  getTopObservations: () => Observation[];
  markObservationsUsed: (ids: string[]) => void;

  // Returns recent hero moments
  getRecentHeroMoments: (count: number) => HeroMoment[];

  // Returns true when spiral detected
  isSpiralRisk: () => boolean;
}

// ─── STORE ────────────────────────────────

export const useRelationshipStore = create<RelationshipState>()(
  persist(
    (set, get) => ({
      roundsTogether: 0,
      sessionsTogether: 0,
      observations: [],
      heroMoments: [],
      confidenceByClub: {},
      currentMentalState: 'neutral',
      consecutiveBadHoles: 0,
      spiralTriggers: [],
      breakthroughs: [],
      firstPureShot: null,
      firstBreak90: null,
      firstRoundNoSpiral: null,

      incrementRounds: () =>
        set(s => ({ roundsTogether: s.roundsTogether + 1 })),

      incrementSessions: () =>
        set(s => ({ sessionsTogether: s.sessionsTogether + 1 })),

      addObservation: (obs) =>
        set(s => ({
          observations: [
            ...s.observations,
            {
              ...obs,
              id: `${Date.now()}_obs`,
              timestamp: Date.now(),
              usedInAdvice: 0,
            },
          ].slice(-50), // Kevin's memory is curated, not infinite
        })),

      addHeroMoment: (moment) => {
        const kevinSaid = "Got it. That's yours.";
        set(s => ({
          heroMoments: [
            ...s.heroMoments,
            {
              ...moment,
              id: `${Date.now()}_hero`,
              timestamp: Date.now(),
              kevinSaid,
            },
          ],
          firstPureShot: s.firstPureShot ?? Date.now(),
        }));
        return kevinSaid;
      },

      updateMentalState: (holescore, par) => {
        const overPar = holescore - par;
        set(s => {
          const badHoles = overPar >= 2 ? s.consecutiveBadHoles + 1 : 0;
          const mental: MentalState =
            badHoles >= 3 ? 'spiraling' :
            badHoles >= 2 ? 'tight' :
            overPar <= 0  ? 'confident' : 'neutral';
          return { consecutiveBadHoles: badHoles, currentMentalState: mental };
        });
      },

      resetSpiral: () =>
        set({ consecutiveBadHoles: 0, currentMentalState: 'neutral' }),

      recordBreakthrough: (description, roundNumber) =>
        set(s => ({
          breakthroughs: [
            ...s.breakthroughs,
            {
              id: `${Date.now()}_bt`,
              description,
              timestamp: Date.now(),
              roundNumber,
            },
          ],
          firstBreak90: description.includes('90')
            ? (s.firstBreak90 ?? Date.now())
            : s.firstBreak90,
        })),

      updateClubConfidence: (club, score) =>
        set(s => ({
          confidenceByClub: {
            ...s.confidenceByClub,
            [club]: Math.min(1, Math.max(0, score)),
          },
        })),

      getTopObservations: () => {
        // Phase V.7+ — relevance-aware ranking. Previously sorted by timestamp
        // alone, which flooded Kevin's prompt with the most recent technical
        // faults after a cage-heavy week and starved out mental + strength
        // notes. Now scores each observation on:
        //   - recency (newer is better, exponential 14-day half-life)
        //   - novelty (less-used in prior advice is better)
        // and returns up to 3 slots prioritising type diversity (1 technical
        // + 1 mental + 1 strength when available) so Kevin always has a
        // mixed picture instead of three of the same kind.
        const now = Date.now();
        const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
        const score = (o: Observation): number => {
          const ageMs = Math.max(0, now - o.timestamp);
          const recency = Math.pow(0.5, ageMs / HALF_LIFE_MS);
          const novelty = 1 / (1 + o.usedInAdvice);
          return recency * novelty;
        };

        const ranked = [...get().observations].sort((a, b) => score(b) - score(a));

        // Type diversity: take the highest-scoring of each type first, then
        // fill remaining slots with whatever ranks next.
        const top: Observation[] = [];
        const seenTypes = new Set<Observation['type']>();
        for (const o of ranked) {
          if (top.length >= 3) break;
          if (!seenTypes.has(o.type)) {
            top.push(o);
            seenTypes.add(o.type);
          }
        }
        for (const o of ranked) {
          if (top.length >= 3) break;
          if (!top.find(t => t.id === o.id)) top.push(o);
        }

        return top;
      },

      markObservationsUsed: (ids) => set(s => ({
        observations: s.observations.map(o =>
          ids.includes(o.id) ? { ...o, usedInAdvice: o.usedInAdvice + 1 } : o,
        ),
      })),

      getRecentHeroMoments: (count) =>
        [...get().heroMoments]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, count),

      isSpiralRisk: () =>
        get().consecutiveBadHoles >= 3 ||
        get().currentMentalState === 'spiraling',
    }),
    {
      name: 'relationship-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
