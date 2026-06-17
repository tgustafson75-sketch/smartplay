import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import { cageLog } from '../services/cageTelemetry';

// ─── TYPES ────────────────────────────────

export interface AcousticContact {
  contact: 'flush' | 'fat' | 'thin' | 'heel' | 'toe' | 'unknown';
  confidence: number;
  source: 'feel-tag' | 'acoustic' | 'error';
}

export interface ReviewLabels {
  strike_location: 'center' | 'heel' | 'toe' | 'top' | 'thin' | 'fat' | 'unknown';
  contact_quality: 'pure' | 'good' | 'okay' | 'bad' | 'unknown';
  self_diagnosis: string | null;
  intent: string | null;
  mental_state: string | null;
  notable_phrases: string[];
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
  review_labels?: ReviewLabels | null;
  review_transcript?: string | null;
  // Phase R — frame-level timestamps (seconds into clip) for temporal alignment
  // of detected issues with audio. Populated when Phase K analyzes a clip.
  detected_issue_timestamps_sec?: number[];

  // Phase BW — clip boundaries within a multi-swing master video.
  // When clipUri is a master video shared across N detection events,
  // these record the inclusive [start, end] seconds within clipUri so
  // Phase K samples frames from the swing's window only. Undefined for
  // legacy single-clip uploads — analyzeSwing falls back to whole-clip
  // sampling automatically.
  clipStartSeconds?: number;
  clipEndSeconds?: number;
  // Phase BW — original detection offset (seconds since recording start)
  // and correlation id linking this shot to the cageStorage clip metadata.
  detectionOffsetSeconds?: number;
  detectionMethod?: 'audio_transient' | 'manual';
  correlationId?: string;
  // Phase BW — per-shot Phase K analysis result. Persisted so the swing
  // detail review UI can render a per-swing card for multi-swing
  // sessions instead of only a session-level aggregate. Optional for
  // back-compat with legacy entries.
  perShotAnalysis?: {
    detected_issue: string;
    severity: 'minor' | 'moderate' | 'significant' | 'none';
    confidence: 'high' | 'medium' | 'low';
    observation: string;
    // Phase 403b — visual evidence of the diagnosis. fault_frame_index
    // is the 0-based index into the 5-frame sample (or -1 when no
    // specific frame stood out). visual_reference_path is the local
    // file URI of that exact frame persisted as a JPEG (or null when
    // the index was -1, the persist failed, or the entry predates
    // Phase 403b). Consumers tolerate missing path — text diagnostic
    // still renders fully.
    fault_frame_index?: number;
    visual_reference_path?: string | null;
  } | null;

  // Phase BZ-v1 — user annotations on a captured swing. All optional; absence
  // = no opinion logged. `isGoodRep` true marks the swing as a keeper for
  // future reference / drill comparison; false means actively flagged as
  // "bad rep" (separate from delete). `userNotes` is free-form text capped
  // at 280 chars by the UI.
  isGoodRep?: boolean | null;
  userNotes?: string | null;
  // 2026-05-24 — Feel-capture dataset (owner-only, dev tooling). When the
  // owner has enabled feelCaptureEnabled in Settings, the session audio
  // for THIS clip is transcribed via Whisper and stored here PAIRED
  // with the existing perShotAnalysis. Forms labeled tuples
  // {clip, transcript, analysis} for future feel-vs-real calibration.
  // No user surface — only owner debug at /cage-debug surfaces it.
  // Empty / absent on every production user (transcription gated off).
  feel_narration_transcript?: string;
  // 2026-05-25 — Fix AJ Phase 2: spoken commentary captured during
  // the video recording (e.g. "this is Chris's third swing, he's
  // been pulling it left" / "putt cam, downhill left to right").
  // Distinct from feel_narration_transcript which is owner-only
  // calibration data — commentary lives on EVERY beta swing so the
  // narration is searchable + brain-accessible. Whisper-transcribed
  // from the same mp4 the video uses; transcription is best-effort
  // (silent clips leave this empty / unset). Updated via
  // setShotCommentaryTranscript.
  commentary_transcript?: string;
}

// Phase BL — how the active club was identified for a given segment.
//   session_start: initial club picked at the start of the session
//   manual:        user tapped the manual selector
//   voice:         user said "switching to <club>"
//   vision:        camera read the number stamped on the club sole
export type ClubSwitchSource = 'session_start' | 'manual' | 'voice' | 'vision';

// Phase BL — one entry per club segment within a cage session. The user
// can switch clubs mid-session; each segment records when the switch
// happened, which shots belong to it, and how the switch was triggered.
// Old sessions without segments still render correctly (consumers fall
// back to CageSession.club + the full shots list).
export interface ClubSegment {
  club_id: string;
  startedAt: number;
  endedAt: number | null;
  shot_ids: string[];
  source: ClubSwitchSource;
  confidence?: 'high' | 'medium' | 'low';
}

export type SwingSource = 'live_cage' | 'uploaded_video';
// 2026-06-12 — how a session was captured, used to pick the library interface/reporting.
// Additive classifier layered ON TOP of `source` (not a replacement): smart_motion =
// a SmartMotion capture (cage / range / course), coach = a Coach Mode lesson (gets the
// instructor report), upload = a plain phone video. Legacy sessions infer it from source.
export type CaptureKind = 'smart_motion' | 'coach' | 'upload' | 'drill';
export type SwingTag = 'range' | 'cage' | 'indoor' | 'course' | 'putt' | 'chip' | 'other';

export interface UploadMetadata {
  uploaded_at: number;
  taken_at?: number | null;     // file metadata; user-editable
  notes?: string | null;
  swinger?: string | null;       // defaults to "Me"
  tag?: SwingTag | null;
  has_audio?: boolean;
  duration_sec?: number | null;
  /** 2026-05-22 — Capture device. Drives analyzer routing in
   *  swingLibrary.getAnalyzerKind(): 'meta_glasses' POV downward video
   *  (hands + putter + ball) does NOT fit poseAnalysisApi's full-body
   *  swing model — those route to puttingAnalysisService instead.
   *  'phone' is the legacy upload path (full-body tripod or partner-
   *  held). 'unknown' = unset, treat as 'phone' for compatibility. */
  source_device?: 'meta_glasses' | 'phone' | 'unknown' | null;
  /** 2026-05-23 — Camera perspective. Disambiguates glasses video,
   *  which can be either POV downward (Tim looking at his own setup
   *  → putting-style hand/putter analyzer) OR outward (Tim wearing
   *  glasses while watching someone else swing — full-body subject,
   *  Phase K swing analyzer). Without this, source_device='meta_glasses'
   *  forced everything to putting and miscategorized "watching daughter
   *  swing" videos.
   *
   *  Auto-inferred at ingest in services/videoUpload.ingestVideoFromPick()
   *  from useFamilyStore.active_member_id (non-null → watching_someone)
   *  and overridable via the upload-screen perspective picker.
   *
   *  Legacy uploads have null/undefined here — getAnalyzerKind falls
   *  back to the original source_device-only routing for those. */
  perspective?: 'pov_self' | 'watching_someone' | null;
  /** 2026-06-14 (Tim — second video source) — per-UPLOAD camera angle, so an
   *  imported clip (e.g. an iPad face-on recording of the same swing) is analyzed
   *  as face-on instead of inheriting the global cage DTL default. Wins over the
   *  cage calibration angle in runPhaseKOnSession. null = use the global default. */
  angleOverride?: 'down_the_line' | 'face_on' | null;
}

export interface CageSession {
  id: string;
  date: number;
  /** Initial club at session start. Existing field — back-compat. New
   *  consumers prefer `currentClub` for the live read and `clubSegments`
   *  for historical analysis. */
  club: string;
  shots: CageShot[];
  /** Phase BL — club currently being hit. Defaults to `club` for sessions
   *  predating BL. Updated when the user switches via vision / voice /
   *  manual selector. New shots are auto-tagged with this value. */
  currentClub?: string;
  /** Phase BL — historical record of club switches in this session.
   *  First segment opens at startSession with source: 'session_start'.
   *  Each switch closes the prior segment and opens a new one. Old
   *  sessions without segments still render — consumers fall back to
   *  treating the entire session as a single segment of `club`. */
  clubSegments?: ClubSegment[];
  dominantMiss: string | null;
  rootCause: string | null;
  summary: string | null;
  // Phase J — reserved for Phase K (pose detection / issue identification).
  // Phase J ships these always-null; cards render placeholder copy until
  // Phase K populates them.
  primary_issue?: PrimaryIssue | null;
  drill_recommendation?: DrillRecommendation | null;
  // 2026-06-12 — additive capture classifier (smart_motion / coach / upload) that drives
  // which interface the library renders. Undefined on legacy sessions → inferred from
  // source via getCaptureKind. See [[smartmotion-shot-map]] / library reporting work.
  captureKind?: CaptureKind;
  // 2026-06-13 (Tim) — on-course HIGHLIGHT swings. When a Smart Motion swing is
  // captured during an active round, the round context is stamped so the
  // scorecard/recap for that round can surface it; `starred` = the user saved it
  // to that round's scorecard ("put a star on it"). All null/false off-course.
  roundId?: string | null;
  roundCourseId?: string | null;
  roundHole?: number | null;
  starred?: boolean;
  // Phase R — source kind. 'live_cage' is the original Phase J flow; an
  // 'uploaded_video' session wraps a single uploaded swing (one CageShot)
  // with upload metadata so it browses uniformly in the swing library.
  source?: SwingSource;
  upload?: UploadMetadata | null;
  // Phase V — analysis lifecycle visibility. Pending = queued, the
  // analyzing_* stages mirror Phase K's pose/classify pipeline so the
  // user sees real progress, ok = analysis finished cleanly, failed =
  // pipeline errored and we need to surface honest copy.
  analysis_status?: AnalysisStatus;
  analysis_error?: string | null;
  /** Pose-detection-derived biomechanics summary. Populated AFTER
   *  Phase K completes by services/poseAnalysisApi when POSE_API_KEY
   *  is set on the server. Null = pose API not configured, failed,
   *  or returned no usable frames. UI hides the biomechanics card
   *  when null — zero regression for non-configured installs. */
  biomechanics?: import('../services/poseAnalysisApi').SwingBiomechanics | null;
  /** 2026-05-22 — PuttingLab result attached to this session when the
   *  session was classified as putting (analyzer-router routed glasses
   *  POV / putt/chip tag through puttingAnalysisService instead of
   *  Phase K). Cage-review's Putting tab renders this. Null when the
   *  session was a full-swing recording or analysis hasn't landed. */
  putting_analysis?: import('../services/puttingAnalysisService').PuttingAnalysis | null;
  /** 2026-05-23 — Coach Mode note. Free-text observation the coach
   *  attached to the swing AFTER analysis (e.g. "hips stalled at
   *  impact" — the human read alongside Kevin's AI fault read).
   *  Written via setSessionCoachNote from the swing-detail screen;
   *  rendered as its own card on that screen. Independent of
   *  primary_issue / putting_analysis — they coexist. */
  coach_note?: string | null;
  /** 2026-06-09 — Feels engine. The PLAYER's own words on how the swing felt
   *  (mechanical "came over the top" or emotional "frustrated"). The caddie
   *  reconciles it with the real read for coaching. Distinct from the
   *  owner-only feel_narration_transcript (passive feel-vs-real dataset). */
  feel_note?: string | null;
  /** 2026-06-12 — Library card thumbnail. A representative frame screenshot,
   *  lazily generated from the clip when no analysis fault-frame exists (e.g.
   *  a SmartMotion swing that didn't produce a server visual_reference_path),
   *  copied to documentDirectory so it survives cache clears. Null until first
   *  generated; getLibrary prefers the real fault frame, then this. */
  thumbnailUri?: string | null;
  /** 2026-05-27 — Fix EO: cage targeting metadata. Normalized 0-1
   *  coordinates relative to the video frame.
   *  - ball_area_norm: center + radius of the ball setup area. Both
   *    manually placed (user taps frame in Phase 1) and auto-detected
   *    (Phase 2, gpt-4o vision on the address frame) flow into this
   *    field. radius defaults to ~5% of frame height when manually
   *    placed; auto-detection returns a tight bound.
   *  - target_norm: the player's chosen aiming point (cage bullseye /
   *    pin / wall target). User-placed only — there's no reliable
   *    visual signal for "where the user is AIMING" without explicit
   *    input. Future: track-the-flag detection for course shots.
   *  Both fields are session-scoped (cage setup persists across the
   *  many swings in one session) and null when unset. */
  ball_area_norm?: { x: number; y: number; r: number } | null;
  target_norm?: { x: number; y: number } | null;
  /** 2026-05-24 — Display-quality diagnostic fault frame persisted to
   *  FileSystem at session-creation time. Pre-requisite for the
   *  visual-annotation feature (coach markup + AI auto-annotation)
   *  and the social-share flywheel — an annotated clip is the
   *  shareable unit, can't draw on a frame you didn't keep. Re-
   *  extracted from the source clip at native resolution (not the
   *  downscaled wire frames the vision model received), so the
   *  result is crisp enough for annotation + sharing. Null when:
   *    - analysis picked no specific frame (fault_frame_index === -1)
   *    - the clip was degenerate (validity gate false, none detected)
   *    - persist failed (FS write error / OOM) — honest degradation
   *  Coexists with PrimaryIssue.visual_reference_path (wire-quality,
   *  legacy field used by the per-shot review card). */
  fault_frame_uri?: string | null;
  /** 2026-05-24 — 0-based index into the 5-frame sample the vision
   *  model received. Mirrors the analysis's `fault_frame_index`
   *  promoted to session level so consumers don't have to dig into
   *  shots[0].perShotAnalysis. -1 = no specific frame (analysis
   *  declined to anchor). */
  fault_frame_index?: number | null;
  /** 2026-05-24 — Source-clip fraction the fault frame was sampled
   *  at (matches FRAME_TIME_FRACTIONS in poseDetection: 0.08, 0.40,
   *  0.60, 0.75, 0.88). Lets annotation tooling map back to a
   *  scrub-position on the video timeline. */
  fault_frame_fraction?: number | null;
  /** 2026-05-24 — Stable player id this swing is attributed to.
   *  Data-model rule (mirrors types/cage.ts:3): every swing/library
   *  record carries a player_id so historical queries don't have
   *  to fuzzy-match on the upload.swinger free-text field. Derived
   *  at ingest time:
   *    1. familyStore.active_member_id when a member is active
   *       (Coach Mode / family-recording flows)
   *    2. playerProfileStore.email when no member is active
   *    3. 'account_holder' fallback for guest installs
   *  Optional for back-compat with sessions ingested before the
   *  rule landed; new ingests always populate it. */
  player_id?: string;
}

export type AnalysisStatus =
  | 'pending'
  | 'analyzing_frames'
  | 'analyzing_pose'
  | 'analyzing_pattern'
  | 'ok'
  | 'failed';

export interface PrimaryIssue {
  issue_id: string;
  name: string;
  category: 'club_face' | 'swing_path' | 'attack_angle' | 'tempo' | 'setup' | 'other';
  severity: 'minor' | 'moderate' | 'significant';
  occurrence_count: number;
  visual_reference_path: string | null;
  mechanical_breakdown: string;
  feel_cue: string;
  detected_in_shots: string[];
  /** Phase V.6 — confidence in the primary issue call. Surfaces 'low' when
   *  the upload pipeline produced a tentative read from a single hard-to-
   *  read swing; the consumer prefixes mechanical_breakdown with a caveat
   *  to keep the honesty bar intact. Optional for back-compat with existing
   *  multi-swing classifications. */
  confidence?: 'high' | 'medium' | 'low';
  /** 2026-05-24 — Plain-language translation of the detected fault.
   *  Produced in the same /api/swing-analysis call as the technical
   *  read; surfaced behind a "What does this mean?" toggle on the
   *  PrimaryIssueCard. Optional + back-compat: absent or empty string
   *  means the affordance is hidden entirely (legacy server, putt
   *  synthesizer, or none/invalid swings). Putting follow-up will add
   *  parallel generation in puttingAnalysisService. */
  layman_explanation?: string;
  /** 2026-05-24 — GolfFix #1 structured payload. primary_fault is the
   *  named fault from a fixed allowlist of faults visible in 2D phone
   *  video (over_the_top / early_extension / casting / sway /
   *  reverse_pivot / chicken_wing / plane_too_flat / plane_too_steep /
   *  head_movement / spine_angle_loss / inconclusive). cause / fix /
   *  drill are one-sentence each, produced in the same Sonnet call.
   *  When primary_fault === 'inconclusive', cause/fix/drill arrive
   *  empty — the card renders an honest "not enough to read yet"
   *  state. Optional + back-compat: absent on legacy / putt paths. */
  primary_fault?:
    | 'over_the_top' | 'early_extension' | 'casting' | 'sway'
    | 'reverse_pivot' | 'chicken_wing' | 'plane_too_flat' | 'plane_too_steep'
    | 'head_movement' | 'spine_angle_loss' | 'no_dominant_fault' | 'inconclusive';
  cause?: string;
  fix?: string;
  drill?: string;
  /** 2026-05-24 S1.1 — Frame-specific evidence: "Frame N: <visible cue>".
   *  Populated for every diagnostic primary_fault (including
   *  no_dominant_fault). Empty for inconclusive. Surfaced under the
   *  fault headline on PrimaryIssueCard. */
  evidence?: string;
  /** 2026-06-14 (Tim — "we go fault, fault, fault, but never say what you did
   *  well") — 1-2 genuinely-OBSERVED strengths for THIS swing, named by the
   *  model alongside the fault. Tank's fundamentals live here: setup (stance /
   *  ball position / grip) from the address frame + balance from the finish.
   *  Honest by construction — the model only populates this from what it can
   *  see; empty when nothing observable. Surfaced as a "What's working" block
   *  ABOVE the fault on PrimaryIssueCard. Absent until /api/swing-analysis
   *  `strengths` is deployed (back-compat: card hides the block when empty). */
  strengths?: string[];
}

export interface DrillRecommendation {
  drill_id: string;       // links to existing SwingLab drill library by id
  drill_name: string;
  reason: string;         // Kevin's Coach voice explaining the recommendation
}

export interface CameraAlignment {
  locked: boolean;
  targetX: number;
  targetY: number;
  lockedAt: number | null;
  // Phase J — distance calibration (per cage; first calibration sticks for
  // the user's home cage). Powers acoustic ball speed reference distance,
  // future pose-distance corrections (K), and CV target sizing (L).
  distance_yards?: number | null;
  cage_id?: string | null;        // user-assigned tag; defaults to "home"
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
  // Phase AQ — rolling window of synthesized practice insights. Each entry
  // is a one-paragraph Sonnet summary of a cage session (what to remember
  // for next round). Last 5 retained. Injected into pre-round briefing.
  recentInsights: { session_id: string; club: string; insight: string; created_at: number }[];
  // Phase BL — UI signal: when true, the active cage session screen
  // shows the manual club picker modal. Set by the club_menu voice
  // intent and by the on-screen "switch club" tap target. Reset when
  // the user picks a club or cancels. NOT persisted.
  clubMenuOpen: boolean;
  // 2026-05-23 — Hydration flag. Flipped by onRehydrateStorage when
  // the persist middleware finishes loading sessionHistory + the rest
  // of the partialized fields from AsyncStorage. Screens that read
  // sessionHistory should check this before rendering "No swings yet"
  // — otherwise the cold-load empty array (initial state) renders for
  // a frame as a misleading empty state, even though data IS in
  // storage and arrives a tick later. NOT persisted (always starts
  // false on each cold launch).
  hasHydrated: boolean;

  // ─── ACTIONS ────────────────────────────

  startSession: (club: string) => void;
  /** Phase BL — switch the active club mid-session. Closes the current
   *  segment (sets endedAt) and opens a new one. New shots are auto-tagged
   *  with the new club. Pass `source` so analytics can distinguish vision
   *  vs voice vs manual recognition rates over time. */
  setActiveClub: (
    club_id: string,
    source: ClubSwitchSource,
    confidence?: 'high' | 'medium' | 'low',
  ) => void;
  /** Phase BL — toggle the manual club picker modal in the active cage
   *  session screen. */
  setClubMenuOpen: (open: boolean) => void;
  /** 2026-05-23 — Setter for the hasHydrated flag. Only called by the
   *  persist middleware's onRehydrateStorage hook; UI code subscribes
   *  to `hasHydrated` and shouldn't call this directly. */
  setHasHydrated: (b: boolean) => void;
  addShot: (shot: Omit<CageShot, 'id' | 'timestamp'>) => void;
  endSession: (summary: {
    dominantMiss: string | null;
    rootCause: string | null;
    summary: string | null;
  }) => void;
  setCameraAlignment: (x: number, y: number) => void;
  clearCameraAlignment: () => void;
  /** Phase R — ingest a single uploaded video as a one-shot CageSession.
   *  Returns the new session id so the caller can navigate to its detail
   *  surface and Phase K analysis can attach to it. */
  /** Phase R / cage-live bridge — ingest a single video as a one-shot
   *  CageSession. Used by the upload flow (source defaults to
   *  'uploaded_video') and the live cage flow (pass source: 'live_cage'
   *  so the My Swing Library can render the entry with the right kind
   *  treatment). */
  ingestUploadedSwing: (input: {
    clipUri: string;
    club: string;
    upload: UploadMetadata;
    source?: SwingSource;
    /** 2026-06-12 (Tim, library reporting) — how this session was captured, so the
     *  library renders the matching interface: SmartMotion (cage/range/course capture),
     *  a Coach Mode lesson, or a plain phone upload. Additive + non-destructive — the
     *  existing `source` enum is untouched; legacy sessions infer it (getCaptureKind). */
    captureKind?: CaptureKind;
  }) => string;
  /** Phase BW — ingest a live cage session with N detected swings, each
   *  with its own clip boundaries pointing into the master video.
   *  Creates one CageSession with N CageShots. Returns the new session
   *  id. Each shot's clipUri is the master video URI; clipStart/EndSeconds
   *  + correlationId distinguish them so Phase K can sample the right
   *  window per swing. */
  ingestLiveCageSession: (input: {
    masterVideoPath: string;
    club: string;
    upload: UploadMetadata;
    shots: {
      correlationId: string;
      detectionOffsetSeconds: number;
      clipStartSeconds: number;
      clipEndSeconds: number;
      detectionMethod: 'audio_transient' | 'manual';
    }[];
    /** 2026-06-13 — 'drill' when this session was launched from a drill card. */
    captureKind?: CaptureKind;
  }) => string;
  /** Phase BW — store the per-shot Phase K analysis result so the review
   *  UI can render per-swing cards for multi-swing sessions. */
  setShotAnalysis: (
    sessionId: string,
    shotId: string,
    analysis: {
      detected_issue: string;
      severity: 'minor' | 'moderate' | 'significant' | 'none';
      confidence: 'high' | 'medium' | 'low';
      observation: string;
      // Phase 403b — optional. Persisted under perShotAnalysis so the
      // review UI can render the fault frame as visual evidence of the
      // diagnosis. Both fields tolerate absence (callers predating 403b
      // continue to call setShotAnalysis without them).
      fault_frame_index?: number;
      visual_reference_path?: string | null;
    },
  ) => void;
  /** Phase R — patch Phase K analysis onto an existing session, used both
   *  by the live cage post-session pipeline (already in app/cage/summary.tsx)
   *  and by the upload analysis pipeline. */
  setSessionAnalysis: (sessionId: string, primary_issue: PrimaryIssue | null, drill_recommendation: DrillRecommendation | null) => void;
  /** 2026-05-24 — Feel-capture dataset writer (owner-only). Whisper
   *  transcribes the clip's audio off the captured mp4 and writes the
   *  raw narration string back onto the shot. Paired with the existing
   *  perShotAnalysis so the tuple {clip, transcript, analysis} is
   *  reviewable in the owner debug surface. No-op when sessionId or
   *  shotId not found. */
  setShotFeelTranscript: (sessionId: string, shotId: string, transcript: string) => void;
  /** 2026-05-25 — Fix AJ Phase 2: persist the spoken-commentary
   *  Whisper transcript for a shot. Same lifecycle pattern as the
   *  feel-narration setter — searches activeSession AND
   *  sessionHistory because transcription can finish either before
   *  or after the session is finalized. */
  setShotCommentaryTranscript: (sessionId: string, shotId: string, transcript: string) => void;
  /**
   * 2026-05-26 — Fix AZ: patch a session's upload metadata in place.
   * Used by the Meta Glasses verbal-cue router to set tag/perspective
   * AFTER initial ingest, once Whisper transcript reveals what the
   * user verbally tagged the clip as ("Putt Cam" / "Chip Cam" /
   * "full swing"). Caller is responsible for the gates (only override
   * when upload.tag/perspective are null + source is meta_glasses).
   */
  patchSessionUpload: (sessionId: string, patch: Partial<UploadMetadata>) => void;
  /** 2026-05-23 — Save a coach note onto a session. Coach Mode flow:
   *  pro watches the swing, AI analysis lands, pro types their own
   *  read ("hips stalled at impact") and saves. Independent of the
   *  AI analysis path — both display side-by-side on the swing
   *  detail screen. Pass empty string or null to clear. */
  setSessionCoachNote: (sessionId: string, note: string | null) => void;
  /** 2026-06-13 — toggle a swing as a saved highlight (star) for its round's scorecard. */
  toggleSessionStarred: (sessionId: string) => void;
  /** Feels engine — store the player's stated feel on the session. */
  setSessionFeel: (sessionId: string, note: string | null) => void;
  /** 2026-06-12 — Persist a lazily-generated library thumbnail (representative
   *  frame) for sessions with no analysis fault-frame. Pass null to clear. */
  setSessionThumbnail: (sessionId: string, uri: string | null) => void;
  /** 2026-05-27 — Fix EO: cage targeting setters. Pass null to clear. */
  setSessionBallArea: (sessionId: string, area: { x: number; y: number; r: number } | null) => void;
  setSessionTarget: (sessionId: string, target: { x: number; y: number } | null) => void;
  /** 2026-05-24 — Persist the display-quality diagnostic fault frame
   *  metadata on a session after analyzeSwing returns successfully.
   *  Wires the annotation + share prerequisite: a stable file URI
   *  the player / coach can draw on. All three pieces written
   *  atomically so consumers can rely on uri != null implying
   *  index and fraction are usable. Pass uri:null to clear (e.g.
   *  if a re-analysis produces no fault). */
  setSessionFaultFrame: (
    sessionId: string,
    frame: { uri: string | null; index: number | null; fraction: number | null },
  ) => void;
  /** Pose-API biomechanics result. Fire-and-forget after Phase K, so
   *  this commits independently from setSessionAnalysis. */
  setSessionBiomechanics: (sessionId: string, biomechanics: import('../services/poseAnalysisApi').SwingBiomechanics | null) => void;
  /** Phase BZ-v1 — user annotation mutators. Each updates the named shot
   *  in-place; no-op if shot id not found. */
  updateShotTags: (sessionId: string, shotId: string, tags: {
    feel?: string | null;
    shape?: string | null;
    contact?: string | null;
    direction?: string | null;
  }) => void;
  markShotGoodRep: (sessionId: string, shotId: string, isGoodRep: boolean | null) => void;
  setShotNotes: (sessionId: string, shotId: string, notes: string | null) => void;
  deleteShot: (sessionId: string, shotId: string) => void;
  // Phase AQ
  addCageInsight: (session_id: string, club: string, insight: string) => void;
  /** 2026-05-22 — Attach a PuttingAnalysis result to a session.
   *  Idempotent — overwrites prior result for the same sessionId so
   *  re-analysis after a video re-upload lands cleanly. Used by the
   *  Phase K analyzer-router when getAnalyzerKind() returns 'putting'
   *  and by the cage-review screen's "Re-analyze" button. */
  addPuttingAnalysis: (
    sessionId: string,
    analysis: import('../services/puttingAnalysisService').PuttingAnalysis,
  ) => void;
  /** Phase V — track analysis lifecycle so the swing detail surface can
   *  show real progress and surface failures honestly. */
  setSessionAnalysisStatus: (sessionId: string, status: AnalysisStatus, error?: string | null) => void;
  /** 2026-06-02 — Fix GN: walk every session and flip any non-terminal
   *  analysis_status ('pending' / 'analyzing_*') older than maxAgeMs
   *  to 'failed' with a "stale" error. Called once on app boot via
   *  the rehydration gate so analyses that were in-flight when the
   *  app was force-closed don't sit at 'analyzing…' forever. Returns
   *  the count purged for telemetry. */
  purgeStaleAnalyses: (maxAgeMs?: number) => number;
  /** Phase R — store frame timestamps for issue temporal alignment. */
  setShotIssueTimestamps: (sessionId: string, shotId: string, timestamps_sec: number[]) => void;
  /** 2026-05-25 — Path C: user-marked trim window for long uploaded
   *  clips. Writes clipStartSeconds + clipEndSeconds onto the shot so
   *  analyzeSwing's bounded-window path samples only within the user's
   *  marked swing window instead of the whole clip. Pass null to clear
   *  the bounds (reverts to whole-clip / tiered sampling). */
  setShotClipBoundaries: (sessionId: string, shotId: string, startSec: number | null, endSec: number | null) => void;
  /** 2026-06-10 — Repoint a shot's source clip uri. Used when a legacy clip is
   *  re-persisted from a volatile cache/content uri into documentDirectory on
   *  first open, so replay + re-analyze read the durable copy from then on. */
  setShotClipUri: (sessionId: string, shotId: string, clipUri: string) => void;
  /** 2026-06-10 — Multi-swing UPLOAD expansion. A single uploaded clip can hold
   *  several swings; once the video locator finds them, replace the session's
   *  single shot with one windowed shot per swing so each gets its own analysis
   *  + per-swing card (mirrors the live multi-swing path). No-op if <2 windows. */
  expandUploadIntoSwings: (sessionId: string, windows: { startSec: number; endSec: number }[]) => void;
  /** Phase R — delete a session from the library. */
  deleteSession: (sessionId: string) => void;
  /** Phase J — set the distance calibration for the current cage. Pass yards.
   *  Optional cage_id defaults to 'home' when omitted. */
  setDistanceCalibration: (yards: number, cageId?: string) => void;
  getClubProfile: (club: string) => CageState['clubProfiles'][string] | null;
  updateShotLabels: (sessionId: string, shotId: string, labels: ReviewLabels, transcript: string) => void;
}

// ─── Helpers ──────────────────────────────

/**
 * 2026-05-24 — Derive the player_id for a new swing/library record per
 * the data-model rule (types/cage.ts:3 — every session carries
 * player_id). Priority:
 *   1. familyStore.active_member_id when a member is currently the
 *      coaching subject (Coach Mode / family-recording flows)
 *   2. playerProfileStore.email for self-recorded swings
 *   3. 'account_holder' guest fallback
 *
 * Dynamic require so cageStore avoids a hard static dep on either
 * store (which would create a circular import via playerProfileStore
 * → settingsStore → cageStore through indirect references). Defensive
 * try/catch — derivation failure returns the guest fallback, never
 * blocks ingest.
 */
// 2026-06-10 — exported so the Caddie Memory store derives the SAME player id
// (one source of truth: family active member → profile email → guest).
export function derivePlayerId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fam = require('./familyStore') as typeof import('./familyStore');
    const id = fam.useFamilyStore.getState().active_member_id;
    if (id) return id;
  } catch { /* no-op — familyStore unavailable */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile = require('./playerProfileStore') as typeof import('./playerProfileStore');
    const email = profile.usePlayerProfileStore.getState().email;
    if (email && email.trim().length > 0) return email.trim().toLowerCase();
  } catch { /* no-op — profile store unavailable */ }
  return 'account_holder';
}

// 2026-06-13 (Tim) — stamp the active-round context onto a Smart Motion capture so
// the scorecard/recap for that round can surface it as a highlight swing. Dynamic
// require avoids a roundStore↔cageStore import cycle. All-null off-course.
function roundContextStamp(): { roundId: string | null; roundCourseId: string | null; roundHole: number | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRoundStore } = require('./roundStore') as typeof import('./roundStore');
    const r = useRoundStore.getState();
    if (r.isRoundActive) {
      return { roundId: r.currentRoundId ?? null, roundCourseId: r.activeCourseId ?? null, roundHole: r.currentHole ?? null };
    }
  } catch { /* non-fatal — off-course or store unavailable */ }
  return { roundId: null, roundCourseId: null, roundHole: null };
}

// ─── STORE ────────────────────────────────

export const useCageStore = create<CageState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      sessionHistory: [],
      clubProfiles: {},
      // Phase AQ
      recentInsights: [],
      cameraAlignment: null,
      // Phase BL
      clubMenuOpen: false,
      // 2026-05-23 — Hydration flag (see interface comment).
      hasHydrated: false,
      setHasHydrated: (b) => set({ hasHydrated: b }),

      startSession: (club) => {
        const id = `${Date.now()}_cage`;
        cageLog('zustand-session-start', 'ok', { session_id: id, club });
        set({
          activeSession: {
            id,
            date: Date.now(),
            club,
            currentClub: club,
            clubSegments: [{
              club_id: club,
              startedAt: Date.now(),
              endedAt: null,
              shot_ids: [],
              source: 'session_start',
            }],
            shots: [],
            dominantMiss: null,
            rootCause: null,
            summary: null,
          },
        });
      },

      setClubMenuOpen: (open) => set({ clubMenuOpen: open }),

      setActiveClub: (club_id, source, confidence) =>
        set(s => {
          if (!s.activeSession) return s;
          const now = Date.now();
          // No-op if the user re-selected the club they're already on.
          if (s.activeSession.currentClub === club_id) return s;

          const prev = s.activeSession.clubSegments ?? [];
          const closed = prev.map((seg, i) =>
            i === prev.length - 1 && seg.endedAt === null
              ? { ...seg, endedAt: now }
              : seg
          );
          const next: ClubSegment = {
            club_id,
            startedAt: now,
            endedAt: null,
            shot_ids: [],
            source,
            ...(confidence ? { confidence } : {}),
          };
          return {
            activeSession: {
              ...s.activeSession,
              currentClub: club_id,
              clubSegments: [...closed, next],
            },
          };
        }),

      addShot: (shot) =>
        set(s => {
          if (!s.activeSession) return s;
          // 2026-06-02 — Fix GN: hard cap at 100 shots per cage session.
          // SwingLab QA audit found no rate cap on cage sessions —
          // 30 shots × 52s full-analysis chain = 1560s of Vercel
          // compute, no cost ceiling. The cap also protects users
          // from accidentally running away with practice marathons
          // that drown the library in unanalyzable swings. 100 is
          // generous (most cage sessions are 20-40 shots) but acts
          // as a safety net. A toast warning at 50 lets the user
          // know they're halfway to the cap.
          const SHOT_HARD_CAP = 100;
          const SHOT_WARN_THRESHOLD = 50;
          if (s.activeSession.shots.length >= SHOT_HARD_CAP) {
            console.log('[cageStore] addShot blocked — cage session hit 100-shot cap');
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { useToastStore } = require('./toastStore');
              useToastStore.getState().show(
                'Cage session hit 100-shot cap — end session and start a new one to keep practicing.',
              );
            } catch { /* noop */ }
            return s;
          }
          if (s.activeSession.shots.length + 1 === SHOT_WARN_THRESHOLD) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { useToastStore } = require('./toastStore');
              useToastStore.getState().show(
                'Heads up — 50 shots logged in this session. Hard cap is 100.',
              );
            } catch { /* noop */ }
          }
          // Phase BL — auto-tag with currentClub when set, falling back
          // to the session's initial club for back-compat with the legacy
          // single-club flow. The shot's own .club still wins if the
          // caller explicitly passed one (preserves test/manual paths).
          const inferredClub =
            shot.club || s.activeSession.currentClub || s.activeSession.club;
          const newShot: CageShot = {
            ...shot,
            club: inferredClub,
            id: `${Date.now()}_shot`,
            timestamp: Date.now(),
          };

          // Append shot id to the open (endedAt:null) segment if any.
          const segments = s.activeSession.clubSegments;
          const updatedSegments = segments
            ? segments.map((seg, i) =>
                i === segments.length - 1 && seg.endedAt === null
                  ? { ...seg, shot_ids: [...seg.shot_ids, newShot.id] }
                  : seg
              )
            : segments;

          return {
            activeSession: {
              ...s.activeSession,
              shots: [...s.activeSession.shots, newShot],
              ...(updatedSegments ? { clubSegments: updatedSegments } : {}),
            },
          };
        }),

      endSession: (summary) =>
        set(s => {
          if (!s.activeSession) {
            cageLog('zustand-session-end', 'fail', { reason: 'no-active-session' });
            return s;
          }
          const sessionId = s.activeSession.id;
          // Phase BL — close the still-open club segment on session end so
          // post-session analytics can compute per-club practice durations
          // without special-casing the final segment.
          const now = Date.now();
          const segments = s.activeSession.clubSegments;
          const closedSegments = segments
            ? segments.map((seg, i) =>
                i === segments.length - 1 && seg.endedAt === null
                  ? { ...seg, endedAt: now }
                  : seg
              )
            : segments;

          const completed: CageSession = {
            ...s.activeSession,
            ...summary,
            ...(closedSegments ? { clubSegments: closedSegments } : {}),
          };
          cageLog('zustand-session-end', 'ok', {
            session_id: sessionId,
            shot_count: completed.shots.length,
            history_length: s.sessionHistory.length + 1,
          });
          return {
            activeSession: null,
            sessionHistory: [...s.sessionHistory, completed].slice(-50),
          };
        }),

      setCameraAlignment: (x, y) =>
        set(s => ({
          cameraAlignment: {
            locked: true,
            targetX: x,
            targetY: y,
            lockedAt: Date.now(),
            // Preserve any existing calibration when re-aiming.
            distance_yards: s.cameraAlignment?.distance_yards ?? null,
            cage_id: s.cameraAlignment?.cage_id ?? null,
          },
        })),

      clearCameraAlignment: () => set({ cameraAlignment: null }),

      setDistanceCalibration: (yards, cageId) =>
        set(s => ({
          cameraAlignment: {
            // If no alignment yet, create one with neutral aim coords —
            // distance can be calibrated independently of fine aim lock.
            locked: s.cameraAlignment?.locked ?? false,
            targetX: s.cameraAlignment?.targetX ?? 0.5,
            targetY: s.cameraAlignment?.targetY ?? 0.5,
            lockedAt: s.cameraAlignment?.lockedAt ?? null,
            distance_yards: yards,
            cage_id: cageId ?? s.cameraAlignment?.cage_id ?? 'home',
          },
        })),

      getClubProfile: (club) => get().clubProfiles[club] ?? null,

      ingestUploadedSwing: ({ clipUri, club, upload, source, captureKind }) => {
        const resolvedSource: SwingSource = source ?? 'uploaded_video';
        // Default the capture classifier from the source when not given explicitly
        // (live cage = SmartMotion; an upload = a plain phone video).
        const resolvedCaptureKind: CaptureKind = captureKind ?? (resolvedSource === 'live_cage' ? 'smart_motion' : 'upload');
        // 2026-06-05 — Dedupe. Network glitches that retry the same
        // upload (or rapid double-tap on the "Analyze" button) used to
        // double-ingest, bloating the library with phantom duplicates
        // and inflating per-session pattern counts. Stable identity
        // pair = clipUri + upload.uploaded_at; if a session with the
        // same pair already exists, return its id without re-adding.
        const dedupeKey = `${clipUri}::${upload.uploaded_at}`;
        const existing = get().sessionHistory.find(
          s => `${s.shots[0]?.clipUri ?? ''}::${s.upload?.uploaded_at ?? 0}` === dedupeKey,
        );
        if (existing) {
          cageLog('ingest-uploaded-swing', 'ok', {
            session_id: existing.id,
            note: 'deduped',
          });
          return existing.id;
        }
        const idSuffix = resolvedSource === 'live_cage' ? '_cage' : '_upload';
        const sessionId = `${Date.now()}${idSuffix}`;
        cageLog('ingest-uploaded-swing', 'ok', {
          session_id: sessionId,
          source: resolvedSource,
          club,
          clipUri_length: clipUri.length,
        });
        const shotId = `${Date.now()}_${resolvedSource === 'live_cage' ? 'cage' : 'uploaded'}_shot`;
        const session: CageSession = {
          id: sessionId,
          date: upload.taken_at ?? upload.uploaded_at,
          club,
          shots: [{
            id: shotId,
            club,
            feel: null, shape: null, contact: null, direction: null,
            timestamp: upload.taken_at ?? upload.uploaded_at,
            clipUri,
            acousticContact: null,
            aiAnalysis: null,
          }],
          dominantMiss: null,
          rootCause: null,
          summary: null,
          source: resolvedSource,
          captureKind: resolvedCaptureKind,
          ...roundContextStamp(),
          upload,
          analysis_status: 'pending',
          analysis_error: null,
          // 2026-05-24 — Data-model rule: every swing record carries
          // a stable player_id. Auto-derived (familyStore active
          // member → profile email → guest fallback).
          player_id: derivePlayerId(),
        };
        set(s => ({ sessionHistory: [...s.sessionHistory, session].slice(-50) }));
        return sessionId;
      },

      ingestLiveCageSession: ({ masterVideoPath, club, upload, shots, captureKind }) => {
        // 2026-06-05 — Dedupe. Same shape as ingestUploadedSwing.
        // Live cage uniqueness = masterVideoPath + first shot
        // correlationId (correlationId is per-detection-event, so
        // same masterVideoPath + same correlationId = same session).
        const firstCorrelationId = shots[0]?.correlationId ?? '';
        const dedupeKey = `${masterVideoPath}::${firstCorrelationId}`;
        const existing = get().sessionHistory.find(s => {
          const sCorr = s.shots[0]?.correlationId ?? '';
          const sPath = s.shots[0]?.clipUri ?? '';
          return `${sPath}::${sCorr}` === dedupeKey;
        });
        if (existing) {
          cageLog('ingest-live-cage-session', 'ok', {
            session_id: existing.id,
            note: 'deduped',
          });
          return existing.id;
        }
        const sessionId = `${Date.now()}_cage`;
        cageLog('ingest-live-cage-session', 'ok', {
          session_id: sessionId,
          club,
          shot_count: shots.length,
          masterVideoPath_length: masterVideoPath.length,
        });
        const baseTs = upload.taken_at ?? upload.uploaded_at;
        const cageShots: CageShot[] = shots.map((evt, i) => ({
          id: `${sessionId}_shot_${i}`,
          club,
          feel: null,
          shape: null,
          contact: null,
          direction: null,
          timestamp: baseTs + Math.round(evt.detectionOffsetSeconds * 1000),
          clipUri: masterVideoPath,
          acousticContact: null,
          aiAnalysis: null,
          clipStartSeconds: evt.clipStartSeconds,
          clipEndSeconds: evt.clipEndSeconds,
          detectionOffsetSeconds: evt.detectionOffsetSeconds,
          detectionMethod: evt.detectionMethod,
          correlationId: evt.correlationId,
          perShotAnalysis: null,
        }));
        const session: CageSession = {
          id: sessionId,
          date: baseTs,
          club,
          shots: cageShots,
          dominantMiss: null,
          rootCause: null,
          summary: null,
          source: 'live_cage',
          captureKind: captureKind ?? 'smart_motion',
          ...roundContextStamp(),
          upload,
          analysis_status: 'pending',
          analysis_error: null,
          // 2026-05-24 — Data-model rule. Same derivation as the
          // uploaded-swing path.
          player_id: derivePlayerId(),
        };
        set(s => ({ sessionHistory: [...s.sessionHistory, session].slice(-50) }));
        return sessionId;
      },

      // 2026-05-24 — Feel-capture transcript writer. Searches BOTH the
      // activeSession (in-flight cage) AND sessionHistory (saved
      // sessions / uploads) for the shot — feel transcription may
      // finish before OR after the session is finalized.
      setShotFeelTranscript: (sessionId, shotId, transcript) =>
        set(s => {
          const trim = (transcript ?? '').trim();
          if (!trim) return s;
          const updateShots = (shots: CageShot[]): CageShot[] =>
            shots.map(shot => shot.id !== shotId ? shot : { ...shot, feel_narration_transcript: trim });
          return {
            ...s,
            activeSession:
              s.activeSession && s.activeSession.id === sessionId
                ? { ...s.activeSession, shots: updateShots(s.activeSession.shots) }
                : s.activeSession,
            sessionHistory: s.sessionHistory.map(session =>
              session.id !== sessionId ? session : { ...session, shots: updateShots(session.shots) },
            ),
          };
        }),

      // 2026-05-25 — Fix AJ Phase 2: same lifecycle as feel transcript.
      setShotCommentaryTranscript: (sessionId, shotId, transcript) =>
        set(s => {
          const trim = (transcript ?? '').trim();
          if (!trim) return s;
          const updateShots = (shots: CageShot[]): CageShot[] =>
            shots.map(shot => shot.id !== shotId ? shot : { ...shot, commentary_transcript: trim });
          return {
            ...s,
            activeSession:
              s.activeSession && s.activeSession.id === sessionId
                ? { ...s.activeSession, shots: updateShots(s.activeSession.shots) }
                : s.activeSession,
            sessionHistory: s.sessionHistory.map(session =>
              session.id !== sessionId ? session : { ...session, shots: updateShots(session.shots) },
            ),
          };
        }),

      // 2026-05-26 — Fix AZ: in-place patch of a session's upload
      // metadata. Used by metaGlassesCueRouter to retroactively set
      // tag/perspective once Whisper transcript reveals the user's
      // verbal cue ("Putt Cam" → tag=putt + perspective=pov_self).
      // Defensive: only mutates an EXISTING upload object — never
      // synthesizes one from null (the session would be a live_cage
      // capture, not a glasses ingest, and we shouldn't fabricate
      // upload metadata for those).
      patchSessionUpload: (sessionId, patch) =>
        set(s => {
          const apply = (session: CageSession): CageSession => {
            if (session.id !== sessionId) return session;
            if (!session.upload) return session;
            return { ...session, upload: { ...session.upload, ...patch } };
          };
          return {
            ...s,
            activeSession: s.activeSession ? apply(s.activeSession) : s.activeSession,
            sessionHistory: s.sessionHistory.map(apply),
          };
        }),

      setShotAnalysis: (sessionId, shotId, analysis) =>
        set(s => ({
          // 2026-05-17 — also flip session.analysis_status to 'ok'
          // and clear analysis_error. Previously this stayed at
          // 'pending' forever on per-shot-only paths because only
          // setSessionAnalysis advanced the status.
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : { ...shot, perShotAnalysis: analysis },
              ),
              analysis_status: 'ok' as AnalysisStatus,
              analysis_error: null,
            },
          ),
        })),

      updateShotTags: (sessionId, shotId, tags) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : {
                  ...shot,
                  ...(tags.feel !== undefined ? { feel: tags.feel } : {}),
                  ...(tags.shape !== undefined ? { shape: tags.shape } : {}),
                  ...(tags.contact !== undefined ? { contact: tags.contact } : {}),
                  ...(tags.direction !== undefined ? { direction: tags.direction } : {}),
                },
              ),
            },
          ),
        })),

      markShotGoodRep: (sessionId, shotId, isGoodRep) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : { ...shot, isGoodRep },
              ),
            },
          ),
        })),

      setShotNotes: (sessionId, shotId, notes) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : { ...shot, userNotes: notes },
              ),
            },
          ),
        })),

      deleteShot: (sessionId, shotId) =>
        set(s => ({
          // 2026-05-17 — also prune the deleted shot id from
          // clubSegments[].shot_ids. Previously segments retained
          // pointers to non-existent shots and the per-segment club
          // aggregation downstream over-counted by one per delete.
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.filter(shot => shot.id !== shotId),
              clubSegments: session.clubSegments?.map(seg => ({
                ...seg,
                shot_ids: seg.shot_ids.filter(id => id !== shotId),
              })),
            },
          ),
        })),

      addCageInsight: (session_id, club, insight) =>
        set(s => ({
          recentInsights: [
            ...s.recentInsights.filter(x => x.session_id !== session_id),
            { session_id, club, insight, created_at: Date.now() },
          ].slice(-5),
        })),

      addPuttingAnalysis: (sessionId, analysis) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              putting_analysis: analysis,
              analysis_status: 'ok' as AnalysisStatus,
            },
          ),
        })),

      // 2026-06-16 — dual-update, matching setShotAnalysis / setShot*Transcript:
      // GolfFix session analysis routinely lands while the session is still
      // IN-FLIGHT (activeSession), before endSession pushes it to sessionHistory.
      // Previously this only patched sessionHistory, so on a live session the
      // analysis found no match — activeSession.primary_issue (+ drill) stayed
      // null and the live GolfFix card rendered empty until the session was
      // saved. The C3 harness ("GolfFix render — no_dominant_fault") seeds an
      // active-only session and reads activeSession, which is why it failed.
      // Patch BOTH, exactly like the sibling shot setters above.
      setSessionAnalysis: (sessionId, primary_issue, drill_recommendation) =>
        set(s => {
          const apply = (session: CageSession): CageSession =>
            session.id !== sessionId ? session : {
              ...session, primary_issue, drill_recommendation,
              analysis_status: 'ok' as AnalysisStatus, analysis_error: null,
            };
          return {
            activeSession:
              s.activeSession && s.activeSession.id === sessionId
                ? apply(s.activeSession)
                : s.activeSession,
            sessionHistory: s.sessionHistory.map(apply),
          };
        }),

      setSessionCoachNote: (sessionId, note) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              coach_note: note && note.trim().length > 0 ? note.trim() : null,
            }
          ),
        })),

      toggleSessionStarred: (sessionId) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : { ...session, starred: !session.starred }
          ),
        })),

      setSessionFeel: (sessionId, note) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              feel_note: note && note.trim().length > 0 ? note.trim() : null,
            }
          ),
        })),

      setSessionThumbnail: (sessionId, uri) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : { ...session, thumbnailUri: uri || null }
          ),
        })),

      // 2026-05-27 — Fix EO: cage targeting setters. Defensive normalize:
      // coord values are clamped to [0,1] before persist so a renderer
      // bug or weird gesture never writes off-frame coords that would
      // render the overlay outside the video viewport.
      setSessionBallArea: (sessionId, area) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session => {
            if (session.id !== sessionId) return session;
            if (area == null) return { ...session, ball_area_norm: null };
            const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
            return {
              ...session,
              ball_area_norm: {
                x: clamp01(area.x),
                y: clamp01(area.y),
                r: Math.max(0.01, Math.min(0.5, area.r)),
              },
            };
          }),
        })),
      setSessionTarget: (sessionId, target) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session => {
            if (session.id !== sessionId) return session;
            if (target == null) return { ...session, target_norm: null };
            const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
            return {
              ...session,
              target_norm: { x: clamp01(target.x), y: clamp01(target.y) },
            };
          }),
        })),

      setSessionFaultFrame: (sessionId, frame) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              fault_frame_uri: frame.uri,
              fault_frame_index: frame.index,
              fault_frame_fraction: frame.fraction,
            }
          ),
        })),

      setSessionBiomechanics: (sessionId, biomechanics) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : { ...session, biomechanics }
          ),
        })),

      // 2026-06-16 — dual-update like setSessionAnalysis: status (analyzing /
      // error / pending) is set while the session is still IN-FLIGHT, so the
      // live GolfFix card must see it too — not just the saved history entry.
      setSessionAnalysisStatus: (sessionId, status, error) =>
        set(s => {
          const apply = (session: CageSession): CageSession =>
            session.id !== sessionId ? session : {
              ...session,
              analysis_status: status,
              analysis_error: error ?? session.analysis_error ?? null,
            };
          return {
            activeSession:
              s.activeSession && s.activeSession.id === sessionId
                ? apply(s.activeSession)
                : s.activeSession,
            sessionHistory: s.sessionHistory.map(apply),
          };
        }),

      // 2026-06-02 — Fix GN: orphan-cleanup pass. Audit found that
      // sessions where analysis was in-flight at force-close stayed
      // at 'pending' or 'analyzing_*' forever — no auto-cleanup, no
      // garbage collection. Library shows "analyzing…" indefinitely.
      // Walking every session at boot and flipping stale non-terminal
      // states to 'failed' surfaces them via the new retry badge so
      // the user can re-trigger analysis instead of stuck library
      // garbage. Default cutoff: 24h.
      purgeStaleAnalyses: (maxAgeMs = 24 * 60 * 60 * 1000) => {
        const cutoff = Date.now() - maxAgeMs;
        let purged = 0;
        const STALE_STATUSES: AnalysisStatus[] = ['pending', 'analyzing_frames', 'analyzing_pose', 'analyzing_pattern'];
        set(s => ({
          sessionHistory: s.sessionHistory.map(session => {
            const status = session.analysis_status;
            if (!status || !STALE_STATUSES.includes(status)) return session;
            if (session.date > cutoff) return session;
            purged += 1;
            return {
              ...session,
              analysis_status: 'failed' as AnalysisStatus,
              analysis_error: 'Analysis didn’t finish (app closed mid-analysis) — tap to retry.',
            };
          }),
        }));
        if (purged > 0) {
          console.log('[cageStore] purgeStaleAnalyses flipped', purged, 'orphaned analyses to failed');
        }
        return purged;
      },

      setShotIssueTimestamps: (sessionId, shotId, timestamps_sec) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : { ...shot, detected_issue_timestamps_sec: timestamps_sec }
              ),
            }
          ),
        })),

      setShotClipBoundaries: (sessionId, shotId, startSec, endSec) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : {
                  ...shot,
                  clipStartSeconds: startSec ?? undefined,
                  clipEndSeconds: endSec ?? undefined,
                }
              ),
            }
          ),
        })),

      setShotClipUri: (sessionId, shotId, clipUri) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : { ...shot, clipUri }
              ),
            }
          ),
        })),

      expandUploadIntoSwings: (sessionId, windows) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session => {
            if (session.id !== sessionId) return session;
            const base = session.shots[0];
            if (!base || windows.length < 2) return session; // nothing to expand
            const shots: CageShot[] = windows.map((w, i) => ({
              ...base, // inherit clipUri, club, etc. from the single uploaded shot
              id: `${sessionId}_shot_${i}`,
              clipStartSeconds: w.startSec,
              clipEndSeconds: w.endSec,
              detectionOffsetSeconds: w.startSec,
              detectionMethod: 'manual' as const,
              aiAnalysis: null,
              perShotAnalysis: null,
            }));
            return { ...session, shots };
          }),
        })),

      deleteSession: (sessionId) =>
        set(s => ({
          sessionHistory: s.sessionHistory.filter(session => session.id !== sessionId),
        })),

      updateShotLabels: (sessionId, shotId, labels, transcript) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              shots: session.shots.map(shot =>
                shot.id !== shotId ? shot : {
                  ...shot,
                  review_labels: labels,
                  review_transcript: transcript,
                }
              ),
            }
          ),
        })),
    }),
    {
      name: 'cage-store-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // Audit follow-up — explicit version + migrate added defensively.
      // Cage session schemas have evolved (clubSegments, primary_issue,
      // analysis_status added across phases) without bumping the persist
      // version. v1 = current shape; bump + add migrate when changing
      // CageSession / CageShot type shape going forward.
      version: 1,
      migrate: (persisted) => persisted as CageState,
      partialize: (s) => ({
        // activeSession NOT persisted — in-flight session lost on crash is acceptable
        sessionHistory: s.sessionHistory,
        clubProfiles: s.clubProfiles,
        cameraAlignment: s.cameraAlignment,
        recentInsights: s.recentInsights,
      }),
      // 2026-05-23 — Hydration signal. Flipped true when AsyncStorage
      // has finished loading the partialized snapshot into the store
      // (or when rehydration fails — in which case the empty initial
      // state IS the truth and the UI should render the genuine empty
      // state, not stay in a loading spinner forever).
      // Library / cage / cage-review screens subscribe to hasHydrated
      // and avoid rendering "No swings yet" until it's true. Prevents
      // the cold-launch flash where the initial [] is misread as "data
      // wiped" while data is actually still in storage and one tick
      // away from arriving.
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.log('[cageStore] rehydrate error (treating as empty):', error);
        }
        useCageStore.getState().setHasHydrated(true);
      },
    },
  ),
);
