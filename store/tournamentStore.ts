/**
 * Tournament store — standalone, group-play scoring tool.
 *
 * 2026-05-24 — Built for Tim's guys-weekend trip. Separate from
 * roundStore by design: tournament mode is its own surface; doesn't
 * touch the caddie / GPS / shot-detection flow. Single scorekeeper
 * enters scores on their phone; leaderboard shares via the Share sheet.
 *
 * Six formats:
 *   - stroke         — team total strokes; lowest wins.
 *   - scramble       — one team score per hole; lowest total wins.
 *   - best_ball      — best individual score per team per hole; sum.
 *   - stableford     — points per individual per hole (par→2, birdie→3,
 *                      etc.); sum per team; highest wins.
 *   - skins          — lowest individual per hole wins a skin; carry-
 *                      over on ties.
 *   - match_play     — head-to-head between exactly 2 teams; hole won/
 *                      lost/halved; running net.
 *
 * Scores keyed by team index + (for individual formats) player index +
 * hole 1-18. Null = not yet entered. Stableford points + skins +
 * match-play results are DERIVED from the underlying gross scores
 * via helper functions in services/tournament/computation.ts — store
 * holds raw data only.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TournamentFormat =
  | 'stroke'
  | 'scramble'
  | 'best_ball'
  | 'stableford'
  | 'skins'
  | 'match_play';

/** Whether scoring is entered per-team or per-player. */
export function isIndividualFormat(f: TournamentFormat): boolean {
  return f === 'best_ball' || f === 'stableford' || f === 'skins';
}

export interface TournamentTeam {
  /** Stable id; survives reordering. */
  id: string;
  name: string;
  /** Player names; length 2-5 in v1 even for team-formats (so we can
   *  switch to individual formats without re-collecting names). */
  players: string[];
}

export interface TournamentHole {
  hole: number;        // 1..18
  par: number;         // 3..5
  handicap?: number;   // 1..18 stroke index — reserved for net play; unused in v1
}

export interface TournamentState {
  phase: 'setup' | 'scoring' | 'leaderboard';
  format: TournamentFormat;
  /** Course label; free-text or copied from bundled COURSES list. */
  courseName: string;
  /** 18 holes with par. Default = all par 4. */
  holes: TournamentHole[];
  teams: TournamentTeam[];

  /** team-format scores keyed `${teamId}.${hole}` → number | null. */
  teamScores: Record<string, number | null>;
  /** individual-format scores keyed `${teamId}.${playerIdx}.${hole}`. */
  playerScores: Record<string, number | null>;
  /** Currently focused hole (1..18). Drives the scoring grid. */
  currentHole: number;
  /** Tournament label for the leaderboard header (e.g. "Bandon Dunes Trip"). */
  label: string;
  /** Stableford point map. Mod-Stableford = different values; v1 uses
   *  the standard (eagle=4, birdie=3, par=2, bogey=1, double+=0). */
  stablefordPoints: { eagle: number; birdie: number; par: number; bogey: number; doublePlus: number };

  // ── actions ───────────────────────────────────────────────────────
  setPhase: (p: TournamentState['phase']) => void;
  setFormat: (f: TournamentFormat) => void;
  setCourseName: (n: string) => void;
  setLabel: (n: string) => void;
  setHolePar: (hole: number, par: number) => void;
  addTeam: () => void;
  removeTeam: (teamId: string) => void;
  setTeamName: (teamId: string, name: string) => void;
  setPlayerName: (teamId: string, playerIdx: number, name: string) => void;
  addPlayer: (teamId: string) => void;
  removePlayer: (teamId: string, playerIdx: number) => void;
  setTeamScore: (teamId: string, hole: number, value: number | null) => void;
  setPlayerScore: (teamId: string, playerIdx: number, hole: number, value: number | null) => void;
  setCurrentHole: (hole: number) => void;
  clearScores: () => void;
  resetTournament: () => void;
}

function makeTeam(idx: number): TournamentTeam {
  return {
    id: `team_${Date.now()}_${idx}`,
    name: `Team ${idx + 1}`,
    players: ['', ''],
  };
}

function defaultHoles(): TournamentHole[] {
  return Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4 }));
}

export const useTournamentStore = create<TournamentState>()(
  persist(
    (set, get) => ({
      phase: 'setup',
      format: 'scramble',
      courseName: '',
      holes: defaultHoles(),
      teams: [makeTeam(0), makeTeam(1)],
      teamScores: {},
      playerScores: {},
      currentHole: 1,
      label: '',
      stablefordPoints: { eagle: 4, birdie: 3, par: 2, bogey: 1, doublePlus: 0 },

      setPhase: (p) => set({ phase: p }),
      setFormat: (f) => set(s => {
        // Match Play limited to exactly 2 teams. Trim if needed.
        if (f === 'match_play' && s.teams.length > 2) {
          return { format: f, teams: s.teams.slice(0, 2) };
        }
        return { format: f };
      }),
      setCourseName: (n) => set({ courseName: n }),
      setLabel: (n) => set({ label: n }),
      setHolePar: (hole, par) => set(s => ({
        holes: s.holes.map(h => h.hole === hole ? { ...h, par } : h),
      })),
      addTeam: () => set(s => {
        if (s.teams.length >= 5) return s;
        if (s.format === 'match_play' && s.teams.length >= 2) return s;
        return { teams: [...s.teams, makeTeam(s.teams.length)] };
      }),
      removeTeam: (teamId) => set(s => {
        if (s.teams.length <= 2) return s;
        return { teams: s.teams.filter(t => t.id !== teamId) };
      }),
      setTeamName: (teamId, name) => set(s => ({
        teams: s.teams.map(t => t.id === teamId ? { ...t, name } : t),
      })),
      setPlayerName: (teamId, playerIdx, name) => set(s => ({
        teams: s.teams.map(t => t.id === teamId
          ? { ...t, players: t.players.map((p, i) => i === playerIdx ? name : p) }
          : t,
        ),
      })),
      addPlayer: (teamId) => set(s => ({
        teams: s.teams.map(t => t.id === teamId && t.players.length < 5
          ? { ...t, players: [...t.players, ''] }
          : t,
        ),
      })),
      removePlayer: (teamId, playerIdx) => set(s => ({
        teams: s.teams.map(t => t.id === teamId && t.players.length > 2
          ? { ...t, players: t.players.filter((_, i) => i !== playerIdx) }
          : t,
        ),
      })),
      setTeamScore: (teamId, hole, value) => set(s => ({
        teamScores: { ...s.teamScores, [`${teamId}.${hole}`]: value },
      })),
      setPlayerScore: (teamId, playerIdx, hole, value) => set(s => ({
        playerScores: { ...s.playerScores, [`${teamId}.${playerIdx}.${hole}`]: value },
      })),
      setCurrentHole: (hole) => set({ currentHole: Math.max(1, Math.min(18, hole)) }),
      clearScores: () => set({ teamScores: {}, playerScores: {} }),
      resetTournament: () => set({
        phase: 'setup',
        format: 'scramble',
        courseName: '',
        holes: defaultHoles(),
        teams: [makeTeam(0), makeTeam(1)],
        teamScores: {},
        playerScores: {},
        currentHole: 1,
        label: '',
      }),
    }),
    {
      name: 'tournament-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

/** Read a single team-format score. */
export function getTeamScore(teamId: string, hole: number): number | null {
  return useTournamentStore.getState().teamScores[`${teamId}.${hole}`] ?? null;
}

/** Read a single individual-format score. */
export function getPlayerScore(teamId: string, playerIdx: number, hole: number): number | null {
  return useTournamentStore.getState().playerScores[`${teamId}.${playerIdx}.${hole}`] ?? null;
}
