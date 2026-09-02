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
 * WHERE IS THE GREEN FOR THIS HOLE — one owner, and it is not here.
 *
 * 2026-08-24 (orphan sweep, root cause). This used to carry its OWN cascade, and the version it
 * duplicated was better in three separate ways. Its own comment admitted the split:
 * "(Mirrors shotLocationService.getGreenCentroid, which does this right.)"
 *
 * What the local copy was missing:
 *   1. THE CANONICAL RESOLVER. getGreenCentroid consults smartFinderService.resolveGreenCoords first
 *      — surveyed truth → Mark Green override → golfbert → courseHoles → geometryCache — and maps a
 *      front-nine marked green onto the back nine on a twice-around course. This copy went straight
 *      to the geometry cache, so a green the player had MARKED was ignored when their hole was
 *      closed out. Every surface the player HEARS (wind, lie analysis, shot tracking, the caddie
 *      payload, distance-to-green) already used the canonical one. Only the coordinate written into
 *      their shot HISTORY used this one. The data disagreed with the voice.
 *   2. THE WGS84 GUARD. This used loose `!== 0` checks — the pre-"Fix GM" shape closed in
 *      shotLocationService on 06-02. It accepts near-zero (0.0001°) and out-of-range values, which is
 *      exactly the class where metres leak into degree slots. A poisoned coordinate became a hole's
 *      green centroid and corrupted shot end-locations and recap distances.
 *   3. Front/back averaging on the GEOMETRY path (this copy only did it on the legacy path).
 *
 * getGreenCentroid's own docstring already claimed it was the "single source of truth… used by
 * SmartFinder distance queries, hole-transition end_location closure, and the distance_to_green
 * voice query." The hole-transition closure was the one consumer that never called it. A file
 * describing its own wiring is not evidence of that wiring.
 *
 * Lazy require: shotLocationService imports useRoundStore at module top, so a static import here
 * would close a cycle. Same pattern the old body used for courseGeometryService.
 */
function greenForHole(holeNumber: number): ShotLocation | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getGreenCentroid } = require('../services/shotLocationService') as typeof import('../services/shotLocationService');
    return getGreenCentroid(holeNumber);
  } catch {
    // Never let a green lookup take down a hole transition or a round save.
    return null;
  }
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
  // 2026-07-04 (clean-audit M1) — which shot on the hole the player SAID this was
  // ("my second shot" → 2). Was parsed by the brain but dropped on write. Optional;
  // null when unstated (the shot's position in the hole's array is the fallback order).
  shot_number?: number | null;
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
  /**
   * 2026-08-24 (Tim — "it would be great if the user knows if shots are verifiably better when doing
   * their routine") — how long the player stood over this shot, in ms, from the shot detector.
   *
   * A pre-shot routine takes time, and the detector already measured that stillness precisely (it
   * has to, because stillness is what identifies a shot at all). It was computed and discarded on
   * every shot. A LOWER BOUND by construction, so a routine is never over-credited. Null on any shot
   * logged by a path that had no GPS stillness to measure — manual entry, the fallback emit.
   */
  pre_shot_dwell_ms?: number | null;
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


/**
 * 2026-08-12 (Tim — "per hole stats matter, especially for history, ghost rounds, and progress
 * tracking") — restored and DERIVED rather than re-scaffolded.
 *
 * The original was a field initialised in four places and never populated by anything, so I removed
 * it in the store sweep. That was the wrong call: the shape was right, it just had no producer.
 *
 * It has one now, and it fabricates nothing. Score, putts and penalties are already captured per
 * hole. GIR is genuinely derivable from them by its standard definition — a green hit in regulation
 * means you reached it with two strokes left for putting — so it needs no new capture and is honest.
 *
 * fairwayHit stays NULL, deliberately and until a real signal exists. `outcome === 'clean'` means
 * "no penalty logged", not "found the fairway" — a tee shot into the rough is clean. Deriving FIR
 * from it would be exactly the fabricated stat the dashboard already refuses to show.
 * [[illustration-data-points]]
 */
export interface HoleStats {
  hole: number;
  score: number;
  putts: number;
  penalties: number;
  /** Null until a real fairway signal exists — never derived from penalty-free tee shots. */
  fairwayHit: boolean | null;
  /** Green in regulation: reached with 2 strokes left to putt. Null when par is unknown. */
  girHit: boolean | null;
}

/**
 * 2026-08-12 — the caddie's risk posture, restored WITH a producer and consumers.
 *
 * Tim: "A huge part of the app is mental state and mental coaching, hence the dynamics being in
 * play." Risk posture is where that becomes an actual club, which is why it belongs in the round and
 * not in settings — it changes hole to hole, and it changes with how the round is going.
 */
export type RiskMode = 'safe' | 'normal' | 'aggressive';

/**
 * 2026-07-25 — one revertible scoring action, captured just before it mutates state.
 *  - score: restores the prior hole score (and prior currentHole, since the first score
 *           on a hole can auto-advance) — deleting the entry when there was no prior score.
 *  - putts: restores the prior putt count for the hole (deleting when there was none).
 *  - shot:  removes the just-appended shot by id (via deleteShot).
 */
export type LastMutation =
  | { kind: 'score'; hole: number; prevScore: number; prevCurrentHole: number; at: number }
  | { kind: 'putts'; hole: number; prevPutts: number | undefined; at: number }
  | { kind: 'shot'; shotId: string; hole: number; at: number };

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
  scoreVsPar: number | null; // null = round had no hole with a known par (don't fabricate/trend a vs-par)
  // 2026-07-24 (M3/M4) — WHS posting basis when this round was played in-app with known pars:
  //   handicapAgs   = Adjusted Gross Score (per-hole net-double-bogey cap; picked-up/unplayed holes
  //                   filled with net par). handicapHoles = length it posts as (9/18). Present only when
  //                   the round met the WHS posting minimum (7 of 9 / 14 of 18) with known pars; the
  //                   handicap recalc uses these instead of the raw total (blow-up holes no longer
  //                   inflate the Index, and a couple of picked-up holes no longer drop the whole round).
  handicapAgs?: number;
  handicapHoles?: 9 | 18;
  isCompetition: boolean;
  nineHoleMode: boolean;
  mode: RoundMode;
  scores: Record<number, number>;
  putts: Record<number, number>;
  shots: ShotResult[];
  /**
   * 2026-08-14 — watch swings captured during this round, tagged to their hole at capture time.
   * Optional: absent on imports, on rounds played without the watch, and on every round that predates
   * this. Stored because watchStore keeps them in memory only, so they would otherwise be gone by the
   * time anyone opens the recap.
   */
  watchSwings?: { timestamp: number; tempoRatio: number; hole: number | null; club: string | null }[];
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
  /**
   * 2026-08-12 (Tim — "per hole stats matter, especially for history, ghost rounds, and progress
   * tracking") — the derived per-hole record, frozen onto the round at completion.
   *
   * Persisted rather than re-derived on read, because derivation needs `courseHoles` for par and
   * that is cleared when the round ends. Without this snapshot, GIR would be computable DURING a
   * round and permanently unknowable afterwards — exactly backwards for history and progress.
   * Optional: rounds that predate this omit it.
   */
  holeStats?: HoleStats[];
  /**
   * 2026-08-12 — TIER 3 of the watch read: the end-of-round tempo compilation.
   *
   * Frozen onto the record because the watch's session swings are in-memory only (watchStore
   * partialize keeps deviceName), so this is the ONE moment the story can be written down. Absent
   * on rounds played without the watch, which is most of them.
   */
  tempoStory?: { baseline: number | null; earlyAvg: number | null; lateAvg: number | null; headline: string } | null;
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
  // 2026-07-01 (audit) — per-hole par snapshot taken at round end. Completed-round
  // surfaces (scorecard tab, HandicapImpactCard, recap) otherwise fabricated par-4
  // for every hole, because courseHoles is cleared when the round ends and API
  // courseIds don't resolve back to a bundled hole list post-round. Snapshotting the
  // real pars here is the single source of truth. Optional: pre-this + imports omit
  // it (consumers fall back to getBundledHoles(courseId) then par-4).
  holePars?: Record<number, number>;
  /** 2026-07-04 — true for a voice SIM round (narrated on simulated GPS).
   *  Excluded from handicap rebuilds and shown as SIM in history. */
  simulated?: boolean;
  // 2026-06-27 (smoke-test fix) — true once this round's score differential has
  // been posted to the WHS index. endRound auto-posts at round end; this flag
  // stops the recap card's "Post to my Index" button from posting the SAME
  // round a SECOND time (which took two of the best-8-of-20 slots and pulled
  // the index too low). Optional: rounds that predate this read as not-posted.
  handicapPosted?: boolean;
}

// ─── STATE ────────────────────────────────

interface RoundState {
  isRoundActive: boolean;
  /** 2026-07-04 — true while a voice SIM round is active (see startRound.simulated).
   *  Gates every learning writer so narrated test rounds never train the brain. */
  isSimRound: boolean;
  mode: RoundMode;
  currentRoundId: string | null;
  activeCourse: string | null;
  activeCourseId: string | null; // golfcourseapi course_id; null for local/manual rounds
  courseLocation: ShotLocation | null;
  recentCourseIds: string[]; // last 5 API course IDs played
  /**
   * 2026-08-12 (Tim, an hour before a league round — "where the hell did Wachusett go? It's not
   * even on my list anymore") — the last known NAME/LOCATION for each recent course id.
   *
   * The Play tab rehydrated recents by calling getCourse(id) for every id at mount, and SILENTLY
   * DROPPED any course whose lookup failed. So a network blip at app start — which is precisely
   * when that effect runs, and precisely what today's warmup connection-starvation bug caused —
   * made a real recent course disappear from the list entirely, while its id sat happily in
   * recentCourseIds. The data was never lost; the app just stopped being able to name it.
   *
   * Caching the name means the list is drawable with no network at all. A course you played
   * yesterday must not vanish because a fetch timed out this morning.
   */
  recentCourseMeta: Record<string, { club_name: string; location: string }>;
  courseHoles: CourseHole[];
  nineHoleMode: boolean;
  // 2026-08-08 (verification wave) — TRUE only when runStartRound expanded a 9-hole course to 18 (twice
  // around). Stamped by the ONE place that knows, instead of three consumers (geometry wrap, hole
  // reconciliation, course-book write) each GUESSING from hole counts — every guess failed differently
  // for non-bundled/API courses (18-default fallbacks made the wrap/reconcile dead or wrongly enabled).
  twiceAround: boolean;
  // 2026-08-06 (tester Matt Abid) — the hole this round STARTED on (1 = front nine, 10 = back nine). For a
  // 9-hole round the final hole is roundStartHole + 8, so a back nine plays 10-18 and ends at 18.
  roundStartHole: number;
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

  scores: Record<number, number>;
  putts: Record<number, number>;
  penalties: Record<number, number>;
  /** The caddie's current risk posture. Set by the player (voice or tap) or eased by the caddie. */
  riskMode: RiskMode;
  /**
   * When the CADDIE eased the posture itself (spiraling read), so a surface can say so ONCE.
   * Null when the posture is where the player put it. A caddie that quietly turns conservative and
   * never mentions it reads as having lost faith in you. [[feels-like-a-real-caddie]]
   */
  riskEasedAt: number | null;
  shots: ShotResult[];
  // 2026-07-25 (voice "undo / scratch that") — transient, single-depth snapshot of the
  // most-recent scoring mutation so a misheard/mis-logged score, putt, or shot can be
  // reverted by voice. NOT persisted (absent from partialize) — undo is an in-the-moment
  // affordance, never resurrected across app restarts. Cleared after it's consumed.
  lastMutation: LastMutation | null;
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
  // 2026-08-09 (Tim — "missing major club use logic") — WHEN the player last declared a club, so shot
  // attribution can arbitrate "user declared 7i" vs "caddie advised 8i" by recency (advised stands
  // unless the player changed club AFTER the advice).
  clubSetAt: number | null;
  /**
   * 2026-08-17 — `kind` records WHO produced this stamp, because not every writer is the caddie:
   *   'spoken'   — the caddie's recommend_club tool: an actual club call, out loud.
   *   'engine'   — the shot-strategy engine's recommended_club, surfaced to the player.
   *   'inferred' — the APP guessing a club from yardage (inferClub). Useful for attributing which
   *                club was hit, but nobody advised it, so adherence must not be measured against
   *                it. It was flowing through this same slot and inflating the recap's "you took
   *                my club" rate with advice that was never given.
   * Absent on stamps persisted before this change — treated as advice, which is what they were.
   */
  pendingKevinRec: { club: string | null; shape: string | null; aimPoint: string | null; aimSide?: 'left' | 'center' | 'right' | null; at?: number; kind?: 'spoken' | 'engine' | 'inferred' } | null;

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
      // 2026-08-06 (tester Matt Abid — "9-hole only shows the front nine") — which hole the round STARTS on.
      // Front nine = 1, back nine = 10. Defaults to 1. For a 9-hole round the last hole is startHole + 8.
      startHole?: number;
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
      /** 2026-08-08 — set by runStartRound when it expanded a 9-hole course to 18 (twice around). */
      twiceAround?: boolean;
      /** 2026-07-04 (Tim — voice sim round / "level one of the golf game") —
       *  marks the round SIMULATED: played by narration on simulated GPS.
       *  A sim round exercises the ENTIRE live pipeline but never trains
       *  anything: no handicap post, no learned-bag carries, no CNS course
       *  memory, no longestDrive, no points. Record is tagged simulated. */
      simulated?: boolean;
    },
  ) => void;
  setSelectedTee: (color: TeeColor) => void;
  setTransportMode: (m: TransportMode) => void;

  // Phase 409 — TightLie pending lie analysis.
  setPendingLieAnalysis: (analysis: import('../services/lieAnalysisService').LieAnalysis | null) => void;
  clearPendingLieAnalysis: () => void;

  // FIX M8 — Kevin recommendation adherence tracking.
  setPendingKevinRec: (rec: { club: string | null; shape: string | null; aimPoint: string | null; aimSide?: 'left' | 'center' | 'right' | null; at?: number; kind?: 'spoken' | 'engine' | 'inferred' } | null) => void;
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
  /** 2026-06-27 — mark a round's differential as posted to the WHS index, so it
   *  can't be double-counted (endRound auto-post + recap-card "Post" button). */
  markHandicapPosted: (id: string) => void;
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
  /**
   * 2026-08-11 (Tim — "for the tenth time, Connecticut National is STILL a green screen and has no
   * thumbnail in the Play tab").
   *
   * The course's own coordinates, captured the moment it is selected. Every pre-round surface —
   * the SmartVision preview, the Play-tab thumbnail — needed a position to draw an aerial, and the
   * only source was the GEOMETRY CACHE. So they showed nothing until a multi-second geometry fetch
   * landed, and nothing at all if it failed: a green screen and a blank thumbnail on a course whose
   * latitude and longitude we were already holding in the record we'd just fetched.
   *
   * Holding the centroid here decouples "where is this course" from "have we built its holes yet".
   * A selected course can always draw itself immediately, and the hole-accurate tile refines it
   * later when geometry arrives.
   */
  previewCourseCoords: { lat: number; lng: number } | null;
  setPreviewCourse: (id: string | null, coords?: { lat: number; lng: number } | null) => void;
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
  /**
   * Record a yardage the player stated. Returns false when the value is not a plausible yardage —
   * the one owner of that judgment; see the implementation for why it does not live at the callers.
   */
  setUserStatedYardage: (value: number, source: 'user' | 'rangefinder' | 'golfshot' | 'other') => boolean;
  /** Clear the stated yardage. Called automatically on next shot logged
   *  or next hole advance; exposed for manual reset too. */
  clearUserStatedYardage: () => void;
  setClub: (club: string) => void;
  setMentalState: (state: string) => void;
  logScore: (hole: number, score: number) => void;
  /** Cache a recent course's name so the Play tab can list it with no network. */
  rememberRecentCourseMeta: (id: string, meta: { club_name: string; location: string }) => void;
  /** Set the caddie's risk posture. `bySelf` marks a caddie-initiated ease rather than a player choice. */
  setRiskMode: (mode: RiskMode, bySelf?: boolean) => void;
  /** Per-hole stats for the CURRENT round — derived, never fabricated. Empty until holes are scored. */
  getHoleStats: () => HoleStats[];
  logPutts: (hole: number, putts: number) => void;
  addPenalty: (hole: number) => void;
  logShot: (shot: ShotResult) => void;
  /** 2026-07-25 — revert the last score/putt/shot (voice "undo / scratch that").
   *  Returns a spoken description of what was undone, or ok:false when there's
   *  nothing to undo. Single-depth: consumes the snapshot. */
  undoLastMutation: () => { ok: boolean; description: string | null };
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
  /**
   * 2026-08-24 (Tim, after a real round — "I got a briefing on a hole twice") — WHAT THE CADDIE HAS
   * ALREADY SAID ON THIS HOLE. One owner, round-scoped, persisted with the round.
   *
   * The tee brief and the proactive stop-read each deduped with a `useRef` inside
   * app/(tabs)/caddie.tsx. A ref does not survive a REMOUNT — and the reset effect guarding it was
   * keyed `[isRoundActive]`, so it also ran on mount and ACTIVELY CLEARED the memory every time the
   * tab remounted mid-round. Switch to Play and back on the same hole and the brief re-armed.
   *
   * "Has the caddie briefed hole 7 this round" is a fact about the ROUND, so it lives with the
   * round. Persisting it means even an app restart mid-round will not repeat a line.
   */
  spokenHoleEvents: Record<string, true>;
  /** True if `kind` has already been spoken on `hole` this round. */
  hasSpokenOnHole: (kind: string, hole: number) => boolean;
  /** Record that `kind` was spoken on `hole`. Idempotent. */
  markSpokenOnHole: (kind: string, hole: number) => void;
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
  getScoreVsPar: () => number | null; // null = no scored hole has a known par (don't fabricate vs-par)
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
/**
 * The plausible band for a yardage the PLAYER states. Owned here because five producers each had
 * their own number (700 / 700 / 900 / 400 / 400) and the field they all write had none.
 * 1 covers a tap-in; 600-odd covers a par 5 from the tee; 850 is not a golf shot.
 */
const MIN_STATED_YARDAGE = 1;
const MAX_STATED_YARDAGE = 700;

const MAX_ROUND_HISTORY = 1000;
const capHistory = (h: RoundRecord[]): RoundRecord[] =>
  h.length > MAX_ROUND_HISTORY ? h.slice(-MAX_ROUND_HISTORY) : h;

// 2026-07-01 (re-audit) — round-store-v1 is ONE persisted row. Each RoundRecord
// carries a full `shots` array (and possibly base64 round_photos), so at ~150+
// rounds the single row can exceed Android's ~2MB per-row read limit and become
// UNREADABLE — the exact failure mode that killed the cage dashboard (which was
// fixed by frame-stripping). Defend the crown-jewel store the same way: keep the
// most recent FULL_DETAIL_ROUNDS full, and strip the heavy per-shot + media arrays
// from OLDER rounds on PERSIST while preserving every scoring + handicap essential
// (scores, putts, holePars, totals, scoreVsPar). In-memory history stays full for
// the session; only the on-disk copy is compacted, so old rounds lose only their
// shot-by-shot / photo detail after a reload — never their score or Index impact.
const FULL_DETAIL_ROUNDS = 50;
const compactHistoryForPersist = (rounds: RoundRecord[]): RoundRecord[] => {
  if (rounds.length <= FULL_DETAIL_ROUNDS) return rounds;
  const cutoff = rounds.length - FULL_DETAIL_ROUNDS;
  return rounds.map((r, i) => {
    if (i >= cutoff) return r; // most recent → keep full
    const heavy = (r.shots?.length ?? 0) > 0 || r.round_photos != null || r.emotionalLog != null || r.health != null;
    if (!heavy) return r; // already light
    return { ...r, shots: [], round_photos: undefined, emotionalLog: undefined, health: undefined };
  });
};

// 2026-08-06 (audit — back nine fix). The round's true hole RANGE, respecting nineHoleMode + roundStartHole
// so front (1-9), back (10-18), and full (1-N) rounds all navigate/end within their own bounds. Single
// source of truth for every stepper / clamp / end-detection so they can't desync.
export function roundFirstHole(s: { nineHoleMode: boolean; roundStartHole: number }): number {
  return s.nineHoleMode ? Math.max(1, s.roundStartHole || 1) : 1;
}
export function roundLastHole(s: { nineHoleMode: boolean; roundStartHole: number; activeCourseId: string | null; courseHoles: CourseHole[] }): number {
  if (s.nineHoleMode) return Math.max(1, s.roundStartHole || 1) + 8;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCourseHoleCount } = require('../data/courses') as typeof import('../data/courses');
    return getCourseHoleCount(s.activeCourseId, s.courseHoles.length);
  } catch {
    return s.courseHoles.length > 0 ? s.courseHoles.length : 18;
  }
}

// 2026-08-09 (on-course audit C1/C2) — bare-voice score/putts hole resolvers live in the LEAF module
// store/voiceScoringHole (no asset imports, so it's unit-testable); re-exported here so the require()
// call sites are unchanged. See voice-scoring-hole.test.ts.
export { voiceScoreHole, voicePuttsHole } from './voiceScoringHole';

export const useRoundStore = create<RoundState>()(
  persist(
    (set, get) => ({
      isRoundActive: false,
      isSimRound: false,
      mode: 'free_play' as RoundMode,
      currentRoundId: null,
      activeCourse: null,
      activeCourseId: null,
      courseLocation: null,
      recentCourseIds: [],
      recentCourseMeta: {},
      courseHoles: [],
      nineHoleMode: false,
      twiceAround: false,
      roundStartHole: 1,
      isCompetition: false,
      roundNotes: '',
      goal: null,
      preRoundYardageSnapshot: null,
      currentHole: 1,
      holeNotes: {},
      currentYardage: null,
      spokenHoleEvents: {},
      userStatedYardage: null,
      club: null,
      mentalState: 'neutral',
      scores: {},
      putts: {},
      penalties: {},
      riskMode: 'normal',
      riskEasedAt: null,
      shots: [],
      lastMutation: null,
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
      clubSetAt: null,
      pendingKevinRec: null,

      setSelectedTee: (color) => set({ selectedTee: color }),
      setTransportMode: (m) => set({ transportMode: m }),
      setPendingLieAnalysis: (analysis) => set({ pendingLieAnalysis: analysis }),
      clearPendingLieAnalysis: () => set({ pendingLieAnalysis: null }),
      setPendingKevinRec: (rec) => set({ pendingKevinRec: rec ? { at: Date.now(), ...rec } : null }),
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
        // 2026-08-12 — begin the round trace automatically. Zero setup: the round IS the signal
        // that we want a trace ([[hands-free-zero-setup-is-the-product]]).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const rt = require('../services/roundTrace') as typeof import('../services/roundTrace');
          rt.startRoundTrace(course || 'round');
          rt.trace('round', 'start', { course, holes: holes?.length ?? 0, nineHole: !!options?.nineHole });
        } catch { /* tracing never blocks a round */ }
        const courseId = options.courseId ?? null;
        const courseLocation = options.courseLocation ?? null;
        // 2026-08-06 (tester Matt Abid) — resolve the starting hole (front nine = 1, back nine = 10),
        // clamped to a real hole in the loaded set.
        const nHoles = holes.length || 1;
        let startHoleResolved = Math.max(1, Math.min(options.startHole ?? 1, nHoles));
        // 2026-08-06 (audit cycle 5, finding #1) — a back-nine start needs a FULL nine ahead of it. On a
        // 9-hole course "back nine" (hole 10) would clamp to hole 9 and then believe the round runs 9→17,
        // walking the player through phantom holes 10-17 with no par/geometry and saving garbage scores.
        // When nineHole is set but the course can't fit a full nine from the requested start, fall back to
        // the front nine. (Guards EVERY start entrypoint, not just the pill UI.)
        if (options.nineHole && startHoleResolved > 1 && startHoleResolved + 8 > nHoles) {
          startHoleResolved = 1;
        }
        // 2026-07-01 (audit — MIC CONVERGENCE) — a new round is a fresh conversation:
        // wipe the shared pipecat history so last round's chat can't leak context into
        // this one. Best-effort; never blocks the round from starting.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/voice/conversationHistory').clearConversationHistory();
        } catch { /* voice history is additive */ }
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
        // 2026-07-30 (audit #1 — DATA LOSS). startRound unconditionally zeroed scores/putts/shots. If a
        // round was ALREADY active with real scores, a one-tap "start a round" (or a voice/deep-link start)
        // wiped it with NO RoundRecord saved. The Play banners are now gated on !isRoundActive; this is the
        // defense for EVERY caller — preserve the in-progress round to history before the reset. Never
        // preserve a sim round; skip if this call is re-starting the SAME round id.
        if (prev.isRoundActive && !prev.isSimRound && prev.currentRoundId !== roundId) {
          const scored = Object.entries(prev.scores).filter(([, sc]) => (sc as number) > 0);
          if (scored.length > 0) {
            try {
              const preserved: RoundRecord = {
                id: prev.currentRoundId ?? `${Date.now()}_preserved`,
                roundNumber: prev.roundNumber,
                courseName: prev.activeCourse,
                courseId: prev.activeCourseId,
                startedAt: prev.roundStartTime ?? Date.now(),
                endedAt: Date.now(),
                holesPlayed: scored.length,
                totalScore: scored.reduce((a, [, sc]) => a + (sc as number), 0),
                scoreVsPar: null,
                isCompetition: prev.isCompetition,
                nineHoleMode: prev.nineHoleMode,
                mode: prev.mode,
                scores: { ...prev.scores },
                putts: { ...prev.putts },
                shots: [...prev.shots],
                selectedTee: prev.selectedTee,
                transportMode: prev.transportMode,
              };
              set(s => ({ roundHistory: capHistory([...s.roundHistory, preserved]) }));
              console.warn('[roundStore] startRound over an active round — preserved the prior round to history (no data loss)');
            } catch (e) { console.log('[roundStore] preserve-on-startRound failed (non-fatal):', e); }
          }
        }
        set({
          isRoundActive: true,
          isSimRound: options.simulated === true,
          mode: options.mode ?? 'free_play',
          currentRoundId: roundId,
          activeCourse: course,
          activeCourseId: courseId,
          courseLocation,
          recentCourseIds: updatedRecent,
          courseHoles: holes,
          nineHoleMode: options.nineHole,
          twiceAround: options.twiceAround === true,
          // 2026-08-09 (stores audit P1) — clear last round's club context so it can't bleed into the
          // first shot of a new round (resolveShotClub's 12-min freshness would otherwise carry it).
          club: null,
          clubSetAt: null,
          pendingKevinRec: null,
          isCompetition: options.isCompetition,
          roundNotes: options.notes,
          goal: options.goal,
          preRoundYardageSnapshot: preRoundSnapshot,
          // FIX B5 — use pre-resolved values (see above) so selectedTee and
          // transportMode are always sourced from opts, not ambient store state.
          selectedTee: resolvedTee,
          transportMode: resolvedTransport,
          // 2026-08-06 (tester Matt Abid) — start on the chosen nine (back nine = hole 10). Clamped to a
          // real hole in the loaded set so an out-of-range start can't strand the round.
          currentHole: startHoleResolved,
          roundStartHole: startHoleResolved,
          holeNotes: {},
          currentYardage: holes[startHoleResolved - 1]?.distance ?? null,
          // 2026-08-24 — a new round starts with nothing said yet, or round 2 would inherit round 1's
          // briefs on every hole number already played.
          spokenHoleEvents: {},
          scores: {},
          putts: {},
          penalties: {},
          riskMode: 'normal',
      riskEasedAt: null,
          shots: [],
          lastMutation: null,
          currentRoundPhotos: [],
          emotionalLog: [],
          roundStartTime: Date.now(),
          roundNumber: prev.roundNumber + 1,
          active_ghost: null,
          mentalState: 'neutral',
          currentLocationType: 'unknown',
          currentTeeBox: null,
        });
        // 2026-06-23 (audit FIX A) — reset the mental-coach spiral at
        // round start. resetSpiral had ZERO callers, so a round ended
        // mid-spiral left consecutiveBadHoles/currentMentalState='spiraling'
        // persisted into the NEXT round, muting hole-1 tactical coaching.
        // Clear it here alongside the other start-of-round resets.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const relMod = require('./relationshipStore') as typeof import('./relationshipStore');
          relMod.useRelationshipStore.getState().resetSpiral();
        } catch (e) {
          console.log('[roundStore] resetSpiral at round start failed (non-fatal):', e);
        }
        console.log(`[path2:round] start course=${course} holes=${holes.length} courseId=${courseId ?? 'none'}`);
        console.log(`[audit:round-active] state=true roundId=${roundId} hole=1 course="${course}"`);
        // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/usageTelemetry').track('round_started', { holes: holes.length, mode: options.mode ?? 'free_play' });
        } catch { /* telemetry never throws */ }
        // FIX B6 — hole 1 voice intro. startRound sets currentHole:1 via direct
        // set() which bypasses setCurrentHole's TTS block (prevHole===clamped guard
        // would fire with both equal to 1). Fire the same intro inline here so the
        // player hears "Hole 1. Par 4. 380 yards." at round start without requiring
        // a manual hole-advance. No double-fire risk: setCurrentHole only speaks when
        // prevHole !== clamped, so a subsequent auto-advance to hole 2 won't repeat it.
        // 2026-08-08 (progression audit P1-5, Tim-approved) — REMOVED the FIX B6 spoken intro here. It
        // hardcoded "Hole 1. Par X. Y yards." — WRONG on a back-nine start (says Hole 1 while the round
        // starts on 10) — and DOUBLE-SPOKE over the caddie tab's own correct intro (skip_briefings
        // branch), two overlapping voices at round start. The caddie tab is the ONE intro owner now;
        // this store stays silent (matching the pull-only per-hole model everywhere else).
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
        // orchestrator reads isEffectiveCartMode() synchronously when
        // deciding whether to auto-fire on a GPS-displacement event, and
        // the detector tick self-corrects settings.cartMode (2026-08-30).
        // Stopped at round end.
        // 2026-08-31 — this comment used to name getCachedReading() here
        // too. That function has ZERO callers and never had one; only
        // isEffectiveCartMode is actually read. A comment that names a
        // caller which does not exist is how an orphan stays invisible.
        // [[a-stale-header-is-a-source-someone-trusts]]
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
        // ensures permission + GPS are running before the user does
        // anything else. (Shot detection is NOT started here — see FIX B
        // below; it is owned by the gated subscriber in app/_layout.tsx
        // which respects the user's autoShotDetection setting + cartMode.)
        //
        // hole detection + off-course detector + poor-signal subscription
        // already auto-start from app/_layout.tsx via the existing
        // isRoundActive subscription (since Phase 405 wave 1) so they
        // ride along automatically with the isRoundActive=true set
        // above.
        void (async () => {
          // 2026-07-30 (audit #4/#14 — DEVICE-CONFIRMED GPS leak) — a SIM round must NOT start the real
          // GPS watch + Android foreground-service notification; simRound feeds SIMULATED fixes. This
          // orchestration ran unconditionally, so a live watchPositionAsync + "tracking your round"
          // notification + eval timer leaked for the WHOLE sim round (proven in Tim's issue log:
          // gps_error stale_hard_clear with lastSource:live DURING a sim round), and on permission-denied
          // it even discardRound()'d the sim round out from under the user. Sim GPS is simRound's job.
          if (options.simulated === true) return;
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
            // 2026-06-23 (audit FIX B) — shot detection is NOT started here.
            // The gated subscriber in app/_layout.tsx owns it: it respects
            // the user's autoShotDetection setting and calls configure({cartMode})
            // first. The previous unconditional shotDetectionService.start()
            // here bypassed that setting (phantom shot prompts Tim disabled)
            // and skipped cartMode config. startRound orchestrates GPS only.
            console.log('[audit:round-active] GPS orchestrated start complete (shot detection owned by _layout gated subscriber)');
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
            // 2026-07-20 (bug-hunt fix) — use the WHS 9-hole method (played-9 differential +
            // the player's EXPECTED second nine), matching rebuildDifferentialsFromHistory.
            // The old score-doubling (total×2 vs 72.0) is the method the codebase ITSELF
            // declares wrong (handicapCalculator.ts:247) — it understates the differential and
            // biases the Index DOWN, and it made the single-scorecard import path disagree with
            // the bulk import + Settings→Recalculate for the same round.
            const currentIndex = typeof profile.handicap_index === 'number' ? profile.handicap_index : 14;
            const diff = input.holesPlayed === 9
              ? Math.round((calcMod.computeScoreDifferential(input.totalScore, 36.0, 113) + calcMod.expectedNineDifferential(currentIndex)) * 10) / 10
              : calcMod.computeScoreDifferential(input.totalScore, 72.0, 113);
            profile.pushDifferential(diff);
            // 2026-07-21 (BETA data-integrity) — the differential is now posted, so mark this
            // imported round handicap-posted (exactly like endRound does at record time).
            // Without it, HandicapImpactCard's "Post to Index" button (gated on !handicapPosted)
            // offers to post the SAME round again → the differential double-counts the Index.
            get().markHandicapPosted(id);
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
            const vsStr = vs == null ? 'no par data' : vs === 0 ? 'even par' : vs > 0 ? `+${vs}` : `${vs}`;
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
          isSimRound: false,
          currentHole: 1,
          currentYardage: null,
          spokenHoleEvents: {},
          userStatedYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseLocation: null,
          courseHoles: [],
          holeNotes: {},
          scores: {},
          putts: {},
          penalties: {},
          riskMode: 'normal',
      riskEasedAt: null,
          shots: [],
          lastMutation: null,
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          pendingKevinRec: null,
          club: null,
          clubSetAt: null,
          selectedTee: 'unspecified',
          transportMode: 'walking',
          nineHoleMode: false,
          twiceAround: false,
          roundStartHole: 1,
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
          currentLocationType: 'unknown',
          currentTeeBox: null,
          active_ghost: null,
        });
        try {
          const toast = require('./toastStore');
          toast.useToastStore.getState().show('Round discarded — nothing saved.');
        } catch { /* non-fatal */ }
        // 2026-07-30 (on-course audit SEV-1 #2) — discard was ASYMMETRIC with endRound: it never tore the
        // sim round down, so simRound.ts module state (simActive / simPos / the holeUnsub store
        // subscription) dangled — isVoiceSimRoundActive() stayed true indefinitely and the leaked
        // subscription fired on every store mutation until the next startVoiceSimRound(). Mirror endRound.
        // Uses the pre-reset `s.isSimRound` snapshot (set() above already cleared the live flag).
        if (s.isSimRound) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            (require('../services/simRound') as typeof import('../services/simRound')).stopVoiceSimRound();
          } catch { /* best-effort */ }
        }
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
            // 2026-07-04 — SIM rounds never count toward the Index.
            // 2026-07-25 (deep audit S2) — pass handicapAgs/handicapHoles, exactly like endRound
            // (:1713). Omitting them made a delete rebuild the Index from RAW totals: blow-up holes
            // re-inflated every round (net-double-bogey cap lost) and pick-up rounds that posted as
            // 9/18 via handicapHoles were dropped entirely — so deleting one round silently disagreed
            // with what endRound had posted.
            next.filter((r: RoundRecord) => !r.simulated).map((r: RoundRecord) => ({
              startedAt: r.startedAt, totalScore: r.totalScore, holesPlayed: r.holesPlayed,
              handicapAgs: r.handicapAgs, handicapHoles: r.handicapHoles,
              // 2026-08-08 (Tim's index cratering) — REAL par/rating baseline per round.
              ...calcMod.postingBaseline(r),
            })),
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

      markHandicapPosted: (id) => {
        set(state => ({
          roundHistory: state.roundHistory.map(r =>
            r.id === id ? { ...r, handicapPosted: true } : r,
          ),
        }));
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
            const green = greenForHole(finalHole);
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
        // 2026-07-24 (full-app audit — vs-par honesty) — count ONLY holes with a KNOWN par (>0), matching
        // the live getScoreVsPar. Superseded the old `?? 4` (which fabricated par 4 for every unknown
        // hole → a made-up "+N" on data-less courses that poisoned the dashboard trend). When NO scored
        // hole has a known par, the saved vs-par is genuinely unknown → null, and the dashboard/recap
        // skip it instead of trending a fabricated number.
        let scoreVsPar: number | null = null;
        for (const [holeNum, score] of scoredEntries) {
          const par = s.courseHoles.find(h => h.hole === Number(holeNum))?.par;
          if (typeof par === 'number' && par > 0) {
            scoreVsPar = (scoreVsPar ?? 0) + (score - par);
          }
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
          // Snapshot per-hole stats while courseHoles (par) is still in memory — see holeStats.
          holeStats: get().getHoleStats(),
          /**
           * 2026-08-14 (Tim, after a round where View hole was empty) — snapshot the watch swings ONTO
           * the record, for the same reason holeStats is snapshotted above: they only exist in memory.
           *
           * watchStore deliberately persists `deviceName` only, so `sessionSwings` dies with the app.
           * The swings were being captured correctly and tagged with their hole all along — they just
           * evaporated before anyone opened the recap, which is normally after the round and often
           * after the app has been backgrounded or killed. Surfacing them without persisting them
           * would only have worked if the player looked before closing the app.
           *
           * Kept to the fields the recap actually reads (hole, club, tempo, timestamp) rather than the
           * full IMU payload — axisCapture holds per-frame gyro arrays that have no consumer yet and
           * would bloat durable storage for every round forever.
           */
          watchSwings: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const w = require('./watchStore') as typeof import('./watchStore');
              return w.useWatchStore.getState().sessionSwings
                .filter(sw => sw.hole != null)
                .map(sw => ({
                  timestamp: sw.timestamp,
                  tempoRatio: sw.tempoRatio,
                  hole: sw.hole ?? null,
                  club: sw.club ?? null,
                }));
            } catch { return undefined; }
          })(),
          // 2026-08-12 — mail the round trace. Fire-and-forget AFTER the record is assembled, so a
          // slow or failed send can never delay or block saving the round itself.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          ...(() => { try {
            const rt = require('../services/roundTrace') as typeof import('../services/roundTrace');
            rt.trace('round', 'end', { holes: scoredEntries.length, score: scoredEntries.reduce((a, [, sc]) => a + sc, 0) });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prof = (require('./playerProfileStore') as typeof import('./playerProfileStore')).usePlayerProfileStore.getState();
            void rt.sendRoundTrace(prof.email || 'tester');
          } catch { /* tracing never blocks the round record */ } return {}; })(),
          // 2026-08-12 — and the watch's tempo story, for the same reason: the swings live only in
          // memory, so this is the last moment it can be captured. Null when no watch was worn.
          tempoStory: (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const ws = (require('./watchStore') as typeof import('./watchStore')).useWatchStore.getState();
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const rd = require('../services/round/roundSwingRead') as typeof import('../services/round/roundSwingRead');
              const story = rd.roundTempoStory(ws.sessionSwings ?? []);
              if (!story.enough || !story.headline) return null;
              /**
               * ...and route it to the CADDIE, not just the recap card. getTopObservations feeds the
               * brain prompt, so a tempo that went late becomes something the caddie KNOWS about you
               * next time rather than a line you read once. Typed 'mental' deliberately: tempo
               * degrading under fatigue is a state reading, not a swing fault.
               * [[caddie-brain-lens]] [[self-growing-agent-architecture]]
               */
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const rel = (require('./relationshipStore') as typeof import('./relationshipStore')).useRelationshipStore.getState();
                if (story.quickenedBy != null && Math.abs(story.quickenedBy) > 0.2) {
                  rel.addObservation({
                    type: 'mental',
                    content: story.quickenedBy > 0
                      ? 'tempo quickens over the closing holes'
                      : 'tempo slows over the closing holes',
                  });
                }
              } catch { /* observation is additive — never block the round record */ }
              return { baseline: story.baseline, earlyAvg: story.earlyAvg, lateAvg: story.lateAvg, headline: story.headline };
            } catch { return null; }
          })(),
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
          // 2026-07-04 — tag sim rounds so nothing downstream treats them as real.
          simulated: s.isSimRound || undefined,
          // 2026-07-01 (audit) — snapshot real per-hole par so completed-round
          // surfaces don't fabricate par-4. courseHoles is cleared post-round.
          holePars: (() => {
            const m: Record<number, number> = {};
            for (const h of s.courseHoles) if (h.par > 0) m[h.hole] = h.par;
            return Object.keys(m).length > 0 ? m : undefined;
          })(),
        };
        // 2026-07-24 (M3/M4 — WHS posting honesty). Cap each hole at net double bogey and fill
        // picked-up/unplayed holes with net par, so (M3) a blow-up hole no longer inflates the Index
        // and (M4) picking up on a couple of holes no longer drops the whole round from the Index.
        // Uses the player's rounded Index as the course handicap — a fair recreational estimate absent
        // a confirmed slope/rating — to set the per-hole stroke allowance. Stored on the record so the
        // recalc (rebuildDifferentialsFromHistory) posts from this, not the raw total.
        if (!s.isSimRound) {
          try {
            const calcMod = require('../services/handicapCalculator');
            const profileMod = require('./playerProfileStore');
            // 2026-07-26 (deep audit S2) — this read `.handicapIndex` (camelCase), which the profile
            // store does NOT expose — it's `handicap_index` (snake_case) — so idx was ALWAYS undefined
            // and courseHandicap defaulted to 18 for EVERY player, silently defeating the net-double-
            // bogey cap + net-par pickup fill for anyone not ~18. The import path already read the
            // correct field. Matches getState().handicap_index used elsewhere.
            const idx = profileMod.usePlayerProfileStore.getState().handicap_index;
            const courseHandicap = Math.round(typeof idx === 'number' && Number.isFinite(idx) ? idx : 18);
            const pars: Record<number, number> = {};
            for (const h of s.courseHoles) if (h.par > 0) pars[h.hole] = h.par;
            // 2026-08-07 (audit — Berlin CC 9-hole): intendedHoles was `nineHoleMode ? 9 : 18`, but a
            // natively-9-hole course is played with nineHoleMode=false, so this said 18. computeWhsPostingScore
            // then loops holes 1-18, hits a null par at hole 10 (pars only cover 1-9), and returns null — so
            // the round NEVER posted to the handicap index, even though WHS allows 9-hole posting.
            // 2026-08-08 (2-week audit O2 — my fix REGRESSED the other case): dropping the nineHoleMode
            // signal entirely meant a front/back-NINE round at an 18-HOLE course computed intendedHoles=18,
            // WHS needed 14 played, saw 9 → null → silently fell back to legacy posting WITHOUT the
            // net-double-bogey caps. BOTH signals matter: the player's declared nine OR a natively-9 course.
            const { getCourseHoleCount } = require('../data/courses') as typeof import('../data/courses');
            const intendedHoles = s.nineHoleMode ? 9 : (getCourseHoleCount(s.activeCourseId, s.courseHoles.length) === 9 ? 9 : 18);
            const post = calcMod.computeWhsPostingScore({
              intendedHoles,
              courseHandicap,
              pars,
              scores: s.scores,
            });
            if (post) { record.handicapAgs = post.adjustedGrossScore; record.handicapHoles = post.postedHoles; }
          } catch (e) { console.log('[handicap] WHS posting score failed (non-fatal):', e); }
        }
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
          // Indexed once — getHoleStats() walks the whole round, and this map is read per hole below.
          const holeStatsByHole: Record<number, { putts: number; girHit: boolean | null; fairwayHit: boolean | null }> =
            Object.fromEntries((get().getHoleStats() ?? []).map(h => [h.hole, h]));
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
              /**
               * 2026-08-23 — teach the model HOW the score happened, not just what it was.
               *
               * putts, GIR and fairways were already computed per hole by getHoleStats and were
               * dropped on the floor at round end, so the caddie could learn that you average 5.2 on
               * this hole and never that you three-putt its green half the time. `girHit` and
               * `fairwayHit` are deliberately passed through as null when unknown -- an unsurveyed
               * green must not be learned as a missed one.
               */
              const stat = holeStatsByHole[hole];
              return {
                hole, par, score, teeClub, approachClub, trouble,
                putts: stat?.putts ?? null,
                girHit: stat?.girHit ?? null,
                fairwayHit: stat?.fairwayHit ?? null,
              };
            });

          // Per-COURSE memory — only when we know the course.
          if (s.activeCourseId && !s.isSimRound) { // 2026-07-04 — sim rounds don't write course memory
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
          if (holesPlayed > 0 && !s.isSimRound) { // 2026-07-04 — narrated sim rounds don't teach the CNS
            const scoreLine = scoreVsPar == null ? 'Round' : scoreVsPar === 0 ? 'even par' : scoreVsPar > 0 ? `+${scoreVsPar}` : `${scoreVsPar}`;
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
          isSimRound: false,
          roundHistory: capHistory([...state.roundHistory, record]),
          currentHole: 1,
          currentYardage: null,
          spokenHoleEvents: {},
          userStatedYardage: null,
          activeCourse: null,
          activeCourseId: null,
          courseLocation: null,
          courseHoles: [],
          holeNotes: {},
          scores: {},
          putts: {},
          penalties: {},
          riskMode: 'normal',
      riskEasedAt: null,
          shots: [],
          lastMutation: null,
          currentRoundPhotos: [],
          emotionalLog: [],
          pendingLieAnalysis: null,
          pendingKevinRec: null,
          club: null,
          clubSetAt: null,
          selectedTee: 'unspecified',
          transportMode: 'walking',
          nineHoleMode: false,
          twiceAround: false,
          roundStartHole: 1,
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
          currentLocationType: 'unknown',
          currentTeeBox: null,
          active_ghost: null,
        }));
        // 2026-06-27 (smoke-test fix) — gate on score>0 to match the saved
        // RoundRecord (scoredEntries) and the getScoreVsPar/getHolesPlayed
        // getters. The ungated count let a never-finalized 0-score hole slip
        // into the handicap-eligibility (===9||18), points (>=9), and Tank
        // soft-intro (>=9) gates below while the record itself excluded it.
        const total = scoredEntries.reduce((a, [, score]) => a + score, 0);
        const holesPlayed = scoredEntries.length;
        console.log(`[path2:round] end totalScore=${total} holesPlayed=${holesPlayed}`);
        // 2026-08-19 (critical-path audit) — PATH 6 SCORECARD handoff. The round is over; what the
        // scorecard renders from here is the PERSISTED record, not live round state. Logging the
        // counts at the boundary makes a "scorecard shows fewer holes than I played" report
        // answerable from one grep: either the record was written short, or the scorecard read it
        // wrong. Those are different bugs and previously looked the same.
        console.log(`[path6:scorecard] round_persisted holes_with_scores=${Object.keys(get().scores).length} shots=${persistedShots.length} total=${total}`);
        console.log(`[audit:round-active] state=false holesPlayed=${holesPlayed} totalScore=${total}`);
        // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/usageTelemetry').track('round_completed', { holesPlayed, totalScore: total });
        } catch { /* telemetry never throws */ }
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
        // 2026-07-04 — SIM rounds never touch the Index.
        // 2026-07-24 (M3/M4) — gate on the WHS posting score computed above (record.handicapHoles),
        // NOT a raw `holesPlayed === 9 || 18`: a round where the player picked up on a couple of holes
        // (holesPlayed 14-17) now posts (filled to the intended 18), and the differential is built from
        // the net-double-bogey-capped Adjusted Gross Score instead of the raw total.
        if (record.handicapHoles != null && !s.isSimRound) {
          try {
            const profileMod = require('./playerProfileStore');
            const profile = profileMod.usePlayerProfileStore.getState();
            const calcMod = require('../services/handicapCalculator');

            // Post via the SAME rebuildDifferentialsFromHistory the delete/recalc path uses (one source
            // of truth → the posted Index matches any later recalc). Each round now carries its WHS
            // posting basis (handicapAgs + handicapHoles); rebuild uses those, falling back to the raw
            // total + 9/18 count for imported/legacy rounds. This round was appended to history above.
            const hist = get().roundHistory;
            const diffs = calcMod.rebuildDifferentialsFromHistory(
              hist.filter((r: RoundRecord) => !r.simulated).map((r: RoundRecord) => ({
                startedAt: r.startedAt, totalScore: r.totalScore, holesPlayed: r.holesPlayed,
                handicapAgs: r.handicapAgs, handicapHoles: r.handicapHoles,
                // 2026-08-08 (Tim's index cratering) — REAL par/rating baseline per round.
                ...calcMod.postingBaseline(r),
              })),
            );
            profile.resetDifferentials(diffs);
            const after = calcMod.estimateNewIndex(diffs);
            if (after?.newIndex != null && Number.isFinite(after.newIndex)) {
              profile.setHandicapIndex(after.newIndex);
            }
            console.log(`[handicap] posted ${record.handicapHoles}h ags=${record.handicapAgs} rebuilt ${diffs.length} diffs newIndex=${after?.newIndex ?? '?'}`);
            // 2026-06-27 (smoke-test fix) — record that this round's differential
            // is already posted, so the recap card's "Post to my Index" button
            // can't post the SAME round again (the double-count bug).
            get().markHandicapPosted(record.id);
          } catch (e) {
            console.log('[handicap] round-end update failed (non-fatal):', e);
          }
        }

        // Points — completed round = 100 pts. 2026-07-06 (audit P0) — the sim gate
        // was documented ("no points farming via sim rounds") but landed on a
        // neighbouring block; a narrated sim round was still worth 100 pts + tier
        // climb. Gate THIS block too.
        if (holesPlayed >= 9 && !s.isSimRound) {
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
            // falling through to the server's Kevin default.
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

        // 2026-07-01 — a finished round is a natural high-value moment to back up
        // to the cloud. Debounced + no-op-gated + inert unless signed in.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/cloudSync/autoBackup').scheduleBackup();
        } catch { /* best-effort — backup is additive */ }

        // 2026-07-04 (voice sim round) — restore the real GPS watcher + clear the
        // simulated fix when a sim round ends. Uses the pre-reset snapshot flag.
        if (s.isSimRound) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            (require('../services/simRound') as typeof import('../services/simRound')).stopVoiceSimRound();
          } catch { /* best-effort */ }
        }

        // 2026-07-04 (Tim — offline log) — the round's captured offline notes are now
        // part of the finished round (they stay in voiceLogStore for recap). Mark them
        // ingested so the live caddie stops surfacing them.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../services/voiceLogService').markRoundNotesIngested(record.id);
        } catch { /* best-effort */ }

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
      previewCourseCoords: null,
      setPreviewCourse: (id, coords) => set({
        previewCourseId: id,
        // Only overwrite the coords when the caller supplies them (or when clearing the course), so
        // a later id-only call can't wipe a good centroid we already captured.
        ...(coords !== undefined || id == null ? { previewCourseCoords: coords ?? null } : {}),
      }),
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
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../services/roundTrace') as typeof import('../services/roundTrace'))
            .trace('round', 'hole', { hole });
        } catch { /* non-fatal */ }
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
        // 2026-08-06 (audit — back nine fix). Clamp to the round's ACTUAL hole range, not a hardcoded 1..9.
        // A back-nine 9-hole round plays holes 10..18, so the floor is roundStartHole (10) and the ceiling
        // is roundStartHole+8 (18) — the old `nineHoleMode ? 9` floored/capped every navigation at 9 and
        // dragged the round back to the front nine. Front nine + full rounds are unchanged.
        const minHole = roundFirstHole(state);
        let maxHole = roundLastHole(state);

        /**
         * 2026-08-23 (Tim — "it's easy to forget setting that, just like it's easy to forget when you
         * start a round doing nine or eighteen holes").
         *
         * KEEP PLAYING = KEEP SCORING. Same class as the cart setting: a declaration made on the
         * first tee and then silently wrong for the rest of the round.
         *
         * A player who said "nine" and then walks onto the 10th tee has told us, by playing it, that
         * this is an eighteen. The clamp used to drag them back to 9 and every hole after that was
         * unrecorded — the round quietly stopped counting while they kept playing. Walking to the
         * next tee is a much stronger signal than a tap they made an hour ago.
         *
         * Only ever EXPANDS, and only onto holes the course actually has. It never shrinks a round:
         * finishing at 9 stays a nine-hole round, because stopping is not evidence of anything.
         */
        if (state.nineHoleMode && hole > maxHole) {
          const courseHoleCount = state.courseHoles?.length ?? 0;
          if (courseHoleCount >= hole) {
            console.log(`[roundStore] played past hole ${maxHole} onto ${hole} — expanding this round to the full ${courseHoleCount}`);
            set({ nineHoleMode: false });
            maxHole = roundLastHole({ ...state, nineHoleMode: false });
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              (require('./issueLogStore') as typeof import('./issueLogStore')).useIssueLogStore
                .getState().addAppEvent('round_expanded_past_nine', { from: 9, onto: hole, courseHoles: courseHoleCount }, 'diag');
            } catch { /* best-effort */ }
          }
        }

        const clamped = Math.max(minHole, Math.min(hole, maxHole));
        if (clamped !== hole) {
          devLog(`[roundStore] setCurrentHole(${hole}) clamped to ${clamped} (course max=${maxHole})`);
        }
        // Phase B + Phase Q.5b — close out the previous hole's last shot
        // end_location to that hole's green centroid before advancing.
        // Component 3: green now sourced from courseGeometryService (single
        // source of truth) with courseHoles records as legacy fallback.
        const prevHole = state.currentHole;
        if (prevHole !== clamped) {
          const green = greenForHole(prevHole);
          if (green) get().closeHoleEndLocation(prevHole, green);
        }
        const holeData = state.courseHoles.find(h => h.hole === clamped);
        // 2026-05-25 — Clear userStatedYardage when advancing holes;
        // a number you spoke on hole 5 is meaningless on hole 6.
        // 2026-08-09 (club-use logic) — the caddie's pending club REC clears with the hole too: advice
        // for the approach on 5 must never attribute a club to a shot on 6 (the shot-club resolver
        // arbitrates declared-vs-advised by recency; hole change hard-expires the advice side).
        const clearStated = prevHole !== clamped ? { userStatedYardage: null, pendingKevinRec: null } : {};
        set({ currentHole: clamped, currentYardage: holeData?.distance ?? null, ...clearStated });
        if (prevHole !== clamped) {
          console.log(`[path2:round] hole transition prev=${prevHole} next=${clamped}`);
          console.log(`[audit:round-active] hole-transition prev=${prevHole} next=${clamped} yardage=${holeData?.distance ?? 'null'}`);
          // 2026-08-06 (Tim — "got double reads on a lot of holes; the user needs to ASK for the briefing,
          // not have it auto-prompted"). Per-hole reads are now PULL-ONLY. Nothing is spoken on a hole
          // change: this auto-intro + M12 briefing was the source of the double/again reads — it fired on
          // BOTH the score-driven advance AND the GPS reconcile of the same transition, and the M12
          // sentence-match regex ("hole N") could narrate the WRONG hole (a sentence naming two holes). The
          // visible hole banner below still updates. The data (hole info + par/yardage + prior-shot memory +
          // the course-intel sentence) is now assembled ON DEMAND when the player asks "what's the read /
          // hole info / brief me" → query_status query_topic:'hole_read' (services/intents/queryStatusHandler.ts).
          // No auto-speak here — the round stays quiet until the player asks.
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

      /**
       * 2026-08-28 (SmartFinder sweep, part 2 — the resolver rather than the rangefinder maths).
       *
       * FIVE PRODUCERS, FIVE DIFFERENT ANSWERS TO THE SAME QUESTION, AND NO OWNER.
       *
       * A stated yardage is the highest-trust number in the app: yardageResolver Tier 3 returns it
       * at `confidence: 'high'`, it BEATS live GPS for five minutes, and the caddie both quotes and
       * clubs from it. Every caller was validating it, and each had invented its own band:
       *
       *   caddie.tsx plan_shot                 0 < d <= 700
       *   conversationalToolDispatch plan_shot 0 < d <= 700
       *   conversationalToolDispatch (other)   isFinite && 0 < y < 900
       *   clubHandler / parseStatedYardage     20..400   (an ambiguity guard, legitimately tighter)
       *   stateYardageHandler / extractYardage 10..400
       *
       * So "I'm 850 out" was accepted through one voice path and refused through another — the same
       * sentence, a different caddie, depending on which route parsed it. And this setter, the one
       * place all five converge, accepted anything at all: NaN, Infinity, 0, negative. Any producer
       * added later inherits no protection whatever, which is how the list got to five.
       *
       * The band belongs to the FIELD, not to the callers. 1..700 covers every real stated distance
       * (a 600-yard par 5 from the tee is a real thing to say; 850 is not a golf shot) and rejects
       * the shapes that are never a yardage. The parser-level limits above stay as they are: those
       * exist to stop a loft, a wind speed or a hole number being MISREAD as a distance, which is a
       * different job from asking whether a number is a plausible yardage.
       *
       * Returns whether it was accepted, so a caller that ANNOUNCES the number can avoid saying
       * "got it, 850" about a value the store refused. [[no-half-fixes-enforce-every-surface]]
       * [[two-owners-is-the-root-cause]]
       */
      setUserStatedYardage: (value, source) => {
        const hole = get().currentHole;
        if (!Number.isFinite(value) || value < MIN_STATED_YARDAGE || value > MAX_STATED_YARDAGE) {
          /**
           * Console only, deliberately. The first version filed this to the issue log — and the
           * unit tests immediately tripped the log's AUTO-SEND, which tries to forward to Tim's
           * inbox. A store setter is a synchronous write path called from render-adjacent code; it
           * has no business reaching a network side effect, and a producer that loops on a bad value
           * would have mailed him about it repeatedly.
           *
           * A refused write means a PRODUCER BUG, which is a build-time concern. That is what the
           * sim guard below and the tests are for — they catch it before it ships, rather than
           * reporting it from the field after it has already misled someone.
           */
          console.log('[roundStore] userStatedYardage REFUSED', { value, source, hole });
          return false;
        }
        set({
          userStatedYardage: {
            value,
            source,
            asOf: Date.now(),
            holeAtCapture: hole,
          },
        });
        console.log('[roundStore] userStatedYardage set', { value, source, hole });
        return true;
      },

      clearUserStatedYardage: () => set({ userStatedYardage: null }),
      setClub: (club) => set({ club, clubSetAt: Date.now() }),
      setMentalState: (state) => set({ mentalState: state }),

      /**
       * 2026-08-12 — risk posture, with a real producer.
       *
       * `bySelf` distinguishes the caddie easing off after a rough stretch from the player asking
       * for it. That matters: a caddie that quietly turns conservative and never says so reads as
       * having lost confidence in you, so the calling surface can speak the change when it's ours
       * and stay silent when it's yours. [[feels-like-a-real-caddie]]
       */
      setRiskMode: (mode, bySelf) => {
        if (mode !== 'safe' && mode !== 'normal' && mode !== 'aggressive') return;
        if (get().riskMode === mode) return;
        // A player-set posture clears the ease marker: once they've chosen, the caddie has nothing
        // to announce and must not narrate their own decision back at them.
        set({ riskMode: mode, riskEasedAt: bySelf ? Date.now() : null });
        console.log('[round] risk posture →', mode, bySelf ? '(caddie eased)' : '(player)');
      },

      /**
       * Per-hole stats for the round so far — DERIVED from what was actually captured.
       *
       * GIR uses the standard definition (reached the green with two strokes left to putt), which
       * follows from score, putts and par without any new capture. It returns null rather than false
       * when par is unknown, so a course with no card can't silently report every hole as missed.
       *
       * fairwayHit stays null: we have no honest fairway signal, and inferring one from a
       * penalty-free tee shot would be the fabricated stat the dashboard already refuses to show.
       */
      getHoleStats: () => {
        const s = get();
        const holes = Object.keys(s.scores)
          .map(Number)
          .filter((h) => Number.isFinite(h) && (s.scores[h] ?? 0) > 0)
          .sort((a, b) => a - b);
        return holes.map((hole) => {
          const score = s.scores[hole] ?? 0;
          const putts = s.putts[hole] ?? 0;
          const par = s.courseHoles.find((h) => h.hole === hole)?.par;
          // Needs a real par AND a real putt count: with putts unrecorded, score - 0 <= par - 2
          // would call every bogey a green in regulation.
          const girHit =
            typeof par === 'number' && par > 0 && s.putts[hole] != null
              ? score - putts <= par - 2
              : null;
          return {
            hole,
            score,
            putts,
            penalties: s.penalties[hole] ?? 0,
            fairwayHit: null,
            girHit,
          };
        });
      },

      rememberRecentCourseMeta: (id, meta) => {
        if (!id || !meta?.club_name) return;
        const prev = get().recentCourseMeta[id];
        if (prev && prev.club_name === meta.club_name && prev.location === meta.location) return;
        // Bounded: only ever the ids we actually keep as recents, so this can't grow.
        set((s) => ({ recentCourseMeta: { ...s.recentCourseMeta, [id]: meta } }));
      },

      logScore: (hole, score) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../services/roundTrace') as typeof import('../services/roundTrace'))
            .trace('shot', 'score', { hole, score });
        } catch { /* non-fatal */ }
        const prevScore = get().scores[hole] ?? 0; // snapshot BEFORE overwrite (first-score test)
        // 2026-08-19 (critical-path audit) — PATH 6 SCORECARD. logScore is the ONE seam every score
        // path funnels through (scorecard tap, cockpit stepper, voice, brain tool dispatch), which
        // makes it the only place a marker can prove "the score the player entered is the score that
        // was stored" regardless of which surface they used. `src` distinguishes a correction from a
        // first entry — the wrong-hole scoring class Tim has fought repeatedly looks identical to a
        // normal write without it.
        console.log(`[path6:scorecard] score_write hole=${hole} score=${score} prev=${prevScore} kind=${prevScore > 0 ? 'correction' : 'first'}`);
        // 2026-07-25 — capture the undo snapshot BEFORE the write + any auto-advance, so
        // "scratch that" restores both the prior score and the hole we were on.
        set({ lastMutation: { kind: 'score', hole, prevScore, prevCurrentHole: get().currentHole, at: Date.now() } });
        set(s => ({ scores: { ...s.scores, [hole]: score } }));
        /**
         * 2026-08-10 (Tim — "two pars and one bogey, and it would tell me to forget the last three").
         *
         * Mental state is now DERIVED here, at the one seam every score path funnels through, instead
         * of being accumulated by whichever surface happened to log. It was called from the caddie
         * tab, the voice handler and the tool dispatch — but NOT the scorecard tab, which writes
         * scores directly — so bad holes counted up and the pars he tapped never counted down.
         * Deriving at the funnel makes that impossible, including for surfaces added later.
         */
        try {
          const st = get();
          const played = Object.keys(st.scores)
            .map(Number)
            .filter(h => Number.isFinite(h) && (st.scores[h] ?? 0) > 0)
            .sort((a, b) => a - b)
            .slice(-6) // a short tail is all the emotional read should ever consider
            .map(h => ({
              strokes: st.scores[h] ?? 0,
              par: st.courseHoles.find(c => c.hole === h)?.par ?? 0,
            }))
            .filter(x => x.par > 0); // unknown par can't be judged — never guess a bad hole into existence
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const relMod = require('./relationshipStore') as typeof import('./relationshipStore');
          relMod.useRelationshipStore.getState().recomputeMentalState(played);
          /**
           * 2026-08-12 (Tim — "a huge part of the app is mental state and mental coaching, hence the
           * dynamics being in play") — the mental read now MOVES something.
           *
           * A player three-plus bad holes deep does not need the caddie still attacking pins. When
           * the read turns 'spiraling' the caddie eases its own posture to safe, which reaches the
           * club pick through composeShotRead. Marked bySelf so the surface can SAY it rather than
           * quietly clubbing differently — a caddie that silently turns conservative and never
           * mentions it reads as having lost faith in you.
           *
           * It never overrides a posture the PLAYER chose: if they asked to be aggressive, they get
           * aggressive, and the caddie says its piece some other way. Easing back out is deliberately
           * NOT automatic — recovering confidence is the player's call, not a counter's.
           */
          const mental = relMod.useRelationshipStore.getState().currentMentalState;
          if (mental === 'spiraling' && get().riskMode === 'normal') {
            get().setRiskMode('safe', true);
          }
        } catch { /* non-fatal — the emotional read must never break scoring */ }
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
        // 2026-06-30 (Tim — "when I enter a score for a hole, auto-advance to the next hole")
        // — on the FIRST score for the CURRENT hole, if Auto Hole Advance is on, move to the
        // next hole. Central seam so it works for voice + manual entry. First-score-only so
        // EDITING a past hole never jumps the round. GPS reconciliation won't ping-pong back
        // (it skips holes behind current or already-scored — holeReconciliation.ts:106).
        try {
          if (prevScore === 0) {
            const st = get();
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const autoAdvance = require('./settingsStore').useSettingsStore.getState().autoHoleAdvance;
            // 2026-07-01 (audit) — respect nineHoleMode for the upper bound, and go
            // through setCurrentHole (NOT a raw set). The old raw set({currentHole})
            // bypassed closeHoleEndLocation (dropping the just-finished hole's GPS
            // drive distance), the nineHole clamp, and the yardage/stated-number
            // reset. setCurrentHole is the canonical advance seam.
            // 2026-08-06 (audit — back nine fix). Use the round's real last hole (back nine ends at 18), so
            // first-score auto-advance fires through holes 10-17→18 instead of never (10 < 9 was always false).
            const holesN = roundLastHole(st);
            if (autoAdvance && st.isRoundActive && hole === st.currentHole && hole < holesN) {
              get().setCurrentHole(hole + 1);
              console.log(`[roundStore] auto-advanced ${hole} → ${hole + 1} on first score (autoHoleAdvance)`);
            } else {
              /**
               * 2026-08-23 (Tim — "I'll log the score for this hole, and then I'm sitting next to the
               * next hole, but it hasn't detected").
               *
               * This branch was silent. Four separate conditions can hold the advance and they have
               * four different fixes -- the setting is off, the round is not active, the score was
               * logged for a hole that is not the current one (voice naming a hole, or a scorecard
               * edit), or we are already on the last hole. Without knowing WHICH, the next report is
               * another round of guessing. Recorded as `diag`: on-device, never mailed.
               */
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                (require('./issueLogStore') as typeof import('./issueLogStore')).useIssueLogStore
                  .getState().addAppEvent('hole_advance_skipped', {
                    reason: !autoAdvance ? 'setting_off'
                      : !st.isRoundActive ? 'round_not_active'
                      : hole !== st.currentHole ? 'scored_a_different_hole'
                      : 'already_last_hole',
                    scoredHole: hole,
                    currentHole: st.currentHole,
                    lastHole: holesN,
                  }, 'diag');
              } catch { /* best-effort */ }
              console.log(`[roundStore] auto-advance SKIPPED for hole ${hole} (current ${st.currentHole}, last ${holesN}, setting ${autoAdvance})`);
            }
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
        set(s => ({
          putts: { ...s.putts, [hole]: putts },
          lastMutation: { kind: 'putts', hole, prevPutts: s.putts[hole], at: Date.now() },
        })),

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
        if (currentScore > 0) {
          // Editing an already-scored hole — logScore is safe (prevScore != 0, no auto-advance).
          get().logScore(hole, currentScore + 1);
        } else {
          // 2026-07-10 (audit OC1) — a penalty on an UNscored hole must NOT go through logScore:
          // it would see prevScore 0 → treat "1" as the hole's first score → auto-advance to the
          // next hole AND stamp a bogus score of 1. Record the penalty stroke directly; the real
          // total overwrites it when the player scores the hole.
          // 2026-08-09 (pass-2 C1) — stamp lastMutation as a SCORE write so undoLastMutation clears this
          // phantom 1. Previously logShot (above) left lastMutation kind:'shot'; an undo then removed the
          // penalty shot but left scores[hole]=1 orphaned (inflating the total by 1 with no backing shot).
          set(s => ({
            scores: { ...s.scores, [hole]: 1 },
            lastMutation: { kind: 'score', hole, prevScore: 0, prevCurrentHole: get().currentHole, at: Date.now() },
          }));
        }
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
            // 2026-07-24 (full-app audit) — guarantee every shot has a stable id at the single logShot
            // choke point. The conversational-brain log_shot path built a ShotResult WITHOUT an id (unlike
            // manual tap / penalty / the voice orchestrator), so a brain-logged shot couldn't be edited/
            // deleted (editShot/deleteShot match by id) and future by-id dedup/backup-merge couldn't
            // address it. Salted so two shots in the same ms don't collide.
            id: shot.id ?? `shot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
          // 2026-07-01 (audit) — plausibility guard. carry_distance / distance_yards
          // are NOT bounded like the GPS path (which is clamped 5..500 at :2144), so a
          // corrupt sensor/measure could feed a >500y value into BOTH the learned bag
          // (recordShot) and longestDrive, poisoning every future club call. Reject
          // anything outside a real single-shot range (no club carries >500y).
          const plausibleCarry = (y: number): boolean => y > 0 && y <= 500;
          const measuredCarry = (sh: ShotResult): number | null => {
            if (typeof sh.carry_distance === 'number' && plausibleCarry(sh.carry_distance)) return sh.carry_distance;
            if (typeof sh.distance_yards === 'number' && plausibleCarry(sh.distance_yards) && sh.distance_yards !== sh.gps_distance_yards) return sh.distance_yards;
            return null;
          };

          // 2026-07-24 (club-logic unification) — NORMALIZE the shot's club once. enriched.club can be
          // any of the four vocabularies (ClubName from tap, ClubId 'DR' from voice, 'driver' from
          // quick-log). Reading it raw meant `=== 'Driver'` missed voice/quick-log drivers, and the
          // learned bag was keyed by a form nothing reads. All bag writes below use the normalized name.
          const normClub = (() => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              return (require('../services/clubNormalize') as typeof import('../services/clubNormalize')).normalizeClub(enriched.club);
            } catch { return null; }
          })();

          // 2026-06-04 — Auto-update longestDrive when a Driver shot with a real
          // (measured) distance beats the player's current best. Profile store is
          // dynamic-required to avoid a module cycle (playerProfileStore doesn't
          // import roundStore today, but this side-channel update is a single hop).
          const driverYards = normClub === 'Driver' ? measuredCarry(enriched) : null;
          if (driverYards != null && !s.isSimRound) { // 2026-07-04 — sim shots can't set records
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
            if (normClub && carry != null && !s.isSimRound) { // 2026-07-04 — sim shots never train the bag
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const mem = require('./caddieMemoryStore') as typeof import('./caddieMemoryStore');
              mem.useCaddieMemoryStore.getState().recordShot({ club: normClub, carryYds: carry, nowMs: enriched.timestamp ?? 0 });
              // 2026-07-24 (club-logic unification) — ALSO feed the clubStats CARRY ladder from this real
              // airtime carry, so the app-wide bag (bagDistances / Fit Profile / dashboard) shares ONE
              // honest carry number with the CNS bag instead of diverging by unit.
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                (require('./clubStatsStore') as typeof import('./clubStatsStore')).useClubStatsStore.getState().recordCarry(normClub, carry);
              } catch { /* additive */ }
            }
          } catch (e) {
            console.log('[roundStore] caddie-memory recordShot failed (non-fatal):', e);
          }

          // 2026-07-04 (voice sim round) — a narrated shot MOVES the simulated
          // player toward the green so yardages count down like a real hole.
          if (s.isSimRound) {
            const stated = enriched.distance_yards ?? enriched.carry_distance ?? null;
            if (typeof stated === 'number' && stated > 0) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                (require('../services/simRound') as typeof import('../services/simRound')).simAdvanceTowardGreen(stated);
              } catch { /* sim movement is best-effort */ }
            }
          }

          return {
            shots: [...backfilled, enriched],
            pendingLieAnalysis: enriched.lie_analysis ? null : s.pendingLieAnalysis,
            // 2026-07-25 — snapshot for voice "undo": remove THIS shot by id. (A penalty
            // is logShot + logScore, so logScore's snapshot overwrites this — "undo" after
            // a penalty reverts the score bump, which is the sensible thing to hear.)
            lastMutation: { kind: 'shot', shotId: enriched.id ?? shot.id ?? '', hole: enriched.hole, at: Date.now() },
          };
        });
      },

      undoLastMutation: () => {
        const snap = get().lastMutation;
        if (!snap) return { ok: false, description: null };
        // Consume it first so a double "undo" can't double-revert.
        set({ lastMutation: null });
        if (snap.kind === 'score') {
          set(s => {
            const scores = { ...s.scores };
            if (snap.prevScore > 0) scores[snap.hole] = snap.prevScore;
            else delete scores[snap.hole];
            return { scores, currentHole: snap.prevCurrentHole };
          });
          // Keep the ghost match in step with the reverted score.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const ghostMod = require('./ghostStore');
            if (ghostMod.useGhostStore.getState().ghostRecord) {
              ghostMod.useGhostStore.getState().updateHole(snap.hole, snap.prevScore > 0 ? snap.prevScore : 0);
            }
          } catch { /* non-fatal */ }
          return {
            ok: true,
            description: snap.prevScore > 0
              ? `Put hole ${snap.hole} back to ${snap.prevScore}.`
              : `Cleared your score on hole ${snap.hole}.`,
          };
        }
        if (snap.kind === 'putts') {
          set(s => {
            const putts = { ...s.putts };
            if (typeof snap.prevPutts === 'number') putts[snap.hole] = snap.prevPutts;
            else delete putts[snap.hole];
            return { putts };
          });
          return {
            ok: true,
            description: typeof snap.prevPutts === 'number'
              ? `Putts on hole ${snap.hole} back to ${snap.prevPutts}.`
              : `Cleared the putts on hole ${snap.hole}.`,
          };
        }
        // shot
        get().deleteShot(snap.shotId);
        return { ok: true, description: `Removed that last shot on hole ${snap.hole}.` };
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

      hasSpokenOnHole: (kind, hole) => get().spokenHoleEvents[`${kind}:${hole}`] === true,
      markSpokenOnHole: (kind, hole) =>
        set((st) => (st.spokenHoleEvents[`${kind}:${hole}`]
          ? st                                   // idempotent — no needless re-render
          : { spokenHoleEvents: { ...st.spokenHoleEvents, [`${kind}:${hole}`]: true as const } })),
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
        // 2026-07-24 (full-app audit — vs-par honesty) — compute vs-par ONLY over holes with a KNOWN
        // par (>0). A missing OR par-0 hole (data-less course / AI-scan gap) is EXCLUDED from BOTH the
        // score and the par sum, rather than fabricating par 4 (the old `?? 4`, which reported a made-up
        // "+N" on data-less courses and poisoned the dashboard trend). When NO scored hole has a known
        // par, vs-par is genuinely unknown → return null and every caller hides it instead of guessing.
        const { scores, courseHoles } = get();
        let total = 0;
        let par = 0;
        let knownHoles = 0;
        for (const [holeNum, score] of Object.entries(scores)) {
          if (score > 0) {
            const holePar = courseHoles.find(h => h.hole === Number(holeNum))?.par;
            if (typeof holePar === 'number' && holePar > 0) {
              total += score;
              par += holePar;
              knownHoles++;
            }
          }
        }
        return knownHoles > 0 ? total - par : null;
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
        /**
         * 2026-08-31 (full-app break test) — a migration that THROWS is a player who lost
         * everything: zustand discards the persisted state and the store comes up on defaults,
         * silently, on launch. A truncated or cleared write can hand this a primitive or null
         * rather than the object the cast below assumes, and the cast is a lie in that case.
         *
         * RETURNS {} RATHER THAN THE VALUE. Handing the primitive back is worse than throwing:
         * zustand's default merge spreads it, so a persisted string becomes numeric index keys
         * ({"0":"a","1":" "…}) sitting alongside the real defaults — and those junk keys are then
         * written straight back to disk on the next save, permanently. An empty object merges to
         * clean defaults, which is the honest outcome for a blob we cannot read.
         */
        if (persisted == null || typeof persisted !== 'object') return {} as never;
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
        // 2026-07-04 — persist the sim flag so an app restart mid-sim-round stays
        // in sim mode (learning gates keep holding) instead of "going real".
        isSimRound: s.isSimRound,
        mode: s.mode,
        currentRoundId: s.currentRoundId,
        activeCourse: s.activeCourse,
        activeCourseId: s.activeCourseId,
        courseLocation: s.courseLocation,
        recentCourseIds: s.recentCourseIds,
        recentCourseMeta: s.recentCourseMeta,
        // Persist the last previewed/selected course so a cold start
        // restores the user's pick instead of defaulting to Menifee.
        previewCourseId: s.previewCourseId,
        courseHoles: s.courseHoles,
        nineHoleMode: s.nineHoleMode,
        twiceAround: s.twiceAround,
        roundStartHole: s.roundStartHole ?? 1,
        isCompetition: s.isCompetition,
        roundNotes: s.roundNotes,
        goal: s.goal,
        currentHole: s.currentHole,
        holeNotes: s.holeNotes,
        currentYardage: s.currentYardage,
        // Round-scoped: persisted so an app restart mid-round cannot repeat a line already spoken.
        spokenHoleEvents: s.spokenHoleEvents,
        club: s.club,
        // 2026-08-09 (stores audit C1) — clubSetAt MUST persist alongside club + pendingKevinRec.at.
        // resolveShotClub arbitrates declared-vs-advised by RECENCY; if clubSetAt is lost on a mid-round
        // crash while the advised rec's timestamp survives, the resolver picks the CADDIE's club over the
        // player's and trains the wrong club. The three timestamps must persist symmetrically.
        clubSetAt: s.clubSetAt,
        scores: s.scores,
        putts: s.putts,
        penalties: s.penalties,
        shots: s.shots,
        roundNumber: s.roundNumber,
        // 2026-07-01 (re-audit) — compact older rounds so this single row can't grow
        // past Android's ~2MB read limit and brick the whole history. See helper.
        roundHistory: compactHistoryForPersist(s.roundHistory),
        active_ghost: s.active_ghost,
        recentInsights: s.recentInsights,
        // Audit follow-up (2026-05-13) — these fields were initialized in the store and mutated
        // during gameplay but were missing from partialize, so a crash mid-round dropped them.
        // mentalState affects caddie tone; currentRoundPhotos is captured memories; roundStartTime
        // is needed by recap; emotionalLog feeds future pattern detection.
        // 2026-08-12 — riskMode removed alongside them: it was persisted here and read by nothing,
        // with a setter no screen or voice path ever called. A caddie posture the player could not
        // set and the caddie never consulted. See the store-field sweep.
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
        // 2026-07-25 (deep audit S3) — persist the pending Kevin club rec, like pendingLieAnalysis
        // above. It's set when Kevin gives a call and consumed when the shot is logged; a crash/
        // restart in between dropped it, so kevin_adhered/kevin_rec_club never stamped on that shot.
        pendingKevinRec: s.pendingKevinRec,
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

// 2026-07-06 (elite audit P0) — ONE eligibility filter for every handicap
// rebuild. endRound/deleteRound already excluded sim rounds, but the three
// external "Recalculate" sites (settings, profile, import-rounds-list — the
// last runs automatically after every import) re-implemented the predicate
// WITHOUT !r.simulated, so one tap silently posted sim differentials into
// the Index. All rebuild sites import this so the filter can't drift again.
export function eligibleHandicapRounds(rounds: RoundRecord[]): RoundRecord[] {
  // 2026-07-24 (M4) — a round that carries a WHS posting basis (handicapHoles: filled to 9/18 after
  // a pick-up) is eligible even if its raw holesPlayed is 14-17. This keeps the recalc button IN SYNC
  // with the round-end posting (one source of truth) so pick-up rounds count in both. Imported/legacy
  // rounds still qualify only as exact complete 9/18.
  return rounds.filter(
    r => (r.handicapHoles != null || r.holesPlayed === 9 || r.holesPlayed === 18) && r.totalScore > 0 && !r.simulated,
  );
}
