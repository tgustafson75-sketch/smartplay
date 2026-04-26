import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── TYPES ────────────────────────────────

export interface AcousticContact {
  contact: 'flush' | 'fat' | 'thin' | 'heel' | 'toe' | 'unknown';
  confidence: number;
  source: 'feel-tag' | 'acoustic' | 'error';
}

export interface CageShot {
  id: string;
  club: string;
  feel: string | null;
  shape: string | null;
  contact: string | null;
  direction: string | null;
  timestamp: number;
  clipUri: string | null;
  acousticContact: AcousticContact | null;
  aiAnalysis: string | null;
}

export interface CageSession {
  id: string;
  date: number;
  club: string;
  shots: CageShot[];
  dominantMiss: string | null;
  rootCause: string | null;
  summary: string | null;
}

export interface CameraAlignment {
  locked: boolean;
  targetX: number;
  targetY: number;
  lockedAt: number | null;
}

// ─── STATE ────────────────────────────────

interface CageState {
  activeSession: CageSession | null; // NOT persisted
  sessionHistory: CageSession[];
  clubProfiles: Record<string, {
    dominantMiss: string | null;
    missRate: number;
    flushRate: number;
    shotCount: number;
  }>;
  cameraAlignment: CameraAlignment | null;

  // ─── ACTIONS ────────────────────────────

  startSession: (club: string) => void;
  addShot: (shot: Omit<CageShot, 'id' | 'timestamp'>) => void;
  endSession: (summary: {
    dominantMiss: string | null;
    rootCause: string | null;
    summary: string | null;
  }) => void;
  setCameraAlignment: (x: number, y: number) => void;
  clearCameraAlignment: () => void;
  getClubProfile: (club: string) => CageState['clubProfiles'][string] | null;
}

// ─── STORE ────────────────────────────────

export const useCageStore = create<CageState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      sessionHistory: [],
      clubProfiles: {},
      cameraAlignment: null,

      startSession: (club) =>
        set({
          activeSession: {
            id: `${Date.now()}_cage`,
            date: Date.now(),
            club,
            shots: [],
            dominantMiss: null,
            rootCause: null,
            summary: null,
          },
        }),

      addShot: (shot) =>
        set(s => {
          if (!s.activeSession) return s;
          return {
            activeSession: {
              ...s.activeSession,
              shots: [
                ...s.activeSession.shots,
                { ...shot, id: `${Date.now()}_shot`, timestamp: Date.now() },
              ],
            },
          };
        }),

      endSession: (summary) =>
        set(s => {
          if (!s.activeSession) return s;
          const completed: CageSession = { ...s.activeSession, ...summary };
          return {
            activeSession: null,
            sessionHistory: [...s.sessionHistory, completed].slice(-50),
          };
        }),

      setCameraAlignment: (x, y) =>
        set({
          cameraAlignment: { locked: true, targetX: x, targetY: y, lockedAt: Date.now() },
        }),

      clearCameraAlignment: () => set({ cameraAlignment: null }),

      getClubProfile: (club) => get().clubProfiles[club] ?? null,
    }),
    {
      name: 'cage-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        // activeSession NOT persisted — in-flight session lost on crash is acceptable
        sessionHistory: s.sessionHistory,
        clubProfiles: s.clubProfiles,
        cameraAlignment: s.cameraAlignment,
      }),
    },
  ),
);
