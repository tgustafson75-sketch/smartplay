import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { RoundMode } from '../types/patterns';
import type { HolePlan } from '../types/plan';
import type { ShotOutcome } from '../types/shot';
import type { RulesDecision } from '../types/penalty';

// ─── TYPES ────────────────────────────────

export interface CourseHole {
  hole: number;
  par: number;
  distance: number;
  front: number;
  back: number;
  teeLat: number;
  teeLng: number;
  middleLat: number;
  middleLng: number;
  frontLat: number;
  frontLng: number;
  backLat: number;
  backLng: number;
  note: string;
  estimated: boolean;
}

export type ShotLocation = { lat: number; lng: number };

// Phase 405 wave 3 — tee box selection. Standard course colors; the
// 'unspecified' default fires when the user starts a round without
// touching the picker (most users until they discover the affordance).
// Per-tee coordinate sets aren't wired into SmartFinder math yet — the
// selection is recorded in the round record so recap + analysis can
// show which tees the player used and future per-tee yardages can be
// added without a schema change.
export type TeeColor = 'unspecified' | 'gold' | 'blue' | 'white' | 'red';

/**
 * Phase Q.5b Component 3 — single-source-of-truth green centroid lookup.
 * Reads courseGeometryService first (the authoritative paid-tier data
 * cached after fetchCourseGeometry warms it). Falls back to legacy
 * courseHoles records when the service has no data yet (which is the
 * typical case until the round-warmup geometry call resolves).
 *
 * Lazy require avoids a circular import (courseGeometryService imports
 * from this file in some helpers).
 */
function greenForHole(
  courseId: string | null,
  holeNumber: number,
  courseHoles: CourseHole[],
): ShotLocation | null {
  // Try service first
  if (courseId) {
    try {
      const { getHoleGeometry } = require('../services/courseGeometryService');
      const g = getHoleGeometry(courseId, holeNumber);
      if (g?.green) return g.green as ShotLocation;
    } catch {}
  }
  // Legacy fallback — courseHoles records from golfcourseapi
  const h = courseHoles.find(x => x.hole === holeNumber);
  if (!h) return null;
  if (h.middleLat !== 0 && h.middleLng !== 0) return { lat: h.middleLat, lng: h.middleLng };
  if ((h.frontLat || h.backLat) && (h.frontLng || h.backLng)) {
    return { lat: (h.frontLat + h.backLat) / 2, lng: (h.frontLng + h.backLng) / 2 };
  }
  return null;
}

export interface ShotResult {
  id?: string;
  feel: 'flush' | 'solid' | 'fat' | 'thin' | 'heel' | 'toe' | 'pure' | 'topped' | null;
  direction: 'left' | 'straight' | 'right' | null;
  shape: 'draw' | 'straight' | 'fade' | null;
  club: string | null;
  hole: number;
  timestamp: number;
  acousticContact: string | null;
  // Phase BJ — free-text fields populated by Kevin's log_shot tool when
  // direction/feel didn't fit the closed enums above. outcome_text is the
  // free-text "where it ended up" (vs the ShotOutcome enum); swing_feel is
  // the swing-feel description ("rushed", "smooth"), distinct from the
  // contact-quality `feel` enum.
  outcome_text?: string | null;
  swing_feel?: string | null;
  // Outcome tagging (added v1 migration — absent in old data treated as 'clean')
  outcome?: ShotOutcome;
  penalty_strokes?: number;
  rules_decision?: RulesDecision;
  // Phase A.2 — conversational logging fields. All optional for back-compat.
  distance_yards?: number | null;
  raw_utterance?: string;
  logged_via?: 'voice' | 'tap';
  gps_location?: ShotLocation | null;       // legacy alias of start_location
  shot_in_round_index?: number;
  player_id?: string;        // reserved for Phase 1.1 multi-player
  speaker_id?: string;       // reserved for Phase 1.1 multi-player voice ID
  weather_snapshot?: Record<string, unknown> | null;  // populated by Phase C
  // Phase B — GPS shot tracking. start_location is the player position when the shot was hit;
  // end_location is the position where the next shot was taken from (or the green centroid
  // for the final shot of a hole). Both null when GPS is unavailable.
  start_location?: ShotLocation | null;
  end_location?: ShotLocation | null;
  hole_number?: number;        // alias of `hole`, populated by new code paths for forward-consistency
  // Phase 409 — TightLie analysis carried onto the shot record at
  // logShot time (copied from roundStore.pendingLieAnalysis, then
  // cleared). Recap + stats over time can correlate shot outcome to
  // lie category. Optional + nullable for back-compat with legacy
  // shots logged before Phase 409 shipped.
  lie_analysis?: import('../services/lieAnalysisService').LieAnalysis | null;
  shot_in_hole_index?: number; // 1, 2, 3 within a hole
  // Phase 110-followup — captured video clip from CaptureOverlay (voice
  // "record this shot"). Back-written by mediaCapture.commitCapture when
  // the user records a shot on this hole. Optional; null when no clip.
  clip_uri?: string | null;
  is_highlight?: boolean;
}

export interface HoleStats {
  hole: number;
  score: number;
  putts: number;
  penalties: number;
  fairwayHit: boolean | null;
  girHit: boolean | null;
}

export interface RoundPhoto {
  uri: string;
  hole: number;
  timestamp: number;
}

export interface RoundRecord {
  id: string;
  roundNumber: number;
  courseName: string | null;
  courseId: string | null;
  startedAt: number;
  endedAt: number;
  holesPlayed: number;
  totalScore: number;
  scoreVsPar: number;
  isCompetition: boolean;
  nineHoleMode: boolean;
  mode: RoundMode;
  scores: Record<number, number>;
  putts: Record<number, number>;
  plans: HolePlan[];
  shots: ShotResult[];
  // Phase R — round memory photos captured during play, displayed in recap collage.
  round_photos?: RoundPhoto[];
}

// ─── STATE ────────────────────────────────

interface RoundState {
  isRoundActive: boolean;
  mode: RoundMode;
  currentRoundId: string | null;
  plans: HolePlan[];
  activeCourse: string | null;
  activeCourseId: string | null; // golfcourseapi course_id; null for local/manual rounds
  recentCourseIds: string[]; // last 5 API course IDs played
  courseHoles: CourseHole[];
  nineHoleMode: boolean;
  isCompetition: boolean;
  roundNotes: string;
  goal: string | null;

  currentHole: number;
  currentYardage: number | null;
  club: string | null;
  mentalState: string;
  riskMode: 'safe' | 'normal' | 'aggressive';

  scores: Record<number, number>;
  putts: Record<number, number>;
  penalties: Record<number, number>;
  shots: ShotResult[];
  holeStats: HoleStats[];
  // Phase R — memory photos captured during the active round.
  currentRoundPhotos: RoundPhoto[];

  // Phase 405 wave 3 — tee box color selected by the player for this
  // round. Standard set covers most courses; 'unspecified' is the
  // default until a UI surface forces a choice. The recap layer
  // shows the played tee so the user's score is contextual.
  selectedTee: TeeColor;

  // Phase 409 — TightLie pending result. The lie analysis completes
  // BEFORE the player hits the shot, so it can't be attached to a
  // ShotResult that doesn't exist yet. This slot holds the most
  // recent confirmed analysis until logShot fires (at which point
  // it's copied onto the shot and cleared). The caddie brain reads
  // this slot directly so a follow-up "what should I hit" question
  // gets answered with the lie reality without the user re-stating it.
  pendingLieAnalysis: import('../services/lieAnalysisService').LieAnalysis | null;

  roundStartTime: number | null;
  roundNumber: number;
  roundHistory: RoundRecord[];
  active_ghost: { source_round_id: string; label: string } | null;
  // Phase AQ — rolling window of synthesized round insights. One-paragraph
  // Sonnet summary per completed round (what to remember next time at
  // this course / when similar patterns appear). Last 10 retained.
  recentInsights: { round_id: string; course: string; insight: string; created_at: number }[];

  // Phase BJ — emotional state log. Per-utterance log when Tim voices a
  // feeling. Reset at round start. Future pattern detector can correlate
  // valence ↔ shot outcomes ("you tend to push right when stressed"); for
  // now this is just storage.
  emotionalLog: { state: string; valence: 'positive' | 'neutral' | 'negative'; hole: number; timestamp: number }[];

  // ─── ACTIONS ────────────────────────────

  startRound: (
    course: string,
    holes: CourseHole[],
    options: {
      nineHole: boolean;
      isCompetition: boolean;
      notes: string;
      goal: string | null;
      courseId?: string | null;
      mode?: RoundMode;
      // Phase 405 wave 3 — tee box selection. Persisted on the round
      // record so recap shows which tees were played; informational
      // today (per-tee coordinates aren't wired into SmartFinder math
      // yet). Defaults to 'white' when omitted.
      selectedTee?: TeeColor;
    },
  ) => void;
  setSelectedTee: (color: TeeColor) => void;

  // Phase 409 — TightLie pending lie analysis.
  setPendingLieAnalysis: (analysis: import('../services/lieAnalysisService').LieAnalysis | null) => void;
  clearPendingLieAnalysis: () => void;
  setActiveCourseId: (id: string | null) => void;
  setCurrentRoundMode: (mode: RoundMode) => void;
  addOrUpdatePlan: (partial: {
    hole_number: number;
    markers: HolePlan['markers'];
    computed_yardages: HolePlan['computed_yardages'];
  }) => void;
  lockPlanForHole: (holeNumber: number) => void;
  getPlanForHole: (holeNumber: number) => HolePlan | null;

  /**
   * Finalize the active round and return the round_id of the just-
   * persisted RoundRecord. Callers route the user to /recap/<id> with
   * the return value. Always returns a string — even on edge-case calls
   * with no shots, a record is appended.
   * Also pushes a fresh score-differential to recent_differentials and
   * recomputes handicap_index when course rating/slope are available.
   */
  endRound: () => string;
  /**
   * 2026-05-17 — Discard the active round WITHOUT saving. Resets all
   * in-round state the same way endRound() does, but does NOT append
   * to roundHistory, does NOT push a score differential, does NOT
   * update handicap_index, and does NOT trigger recap generation.
   * Use when the user started a round by mistake or wants to abandon
   * a practice / test session that shouldn't count.
   */
  discardRound: () => void;
  // Phase AQ — append a synthesized round insight (rolling 10).
  addRoundInsight: (round_id: string, course: string, insight: string) => void;
  /** Phase R — capture a memory photo at the current hole during an active round. */
  addRoundPhoto: (uri: string) => void;
  /** Phase Q.5b — pending course id signaled by Play tab / Course Detail
   *  for Caddie tab to consume on focus. Set then auto-cleared. */
  pendingStartCourseId: string | null;
  setPendingStartCourse: (id: string | null) => void;
  /** Pre-beta — pending round factors set on the Play tab alongside the
   *  course pick. Caddie reads these when consuming the pendingStart
   *  signal so the round launches with the user's strategy/mental/format
   *  selection instead of bare defaults. */
  pendingStartFactors: {
    mode: RoundMode;
    nineHole: boolean;
    isCompetition: boolean;
    mentalState: string;
    notes: string;
  } | null;
  setPendingStartFactors: (f: {
    mode: RoundMode;
    nineHole: boolean;
    isCompetition: boolean;
    mentalState: string;
    notes: string;
  } | null) => void;
  setCurrentHole: (hole: number) => void;
  setCurrentYardage: (yards: number | null) => void;
  setClub: (club: string) => void;
  setMentalState: (state: string) => void;
  setRiskMode: (mode: 'safe' | 'normal' | 'aggressive') => void;
  logScore: (hole: number, score: number) => void;
  logPutts: (hole: number, putts: number) => void;
  addPenalty: (hole: number) => void;
  logShot: (shot: ShotResult) => void;
  // Phase BJ — append an emotional state entry. Caller passes state +
  // valence + hole; timestamp stamped here.
  logEmotionalState: (state: string, valence: 'positive' | 'neutral' | 'negative', hole: number) => void;
  // Phase 109-followup — edit / delete / bulk-add shots after the fact
  // (correcting typos, removing accidentally-logged shots, catching up
  // after forgetting to log several). Each operates on shot.id.
  editShot: (id: string, patch: Partial<ShotResult>) => void;
  deleteShot: (id: string) => void;
  bulkLogShots: (shots: ShotResult[]) => void;
  /**
   * Phase B — Set the end_location of the last shot on `hole` (typically called when the
   * player advances to the next hole; `endLoc` should be the green centroid of `hole`).
   */
  closeHoleEndLocation: (hole: number, endLoc: ShotLocation) => void;
  /** Phase C — attach a weather snapshot to a previously-logged shot. */
  updateShotWeather: (shotId: string, weather: Record<string, unknown>) => void;
  setRoundNotes: (notes: string) => void;
  setNineHoleMode: (v: boolean) => void;
  setIsCompetition: (v: boolean) => void;

  setActiveGhost: (payload: { source_round_id: string; label: string } | null) => void;
  clearActiveGhost: () => void;

  getCurrentPar: () => number | null;
  getTotalScore: () => number;
  getHolesPlayed: () => number;
  getScoreVsPar: () => number;
  getCurrentHoleData: () => CourseHole | null;
  computeHoleScore: (hole: number) => number | null;
}

// ─── STORE ────────────────────────────────

export const useRoundStore = create<RoundState>()(
  persist(
    (set, get) => ({
      isRoundActive: false,
      mode: 'free_play' as RoundMode,
      currentRoundId: null,
      plans: [],
      activeCourse: null,
      activeCourseId: null,
      recentCourseIds: [],
      courseHoles: [],
      nineHoleMode: false,
      isCompetition: false,
      roundNotes: '',
      goal: null,
      currentHole: 1,
      currentYardage: null,
      club: null,
      mentalState: 'neutral',
      riskMode: 'normal',
      scores: {},
      putts: {},
      penalties: {},
      shots: [],
      holeStats: [],
      currentRoundPhotos: [],
      roundStartTime: null,
      roundNumber: 0,
      roundHistory: [],
      // Phase AQ
      recentInsights: [],
      // Phase BJ
      emotionalLog: [],
      active_ghost: null,
      // Phase 405 wave 3 — tee box selection. 'unspecified' until user picks.
      selectedTee: 'unspecified',

      // Phase 409 — TightLie pending lie analysis. Cleared when a shot is
      // logged (its value is copied onto the shot.lie_analysis).
      pendingLieAnalysis: null,

      setSelectedTee: (color) => set({ selectedTee: color }),
      setPendingLieAnalysis: (analysis) => set({ pendingLieAnalysis: analysis }),
      clearPendingLieAnalysis: () => set({ pendingLieAnalysis: null }),

      startRound: (course, holes, options) => {
        const courseId = options.courseId ?? null;
        const prev = get();
        const updatedRecent = courseId
          ? [courseId, ...prev.recentCourseIds.filter(id => id !== courseId)].slice(0, 5)
          : prev.recentCourseIds;
        const roundId = Date.now().toString();
        // 2026-05-17 — preserve any pre-round plans the user saved for
        // THIS course's holes. Plans for other courses are dropped at
        // round start (they belong to a different course context). Each
        // surviving plan gets re-keyed to the new round_id so the recap
        // pipeline associates them with this round's shots correctly.
        const carriedPlans = courseId
          ? prev.plans
              .filter(p => p.course_id === courseId)
              .map(p => ({ ...p, round_id: roundId }))
          : [];
        set({
          isRoundActive: true,
          mode: options.mode ?? 'free_play',
          currentRoundId: roundId,
          plans: carriedPlans,
          activeCourse: course,
          activeCourseId: courseId,
          recentCourseIds: updatedRecent,
          courseHoles: holes,
          nineHoleMode: options.nineHole,
          isCompetition: options.isCompetition,
          roundNotes: options.notes,
          goal: options.goal,
          // Phase 405 wave 3 — honor explicit tee from options, else keep
          // the prior selection (if user picked one on the Play tab),
          // else 'unspecified' for back-compat with callers predating wave 3.
          selectedTee: options.selectedTee ?? prev.selectedTee ?? 'unspecified',
          currentHole: 1,
          currentYardage: holes[0]?.distance ?? null,
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          currentRoundPhotos: [],
          emotionalLog: [],
          roundStartTime: Date.now(),
          roundNumber: prev.roundNumber + 1,
          active_ghost: null,
        });
        console.log(`[path2:round] start course=${course} holes=${holes.length} courseId=${courseId ?? 'none'}`);
        console.log(`[audit:round-active] state=true roundId=${roundId} hole=1 course="${course}"`);
        // Phase 405 wave 3 — visible round-start confirmation. Dynamic
        // require avoids a circular dep when toastStore re-imports
        // anything that touches roundStore.
        try {
          const toast = require('./toastStore');
          toast.useToastStore.getState().show(`Round started · ${course}`);
        } catch { /* non-fatal */ }
        // Phase 405 — geometry pre-warm. Fire-and-forget so the round
        // can start immediately, but the cache populates in the
        // background so SmartFinder doesn't cold-start when the user
        // first opens it mid-round. The geometry service has a 7-day
        // AsyncStorage cache so this survives a network drop later in
        // the round. Errors are non-fatal — SmartFinder gracefully
        // falls through to the bundled courseHoles fallback path.
        if (courseId) {
          void (async () => {
            try {
              const { fetchCourseGeometry } = await import('../services/courseGeometryService');
              await fetchCourseGeometry(courseId);
              console.log(`[audit:round-active] geometry pre-warm complete for ${courseId}`);
            } catch (e) {
              console.log('[roundStore] geometry pre-warm failed (non-fatal):', e);
            }
          })();
        }
        // Phase 405 wave 3 — round-start orchestration. The audit
        // documented that GPS-dependent services were started from
        // scattered call sites (caddie.tsx focusEffect,
        // shotDetectionService.start indirectly via _layout.tsx,
        // gpsManager via recalibrate). A user could tap Start Round
        // without ever navigating to the Caddie tab and miss GPS
        // entirely. Now: startRound is the single orchestrator that
        // ensures permission + GPS + shot detection are running before
        // the user does anything else.
        //
        // hole detection + off-course detector + poor-signal subscription
        // already auto-start from app/_layout.tsx via the existing
        // isRoundActive subscription (since Phase 405 wave 1) so they
        // ride along automatically with the isRoundActive=true set
        // above.
        void (async () => {
          try {
            const Location = await import('expo-location');
            const perm = await Location.requestForegroundPermissionsAsync();
            if (!perm.granted) {
              // 2026-05-16 — was silently returning here, leaving the
              // user with a "round started" toast but no actual GPS
              // tracking. The visible PermissionBanner on the Caddie
              // tab covers the recovery affordance, but we also surface
              // a toast at this exact moment so the user understands
              // why yardages aren't populating.
              console.log('[roundStore] foreground location permission denied at round start');
              try {
                const { useToastStore } = await import('./toastStore');
                useToastStore.getState().show(
                  'Location off — tap the GPS banner on the Caddie tab to enable.',
                );
              } catch {}
              return;
            }
            // Phase 405 wave 4 — also request background-location
            // permission so phone-in-pocket play keeps GPS active. The
            // pre-flight /permissions screen now also requests this,
            // but we keep the re-prompt here as a belt-and-suspenders
            // safety net for users who skipped the pre-flight or
            // installed before the pre-flight included it. Denial is
            // non-fatal — foreground-service notification on Android
            // still keeps the subsystem warm; iOS just won't track
            // when truly backgrounded.
            try {
              await Location.requestBackgroundPermissionsAsync();
            } catch (e) {
              console.log('[roundStore] background permission request skipped:', e);
            }
            const { startGpsManager } = await import('../services/gpsManager');
            await startGpsManager();
            const { shotDetectionService } = await import('../services/shotDetectionService');
            await shotDetectionService.start();
            console.log('[audit:round-active] GPS + shot detection orchestrated start complete');
          } catch (e) {
            console.log('[roundStore] round-start orchestration failed (non-fatal):', e);
          }
        })();
      },

      // 2026-05-17 — Discard the in-flight round without saving anything.
      // Same state reset as endRound's success path, but no roundHistory
      // append, no differential push, no recap generation, no toast.
      // Tim's "End and Delete Round" path — for accidental starts or
      // practice sessions that shouldn't count toward his record.
      discardRound: () => {
        const s = get();
        console.log(`[roundStore] discardRound — abandoning ${s.currentRoundId ?? 'unknown'}`);
        set({
          isRoundActive: false,
          currentHole: 1,
          currentYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseHoles: [],
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          plans: [],
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          selectedTee: 'unspecified',
          nineHoleMode: false,
          isCompetition: false,
          roundNotes: '',
          goal: null,
          mode: 'free_play' as RoundMode,
          currentRoundId: null,
          roundStartTime: null,
        });
        try {
          const toast = require('./toastStore');
          toast.useToastStore.getState().show('Round discarded — nothing saved.');
        } catch { /* non-fatal */ }
        // Same orchestrated teardown as endRound (GPS / shot detection /
        // hole detection). Fire-and-forget on its own microtask.
        void (async () => {
          try {
            const { shotDetectionService } = await import('../services/shotDetectionService');
            shotDetectionService.stop();
          } catch (e) {
            console.log('[roundStore] discard teardown failed (non-fatal):', e);
          }
        })();
      },

      setActiveCourseId: (id) => set({ activeCourseId: id }),
      setCurrentRoundMode: (mode) => set({ mode }),

      addOrUpdatePlan: (partial) => {
        const state = get();
        const existing = state.plans.find(p => p.hole_number === partial.hole_number);
        if (existing) {
          set(s => ({
            plans: s.plans.map(p =>
              p.hole_number === partial.hole_number
                ? { ...p, markers: partial.markers, computed_yardages: partial.computed_yardages }
                : p
            ),
          }));
        } else {
          // 2026-05-17 — course_id fallback chain: active round id ->
          // pending start course (pre-round planning) -> 'local' sentinel.
          // Without the pending fallback, every pre-round plan got
          // tagged 'local' and couldn't be filtered back to the right
          // course when startRound fires.
          const effectiveCourseId =
            state.activeCourseId ?? state.pendingStartCourseId ?? 'local';
          const newPlan: HolePlan = {
            id: Date.now().toString() + '_h' + partial.hole_number,
            round_id: state.currentRoundId ?? 'unknown',
            course_id: effectiveCourseId,
            hole_number: partial.hole_number,
            player_id: 'primary',
            created_at: Date.now(),
            locked_at: null,
            notes: null,
            markers: partial.markers,
            computed_yardages: partial.computed_yardages,
          };
          set(s => ({ plans: [...s.plans, newPlan] }));
        }
      },

      lockPlanForHole: (holeNumber) =>
        set(s => ({
          plans: s.plans.map(p =>
            p.hole_number === holeNumber && p.locked_at === null
              ? { ...p, locked_at: Date.now() }
              : p
          ),
        })),

      getPlanForHole: (holeNumber) =>
        get().plans.find(p => p.hole_number === holeNumber) ?? null,

      endRound: () => {
        const s = get();

        // Phase B refinement + Phase Q.5b Component 3 — close out the
        // final played hole's last shot end_location to its green centroid
        // before persisting. Sourced from courseGeometryService (single
        // source of truth) with courseHoles fallback for legacy compat.
        const playedHoles = Array.from(new Set(s.shots.map(x => x.hole))).sort((a, b) => a - b);
        const finalHole = playedHoles[playedHoles.length - 1];
        if (finalHole != null) {
          const last = [...s.shots].reverse().find(x => x.hole === finalHole);
          if (last && !last.end_location) {
            const green = greenForHole(s.activeCourseId, finalHole, s.courseHoles);
            if (green) get().closeHoleEndLocation(finalHole, green);
          }
        }

        let scoreVsPar = 0;
        for (const [holeNum, score] of Object.entries(s.scores)) {
          const par = s.courseHoles.find(h => h.hole === Number(holeNum))?.par ?? 0;
          scoreVsPar += score - par;
        }
        const record: RoundRecord = {
          id: s.currentRoundId ?? Date.now().toString(),
          roundNumber: s.roundNumber,
          courseName: s.activeCourse,
          courseId: s.activeCourseId,
          startedAt: s.roundStartTime ?? Date.now(),
          endedAt: Date.now(),
          holesPlayed: Object.keys(s.scores).length,
          totalScore: Object.values(s.scores).reduce((a, b) => a + b, 0),
          scoreVsPar,
          isCompetition: s.isCompetition,
          nineHoleMode: s.nineHoleMode,
          mode: s.mode,
          scores: { ...s.scores },
          putts: { ...s.putts },
          plans: [...s.plans],
          shots: [...s.shots],
          round_photos: s.currentRoundPhotos.length > 0 ? [...s.currentRoundPhotos] : undefined,
        };
        // 2026-05-16 — Full in-round state reset on round end. Was
        // only flipping isRoundActive false + appending to roundHistory,
        // which left currentHole / scores / shots / activeCourse stale.
        // Reported: after ending a Mariners round, the Caddie tab still
        // showed "Hole 10" (Mariners has 9 holes anyway). Now the next
        // round starts from a clean slate AND the in-between display has
        // no stale state to surface.
        // KEEP: roundHistory (the persisted record we just appended),
        //       roundNumber (incremented by startRound on next round),
        //       recentCourseIds (locator UX context).
        set(state => ({
          isRoundActive: false,
          roundHistory: [...state.roundHistory, record],
          currentHole: 1,
          currentYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseHoles: [],
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          plans: [],
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          selectedTee: 'unspecified',
          nineHoleMode: false,
          isCompetition: false,
          roundNotes: '',
          goal: null,
          mode: 'free_play' as RoundMode,
          currentRoundId: null,
          roundStartTime: null,
        }));
        const total = Object.values(s.scores).reduce((a, b) => a + b, 0);
        const holesPlayed = Object.keys(s.scores).length;
        console.log(`[path2:round] end totalScore=${total} holesPlayed=${holesPlayed}`);
        console.log(`[audit:round-active] state=false holesPlayed=${holesPlayed} totalScore=${total}`);
        // Phase 405 wave 3 — visible round-end confirmation.
        try {
          const toast = require('./toastStore');
          toast.useToastStore.getState().show(`Round ended · ${holesPlayed} hole${holesPlayed === 1 ? '' : 's'} · ${total}`);
        } catch { /* non-fatal */ }

        // Phase 405 wave 3 — round-end teardown guarantee. Symmetric to
        // the orchestrated start: shotDetectionService.stop drops GPS
        // via stopGpsManager. hole-detection + off-course detector are
        // torn down by the _layout.tsx isRoundActive subscription.
        // Fire-and-forget on its own microtask so this set() returns
        // synchronously.
        void (async () => {
          try {
            const { shotDetectionService } = await import('../services/shotDetectionService');
            shotDetectionService.stop();
            console.log('[audit:round-active] GPS + shot detection orchestrated stop complete');
          } catch (e) {
            console.log('[roundStore] round-end orchestration failed (non-fatal):', e);
          }
        })();

        // PGA HOPE follow-up — auto-clear Tank's soft-intro after the player
        // has completed at least one full round (>=9 holes) with Tank as
        // their active caddie.
        if (holesPlayed >= 9) {
          try {
            const settingsMod = require('./settingsStore');
            const cur = settingsMod.useSettingsStore.getState();
            if (cur.tankSoftIntro && cur.caddiePersonality === 'tank') {
              cur.setTankSoftIntro(false);
            }
          } catch { /* ignore */ }
        }

        // 2026-05-16 — Handicap pipeline now wired into round-end.
        // Previously: pushDifferential() + computeRoundHandicap() existed
        // but nothing called them at round end, so Tim's manual handicap
        // entry sat stale through every round he played. Now:
        //   1. Compute the round's score differential from raw score +
        //      course rating + slope.
        //   2. Push it to recent_differentials (rolling last 20).
        //   3. When handicap_index is set, blend the new differential
        //      into the new Index estimate (WHS: average of best 8 of
        //      last 20 differentials).
        // Falls back to defaults (rating 72.0, slope 113) for local
        // courses without confirmed rating data — keeps the differential
        // honest enough to trend rather than be exactly USGA-correct.
        if (holesPlayed >= 9) {
          try {
            const profileMod = require('./playerProfileStore');
            const profile = profileMod.usePlayerProfileStore.getState();
            const calcMod = require('../services/handicapCalculator');

            // Build HandicapHoleEntry[] from the just-ended round.
            const holes = Object.entries(s.scores).map(([k, score]) => {
              const holeNum = Number(k);
              const par = s.courseHoles.find(h => h.hole === holeNum)?.par ?? 4;
              return { hole_number: holeNum, par, score };
            });

            // Course rating + slope. Pull from courseHoles or fall back
            // to USGA neutral (72.0 / 113). Most local courses don't
            // ship rating data; that's OK — the differential just
            // anchors to the neutral baseline.
            const courseRating = 72.0;
            const slopeRating = 113;
            const parTotal = holes.reduce((a, h) => a + h.par, 0);

            if (profile.handicap_index != null && holes.length > 0) {
              const result = calcMod.computeRoundHandicap({
                handicapIndex: profile.handicap_index,
                courseRating,
                slopeRating,
                par: parTotal,
                holes,
                recentDifferentials: profile.recent_differentials,
              });
              profile.pushDifferential(result.score_differential);
              // Refresh handicap_index from post-push differentials.
              const after = calcMod.estimateNewIndex(
                [...profile.recent_differentials, result.score_differential],
              );
              if (after?.newIndex != null && Number.isFinite(after.newIndex)) {
                profile.setHandicapIndex(after.newIndex);
              }
              console.log(`[handicap] differential=${result.score_differential.toFixed(1)} newIndex=${after?.newIndex ?? '?'}`);
            } else if (holes.length > 0) {
              // No index yet — still push the differential so when the
              // user enters their starting Index, recent_differentials
              // is already populated.
              const ags = calcMod.computeAdjustedGrossScore(holes, 18);
              const diff = calcMod.computeScoreDifferential(ags, courseRating, slopeRating);
              profile.pushDifferential(diff);
              console.log(`[handicap] differential=${diff.toFixed(1)} (no index yet)`);
            }
          } catch (e) {
            console.log('[handicap] round-end update failed (non-fatal):', e);
          }
        }

        // Points — completed round = 100 pts.
        if (holesPlayed >= 9) {
          try {
            const pointsMod = require('./pointsStore');
            pointsMod.usePointsStore.getState().addPoints(100, `round_completed_${holesPlayed}h`);
          } catch (e) { console.log('[points] round-end emit failed:', e); }
        }

        // 2026-05-16 — Kick off Sonnet recap generation FROM THE STORE,
        // not just from app/(tabs)/caddie.tsx's generateRoundSummary().
        // Both Play tab's "End Round" + Tools menu's End Round bypass
        // that caddie-tab path entirely, so a user who ends a round
        // from either of those surfaces (Tim's Mariners case) would
        // navigate to /recap/<id> and find no recap file. Firing it
        // here guarantees every end-round path produces a recap.
        //
        // Fire-and-forget: the recap screen tolerates the few-second
        // gap between landing and the file appearing via its own
        // re-poll. We pass minimal-required context; richer context
        // (cage, arena, ghost) only attaches when the caddie tab's
        // generateRoundSummary path runs alongside (no regression).
        void (async () => {
          try {
            const { generateRecap } = await import('../services/recapGenerator');
            const playerName = (() => {
              try {
                const profileMod = require('./playerProfileStore');
                const p = profileMod.usePlayerProfileStore.getState();
                return p.firstName || p.name || 'the player';
              } catch { return 'the player'; }
            })();
            const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
            await generateRecap(record.id, {
              courseName: record.courseName ?? 'Unknown Course',
              courseId: record.courseId,
              mode: record.mode,
              startedAt: record.startedAt,
              endedAt: record.endedAt,
              totalScore: record.totalScore,
              scoreVsPar: record.scoreVsPar,
              scores: record.scores,
              plans: record.plans,
              shots: record.shots,
              courseHoles: s.courseHoles,
              patternInsights: [],
              playerName,
              apiUrl,
            });
            console.log(`[roundStore] recap generated for ${record.id}`);
          } catch (e) {
            console.log('[roundStore] recap generation failed (non-fatal):', e);
          }
        })();

        return record.id;
      },

      addRoundInsight: (round_id, course, insight) =>
        set(s => ({
          recentInsights: [
            ...s.recentInsights.filter(x => x.round_id !== round_id),
            { round_id, course, insight, created_at: Date.now() },
          ].slice(-10),
        })),

      pendingStartCourseId: null,
      setPendingStartCourse: (id) => set({ pendingStartCourseId: id }),
      pendingStartFactors: null,
      setPendingStartFactors: (f) => set({ pendingStartFactors: f }),

      addRoundPhoto: (uri) =>
        set(s => {
          if (!s.isRoundActive) return s;
          return {
            currentRoundPhotos: [
              ...s.currentRoundPhotos,
              { uri, hole: s.currentHole, timestamp: Date.now() },
            ],
          };
        }),

      setCurrentHole: (hole) => {
        const state = get();
        // 2026-05-16 — Clamp to the course's actual hole count so the
        // stepper / auto-detection / voice "next hole" can't overshoot
        // (Tim's Mariners report: tab showed "Hole 10" at a 9-hole
        // course). Also clamp the low end to 1 in case anything ever
        // calls setCurrentHole(0) or a negative.
        const maxHole = state.courseHoles.length > 0 ? state.courseHoles.length : 18;
        const clamped = Math.max(1, Math.min(hole, maxHole));
        if (clamped !== hole) {
          console.log(`[roundStore] setCurrentHole(${hole}) clamped to ${clamped} (course max=${maxHole})`);
        }
        // Phase B + Phase Q.5b — close out the previous hole's last shot
        // end_location to that hole's green centroid before advancing.
        // Component 3: green now sourced from courseGeometryService (single
        // source of truth) with courseHoles records as legacy fallback.
        const prevHole = state.currentHole;
        if (prevHole !== clamped) {
          const green = greenForHole(state.activeCourseId, prevHole, state.courseHoles);
          if (green) get().closeHoleEndLocation(prevHole, green);
        }
        const holeData = state.courseHoles.find(h => h.hole === clamped);
        set({ currentHole: clamped, currentYardage: holeData?.distance ?? null });
        if (prevHole !== clamped) {
          console.log(`[path2:round] hole transition prev=${prevHole} next=${clamped}`);
          console.log(`[audit:round-active] hole-transition prev=${prevHole} next=${clamped} yardage=${holeData?.distance ?? 'null'}`);
        }
        // Notify holeDetection of manual override so its sustained-position
        // window doesn't immediately race against the user's pick.
        try {
          require('../services/holeDetection').noteManualOverride();
        } catch {}
        // Pre-beta — hole change is a shot-intent signal; bump GPS to active.
        try {
          require('../services/gpsManager').bumpToActive('hole_change');
        } catch {}
      },

      setCurrentYardage: (yards) => set({ currentYardage: yards }),
      setClub: (club) => set({ club }),
      setMentalState: (state) => set({ mentalState: state }),
      setRiskMode: (mode) => set({ riskMode: mode }),

      logScore: (hole, score) =>
        set(s => ({ scores: { ...s.scores, [hole]: score } })),

      logEmotionalState: (state, valence, hole) =>
        set(s => ({
          emotionalLog: [
            ...(s.emotionalLog ?? []),
            { state, valence, hole, timestamp: Date.now() },
          ].slice(-50),
        })),

      logPutts: (hole, putts) =>
        set(s => ({ putts: { ...s.putts, [hole]: putts } })),

      addPenalty: (hole) => {
        // Unified path: creates a ShotResult so the penalty flows through computeHoleScore,
        // pattern detection, and recap — same as all other penalty outcomes.
        const syntheticShot: ShotResult = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          feel: null,
          direction: null,
          shape: null,
          club: null,
          hole,
          timestamp: Date.now(),
          acousticContact: null,
          outcome: 'manual_penalty',
          penalty_strokes: 1,
          rules_decision: undefined,
        };
        get().logShot(syntheticShot);
        // Bump scores[hole] by 1 so the scorecard reflects this penalty immediately.
        const currentScore = get().scores[hole] ?? 0;
        get().logScore(hole, currentScore + 1);
        // Legacy penalties[] field intentionally NOT written — ShotResult is authoritative now.
      },

      logShot: (shot) =>
        set(s => {
          // Phase B back-fill: if the previous shot on the same hole has no end_location,
          // set it to this shot's start_location. Mirrors the "next shot's tee = previous
          // shot's resting spot" pattern through the round.
          const incomingStart = shot.start_location ?? shot.gps_location ?? null;
          const sameHoleShots = s.shots.filter(x => x.hole === shot.hole);
          const shotInHoleIndex = sameHoleShots.length + 1;
          const shotInRoundIndex = shot.shot_in_round_index ?? s.shots.length + 1;
          const enriched: ShotResult = {
            ...shot,
            start_location: incomingStart,
            gps_location: shot.gps_location ?? incomingStart,
            hole_number: shot.hole_number ?? shot.hole,
            shot_in_hole_index: shot.shot_in_hole_index ?? shotInHoleIndex,
            shot_in_round_index: shotInRoundIndex,
            player_id: shot.player_id ?? 'primary',
            // Phase 409 — copy the pending TightLie analysis onto this
            // shot's record if the user captured a lie before hitting.
            // Respects an explicit lie_analysis passed in (rare; voice
            // intent could conceivably attach one directly) — only
            // falls back to the pending slot when the incoming shot
            // doesn't carry one.
            lie_analysis: shot.lie_analysis ?? s.pendingLieAnalysis ?? null,
          };
          let backfilled = s.shots;
          if (incomingStart) {
            // Find last shot on the same hole that lacks end_location and patch it.
            const lastOnHoleIdx = (() => {
              for (let i = s.shots.length - 1; i >= 0; i--) {
                if (s.shots[i].hole === shot.hole) return i;
              }
              return -1;
            })();
            if (lastOnHoleIdx >= 0 && !s.shots[lastOnHoleIdx].end_location) {
              backfilled = s.shots.map((x, i) =>
                i === lastOnHoleIdx ? { ...x, end_location: incomingStart } : x,
              );
            }
          }
          // Phase 409 — clear the pending lie analysis once consumed
          // by a shot. If the user captures another lie later in the
          // round, setPendingLieAnalysis writes a fresh one. This
          // prevents a stale lie from haunting multiple shots.
          return {
            shots: [...backfilled, enriched],
            pendingLieAnalysis: enriched.lie_analysis ? null : s.pendingLieAnalysis,
          };
        }),

      // Phase 109-followup — edit a previously logged shot. Patch is a
      // partial ShotResult. Match by id; no-op if id not found.
      editShot: (id, patch) =>
        set(s => ({
          shots: s.shots.map(x => x.id === id ? { ...x, ...patch } : x),
        })),

      // Phase 109-followup — delete a logged shot by id. Re-numbers the
      // shot_in_hole_index for remaining shots on that hole so totals
      // stay consistent.
      deleteShot: (id) =>
        set(s => {
          const target = s.shots.find(x => x.id === id);
          if (!target) return {};
          const remaining = s.shots.filter(x => x.id !== id);
          // Re-number shot_in_hole_index for remaining shots on the same hole.
          const sameHole = remaining
            .filter(x => x.hole === target.hole)
            .sort((a, b) => a.timestamp - b.timestamp);
          const reindexedById = new Map(
            sameHole.map((x, i) => [x.id, { ...x, shot_in_hole_index: i + 1 }]),
          );
          const renumbered = remaining.map(x =>
            reindexedById.has(x.id) ? reindexedById.get(x.id)! : x,
          );
          return { shots: renumbered };
        }),

      // Phase 109-followup — bulk-add multiple shots (catch-up flow).
      // Each shot goes through the same back-fill + index pipeline as
      // logShot via repeated apply.
      bulkLogShots: (shots) => {
        for (const shot of shots) {
          get().logShot(shot);
        }
      },

      updateShotWeather: (shotId, weather) =>
        set(s => ({
          shots: s.shots.map(x =>
            x.id === shotId ? { ...x, weather_snapshot: weather } : x,
          ),
        })),

      closeHoleEndLocation: (hole, endLoc) =>
        set(s => {
          for (let i = s.shots.length - 1; i >= 0; i--) {
            if (s.shots[i].hole === hole) {
              if (s.shots[i].end_location) return s; // already closed
              const updated = s.shots.map((x, idx) =>
                idx === i ? { ...x, end_location: endLoc } : x,
              );
              return { shots: updated };
            }
          }
          return s;
        }),

      setRoundNotes: (notes) => set({ roundNotes: notes }),
      setNineHoleMode: (v) => set({ nineHoleMode: v }),
      setIsCompetition: (v) => set({ isCompetition: v }),
      setActiveGhost: (payload) => set({ active_ghost: payload }),
      clearActiveGhost: () => set({ active_ghost: null }),

      getCurrentPar: () => {
        const { courseHoles, currentHole } = get();
        return courseHoles.find(h => h.hole === currentHole)?.par ?? null;
      },

      getTotalScore: () =>
        Object.values(get().scores).reduce((a, b) => a + b, 0),

      getHolesPlayed: () =>
        Object.keys(get().scores).length,

      getScoreVsPar: () => {
        const { scores, courseHoles } = get();
        let total = 0;
        let par = 0;
        for (const [holeNum, score] of Object.entries(scores)) {
          if (score > 0) {
            total += score;
            par += courseHoles.find(h => h.hole === Number(holeNum))?.par ?? 0;
          }
        }
        return total - par;
      },

      getCurrentHoleData: () => {
        const { courseHoles, currentHole } = get();
        return courseHoles.find(h => h.hole === currentHole) ?? null;
      },

      computeHoleScore: (hole: number) => {
        const holeShots = get().shots.filter(s => s.hole === hole);
        if (holeShots.length === 0) return null;
        return holeShots.length + holeShots.reduce((acc, s) => acc + (s.penalty_strokes ?? 0), 0);
      },
    }),
    {
      name: 'round-store-v1',
      version: 1,
      migrate: (persisted, version) => {
        const s = persisted as RoundState;
        if (version === 0) {
          s.shots = (s.shots ?? []).map(sh => ({
            ...sh,
            outcome: sh.outcome ?? 'clean',
            penalty_strokes: sh.penalty_strokes ?? 0,
          }));
          s.roundHistory = (s.roundHistory ?? []).map(r => ({
            ...r,
            shots: (r.shots ?? []).map(sh => ({
              ...sh,
              outcome: sh.outcome ?? 'clean',
              penalty_strokes: sh.penalty_strokes ?? 0,
            })),
          }));
        }
        return s;
      },
      storage: createJSONStorage(() => getPersistStorage()),
      // Phase Y — explicit hydration signal so subscribers (_layout effects,
      // shotDetection lifecycle) can wait until rehydration finishes before
      // capturing initial state. Without this, a fast user tapping Start
      // Round before AsyncStorage rehydrate resolves loses the
      // isRoundActive flip — the rehydrated snapshot lands AFTER startRound
      // and overwrites it back to false. zustand's `persist.hasHydrated()`
      // is queryable any time; `onFinishHydration` lets us also notify
      // subscribers that registered before hydration completed.
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.log('[roundStore] rehydrate error:', error);
      },
      partialize: (s) => ({
        isRoundActive: s.isRoundActive,
        mode: s.mode,
        currentRoundId: s.currentRoundId,
        plans: s.plans,
        activeCourse: s.activeCourse,
        activeCourseId: s.activeCourseId,
        recentCourseIds: s.recentCourseIds,
        courseHoles: s.courseHoles,
        nineHoleMode: s.nineHoleMode,
        isCompetition: s.isCompetition,
        roundNotes: s.roundNotes,
        goal: s.goal,
        currentHole: s.currentHole,
        currentYardage: s.currentYardage,
        club: s.club,
        scores: s.scores,
        putts: s.putts,
        penalties: s.penalties,
        shots: s.shots,
        holeStats: s.holeStats,
        roundNumber: s.roundNumber,
        roundHistory: s.roundHistory,
        active_ghost: s.active_ghost,
        recentInsights: s.recentInsights,
        // Audit follow-up (2026-05-13) — these five fields were
        // initialized in the store and mutated during gameplay but were
        // missing from partialize, so a crash mid-round dropped them.
        // mentalState + riskMode affect caddie tone; currentRoundPhotos
        // is captured memories; roundStartTime is needed by recap;
        // emotionalLog feeds future pattern detection.
        mentalState: s.mentalState,
        riskMode: s.riskMode,
        currentRoundPhotos: s.currentRoundPhotos,
        roundStartTime: s.roundStartTime,
        emotionalLog: s.emotionalLog,
      }),
    },
  ),
);

/**
 * Phase Y / Audit follow-up — expose the persist middleware's hydration
 * API as a typed helper so consumers (app/_layout.tsx, anywhere else
 * that needs to gate effects on rehydrate completion) don't have to
 * use `as unknown as` casts against Zustand's internal typing.
 *
 * Usage:
 *   useEffect(() => whenRoundStoreHydrated(() => { ... }), []);
 *
 * If the store is already hydrated, body runs immediately and the
 * returned cleanup is whatever body returns. Otherwise the body fires
 * when persist signals onFinishHydration; the returned cleanup
 * unsubscribes from that hook AND runs the body's cleanup if it
 * returned one.
 */
type ZustandPersistApi = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (cb: () => void) => () => void;
  };
};

export function whenRoundStoreHydrated(body: () => void | (() => void)): () => void {
  let cleanup: void | (() => void) = undefined;
  const persistApi = (useRoundStore as unknown as ZustandPersistApi).persist;
  if (persistApi.hasHydrated()) {
    cleanup = body();
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }
  const unsub = persistApi.onFinishHydration(() => {
    cleanup = body();
    unsub();
  });
  return () => {
    unsub();
    if (typeof cleanup === 'function') cleanup();
  };
}
