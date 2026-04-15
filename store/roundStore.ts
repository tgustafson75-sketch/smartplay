import { create } from 'zustand';

export type Shot = {
  result: string;
  mental: string;
  club: string;
  aim: string;
  target?: 'left' | 'center' | 'right';  // intended aim before the shot
  timestamp: number;
  hole: number;
  distance: number;
  situation?: string;
  // GPS-enriched fields — populated when GPS watch is active
  gpsLat?: number;
  gpsLng?: number;
  yardsBefore?: number;   // distance-to-pin at moment of shot
  yardsAfter?: number;    // distance-to-pin after player walks to ball
  yardsCarried?: number;  // computed: yardsBefore - yardsAfter
  // AI / video frame analysis fields
  sessionId?: string;     // groups shots within a round session; set once per session start
  frameTag?: string;      // media-fragment ref to the video frame (e.g. "<uri>#t=12s")
};

interface RoundState {
  scores: number[];
  currentHole: number;
  goal: 'break100' | 'break90' | null;
  club: string;
  targetDistance: number | null;
  shots: Shot[];
  shotResult: string;
  aim: string;
  activeCourse: string;
  setScore: (holeIndex: number, value: number) => void;
  setCurrentHole: (hole: number) => void;
  setGoal: (goal: 'break100' | 'break90') => void;
  setClub: (club: string) => void;
  setTargetDistance: (dist: number | null) => void;
  addShot: (shot: Shot) => void;
  clearRound: () => void;
  setShotResult: (r: string) => void;
  setAim: (a: string) => void;
  setActiveCourse: (name: string) => void;
}

export const useRoundStore = create<RoundState>((set) => ({
  scores: Array(18).fill(0),
  currentHole: 1,
  goal: null,
  club: 'Driver',
  targetDistance: null,
  shots: [],
  shotResult: '',
  aim: 'center',
  activeCourse: '',
  setScore: (holeIndex, value) =>
    set((state) => {
      const scores = [...state.scores];
      scores[holeIndex] = value;
      return { scores };
    }),
  setCurrentHole: (hole) => set(() => ({ currentHole: hole })),
  setGoal: (goal) => set(() => ({ goal })),
  setClub: (club) => set(() => ({ club })),
  setTargetDistance: (dist) => set(() => ({ targetDistance: dist })),
  addShot: (shot) => set((state) => ({ shots: [...state.shots, shot].slice(-50), shotResult: shot.result })),
  clearRound: () => set(() => ({ shots: [], shotResult: '', aim: 'center' })),
  setShotResult: (r) => set(() => ({ shotResult: r })),
  setAim: (a) => set(() => ({ aim: a })),
  setActiveCourse: (name) => set(() => ({ activeCourse: name })),
}));
