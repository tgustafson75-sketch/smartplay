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

// ─── Course Book (static, player-INDEPENDENT course knowledge) ───────────────
// 2026-06-14 (Tim — "range book") — the static characteristics of a course/hole
// (one-liner note, description, hazards, course tips, booking metadata). Anchored
// ONCE when /api/course-content (and Places, Step 3) resolve, then it's persisted,
// OFFLINE-available, and fed into the brain + the offline responder so the caddie can
// describe a hole / its hazards with no signal. Distinct from the LEARNED, per-player
// HoleMemory above (this is the same for everyone; learned memory grows per player).

export interface StaticHoleKnowledge {
  /** 6-12 word one-liner (from course-content hole_notes). */
  note: string | null;
  /** 2-3 sentence preview (from course-content hole_descriptions). */
  description: string | null;
  /** Hazard labels ("water left", "fairway bunker"), from geometry/content. */
  hazards: string[];
}

export interface CourseBookEntry {
  course_id: string;
  name: string | null;
  holes: Record<number, StaticHoleKnowledge>;
  /** Course-wide strategic tips (course-content caddie_tips). */
  tips: string[];
  about: string | null;
  // Step 3 — course metadata from Google Places (booking + offline phone-to-call).
  website: string | null;
  phone: string | null;
  bookingUrl: string | null;
  savedAt: number;
}

// ─── Bounds (keep the persisted blob small) ──────────────────────────────────

const MIN_SAMPLES = 5;          // distances stay null until this many real shots
const SAMPLE_HALF_LIFE = 20;    // rolling-average weight (recent shots matter more)
const MAX_REFLECTIONS = 10;
const MAX_COURSE_NOTES = 12;
const MAX_RECENT_FAULTS = 8;
const MAX_TROUBLE = 6;
const MAX_COURSE_TIPS = 8;        // course-wide caddie tips kept per course book entry
const MAX_HOLE_HAZARDS = 6;       // hazard labels kept per hole

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
  /** Static, player-independent course knowledge (the "range book"). */
  courseBook: Record<string, CourseBookEntry>;

  /** Null-safe read — always returns a complete PlayerMemory (empty if new). */
  getPlayer: (playerId?: string) => PlayerMemory;

  /** Null-safe reads for the course book (offline + brain consumers). */
  getCourseBook: (courseId: string) => CourseBookEntry | null;
  getStaticHole: (courseId: string, hole: number) => StaticHoleKnowledge | null;
  /**
   * Anchor static course knowledge into the book (best-effort, additive, merge).
   * Only non-empty fields overwrite; absent fields preserve what's already saved
   * so a later partial source (e.g. Places metadata) can't wipe earlier content.
   */
  saveCourseBook: (input: {
    course_id: string;
    name?: string | null;
    holes?: { hole: number; note?: string | null; description?: string | null; hazards?: string[] }[];
    tips?: string[];
    about?: string | null;
    website?: string | null;
    phone?: string | null;
    bookingUrl?: string | null;
    nowMs: number;
  }) => void;

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
      courseBook: {},

      getPlayer: (playerId) => {
        const id = pid(playerId);
        return get().players[id] ?? emptyPlayer(id);
      },

      getCourseBook: (courseId) => {
        if (!courseId) return null;
        return get().courseBook?.[courseId] ?? null;
      },

      getStaticHole: (courseId, hole) => {
        const book = get().courseBook?.[courseId];
        return book?.holes?.[hole] ?? null;
      },

      saveCourseBook: ({ course_id, name, holes, tips, about, website, phone, bookingUrl, nowMs }) => {
        if (!course_id) return;
        set((s) => {
          const prev: CourseBookEntry = s.courseBook?.[course_id] ?? {
            course_id, name: name ?? null, holes: {}, tips: [], about: null,
            website: null, phone: null, bookingUrl: null, savedAt: 0,
          };
          // Merge holes: only overwrite a field when the incoming value is present,
          // so a hazards-only or note-only source can't wipe an existing description.
          const holesMap: Record<number, StaticHoleKnowledge> = { ...prev.holes };
          for (const h of holes ?? []) {
            if (typeof h.hole !== 'number') continue;
            const ph = holesMap[h.hole] ?? { note: null, description: null, hazards: [] };
            holesMap[h.hole] = {
              note: (h.note && h.note.trim()) ? h.note.trim() : ph.note,
              description: (h.description && h.description.trim()) ? h.description.trim() : ph.description,
              hazards: (h.hazards && h.hazards.length > 0)
                ? Array.from(new Set(h.hazards.filter((x) => typeof x === 'string' && x.trim()))).slice(0, MAX_HOLE_HAZARDS)
                : ph.hazards,
            };
          }
          const next: CourseBookEntry = {
            course_id,
            name: (name && name.trim()) ? name.trim() : prev.name,
            holes: holesMap,
            tips: (tips && tips.length > 0)
              ? Array.from(new Set(tips.filter((x) => typeof x === 'string' && x.trim()))).slice(0, MAX_COURSE_TIPS)
              : prev.tips,
            about: (about && about.trim()) ? about.trim() : prev.about,
            website: (website && website.trim()) ? website.trim() : prev.website,
            phone: (phone && phone.trim()) ? phone.trim() : prev.phone,
            bookingUrl: (bookingUrl && bookingUrl.trim()) ? bookingUrl.trim() : prev.bookingUrl,
            savedAt: nowMs,
          };
          return { courseBook: { ...s.courseBook, [course_id]: next } };
        });
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
          // Dedupe by round: a round's baseline reflection (written at endRound)
          // is REPLACED by a richer one (e.g. the recap's LLM summary) for the
          // same round_id, rather than stacking two entries for one round.
          const reflections = [reflection, ...p.reflections.filter((r) => r.round_id !== round_id)].slice(0, MAX_REFLECTIONS);
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
      // 2026-06-14 — v2 adds the static `courseBook`. Migrate preserves all learned
      // player memory and seeds an empty book; never throws, never wipes.
      version: 2,
      storage: createJSONStorage(() => getPersistStorage()),
      // `players` (learned, per-player) + `courseBook` (static, shared) both persist.
      partialize: (s) => ({ players: s.players, courseBook: s.courseBook }),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<{ players: Record<string, PlayerMemory>; courseBook: Record<string, CourseBookEntry> }>;
        return { players: p.players ?? {}, courseBook: p.courseBook ?? {} };
      },
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
