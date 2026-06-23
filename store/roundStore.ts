import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
// 2026-05-21 — Consolidation 4: routine status logs gated. Tagged
// breadcrumbs ([path2:round], [audit:round-active]) stay on console.log.
import { devLog } from '../services/devLog';
import type { RoundMode } from '../types/patterns';
// 2026-06-04 — HolePlan removed. No pre-round authoring; recap renders
// actual-outcome only. See types/plan.ts for the slimmed-down types.
import type { ShotOutcome } from '../types/shot';
import type { RulesDecision } from '../types/penalty';
// 2026-05-22 — Static import. holeReconciliation imports useRoundStore
// (back-edge) but only USES it at call time inside reconcileCurrentHole,
// not at module-eval, so Metro's live-binding handles the cycle safely.
// Switched from require() per the no-anti-pattern refinement pass.
import { forceHoleReconciliation } from '../services/holeReconciliation';
import { haversineYards } from '../utils/geoDistance';
import { getApiBaseUrl } from '../services/apiBase';

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
  // 2026-05-24 — Optional screenshot override URI for holes where the
  // Mapbox / Google tile is poor (low-resolution, occluded by trees,
  // wrong orientation, etc.). When set, GolfshotHoleView uses it as
  // the image source instead of resolveHoleImage's chain. Existing
  // marker calibration (useHoleMarkerCalibrationStore) overlays on
  // top, so once dragged to the right spot, the player's tee / pin
  // marker positions persist across rounds. Leave undefined to fall
  // through to the existing local bundled → Mapbox → Google chain.
  backgroundImageUri?: string;
}

export type ShotLocation = { lat: number; lng: number };

/**
 * 2026-05-24 — External-source voice/AI utterance log entry.
 *
 * Today the only writer is services/metaGlassesIngest.ts (Meta View JSON
 * import). Shape is intentionally source-agnostic so future bridges
 * (AirPods on-device transcript export, Bose Soundscape voice exchanges,
 * a real-time WebSocket bridge) can land in the same log without a
 * schema change. The caddie brain reads this via
 * useRoundStore.getState().externalContext to answer questions like
 * "what did Meta say on this hole?".
 *
 *   source         — 'meta_glasses' today; widen the literal union as
 *                    new bridges land
 *   timestamp      — utterance epoch ms (assistant reply time)
 *   hole           — best-effort attribution via GPS-nearest-green
 *                    bucketing in metaGlassesIngest (300yd radius). May
 *                    be the active currentHole when GPS is missing or
 *                    null when neither resolves.
 *   user_prompt    — what the human said TO the assistant
 *   ai_response    — what the assistant replied
 *   gps            — captured at utterance time; used for downstream
 *                    hole-attribution sanity checks and for surfacing
 *                    location on a future map view
 */
export type ExternalContext = {
  source: 'meta_glasses' | string;
  timestamp: number;
  hole: number | null;
  user_prompt: string;
  ai_response: string;
  gps: { lat: number; lng: number } | null;
};

// Phase 405 wave 3 — tee box selection. Standard course colors; the
// 'unspecified' default fires when the user starts a round without
// touching the picker (most users until they discover the affordance).
// Per-tee coordinate sets aren't wired into SmartFinder math yet — the
// selection is recorded in the round record so recap + analysis can
// show which tees the player used and future per-tee yardages can be
// added without a schema change.
export type TeeColor = 'unspecified' | 'gold' | 'blue' | 'white' | 'red';

// 2026-06-13 (Tim) — how the player is getting around this round. Set on the Play
// tab; persisted on the round record. Informational today (recorded per round, fed to
// caddie/recap context), and the hook for future cart-mark GPS fallback + walking
// fatigue/pace awareness + honest step/distance interpretation (cart ≠ walked).
export type TransportMode = 'walking' | 'cart';

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
  // 2026-06-04 — Airtime-only carry distance (excludes roll). Populated
  // when an acoustic / pose / shot-trace source has measured it; used by
  // the dashboard Highlights "Longest Drive" and the auto-update path in
  // logShot. Distinct from distance_yards (total to-resting-spot).
  carry_distance?: number | null;
  // 2026-06-14 (Tim — "every golfer wants to know what their drive did") —
  // honest GPS tee→ball total, computed in logShot's back-fill the moment
  // the NEXT shot supplies this shot's end_location (haversine start→end).
  // This is the most reliable drive-distance source we have: no acoustics,
  // no pose — just where the ball was hit from vs. where it came to rest.
  // Kept SEPARATE from distance_yards so a measured/estimated value is never
  // silently overwritten; logShot back-fills distance_yards from this only
  // when distance_yards is absent. Null until end_location is known.
  gps_distance_yards?: number | null;
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
  // FIX M8 — Kevin's recommendation at the time this shot was taken.
  // Stamped by log_shot handlers from pendingKevinRec; null when Kevin
  // hadn't given a club call before this shot was logged.
  kevin_rec_club?: string | null;
  kevin_rec_shape?: string | null;
  // True when actualClub === kevin_rec_club (both non-null). Null when
  // either side is missing (no rec, or club not captured in the log).
  kevin_adhered?: boolean | null;
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
  shots: ShotResult[];
  // 2026-06-13 — tee played, persisted onto the record so tee-box score goals
  // (services/goals/teeScoreGoal) can evaluate "break 90 from the reds" honestly.
  // Optional: rounds that predate this (and imports) read as 'unspecified' = untagged.
  selectedTee?: TeeColor;
  // 2026-06-13 — walking vs cart (Play tab). Optional; older rounds omit it.
  transportMode?: TransportMode;
  // 2026-06-13 (Tim) — short caddie summary shown on the dashboard Recent Rounds.
  // For new rounds the rich LLM recap (planStorage) is preferred; this is a
  // deterministic baseline, also backfilled onto past in-app rounds that predate
  // the recap feature (see backfillRoundSummaries).
  summary?: string;
  // Phase BJ — emotional state log for the round (valence pattern detection).
  // Optional: pre-BJ rounds omit it.
  emotionalLog?: { state: string; valence: 'positive' | 'neutral' | 'negative'; hole: number; timestamp: number }[];
  // FIX M14 — round goal (e.g. "break 90") persisted onto the record so recap
  // and tee-goal evaluation can read it without live store access.
  goal?: string | null;
  // Phase R — round memory photos captured during play, displayed in recap collage.
  round_photos?: RoundPhoto[];
  // 2026-05-17 — Phase 413 — wearable / health-data round enrichment.
  // Populated at round-end when Health Connect (Android) is granted
  // and returned data. All optional — older rounds and rounds without
  // watch data omit these fields. Round summary copy and Kevin's
  // recap context can incorporate them when present.
  health?: {
    totalSteps: number;
    distanceMeters: number;
    heartRateAvg: number | null;
    heartRateMax: number | null;
    activeCalories: number;
    durationMin: number;
    /** True when at least one watch sample landed during the round
     *  (vs zero because permission was denied or no watch present). */
    hasWatchData: boolean;
  };
  // FIX M15 — post-round feelings captured on the feelings screen
  // before the recap. Optional: rounds that predate this omit it.
  postRoundFeelings?: {
    energy?: string;
    focus?: string;
    vibe?: string;
    weather?: string;
  };
}

// ─── STATE ────────────────────────────────

interface RoundState {
  isRoundActive: boolean;
  mode: RoundMode;
  currentRoundId: string | null;
  activeCourse: string | null;
  activeCourseId: string | null; // golfcourseapi course_id; null for local/manual rounds
  courseLocation: ShotLocation | null;
  recentCourseIds: string[]; // last 5 API course IDs played
  courseHoles: CourseHole[];
  nineHoleMode: boolean;
  isCompetition: boolean;
  roundNotes: string;
  goal: string | null;

  // 2026-05-24 — Pre-round yardage snapshot frozen at startRound. Tim:
  // "Pre-round all SmartVision hole yardages readout are tied to static
  // images and static because we have the option to save it to be
  // evaluated post round as planned versus outcome." This is the
  // PLAN side of the planned-vs-outcome comparison. Snapshot is taken
  // ONCE at startRound from the bundled courseHoles array (which is
  // already static — front/middle/back yardages baked in data/courses.ts)
  // so post-round recap can compare "what the player saw before teeing
  // off" vs "what their shot end_location actually showed." Null when
  // no round is active OR when the course has no bundled yardage data.
  // Cleared by endRound + discardRound alongside the rest of round state.
  preRoundYardageSnapshot: {
    hole: number;
    static_front: number | null;
    static_middle: number | null;
    static_back: number | null;
    par: number;
  }[] | null;

  currentHole: number;
  holeNotes: Record<number, string>;
  currentYardage: number | null;
  // 2026-05-25 — Tier 3 of the yardage resolver: user-stated number
  // ("I'm 142", "Golfshot says 156", "rangefinder reads 178"). Lives
  // here until next shot logged OR next hole declared OR user states a
  // new yardage. When set, takes precedence over GPS-derived yardage
  // for the active shot — addresses Tim's Palms round where he fed
  // Kevin the Golfshot number and the system had nowhere to put it.
  userStatedYardage: {
    value: number;
    source: 'user' | 'rangefinder' | 'golfshot' | 'other';
    asOf: number;
    holeAtCapture: number;
  } | null;
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
  // 2026-06-13 — walking vs cart for this round (Play tab setup).
  transportMode: TransportMode;

  // Phase 409 — TightLie pending result. The lie analysis completes
  // BEFORE the player hits the shot, so it can't be attached to a
  // ShotResult that doesn't exist yet. This slot holds the most
  // recent confirmed analysis until logShot fires (at which point
  // it's copied onto the shot and cleared). The caddie brain reads
  // this slot directly so a follow-up "what should I hit" question
  // gets answered with the lie reality without the user re-stating it.
  pendingLieAnalysis: import('../services/lieAnalysisService').LieAnalysis | null;

  // FIX M8 — Kevin's last shot recommendation, held until the next log_shot
  // fires so adherence (did the player follow the club call?) can be stamped
  // onto the ShotResult. Cleared by clearPendingKevinRec after each shot.
  pendingKevinRec: { club: string | null; shape: string | null; aimPoint: string | null } | null;

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

  // 2026-05-24 — External-source utterance log. Today only fed by
  // services/metaGlassesIngest.ts (Meta View JSON import); designed to
  // be the destination for any third-party AI voice transcript we
  // ingest (Bose / AirPods on-device transcription, future bridges).
  // Soft-capped to 500 entries in appendExternalContext to prevent
  // unbounded growth across rounds. Persisted so a query like "what did
  // Meta say on hole 7" survives an app restart.
  externalContext: ExternalContext[];

  // 2026-05-24 — Location-type tagging from GPS-vs-courseHoles geometry.
  // Tee/green detection via 30yd / 40yd radii; defaults to 'fairway' when
  // GPS is inside the course bbox but not near a tee or the current
  // green; 'unknown' before the first fix lands.
  //
  // CRITICAL: This does NOT advance currentHole. holeDetection.ts is the
  // sole owner of hole transitions (10s sustained position + 60yd green
  // gate + 30yd transition margin + cart-mode bonus + sequence-aware).
  // The spec asked for inline auto-advance on tee detection — DROPPED
  // because it would race holeDetection and reintroduce the H14→H15
  // premature-transition regression documented at holeDetection.ts:36-46.
  // Surface this state to consumers (SG-tee detector, pace tracker,
  // strategy brain) — let holeDetection own the actual hole index.
  currentLocationType: 'tee' | 'fairway' | 'green' | 'unknown';
  currentTeeBox: { hole: number; lat: number; lng: number } | null;

  // 2026-05-24 — Round-end timestamp. Currently always null during an
  // active round; reserved for completed-round ingestion paths
  // (metaGlassesIngest's roundStart..roundEnd filter). endRound() does
  // not yet set this field — the active-round case uses Date.now() as
  // the upper bound. Wire endRound to set this when historical
  // ingestion is needed.
  roundEndTime: number | null;

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
      courseLocation?: ShotLocation | null;
      mode?: RoundMode;
      // Phase 405 wave 3 — tee box selection. Persisted on the round
      // record so recap shows which tees were played; informational
      // today (per-tee coordinates aren't wired into SmartFinder math
      // yet). Defaults to 'white' when omitted.
      selectedTee?: TeeColor;
      transportMode?: TransportMode;
    },
  ) => void;
  setSelectedTee: (color: TeeColor) => void;
  setTransportMode: (m: TransportMode) => void;

  // Phase 409 — TightLie pending lie analysis.
  setPendingLieAnalysis: (analysis: import('../services/lieAnalysisService').LieAnalysis | null) => void;
  clearPendingLieAnalysis: () => void;

  // FIX M8 — Kevin recommendation adherence tracking.
  setPendingKevinRec: (rec: { club: string | null; shape: string | null; aimPoint: string | null } | null) => void;
  clearPendingKevinRec: () => void;
  setActiveCourseId: (id: string | null) => void;
  setCurrentRoundMode: (mode: RoundMode) => void;

  /**
   * Finalize the active round and return the round_id of the just-
   * persisted RoundRecord. Callers route the user to /recap/<id> with
   * the return value. Always returns a string — even on edge-case calls
   * with no shots, a record is appended.
   * Also pushes a fresh score-differential to recent_differentials and
   * recomputes handicap_index when course rating/slope are available.
   */
  endRound: () => string;
  /** 2026-06-13 — backfill a deterministic caddie summary onto past IN-APP rounds
   *  that lack one (Golfshot imports excluded). Idempotent; no-op if nothing to do. */
  backfillRoundSummaries: () => void;
  /**
   * 2026-05-17 — Phase 413 — attach a health-data snapshot to the most
   * recently saved RoundRecord. Called by the round-end flow AFTER
   * endRound() returns the id, since reading from Health Connect is
   * async and endRound is sync. Idempotent: if the snapshot has
   * hasWatchData=false the record is left untouched (no point
   * filling fields with zeros that masquerade as real data).
   */
  enrichLastRoundWithHealth: (health: NonNullable<RoundRecord['health']>) => void;
  /**
   * 2026-05-26 — Fix AA: append an externally-imported round (parsed
   * from a scorecard screenshot via /api/round-import). Bypasses
   * startRound/endRound — this is a historical record being grafted
   * onto roundHistory after the fact, not an in-app round. The id is
   * generated; roundNumber slots in at +1 after the latest existing
   * record so analytics ordering stays sane.
   *
   * The record's shots[] / plans[] arrive empty (a scorecard photo
   * doesn't carry per-shot detail); per-shot analytics that depend
   * on shots[] just skip imported rounds naturally.
   *
   * Returns the id of the newly appended record so the caller can
   * route the user into recap / scorecard for that import.
   */
  addImportedRound: (
    input: Pick<
      RoundRecord,
      'courseName' | 'startedAt' | 'endedAt' | 'holesPlayed'
        | 'totalScore' | 'scoreVsPar' | 'nineHoleMode' | 'scores' | 'putts'
    > & { mode?: RoundMode; courseId?: string | null; updateHandicap?: boolean },
  ) => string;
  /**
   * 2026-05-17 — Discard the active round WITHOUT saving. Resets all
   * in-round state the same way endRound() does, but does NOT append
   * to roundHistory, does NOT push a score differential, does NOT
   * update handicap_index, and does NOT trigger recap generation.
   * Use when the user started a round by mistake or wants to abandon
   * a practice / test session that shouldn't count.
   */
  discardRound: () => void;
  /** Remove a completed round from history and rebuild handicap differentials
   *  from the remaining rounds so the index stays correct. */
  deleteRound: (id: string) => void;
  // Phase AQ — append a synthesized round insight (rolling 10).
  addRoundInsight: (round_id: string, course: string, insight: string) => void;
  /** 2026-05-24 — Append a single external-source utterance (e.g. one
   *  Meta glasses voice exchange) to the externalContext log.
   *  Soft-capped at 500 (FIFO) so persistence doesn't bloat. */
  appendExternalContext: (ctx: ExternalContext) => void;
  /** 2026-05-24 — Update currentLocationType from a fresh GPS fix.
   *  Called by gpsManager on every accepted fix. Cheap: early-returns
   *  when no courseHoles loaded; dedups when the type+tee box didn't
   *  change. Does NOT touch currentHole — holeDetection owns that. */
  setLocationContext: (coords: ShotLocation) => void;
  /** Phase R — capture a memory photo at the current hole during an active round. */
  addRoundPhoto: (uri: string) => void;
  /** FIX M15 — merge a partial patch into a completed RoundRecord by id.
   *  Used by the post-round feelings screen to persist feelings before
   *  opening the recap. No-op when the id isn't found in roundHistory. */
  updateRoundRecord: (roundId: string, patch: Partial<RoundRecord>) => void;
  /** Phase Q.5b — pending course id signaled by Play tab / Course Detail
   *  for Caddie tab to consume on focus. Set then auto-cleared. */
  pendingStartCourseId: string | null;
  setPendingStartCourse: (id: string | null) => void;
  /** Render-only "selected on Play tab" hint. Distinct from pending* —
   *  setting this does NOT auto-launch a round; it just lets pre-round
   *  surfaces (SmartVision preview, L1HolePreview) resolve the course
   *  the user is currently considering. Overwritten on next selection. */
  previewCourseId: string | null;
  setPreviewCourse: (id: string | null) => void;
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
  setHoleNote: (hole: number, note: string) => void;
  /** 2026-05-22 — User-initiated hole reconciliation against fresh GPS.
   *  Delegates to services/holeReconciliation. The UI's "Refresh GPS"
   *  button calls this. Returns a result the UI can surface as toast /
   *  banner ("Snapped to hole 7" / "GPS too weak — step into open sky").
   *  This is the manual counterpart to the (dormant) auto-detection in
   *  services/holeDetection.ts. */
  reconcileHole: () => import('../services/holeReconciliation').ReconcileResult;
  setCurrentYardage: (yards: number | null) => void;
  /**
   * 2026-05-25 — Tier 3 setter. Voice "I'm 142", "Golfshot says 156",
   * "rangefinder reads 178" routes here. Caller sets value + source;
   * holeAtCapture is bound to currentHole so the value invalidates
   * cleanly when the user advances holes.
   */
  setUserStatedYardage: (value: number, source: 'user' | 'rangefinder' | 'golfshot' | 'other') => void;
  /** Clear the stated yardage. Called automatically on next shot logged
   *  or next hole advance; exposed for manual reset too. */
  clearUserStatedYardage: () => void;
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
  /** Remove synthetic quick-score placeholder shots for a hole (audit fix). */
  clearQuickScorePlaceholders: (hole: number) => void;
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

// 2026-06-14 (audit — store hygiene) — backstop cap on persisted roundHistory.
// Each record carries its full shots[], and the whole history re-serializes on
// every persist write, so unbounded growth (or a runaway-append bug) bloats the
// AsyncStorage blob. 1000 rounds preserves every realistic user's full history
// (years of play) while bounding the worst case. The deeper per-tick-serialization
// win (relocating past-round shots off the hot blob) is a separate refactor that
// wants device verification — see audit-backlog.
const MAX_ROUND_HISTORY = 1000;
const capHistory = (h: RoundRecord[]): RoundRecord[] =>
  h.length > MAX_ROUND_HISTORY ? h.slice(-MAX_ROUND_HISTORY) : h;

export const useRoundStore = create<RoundState>()(
  persist(
    (set, get) => ({
      isRoundActive: false,
      mode: 'free_play' as RoundMode,
      currentRoundId: null,
      activeCourse: null,
      activeCourseId: null,
      courseLocation: null,
      recentCourseIds: [],
      courseHoles: [],
      nineHoleMode: false,
      isCompetition: false,
      roundNotes: '',
      goal: null,
      preRoundYardageSnapshot: null,
      currentHole: 1,
      holeNotes: {},
      currentYardage: null,
      userStatedYardage: null,
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
      roundEndTime: null,
      roundNumber: 0,
      roundHistory: [],
      // Phase AQ
      recentInsights: [],
      // Phase BJ
      emotionalLog: [],
      // 2026-05-24 — Meta glasses + future external voice context.
      externalContext: [],
      // 2026-05-24 — Tee/fairway/green tagging from GPS geometry.
      currentLocationType: 'unknown',
      currentTeeBox: null,
      active_ghost: null,
      // Phase 405 wave 3 — tee box selection. 'unspecified' until user picks.
      selectedTee: 'unspecified',
      // 2026-06-13 — walking vs cart; default walking (the engaged/health default).
      transportMode: 'walking',

      // Phase 409 — TightLie pending lie analysis. Cleared when a shot is
      // logged (its value is copied onto the shot.lie_analysis).
      pendingLieAnalysis: null,

      // FIX M8 — Kevin's last recommendation, cleared after each shot is logged.
      pendingKevinRec: null,

      setSelectedTee: (color) => set({ selectedTee: color }),
      setTransportMode: (m) => set({ transportMode: m }),
      setPendingLieAnalysis: (analysis) => set({ pendingLieAnalysis: analysis }),
      clearPendingLieAnalysis: () => set({ pendingLieAnalysis: null }),
      setPendingKevinRec: (rec) => set({ pendingKevinRec: rec }),
      clearPendingKevinRec: () => set({ pendingKevinRec: null }),

      // 2026-05-24 — Append + soft-cap. 500-entry FIFO keeps the
      // persisted footprint bounded across multiple rounds of imports.
      appendExternalContext: (ctx) => set((s) => {
        const next = [...(s.externalContext ?? []), ctx];
        return { externalContext: next.length > 500 ? next.slice(-500) : next };
      }),

      // 2026-05-24 — Location-type tagging. Pure geometry against
      // courseHoles, no side effects on currentHole. Dedup on unchanged
      // type+box so a steady fairway-walking GPS stream doesn't churn
      // subscribers every 1-2s. See header comment on
      // currentLocationType for why hole auto-advance was DROPPED.
      // 2026-06-14 (audit P1 — hot-path serialization) — this is the ONLY
      // roundStore setter fired on every GPS tick (gpsManager emit). It was
      // `set((s) => ... return {})`, but a zustand set() ALWAYS notifies +
      // re-serializes the persisted blob (shots + full roundHistory) even when
      // the partial is `{}` — so a player standing in one spot re-stringified
      // the whole history ~1×/s for nothing. Now we read via get() and only
      // call set() on an ACTUAL tee/green/fairway transition (a handful per
      // round); no-change ticks return without touching the store. Behaviour is
      // identical (same transitions, same dedup) — only the wasted writes are gone.
      // No data-shape change, no migration: far safer than relocating stored shots,
      // and it fully addresses the per-tick cost since setLocationContext was the
      // sole per-tick writer (currentYardage is set only by the one-shot refresh).
      setLocationContext: (coords) => {
        const s = get();
        if (!s.courseHoles.length) return;
        const TEE_RADIUS_YARDS = 30;
        const GREEN_RADIUS_YARDS = 40;

        // Tee check across ALL holes (so SG-tee tagging works even
        // before holeDetection has transitioned).
        for (const hole of s.courseHoles) {
          if (!hole.teeLat || !hole.teeLng) continue;
          const distToTee = haversineYards(coords, { lat: hole.teeLat, lng: hole.teeLng });
          if (distToTee <= TEE_RADIUS_YARDS) {
            if (
              s.currentLocationType === 'tee' &&
              s.currentTeeBox?.hole === hole.hole
            ) return; // no change → no set() → no persist write
            set({
              currentLocationType: 'tee',
              currentTeeBox: { hole: hole.hole, lat: hole.teeLat, lng: hole.teeLng },
            });
            return;
          }
        }

        // Green check against the active hole only — if you're standing
        // on the wrong green, that's a different problem.
        const green = s.courseHoles.find(h => h.hole === s.currentHole);
        if (green?.middleLat && green?.middleLng) {
          const distToGreen = haversineYards(coords, { lat: green.middleLat, lng: green.middleLng });
          if (distToGreen <= GREEN_RADIUS_YARDS) {
            // 2026-06-07 (audit N1) — dedup on the actual discriminator
            // (currentLocationType) only; green/fairway always null the
            // tee box, so the prior `&& currentTeeBox === null` was a
            // brittle coincidence.
            if (s.currentLocationType === 'green') return;
            set({ currentLocationType: 'green', currentTeeBox: null });
            return;
          }
        }

        // Default fairway. Dedup on location type.
        if (s.currentLocationType === 'fairway') return;
        set({ currentLocationType: 'fairway', currentTeeBox: null });
      },

      startRound: (course, holes, options) => {
        const courseId = options.courseId ?? null;
        const courseLocation = options.courseLocation ?? null;
        // FIX B5 — explicitly bind selectedTee and transportMode from opts so
        // they are never sourced from ambient store state. prev.selectedTee /
        // prev.transportMode are only used as secondary fallbacks here and are
        // explicitly named — a future caller refactor won't accidentally shadow them.
        const prev = get();
        const resolvedTee = options.selectedTee ?? prev.selectedTee ?? 'unspecified';
        const resolvedTransport = options.transportMode ?? prev.transportMode ?? 'walking';
        const updatedRecent = courseId
          ? [courseId, ...prev.recentCourseIds.filter(id => id !== courseId)].slice(0, 5)
          : prev.recentCourseIds;
        const roundId = Date.now().toString();
        // 2026-05-24 — Freeze the bundled F/M/B yardages at round-start
        // so post-round recap can compare planned (here) vs outcome
        // (shot.end_location distance) without GPS drift contaminating
        // the comparison. Pure read; bundled data is already static.
        const preRoundSnapshot = holes.length > 0
          ? holes.map(h => ({
              hole: h.hole,
              static_front: typeof h.front === 'number' ? h.front : null,
              static_middle: typeof h.distance === 'number' ? h.distance : null,
              static_back: typeof h.back === 'number' ? h.back : null,
              par: h.par,
            }))
          : null;
        set({
          isRoundActive: true,
          mode: options.mode ?? 'free_play',
          currentRoundId: roundId,
          activeCourse: course,
          activeCourseId: courseId,
          courseLocation,
          recentCourseIds: updatedRecent,
          courseHoles: holes,
          nineHoleMode: options.nineHole,
          isCompetition: options.isCompetition,
          roundNotes: options.notes,
          goal: options.goal,
          preRoundYardageSnapshot: preRoundSnapshot,
          // FIX B5 — use pre-resolved values (see above) so selectedTee and
          // transportMode are always sourced from opts, not ambient store state.
          selectedTee: resolvedTee,
          transportMode: resolvedTransport,
          currentHole: 1,
          holeNotes: {},
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
        // FIX B6 — hole 1 voice intro. startRound sets currentHole:1 via direct
        // set() which bypasses setCurrentHole's TTS block (prevHole===clamped guard
        // would fire with both equal to 1). Fire the same intro inline here so the
        // player hears "Hole 1. Par 4. 380 yards." at round start without requiring
        // a manual hole-advance. No double-fire risk: setCurrentHole only speaks when
        // prevHole !== clamped, so a subsequent auto-advance to hole 2 won't repeat it.
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const settingsMod = require('./settingsStore') as typeof import('./settingsStore');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const trustMod = require('./trustLevelStore') as typeof import('./trustLevelStore');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const voiceMod = require('../services/voiceService') as typeof import('../services/voiceService');
            const settings = settingsMod.useSettingsStore.getState();
            const trustLevel = trustMod.useTrustLevelStore.getState().level;
            if (settings.voiceEnabled && trustLevel !== 1) {
              const holeOne = holes.find(h => h.hole === 1);
              let text = 'Hole 1.';
              if (holeOne?.par) text += ` Par ${holeOne.par}.`;
              if (holeOne?.distance) text += ` ${holeOne.distance} yards.`;
              const apiUrl = getApiBaseUrl();
              void voiceMod.speak(text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
                ?.catch?.(() => {});
            }
          } catch (e) {
            console.log('[roundStore] hole-1 intro failed (non-fatal):', e);
          }
        })();
        // 2026-05-22 — Course Data Orchestrator: clear sustained-fix buffer
        // so a heading carried over from a prior round can't bias the
        // first reconciliation on this round.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/courseDataOrchestrator').clearSustainedBuffer?.();
        } catch { /* non-fatal */ }
        // 2026-06-06 — Phase 2 of on-course resilience sprint. Pre-warm
        // per-course caches the moment the round commits, so SmartVision /
        // Caddie / brain context all have data even when cellular drops
        // mid-round (Tim's Echo Hills failure mode). Underlying services
        // (courseGeometry + courseContent) own their own AsyncStorage
        // caches with stale-while-revalidate; this is purely a nudge to
        // populate them at the moment signal is most likely to be good.
        // Fire-and-forget — UX never blocks on this.
        if (courseId && holes.length > 0) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prefetch = require('../services/roundPrefetch') as typeof import('../services/roundPrefetch');
            void prefetch.prefetchRoundData({
              courseId,
              courseName: course,
              courseLocation,
              holes,
            });
          } catch (e) {
            console.log('[roundStore.startRound] prefetch dispatch failed (non-fatal):', e);
          }
        }
        // 2026-05-21 — Fix N-3 — the original Phase 413 JIT Health Connect
        // permission ask used to live here. It was the prime suspect for the
        // Z Fold "app closes on Start Round, every time, reopen shows round
        // active" crash: react-native-health-connect can throw a native
        // JNI fatal during initialize()/requestPermission() on Samsung One
        // UI devices where Health Connect is missing or stubbed, and JS
        // try/catch CANNOT catch a native JNI throw. The persist set
        // landed (round shows active on reopen) but the IIFE took the
        // process down before hasAskedHealthPermission could flip — so
        // the JIT re-fired every Start Round attempt.
        //
        // Round-start now makes ZERO Health Connect native calls. The
        // permission ask is moved to an explicit user action in
        // Settings → Health Data → "Connect Health Data" — off the
        // round-start path entirely. A native crash there only affects
        // the Settings tap, not the round flow.
        // 2026-05-17 — Phase 413 — start the walking-vs-cart detector
        // ticker. Refreshes every 30s during the round; the
        // orchestrator reads getCachedReading() / isEffectiveCartMode()
        // synchronously when deciding whether to auto-fire on a
        // GPS-displacement event. Stopped at round end.
        //
        // 2026-05-21 — Fix N-3 — gate on hasAskedHealthPermission. The
        // ticker's first tick fires immediately (walkingDetector.ts:157)
        // and calls isHealthAvailable() → hc.initialize() — a native
        // call that can crash the process on Samsung One UI when HC
        // is missing/stubbed. With the JIT removed (above), the user
        // must explicitly grant via Settings before any HC native code
        // runs. Until then we skip the ticker entirely. The GPS-only
        // fallback inside detectActivity already covers no-health-data
        // scenarios, so cart/walk detection still works without HC —
        // it just leans harder on GPS speed + the manual cartMode toggle.
        void (async () => {
          try {
            const settingsMod = require('./settingsStore');
            const settingsSnap = settingsMod.useSettingsStore.getState();
            if (!settingsSnap.hasAskedHealthPermission) {
              console.log('[roundStore] walking ticker skipped: Health Connect not granted yet');
              return;
            }
            const wd = await import('../services/walkingDetector');
            const gps = await import('../services/gpsManager');
            wd.startActivityTicker(() => gps.getLastFix()?.speed ?? 0);
          } catch (e) {
            console.log('[roundStore] activity ticker start failed:', e);
          }
        })();
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
              await fetchCourseGeometry(courseId, { courseLocation });
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
            console.log(`[path2:round] gps_prewarm granted=${perm.granted}`);
            if (!perm.granted) {
              // 2026-06-01 — Fix GL: stronger handling. The previous
              // behavior left isRoundActive=true with no GPS subscription,
              // so every downstream consumer (holeDetection,
              // offCourseDetector, yardages, scorecard, voice intents)
              // thought the round was live but had no fix. Round appeared
              // active for hours with zero feedback. New behavior:
              // immediately discardRound() so the user sees the round
              // never started, plus a persistent toast that explains
              // why. They re-grant permission in Settings and tap Start
              // Round again — clean state, no orphaned in-flight round.
              console.log('[roundStore] foreground location permission denied at round start — discarding round');
              try {
                const { useToastStore } = await import('./toastStore');
                useToastStore.getState().show(
                  'Location off — enable Location in Settings, then tap Start Round again.',
                );
              } catch {}
              // 2026-06-02 — Fix GM: belt-and-suspenders. Set
              // isRoundActive=false FIRST so that even if discardRound
              // throws (a subscriber teardown error, an AsyncStorage
              // write race, etc.), the round-active flag is already
              // false. Without this, an exception in discardRound left
              // isRoundActive=true with no GPS subscription → orphan
              // round, no banner (banner gates on isRoundActive=true
              // AND unhealthy GPS — but GPS was never started so it
              // never registered as unhealthy).
              try { set({ isRoundActive: false }); } catch { /* noop */ }
              try {
                get().discardRound();
              } catch (e) {
                console.log('[roundStore] discardRound after permission denial failed:', e);
              }
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
      addImportedRound: (input) => {
        const id = `imported_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const state = get();
        const nextRoundNumber = state.roundHistory.length > 0
          ? Math.max(...state.roundHistory.map(r => r.roundNumber)) + 1
          : 1;
        const record: RoundRecord = {
          id,
          roundNumber: nextRoundNumber,
          courseName: input.courseName,
          courseId: input.courseId ?? null,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          holesPlayed: input.holesPlayed,
          totalScore: input.totalScore,
          scoreVsPar: input.scoreVsPar,
          isCompetition: false,
          nineHoleMode: input.nineHoleMode,
          mode: input.mode ?? 'free_play',
          scores: { ...input.scores },
          putts: { ...input.putts },
          shots: [],
        };
        // 2026-06-11 (audit) — dedupe re-imports. The bulk-import UX invites
        // repeated screenshots, so the same round can arrive twice (and a
        // duplicate silently inflates the best-8-of-20 handicap window). Skip a
        // record that matches an existing one on (calendar day, course, score,
        // holes) and return the existing id so the caller's count stays honest.
        const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
        const dupKey = `${dayKey(input.startedAt)}|${(input.courseName ?? '').trim().toLowerCase()}|${input.totalScore}|${input.holesPlayed}`;
        const dup = state.roundHistory.find(r =>
          `${dayKey(r.startedAt)}|${(r.courseName ?? '').trim().toLowerCase()}|${r.totalScore}|${r.holesPlayed}` === dupKey);
        if (dup) {
          console.log(`[roundStore] addImportedRound dedupe: skipping duplicate ${dupKey} (existing ${dup.id})`);
          return dup.id;
        }
        set(s => ({ roundHistory: capHistory([...s.roundHistory, record]) }));

        // 2026-06-11 (audit) — let the caller suppress per-round handicap math.
        // The bulk importer passes updateHandicap:false and runs ONE rebuild
        // from full history afterward, so we don't push N intermediate
        // differentials (which the rebuild would clobber when ≥3 rounds, but
        // would leave un-reconciled when <3).
        // 2026-05-26 — Fix BD: feed imported rounds into the handicap
        // pipeline just like endRound does. Mirrors the same neutral-
        // baseline approximation (course rating 72.0, slope 113) used
        // by endRound for local courses without confirmed rating data
        // — keeps the differential honest enough to trend toward an
        // estimated index without pretending to be exactly USGA-correct.
        // Requires 9+ holes (matches endRound's gate) to count for
        // handicap purposes.
        // 2026-06-06 — Phase 6.1 followup: tighten filter to 9 OR 18
        // exact (no partial 10-17), and double 9-hole totalScore as
        // the 18-hole-equivalent before differential math. Previously
        // 9-hole imports got differential ≈ −32 against neutral 72.0
        // and dragged the estimated Index way down.
        if ((input.updateHandicap ?? true) && (input.holesPlayed === 9 || input.holesPlayed === 18)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const profileMod = require('./playerProfileStore');
            const profile = profileMod.usePlayerProfileStore.getState();
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const calcMod = require('../services/handicapCalculator');
            // Differential from total score against the neutral course
            // baseline. Skip per-hole AGS cap since imported rounds
            // don't carry per-hole pars (just totals).
            const adjustedScore = input.holesPlayed === 9 ? input.totalScore * 2 : input.totalScore;
            const diff = calcMod.computeScoreDifferential(adjustedScore, 72.0, 113);
            profile.pushDifferential(diff);
            // 2026-06-11 (audit) — always (re)estimate, even with no prior index,
            // so single-scorecard imports (import-round.tsx, updateHandicap
            // defaults true) produce a FIRST index once ≥3 differentials exist.
            // estimateNewIndex self-gates below 3 (returns null). Previously the
            // `handicap_index != null` guard meant importing rounds one at a
            // time never produced an index. (profile.recent_differentials is the
            // pre-push array; [...it, diff] is the correct post-push set.)
            const after = calcMod.estimateNewIndex([...profile.recent_differentials, diff]);
            if (after?.newIndex != null && Number.isFinite(after.newIndex)) {
              profile.setHandicapIndex(after.newIndex);
            }
            console.log(`[handicap] imported-round differential=${diff.toFixed(1)}`);
          } catch (e) {
            console.log('[handicap] imported-round update failed (non-fatal):', e);
          }
        }

        console.log(
          `[roundStore] addImportedRound id=${id} course=${input.courseName ?? 'unknown'} ` +
          `score=${input.totalScore} vsPar=${input.scoreVsPar} holes=${input.holesPlayed}`,
        );
        return id;
      },

      enrichLastRoundWithHealth: (health) => {
        if (!health.hasWatchData) return;
        const s = get();
        if (s.roundHistory.length === 0) return;
        const updated = s.roundHistory.map((r, idx) =>
          idx === s.roundHistory.length - 1 ? { ...r, health } : r,
        );
        set({ roundHistory: updated });
        devLog('[roundStore] enrichLastRoundWithHealth:', {
          steps: health.totalSteps,
          dist: health.distanceMeters,
          hr_avg: health.heartRateAvg,
        });
      },

      backfillRoundSummaries: () => {
        set(s => {
          let changed = false;
          const updated = s.roundHistory.map(r => {
            // Skip rounds that already have a summary, and Golfshot imports
            // (id prefixed 'imported_' — score-only, no in-app shots to read).
            if (r.summary || r.id.startsWith('imported_')) return r;
            changed = true;
            const vs = r.scoreVsPar;
            const vsStr = vs === 0 ? 'even par' : vs > 0 ? `+${vs}` : `${vs}`;
            const where = r.courseName ? ` at ${r.courseName}` : '';
            const summary = r.holesPlayed > 0
              ? `${r.totalScore > 0 ? `${r.totalScore}, ` : ''}${vsStr} through ${r.holesPlayed} hole${r.holesPlayed === 1 ? '' : 's'}${where}.`
              : `Round${where}.`;
            return { ...r, summary };
          });
          return changed ? { roundHistory: updated } : {};
        });
      },

      discardRound: () => {
        const s = get();
        console.log(`[roundStore] discardRound — abandoning ${s.currentRoundId ?? 'unknown'}`);
        set({
          isRoundActive: false,
          currentHole: 1,
          currentYardage: null,
          userStatedYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseLocation: null,
          courseHoles: [],
          holeNotes: {},
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          pendingKevinRec: null,
          selectedTee: 'unspecified',
          transportMode: 'walking',
          nineHoleMode: false,
          isCompetition: false,
          roundNotes: '',
          goal: null,
          mode: 'free_play' as RoundMode,
          currentRoundId: null,
          roundStartTime: null,
          preRoundYardageSnapshot: null,
          // 2026-06-07 (audit M2) — clear per-round caddie/location state so
          // the NEXT round doesn't inherit the prior round's tone/tags.
          mentalState: 'neutral',
          riskMode: 'normal',
          currentLocationType: 'unknown',
          currentTeeBox: null,
          active_ghost: null,
        });
        try {
          const toast = require('./toastStore');
          toast.useToastStore.getState().show('Round discarded — nothing saved.');
        } catch { /* non-fatal */ }
        // Same orchestrated teardown as endRound (GPS / shot detection /
        // hole detection + walking-activity ticker). Fire-and-forget.
        void (async () => {
          try {
            const { shotDetectionService } = await import('../services/shotDetectionService');
            shotDetectionService.stop();
          } catch (e) {
            console.log('[roundStore] discard teardown failed (non-fatal):', e);
          }
          // 2026-06-07 (audit M2) — discard also leaked the walking-activity
          // ticker that endRound stops; mirror that teardown here.
          try {
            const wd = await import('../services/walkingDetector');
            wd.stopActivityTicker();
          } catch (e) {
            console.log('[roundStore] discard ticker stop failed (non-fatal):', e);
          }
        })();
      },

      deleteRound: (id) => {
        const next = get().roundHistory.filter(r => r.id !== id);
        set({ roundHistory: next });
        try {
          const calcMod = require('../services/handicapCalculator');
          const profileMod = require('./playerProfileStore');
          const profile = profileMod.usePlayerProfileStore.getState();
          const diffs = calcMod.rebuildDifferentialsFromHistory(
            next.map((r: RoundRecord) => ({ startedAt: r.startedAt, totalScore: r.totalScore, holesPlayed: r.holesPlayed })),
          );
          profile.resetDifferentials(diffs);
          const result = calcMod.estimateNewIndex(diffs);
          if (result?.newIndex != null && Number.isFinite(result.newIndex)) {
            profile.setHandicapIndex(result.newIndex);
          } else if (diffs.length === 0) {
            profile.setHandicapIndex(null);
          }
        } catch (e) {
          console.error('[roundStore] deleteRound handicap rebuild failed:', e);
        }
      },

      setActiveCourseId: (id) => set({ activeCourseId: id }),
      setCurrentRoundMode: (mode) => set({ mode }),

      endRound: () => {
        const s = get();
        // Guard: no active round → no-op. Without this, a double-tap
        // (final-hole auto-end racing the End Round button) or a stray
        // call appends a phantom roundHistory entry and can push a bogus
        // handicap differential. (audit 2026-06-07)
        if (!s.isRoundActive) return '';

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
        // 2026-06-14 (audit fix) — closeHoleEndLocation above mutates `shots`
        // via set(), but the snapshot `s` was taken BEFORE it ran, so building
        // the record from `s.shots` dropped the final-hole green-close (and its
        // GPS distance) from every saved round. Re-read the live shots now.
        const persistedShots = get().shots;

        // 2026-05-17 — gate on score > 0 to match getScoreVsPar()'s
        // semantics. Previously this counted 0-scores against par
        // (an in-progress hole that was never finalized inflated the
        // over-par total), while the getter skipped them. The
        // RoundRecord.scoreVsPar drives the handicap differential
        // push, so a 0 in the scores map was silently biasing the
        // user's handicap calculation toward over-par.
        // 2026-06-16 (audit) — derive holesPlayed + totalScore from the SAME
        // score>0 gate scoreVsPar uses below. A never-finalized 0-score hole left
        // in the map otherwise inflated holesPlayed (and skewed the incomplete-
        // round handicap filter `totalScore >= MIN_STROKES_PER_HOLE * holesPlayed`)
        // while scoreVsPar already skipped it — an inconsistent saved triplet.
        const scoredEntries = Object.entries(s.scores).filter(([, score]) => score > 0);
        let scoreVsPar = 0;
        for (const [holeNum, score] of scoredEntries) {
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
          holesPlayed: scoredEntries.length,
          totalScore: scoredEntries.reduce((a, [, score]) => a + score, 0),
          scoreVsPar,
          isCompetition: s.isCompetition,
          nineHoleMode: s.nineHoleMode,
          mode: s.mode,
          scores: { ...s.scores },
          putts: { ...s.putts },
          shots: [...persistedShots],
          selectedTee: s.selectedTee,
          transportMode: s.transportMode,
          round_photos: s.currentRoundPhotos.length > 0 ? [...s.currentRoundPhotos] : undefined,
          // FIX B13 — persist emotional log onto the record so recap + future
          // pattern analysis ("you push right when stressed") can correlate
          // valence with shot outcomes without needing a live round.
          emotionalLog: s.emotionalLog.length > 0 ? [...s.emotionalLog] : undefined,
          // FIX M14 — persist the player's stated goal ("break 90") so recap
          // surfaces it and evaluateTeeGoal / post-round analysis can read it.
          goal: s.goal ?? undefined,
        };
        // 2026-06-10 — Caddie CNS Phase 1: distill this round into per-course /
        // per-hole memory (rounds played, scoring avg, tee club, par). Additive
        // + best-effort; nothing reads it yet (Phase 2 retrieval). Reuses the
        // record we just built so it's consistent with roundHistory.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mem = require('./caddieMemoryStore') as typeof import('./caddieMemoryStore');
          // Build per-hole data ONCE (course-independent). 2026-06-13 (audit G3):
          // feed REAL approachClub (last clubbed shot that isn't the tee shot) +
          // trouble (hole played 2+ over par) into memory instead of null/[].
          const holesData = Object.entries(s.scores)
            .filter(([, sc]) => typeof sc === 'number' && sc > 0)
            .map(([holeStr, sc]) => {
              const hole = Number(holeStr);
              const par = s.courseHoles.find(h => h.hole === hole)?.par ?? null;
              const holeShots = s.shots.filter(x => x.hole === hole);
              const teeClub = holeShots[0]?.club ?? null;
              const approachShot = [...holeShots].reverse().find(x => !!x.club && x !== holeShots[0]);
              const approachClub = approachShot?.club ?? null;
              const score = sc as number;
              const trouble = par != null && score - par >= 2 ? ['played 2+ over'] : [];
              return { hole, par, score, teeClub, approachClub, trouble };
            });

          // Per-COURSE memory — only when we know the course.
          if (s.activeCourseId) {
            mem.useCaddieMemoryStore.getState().recordRoundEnd({
              round_id: record.id,
              course_id: s.activeCourseId,
              course_name: s.activeCourse,
              nowMs: Date.now(),
              holes: holesData,
            });
          }

          // Player-level REFLECTION — 2026-06-13 (audit G1 bug): runs REGARDLESS of
          // course. The player's stated miss/focus/carry + score are course-independent
          // facts; gating this on activeCourseId meant local/manual rounds never learned
          // anything. course_id is null for those — the reflection is still kept.
          const holesPlayed = holesData.length;
          if (holesPlayed > 0) {
            const scoreLine = scoreVsPar === 0 ? 'even par' : scoreVsPar > 0 ? `+${scoreVsPar}` : `${scoreVsPar}`;
            const summary = `${scoreLine} through ${holesPlayed} hole${holesPlayed === 1 ? '' : 's'}${s.activeCourse ? ` at ${s.activeCourse}` : ''}.`;
            const takeaways: string[] = [];
            const troubleHoles = holesData.filter(h => h.trouble.length > 0).map(h => `hole ${h.hole}`);
            if (troubleHoles.length > 0) takeaways.push(`Trouble holes: ${troubleHoles.slice(0, 3).join(', ')}.`);
            // CNS ingestion (audit G1): distill what the player SAID this round into
            // durable takeaways so the dialogue feeds the brain. Honest/narrow — only
            // high-confidence stated signals; [] when nothing matched.
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const convo = require('./conversationLogStore') as typeof import('./conversationLogStore');
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const distill = require('../services/conversationDistill') as typeof import('../services/conversationDistill');
              const startedAt = s.roundStartTime ?? 0;
              const roundTurns = convo.useConversationLog.getState().turns.filter(t => t.at >= startedAt);
              for (const note of distill.distillConversation(roundTurns)) takeaways.push(note);
            } catch (e) {
              console.log('[roundStore] conversation distill failed (non-fatal):', e);
            }
            mem.useCaddieMemoryStore.getState().recordReflection({
              round_id: record.id,
              course_id: s.activeCourseId ?? null,
              summary,
              keyTakeaways: takeaways,
              nowMs: Date.now(),
            });
          }
        } catch (e) {
          console.log('[roundStore] caddie-memory recordRoundEnd failed (non-fatal):', e);
        }
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
          roundHistory: capHistory([...state.roundHistory, record]),
          currentHole: 1,
          currentYardage: null,
          userStatedYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseLocation: null,
          courseHoles: [],
          holeNotes: {},
          scores: {},
          putts: {},
          penalties: {},
          shots: [],
          holeStats: [],
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          pendingKevinRec: null,
          selectedTee: 'unspecified',
          transportMode: 'walking',
          nineHoleMode: false,
          isCompetition: false,
          roundNotes: '',
          goal: null,
          mode: 'free_play' as RoundMode,
          currentRoundId: null,
          roundStartTime: null,
          preRoundYardageSnapshot: null,
          // 2026-06-07 (audit M2) — clear per-round caddie/location state so
          // the next round starts neutral (matches discardRound).
          mentalState: 'neutral',
          riskMode: 'normal',
          currentLocationType: 'unknown',
          currentTeeBox: null,
          active_ghost: null,
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
        // 2026-06-06 — Phase 6.1 followup: only post differentials for
        // complete 9 OR 18 hole rounds. Partial 10-17 hole rounds were
        // previously admitted via `holesPlayed >= 9` and shoved a
        // misleading differential (raw partial-score against neutral
        // 72.0 rating) into the rolling pool. Match the rebuild filter
        // tightening in services/handicapCalculator.ts. 9-hole rounds
        // also need the ×2 scaling — previously a 40-stroke 9-hole
        // round computed differential ≈ −32 against the 72.0 baseline
        // and dragged the estimated Index into negative territory.
        if (holesPlayed === 9 || holesPlayed === 18) {
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
            // For 9-hole rounds, parTotal carries 9 holes (~36). To
            // keep the differential math comparable to 18-hole rounds
            // we double the AGS and treat it as the 18-hole-equivalent
            // (see services/handicapCalculator.ts:212-238 for the same
            // approach in the rebuild path).
            const is9 = holesPlayed === 9;
            const parTotal = holes.reduce((a, h) => a + h.par, 0);
            const equivalentPar = is9 ? parTotal * 2 : parTotal;

            if (profile.handicap_index != null && holes.length > 0) {
              const courseHandicap = calcMod.computeCourseHandicap(
                profile.handicap_index, courseRating, slopeRating, equivalentPar,
              );
              const ags = calcMod.computeAdjustedGrossScore(holes, courseHandicap);
              const equivalentAgs = is9 ? ags * 2 : ags;
              const scoreDifferential = calcMod.computeScoreDifferential(equivalentAgs, courseRating, slopeRating);
              profile.pushDifferential(scoreDifferential);
              const after = calcMod.estimateNewIndex(
                [...profile.recent_differentials, scoreDifferential],
              );
              if (after?.newIndex != null && Number.isFinite(after.newIndex)) {
                profile.setHandicapIndex(after.newIndex);
              }
              console.log(`[handicap] holesPlayed=${holesPlayed} differential=${scoreDifferential.toFixed(1)} newIndex=${after?.newIndex ?? '?'}`);
            } else if (holes.length > 0) {
              // No index yet — still push the differential so when the
              // user enters their starting Index, recent_differentials
              // is already populated.
              const ags = calcMod.computeAdjustedGrossScore(holes, 18);
              const equivalentAgs = is9 ? ags * 2 : ags;
              const diff = calcMod.computeScoreDifferential(equivalentAgs, courseRating, slopeRating);
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
            const apiUrl = getApiBaseUrl();
            // 2026-05-21 — Fix Q: pass voiceGender + persona so the recap
            // renders in the user's selected caddie's voice instead of
            // falling through to the server's Kevin default. cur is the
            // active settings snapshot captured higher up in this scope
            // (see the tankSoftIntro branch above line 825).
            const settingsForRecap = (() => {
              try {
                const mod = require('./settingsStore');
                return mod.useSettingsStore.getState();
              } catch { return null; }
            })();
            await generateRecap(record.id, {
              courseName: record.courseName ?? 'Unknown Course',
              courseId: record.courseId,
              mode: record.mode,
              startedAt: record.startedAt,
              endedAt: record.endedAt,
              totalScore: record.totalScore,
              scoreVsPar: record.scoreVsPar,
              scores: record.scores,
              shots: record.shots,
              courseHoles: s.courseHoles,
              patternInsights: [],
              playerName,
              apiUrl,
              voiceGender: settingsForRecap?.voiceGender ?? 'male',
              persona: settingsForRecap?.caddiePersonality,
            });
            console.log(`[roundStore] recap generated for ${record.id}`);
          } catch (e) {
            console.log('[roundStore] recap generation failed (non-fatal):', e);
          }
        })();

        // 2026-06-04 — Refresh the cached AI Kevin's Read after the
        // round ends. Fire-and-forget — never blocks round end and
        // failures fall through to the dashboard's default fallback.
        void (async () => {
          try {
            const { generateKevinRead } = await import('../services/kevinReadService');
            await generateKevinRead();
          } catch (e) {
            console.log('[roundStore] kevinRead refresh failed (non-fatal):', e);
          }
        })();

        // 2026-05-17 — Phase 413 — stop the walking-vs-cart ticker
        // started in startRound. Cleans up the interval and resets
        // the cached reading so a future round starts fresh.
        void (async () => {
          try {
            const wd = await import('../services/walkingDetector');
            wd.stopActivityTicker();
          } catch (e) {
            console.log('[roundStore] activity ticker stop failed:', e);
          }
        })();

        // 2026-05-17 — Phase 413 — async health-snapshot read +
        // enrichLastRoundWithHealth. Same fire-and-forget pattern as
        // recap above; if Health Connect isn't installed / not
        // permissioned / not Android, the read returns hasData=false
        // and the enrich call no-ops. Round summary copy and Kevin's
        // recap context use the data when present. Gated on the
        // user's Settings → Health Data toggle so an explicit off
        // skips the read entirely (faster end-round + zero Health
        // Connect access).
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const settingsMod = require('./settingsStore');
            if (!settingsMod.useSettingsStore.getState().healthDataEnabled) return;
            const { readHealthSnapshot } = await import('../services/healthData');
            const snap = await readHealthSnapshot(record.startedAt, record.endedAt);
            if (!snap.hasData) return;
            const durationMin = Math.max(1, Math.round((record.endedAt - record.startedAt) / 60_000));
            get().enrichLastRoundWithHealth({
              totalSteps: snap.steps,
              distanceMeters: snap.distanceMeters,
              heartRateAvg: snap.heartRateAvg,
              heartRateMax: snap.heartRateMax,
              activeCalories: snap.activeCalories,
              durationMin,
              hasWatchData: true,
            });
          } catch (e) {
            console.log('[roundStore] health enrich failed (non-fatal):', e);
          }
        })();

        // FIX M13 — evaluate active tee-box score goals at round end so the player
        // gets a TTS celebration when they hit their goal. Pure sync read from
        // teeGoalStore (already persisted) + evaluateTeeGoal (pure fn, no network).
        // Only fires when voice is enabled, trust > 1, and at least one goal is active.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const teeGoalMod = require('./teeGoalStore') as typeof import('./teeGoalStore');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const evalMod = require('../services/goals/teeScoreGoal') as typeof import('../services/goals/teeScoreGoal');
          const goals = teeGoalMod.useTeeGoalStore.getState().goals;
          if (goals.length > 0) {
            // Build updated history including the just-saved record for evaluation.
            const updatedHistory = get().roundHistory;
            const settingsForGoal = (() => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const mod = require('./settingsStore');
                return mod.useSettingsStore.getState();
              } catch { return null; }
            })();
            const trustForGoal = (() => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const mod = require('./trustLevelStore');
                return mod.useTrustLevelStore.getState().level;
              } catch { return 2; }
            })();
            if (settingsForGoal?.voiceEnabled && trustForGoal !== 1) {
              for (const goal of goals) {
                const progress = evalMod.evaluateTeeGoal(goal, updatedHistory);
                // Celebrate only when this round tipped the goal into achieved for the first time.
                if (progress.achieved && progress.achievedAt === record.endedAt) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const voiceMod = require('../services/voiceService') as typeof import('../services/voiceService');
                    const celebText = `Goal achieved! ${evalMod.describeTeeGoal(goal)} — you did it!`;
                    const apiUrl = getApiBaseUrl();
                    void voiceMod.speak(celebText, settingsForGoal.voiceGender, settingsForGoal.language, apiUrl, { userInitiated: true })
                      ?.catch?.(() => {});
                  } catch { /* non-fatal */ }
                }
              }
            }
          }
        } catch (e) {
          console.log('[roundStore] tee-goal evaluation failed (non-fatal):', e);
        }

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
      previewCourseId: null,
      setPreviewCourse: (id) => set({ previewCourseId: id }),
      pendingStartFactors: null,
      setPendingStartFactors: (f) => set({ pendingStartFactors: f }),

      setHoleNote: (hole, note) =>
        set((s) => {
          const n = Number(hole);
          if (!Number.isInteger(n) || n < 1 || n > 18) return {};
          const text = String(note ?? '').trim();
          if (!text) {
            if (!(n in s.holeNotes)) return {};
            const next = { ...s.holeNotes };
            delete next[n];
            return { holeNotes: next };
          }
          if (s.holeNotes[n] === text) return {};
          return { holeNotes: { ...s.holeNotes, [n]: text } };
        }),

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

      updateRoundRecord: (roundId, patch) =>
        set(s => ({
          roundHistory: s.roundHistory.map(r =>
            r.id === roundId ? { ...r, ...patch } : r,
          ),
        })),

      setCurrentHole: (hole) => {
        const state = get();
        // 2026-05-22 — Fix T diagnostics. Any call to setCurrentHole now
        // logs a single line with the source (best-effort via Error().stack
        // frame parsing). After two real rounds where auto-advance kept
        // firing despite Fix T's subscriber gate, this lets us SEE exactly
        // what path is bumping the hole. Voice commands, cockpit stepper,
        // DataStrip arrows, scorecard taps — all should appear here when
        // they fire. If ANY anonymous / unexplained path shows up, that's
        // the next thing to gate.
        try {
          const stack = new Error().stack ?? '';
          const lines = stack.split('\n').slice(2, 5); // skip Error + setCurrentHole frame
          const caller = lines.find(l => l.trim().length > 0 && !l.includes('setCurrentHole')) ?? '<unknown>';
          console.log(`[roundStore] setCurrentHole(${hole}) called from: ${caller.trim()}`);
        } catch { /* stack parsing best-effort */ }
        // 2026-05-16 — Clamp to the course's actual hole count so the
        // stepper / auto-detection / voice "next hole" can't overshoot
        // (Tim's Mariners report: tab showed "Hole 10" at a 9-hole
        // course). Also clamp the low end to 1 in case anything ever
        // calls setCurrentHole(0) or a negative.
        // 2026-06-07 (audit M4) — clamp using the SAME authority the
        // caddie's end-of-round check uses (getCourseHoleCount: bundled
        // metadata → live length → 18) so the two can't desync (round
        // ending early or never auto-ending). Respects nineHoleMode.
        const maxHole = (() => {
          if (state.nineHoleMode) return 9;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { getCourseHoleCount } = require('../data/courses') as typeof import('../data/courses');
            return getCourseHoleCount(state.activeCourseId, state.courseHoles.length);
          } catch {
            return state.courseHoles.length > 0 ? state.courseHoles.length : 18;
          }
        })();
        const clamped = Math.max(1, Math.min(hole, maxHole));
        if (clamped !== hole) {
          devLog(`[roundStore] setCurrentHole(${hole}) clamped to ${clamped} (course max=${maxHole})`);
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
        // 2026-05-25 — Clear userStatedYardage when advancing holes;
        // a number you spoke on hole 5 is meaningless on hole 6.
        const clearStated = prevHole !== clamped ? { userStatedYardage: null } : {};
        set({ currentHole: clamped, currentYardage: holeData?.distance ?? null, ...clearStated });
        if (prevHole !== clamped) {
          console.log(`[path2:round] hole transition prev=${prevHole} next=${clamped}`);
          console.log(`[audit:round-active] hole-transition prev=${prevHole} next=${clamped} yardage=${holeData?.distance ?? 'null'}`);
          // 2026-05-21 — Fix S — per-hole caddie intro on transition. Fires
          // for BOTH auto-detection (holeDetection subscriber) and manual
          // nav (cockpit stepper, DataStrip ◀/▶, voice "I'm on hole 7").
          // Brief: hole, par, yardage. Hole 1 at round-start does NOT pass
          // through this branch (startRound uses direct set(), not
          // setCurrentHole), so no double-fire with the briefing or the
          // skip-briefings hole-1 announcement. Gating mirrors the
          // skip-briefings speak: voice enabled AND trust level !== 1
          // (Quiet). Active persona is implicitly honored — speak() reads
          // caddiePersonality from the store at request time (Fix Q).
          // userInitiated:true bypasses L1 Quiet's scripted-speech gate;
          // we still suppress at trust=1 above so Quiet stays quiet.
          if (state.isRoundActive) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const settingsMod = require('./settingsStore') as typeof import('./settingsStore');
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const trustMod = require('./trustLevelStore') as typeof import('./trustLevelStore');
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const voiceMod = require('../services/voiceService') as typeof import('../services/voiceService');
              const settings = settingsMod.useSettingsStore.getState();
              const trustLevel = trustMod.useTrustLevelStore.getState().level;
              if (settings.voiceEnabled && trustLevel !== 1) {
                const par = holeData?.par;
                const yards = holeData?.distance;
                let text = `Hole ${clamped}.`;
                if (par) text += ` Par ${par}.`;
                if (yards) text += ` ${yards} yards.`;
                const apiUrl = getApiBaseUrl();
                void voiceMod.speak(text, settings.voiceGender, settings.language, apiUrl, { userInitiated: true })
                  ?.catch?.(() => {});
              }
              // FIX M12 — per-hole AI briefing for holes 2-18. If courseIntelligence
              // is cached and contains a sentence referencing this hole, speak it as
              // a one-sentence Kevin insight. No API call — reads from the
              // getCachedCourseIntelligenceSync sync accessor (AsyncStorage-backed,
              // warmed by roundPrefetch at round start). Guards: voice on, trust > 1,
              // hole > 1, courseId known, intel cached. Lightweight: no network.
              if (settings.voiceEnabled && trustLevel !== 1 && clamped > 1 && state.activeCourseId) {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const intelMod = require('../services/courseIntelligenceService') as typeof import('../services/courseIntelligenceService');
                  const intel = intelMod.getCachedCourseIntelligenceSync(state.activeCourseId);
                  if (intel) {
                    const holeRef = new RegExp(`hole\\s+${clamped}\\b`, 'i');
                    const sentences = intel.split(/(?<=[.!?])\s+/);
                    const match = sentences.find(sen => holeRef.test(sen));
                    if (match) {
                      const apiUrl2 = getApiBaseUrl();
                      void voiceMod.speak(match.trim(), settings.voiceGender, settings.language, apiUrl2, { userInitiated: true })
                        ?.catch?.(() => {});
                    }
                  }
                } catch (e) {
                  console.log('[roundStore] per-hole intel insight failed (non-fatal):', e);
                }
              }
            } catch (e) {
              console.log('[roundStore] per-hole intro failed (non-fatal):', e);
            }
          }
          // 2026-06-06 — Phase 5 of on-course resilience sprint. Visible
          // banner on every real hole transition. Doubles up the audible
          // "Hole 7. Par 4..." announcement and works even when audio is
          // suppressed (trust=1 Quiet, voiceEnabled=false) or audio is
          // failing (cellular dead — speak() catch logs silently).
          // Tim's perception fix: makes a deliberate transition feel
          // unambiguous rather than buried in audio.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const toastMod = require('./toastStore') as typeof import('./toastStore');
            toastMod.useToastStore.getState().show(`Now on hole ${clamped}`);
          } catch { /* non-fatal */ }
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

      // 2026-05-22 — Hole reconciliation action. Single-line delegate so
      // the UI's Refresh GPS button has a clean import surface:
      //   `useRoundStore.getState().reconcileHole()` → ReconcileResult
      // All safety gates (accuracy, backward-jump, current-hole bias,
      // force-mode margin, sustained-heading tie-breaker) live in the
      // service. Returns a result the UI can render as toast / banner.
      reconcileHole: () => forceHoleReconciliation(),

      setCurrentYardage: (yards) => set({ currentYardage: yards }),

      setUserStatedYardage: (value, source) => {
        const hole = get().currentHole;
        set({
          userStatedYardage: {
            value,
            source,
            asOf: Date.now(),
            holeAtCapture: hole,
          },
        });
        console.log('[roundStore] userStatedYardage set', { value, source, hole });
      },

      clearUserStatedYardage: () => set({ userStatedYardage: null }),
      setClub: (club) => set({ club }),
      setMentalState: (state) => set({ mentalState: state }),
      setRiskMode: (mode) => set({ riskMode: mode }),

      logScore: (hole, score) => {
        set(s => ({ scores: { ...s.scores, [hole]: score } }));
        // 2026-05-22 — Ghost Rounds. Push the just-logged score into the
        // active ghost match so the per-hole delta + running overall
        // refresh immediately. No-op when no ghost is active. Dynamic
        // require avoids the circular import (ghostStore depends on
        // RoundRecord from this file).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ghostMod = require('./ghostStore');
          if (ghostMod.useGhostStore.getState().ghostRecord) {
            ghostMod.useGhostStore.getState().updateHole(hole, score);
            console.log(`[ghost] hole ${hole} score ${score} → updateHole`);
          }
        } catch { /* non-fatal */ }
      },

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
        // 2026-05-17 — preserve `pendingLieAnalysis` across this call.
        // logShot consumes the pending slot when a shot is logged
        // without its own lie_analysis; a penalty isn't really a swing
        // and shouldn't steal a lie capture the user took for their
        // next real shot. Snapshot before, restore after.
        const pendingLieBefore = get().pendingLieAnalysis;
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
        if (pendingLieBefore != null) set({ pendingLieAnalysis: pendingLieBefore });
        // Bump scores[hole] by 1 so the scorecard reflects this penalty immediately.
        const currentScore = get().scores[hole] ?? 0;
        get().logScore(hole, currentScore + 1);
        // Legacy penalties[] field intentionally NOT written — ShotResult is authoritative now.
      },

      logShot: (shot) => {
        console.log(`[path2:round] shot logged hole=${shot.hole} club=${shot.club ?? 'none'}`);
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
              backfilled = s.shots.map((x, i) => {
                if (i !== lastOnHoleIdx) return x;
                // 2026-06-14 — the player just moved to their ball: this shot's
                // resting spot IS the next shot's tee. Compute the honest GPS
                // tee→ball total now (haversine), the most reliable drive
                // distance we have. Guard against jitter with a sane floor so a
                // weak fix can't manufacture a phantom "15-yard drive"; tap-ins
                // legitimately under the floor just stay GPS-distance-less.
                let gpsYds: number | null = null;
                if (x.start_location) {
                  const d = haversineYards(x.start_location, incomingStart);
                  if (Number.isFinite(d) && d >= 5 && d <= 500) gpsYds = Math.round(d);
                }
                const patched: ShotResult = {
                  ...x,
                  end_location: incomingStart,
                  gps_distance_yards: gpsYds ?? x.gps_distance_yards ?? null,
                  // Only fill distance_yards when nothing measured it — never
                  // clobber an acoustic/pose/voice value with the GPS estimate.
                  distance_yards:
                    typeof x.distance_yards === 'number' ? x.distance_yards : gpsYds,
                };
                return patched;
              });
            }
          }
          // Phase 409 — clear the pending lie analysis once consumed
          // by a shot. If the user captures another lie later in the
          // round, setPendingLieAnalysis writes a fresh one. This
          // prevents a stale lie from haunting multiple shots.

          // 2026-06-14 (audit #5 — honesty) — the LEARNING signal for the bag/
          // longestDrive. Airtime carry (acoustic/pose) or a MEASURED total only —
          // NEVER the GPS tee→ball estimate. GPS has no per-fix accuracy here, so a
          // weak fix could otherwise train a wrong yardage into the model and corrupt
          // every future club call. GPS stays a DISPLAY value (it answers "what did my
          // driver do"); it just doesn't teach the brain. distance_yards is treated as
          // GPS-sourced (excluded) exactly when it equals gps_distance_yards.
          const measuredCarry = (sh: ShotResult): number | null => {
            if (typeof sh.carry_distance === 'number' && sh.carry_distance > 0) return sh.carry_distance;
            if (typeof sh.distance_yards === 'number' && sh.distance_yards > 0 && sh.distance_yards !== sh.gps_distance_yards) return sh.distance_yards;
            return null;
          };

          // 2026-06-04 — Auto-update longestDrive when a Driver shot with a real
          // (measured) distance beats the player's current best. Profile store is
          // dynamic-required to avoid a module cycle (playerProfileStore doesn't
          // import roundStore today, but this side-channel update is a single hop).
          const driverYards = enriched.club === 'Driver' ? measuredCarry(enriched) : null;
          if (driverYards != null) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const profileMod = require('./playerProfileStore') as typeof import('./playerProfileStore');
              const cur = profileMod.usePlayerProfileStore.getState().longestDrive;
              if (cur == null || driverYards > cur) {
                profileMod.usePlayerProfileStore.getState().setLongestDrive(driverYards);
              }
            } catch (e) {
              console.log('[roundStore] longestDrive update failed (non-fatal):', e);
            }
          }

          // 2026-06-10 — Caddie CNS Phase 1: feed real carries into the learning
          // bag model. Additive + best-effort; nothing reads it yet (Phase 2).
          try {
            // 2026-06-14 (audit #5) — train the bag ONLY on a measured carry, never a
            // GPS estimate (see measuredCarry above). Keeps the learned model honest.
            const carry = measuredCarry(enriched);
            if (enriched.club && carry != null) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const mem = require('./caddieMemoryStore') as typeof import('./caddieMemoryStore');
              mem.useCaddieMemoryStore.getState().recordShot({ club: enriched.club, carryYds: carry, nowMs: enriched.timestamp ?? 0 });
            }
          } catch (e) {
            console.log('[roundStore] caddie-memory recordShot failed (non-fatal):', e);
          }

          return {
            shots: [...backfilled, enriched],
            pendingLieAnalysis: enriched.lie_analysis ? null : s.pendingLieAnalysis,
          };
        });
      },

      // Phase 109-followup — edit a previously logged shot. Patch is a
      // partial ShotResult. Match by id; no-op if id not found.
      editShot: (id, patch) =>
        set(s => ({
          shots: s.shots.map(x => x.id === id ? { ...x, ...patch } : x),
        })),

      // 2026-06-07 (audit) — clear quick-score placeholder shots for a hole
      // before re-scoring. Quick-score taps mint `score` synthetic shots
      // (ids prefixed `qs-<hole>-`); without clearing the prior batch,
      // re-scoring a hole accumulated phantom shots (corrupting recap /
      // GIR / club-usage / longest-drive stats). Only removes synthetic
      // quick-score shots — real tracked/voice/auto shots are untouched.
      clearQuickScorePlaceholders: (hole) =>
        set(s => ({
          shots: s.shots.filter(x => !(typeof x.id === 'string' && x.id.startsWith(`qs-${hole}-`))),
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
      // 2026-06-07 (audit M3) — single atomic append that assigns indices
      // but does NOT run logShot's per-shot back-fill. The back-fill sets
      // the PREVIOUS shot's end_location to the next shot's start, which
      // chained end-locations across catch-up shots that weren't actually
      // sequential in time, corrupting their distances. Contract: bulk
      // shots must carry their own start/end locations (they're complete,
      // already-ordered records); we preserve them verbatim.
      bulkLogShots: (shots) =>
        set(s => {
          if (shots.length === 0) return {};
          let roundIdx = s.shots.length;
          const perHole = new Map<number, number>();
          for (const x of s.shots) perHole.set(x.hole, (perHole.get(x.hole) ?? 0) + 1);
          const batch: ShotResult[] = shots.map(shot => {
            const incomingStart = shot.start_location ?? shot.gps_location ?? null;
            roundIdx += 1;
            const holeCount = (perHole.get(shot.hole) ?? 0) + 1;
            perHole.set(shot.hole, holeCount);
            return {
              ...shot,
              start_location: incomingStart,
              gps_location: shot.gps_location ?? incomingStart,
              hole_number: shot.hole_number ?? shot.hole,
              shot_in_hole_index: shot.shot_in_hole_index ?? holeCount,
              shot_in_round_index: shot.shot_in_round_index ?? roundIdx,
              player_id: shot.player_id ?? 'primary',
            };
          });
          return { shots: [...s.shots, ...batch] };
        }),

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
        // 2026-06-16 (audit) — count only finalized holes (score>0), matching
        // getScoreVsPar + the persisted RoundRecord. A 0-score in-progress hole
        // must not inflate the count.
        Object.values(get().scores).filter((score) => score > 0).length,

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
        activeCourse: s.activeCourse,
        activeCourseId: s.activeCourseId,
        courseLocation: s.courseLocation,
        recentCourseIds: s.recentCourseIds,
        // Persist the last previewed/selected course so a cold start
        // restores the user's pick instead of defaulting to Menifee.
        previewCourseId: s.previewCourseId,
        courseHoles: s.courseHoles,
        nineHoleMode: s.nineHoleMode,
        isCompetition: s.isCompetition,
        roundNotes: s.roundNotes,
        goal: s.goal,
        currentHole: s.currentHole,
        holeNotes: s.holeNotes,
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
        roundEndTime: s.roundEndTime,
        emotionalLog: s.emotionalLog,
        // 2026-05-24 — Persist Meta glasses + external context so a
        // query about a prior hole survives an app restart.
        externalContext: s.externalContext,
        // 2026-05-17 — second audit pass found two more in-round
        // fields that were initialized + mutated but missing from
        // partialize, so a crash mid-round lost them:
        // pendingLieAnalysis (TightLie capture awaiting next shot)
        // + selectedTee (Play tab tee picker). `goal` is already
        // partialized above.
        pendingLieAnalysis: s.pendingLieAnalysis,
        selectedTee: s.selectedTee,
        transportMode: s.transportMode,
        // 2026-06-05 — third audit pass: four more in-round fields
        // that were initialized + mutated mid-round but missing from
        // partialize, so a crash + relaunch silently lost them.
        //   preRoundYardageSnapshot — frozen F/M/B at round start;
        //     used by recap planned-vs-outcome comparison
        //   userStatedYardage      — "I'm 140" voice override
        //   currentLocationType    — tee/fairway/green tagging for shots
        //   currentTeeBox          — tee anchor for hole-1 yardage
        preRoundYardageSnapshot: s.preRoundYardageSnapshot,
        userStatedYardage: s.userStatedYardage,
        currentLocationType: s.currentLocationType,
        currentTeeBox: s.currentTeeBox,
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
