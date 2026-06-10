/**
 * Caddie Central Nervous System — Phase 1: the Memory store.
 *
 * A persistent, device-local, per-player + per-course memory that GROWS over
 * time. This is the brain's long-term / procedural memory: learned bag
 * distances, tendencies, preferences, and per-course/hole knowledge. Over
 * repeated rounds the caddie can lean on this instead of raw live signal.
 *
 * DESIGN RULES (see docs/caddie-cns-phase1-2.md):
 *   • ADDITIVE — nothing else changes. Phase 1 only WRITES; no feature reads it
 *     yet (Phase 2 adds the retrieval layer). So this cannot break anything.
 *   • NULL-SAFE — every getter returns a complete, typed default; learned
 *     numbers stay null until there are enough REAL samples (honesty rule).
 *   • BOUNDED — rolling sample windows + capped lists, so the persisted blob
 *     never grows without limit.
 *   • Keyed by player_id (family member → profile email → guest) + course_id.
 *
 * Every writer is best-effort and wrapped by the store's own set(); callers
 * invoke them inside try/catch so a memory hiccup can never affect a hot path.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { derivePlayerId } from './cageStore';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Learned distance model for one club. Numbers stay null until MIN_SAMPLES
 *  real shots — we never show a fabricated yardage. */
export interface ClubModel {
  club: string;
  samples: number;
  avgCarryYds: number | null;
  /** Rough 80th-percentile dispersion (yards) once enough samples exist. */
  dispersionYds: number | null;
  lastUpdated: number;
}

export interface HoleMemory {
  hole: number;
  par: number | null;
  typicalTeeClub: string | null;
  typicalApproachClub: string | null;
  /** Distilled line note, e.g. "favor left — you miss right here". */
  bestLine: string | null;
  /** Distilled green note, e.g. "back-to-front, fast". */
  greenBehavior: string | null;
  played: number;
  scoringAvg: number | null;
  trouble: string[];
  lastPlayed: number;
}

export interface CourseMemory {
  course_id: string;
  name: string | null;
  rounds_played: number;
  holes: Record<number, HoleMemory>;
  notes: string[];
  lastPlayed: number;
}

export interface Reflection {
  round_id: string;
  course_id: string | null;
  date: number;
  summary: string;
  keyTakeaways: string[];
}

export interface PlayerMemory {
  player_id: string;
  bag: Record<string, ClubModel>;
  tendencies: { dominantMiss: string | null; recentFaults: string[] };
  preferences: { respondsTo: string | null; tone: string | null };
  courses: Record<string, CourseMemory>;
  reflections: Reflection[];
  updated_at: number;
}

// ─── Bounds (keep the persisted blob small) ──────────────────────────────────

const MIN_SAMPLES = 5;          // distances stay null until this many real shots
const SAMPLE_HALF_LIFE = 20;    // rolling-average weight (recent shots matter more)
const MAX_REFLECTIONS = 10;
const MAX_COURSE_NOTES = 12;
const MAX_RECENT_FAULTS = 8;
const MAX_TROUBLE = 6;

// ─── Defaults (null-safe) ────────────────────────────────────────────────────

function emptyPlayer(player_id: string): PlayerMemory {
  return {
    player_id,
    bag: {},
    tendencies: { dominantMiss: null, recentFaults: [] },
    preferences: { respondsTo: null, tone: null },
    courses: {},
    reflections: [],
    updated_at: 0,
  };
}

function emptyHole(hole: number): HoleMemory {
  return {
    hole, par: null, typicalTeeClub: null, typicalApproachClub: null,
    bestLine: null, greenBehavior: null,
    played: 0, scoringAvg: null, trouble: [], lastPlayed: 0,
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface CaddieMemoryState {
  players: Record<string, PlayerMemory>;

  /** Null-safe read — always returns a complete PlayerMemory (empty if new). */
  getPlayer: (playerId?: string) => PlayerMemory;

  // Writers (all additive, best-effort). `playerId` defaults to the derived id.
  recordShot: (input: { club: string; carryYds: number | null; nowMs: number; playerId?: string }) => void;
  recordSwingFault: (input: { fault: string | null; nowMs: number; playerId?: string }) => void;
  recordRoundEnd: (input: {
    round_id: string;
    course_id: string;
    course_name?: string | null;
    nowMs: number;
    holes: { hole: number; par?: number | null; score?: number | null; teeClub?: string | null; approachClub?: string | null; trouble?: string[] }[];
    playerId?: string;
  }) => void;
  recordReflection: (input: { round_id: string; course_id?: string | null; summary: string; keyTakeaways?: string[]; nowMs: number; playerId?: string }) => void;
  recordPreference: (input: { respondsTo?: string | null; tone?: string | null; playerId?: string }) => void;
}

function pid(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  try { return derivePlayerId(); } catch { return 'account_holder'; }
}

export const useCaddieMemoryStore = create<CaddieMemoryState>()(
  persist(
    (set, get) => ({
      players: {},

      getPlayer: (playerId) => {
        const id = pid(playerId);
        return get().players[id] ?? emptyPlayer(id);
      },

      recordShot: ({ club, carryYds, nowMs, playerId }) => {
        if (!club || carryYds == null || !(carryYds > 0)) return; // only REAL carries
        const id = pid(playerId);
        set((s) => {
          const p = s.players[id] ?? emptyPlayer(id);
          const prev = p.bag[club] ?? { club, samples: 0, avgCarryYds: null, dispersionYds: null, lastUpdated: 0 };
          const samples = prev.samples + 1;
          // Exponential rolling average (recent shots weighted heavier than a
          // flat mean, so the bag tracks current form, not ancient outliers).
          const w = Math.min(1, 1 / Math.min(samples, SAMPLE_HALF_LIFE));
          const base = prev.avgCarryYds ?? carryYds;
          const avg = base + (carryYds - base) * w;
          // Dispersion proxy: rolling abs deviation from the running avg.
          const dev = Math.abs(carryYds - avg);
          const prevDisp = prev.dispersionYds ?? dev;
          const disp = prevDisp + (dev - prevDisp) * w;
          const next: ClubModel = {
            club,
            samples,
            // Honesty: don't surface a number until we've truly learned it.
            avgCarryYds: samples >= MIN_SAMPLES ? Math.round(avg) : null,
            dispersionYds: samples >= MIN_SAMPLES ? Math.round(disp) : null,
            lastUpdated: nowMs,
          };
          return { players: { ...s.players, [id]: { ...p, bag: { ...p.bag, [club]: next }, updated_at: nowMs } } };
        });
      },

      recordSwingFault: ({ fault, nowMs, playerId }) => {
        if (!fault || fault === 'none' || fault === 'no_dominant_fault') return;
        const id = pid(playerId);
        set((s) => {
          const p = s.players[id] ?? emptyPlayer(id);
          const recentFaults = [fault, ...p.tendencies.recentFaults.filter((f) => f !== fault)].slice(0, MAX_RECENT_FAULTS);
          // Dominant miss = most frequent recent fault.
          const counts: Record<string, number> = {};
          for (const f of recentFaults) counts[f] = (counts[f] ?? 0) + 1;
          const dominantMiss = recentFaults.length > 0
            ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
            : null;
          return { players: { ...s.players, [id]: { ...p, tendencies: { dominantMiss, recentFaults }, updated_at: nowMs } } };
        });
      },

      recordRoundEnd: ({ round_id, course_id, course_name, nowMs, holes, playerId }) => {
        if (!course_id) return;
        const id = pid(playerId);
        set((s) => {
          const p = s.players[id] ?? emptyPlayer(id);
          const prevCourse: CourseMemory = p.courses[course_id] ?? {
            course_id, name: course_name ?? null, rounds_played: 0, holes: {}, notes: [], lastPlayed: 0,
          };
          const holesMap: Record<number, HoleMemory> = { ...prevCourse.holes };
          for (const h of holes ?? []) {
            if (typeof h.hole !== 'number') continue;
            const ph = holesMap[h.hole] ?? emptyHole(h.hole);
            const played = ph.played + 1;
            const scoringAvg =
              typeof h.score === 'number' && h.score > 0
                ? (ph.scoringAvg == null ? h.score : Math.round(((ph.scoringAvg * ph.played + h.score) / played) * 10) / 10)
                : ph.scoringAvg;
            const trouble = h.trouble && h.trouble.length > 0
              ? Array.from(new Set([...h.trouble, ...ph.trouble])).slice(0, MAX_TROUBLE)
              : ph.trouble;
            holesMap[h.hole] = {
              ...ph,
              par: h.par ?? ph.par,
              typicalTeeClub: h.teeClub ?? ph.typicalTeeClub,
              typicalApproachClub: h.approachClub ?? ph.typicalApproachClub,
              played, scoringAvg, trouble, lastPlayed: nowMs,
            };
          }
          const nextCourse: CourseMemory = {
            ...prevCourse,
            name: course_name ?? prevCourse.name,
            rounds_played: prevCourse.rounds_played + 1,
            holes: holesMap,
            lastPlayed: nowMs,
          };
          return { players: { ...s.players, [id]: { ...p, courses: { ...p.courses, [course_id]: nextCourse }, updated_at: nowMs } } };
        });
      },

      recordReflection: ({ round_id, course_id, summary, keyTakeaways, nowMs, playerId }) => {
        if (!summary || !summary.trim()) return;
        const id = pid(playerId);
        set((s) => {
          const p = s.players[id] ?? emptyPlayer(id);
          const reflection: Reflection = {
            round_id, course_id: course_id ?? null, date: nowMs,
            summary: summary.trim(), keyTakeaways: (keyTakeaways ?? []).slice(0, 5),
          };
          const reflections = [reflection, ...p.reflections].slice(0, MAX_REFLECTIONS);
          return { players: { ...s.players, [id]: { ...p, reflections, updated_at: nowMs } } };
        });
      },

      recordPreference: ({ respondsTo, tone, playerId }) => {
        const id = pid(playerId);
        set((s) => {
          const p = s.players[id] ?? emptyPlayer(id);
          return { players: { ...s.players, [id]: { ...p, preferences: {
            respondsTo: respondsTo ?? p.preferences.respondsTo,
            tone: tone ?? p.preferences.tone,
          } } } };
        });
      },
    }),
    {
      name: 'caddie-memory-v1',
      version: 1,
      storage: createJSONStorage(() => getPersistStorage()),
      // Only `players` persists. Seed empty on a missing/old blob; never throw.
      partialize: (s) => ({ players: s.players }),
      migrate: (persisted) => (persisted ?? { players: {} }) as { players: Record<string, PlayerMemory> },
    },
  ),
);

/** Owner-logs / telemetry: a compact snapshot of what's been learned. */
export function caddieMemorySnapshot(playerId?: string): {
  player_id: string; clubsLearned: number; coursesKnown: number; reflections: number; dominantMiss: string | null;
} {
  const p = useCaddieMemoryStore.getState().getPlayer(playerId);
  return {
    player_id: p.player_id,
    clubsLearned: Object.values(p.bag).filter((c) => c.avgCarryYds != null).length,
    coursesKnown: Object.keys(p.courses).length,
    reflections: p.reflections.length,
    dominantMiss: p.tendencies.dominantMiss,
  };
}
