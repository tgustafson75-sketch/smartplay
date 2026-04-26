import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  // Returns top 3 observations for brain prompt
  getTopObservations: () => Observation[];

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
        const top = [...get().observations]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 3);

        if (top.length > 0) {
          set(s => ({
            observations: s.observations.map(o =>
              top.find(t => t.id === o.id)
                ? { ...o, usedInAdvice: o.usedInAdvice + 1 }
                : o
            ),
          }));
        }

        return top;
      },

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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
