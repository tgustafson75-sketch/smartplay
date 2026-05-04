import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
export type SwingTag = 'range' | 'cage' | 'indoor' | 'course' | 'other';

export interface UploadMetadata {
  uploaded_at: number;
  taken_at?: number | null;     // file metadata; user-editable
  notes?: string | null;
  swinger?: string | null;       // defaults to "Me"
  tag?: SwingTag | null;
  has_audio?: boolean;
  duration_sec?: number | null;
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
  ingestUploadedSwing: (input: {
    clipUri: string;
    club: string;
    upload: UploadMetadata;
  }) => string;
  /** Phase R — patch Phase K analysis onto an existing session, used both
   *  by the live cage post-session pipeline (already in app/cage/summary.tsx)
   *  and by the upload analysis pipeline. */
  setSessionAnalysis: (sessionId: string, primary_issue: PrimaryIssue | null, drill_recommendation: DrillRecommendation | null) => void;
  // Phase AQ
  addCageInsight: (session_id: string, club: string, insight: string) => void;
  /** Phase V — track analysis lifecycle so the swing detail surface can
   *  show real progress and surface failures honestly. */
  setSessionAnalysisStatus: (sessionId: string, status: AnalysisStatus, error?: string | null) => void;
  /** Phase R — store frame timestamps for issue temporal alignment. */
  setShotIssueTimestamps: (sessionId: string, shotId: string, timestamps_sec: number[]) => void;
  /** Phase R — delete a session from the library. */
  deleteSession: (sessionId: string) => void;
  /** Phase J — set the distance calibration for the current cage. Pass yards.
   *  Optional cage_id defaults to 'home' when omitted. */
  setDistanceCalibration: (yards: number, cageId?: string) => void;
  getClubProfile: (club: string) => CageState['clubProfiles'][string] | null;
  updateShotLabels: (sessionId: string, shotId: string, labels: ReviewLabels, transcript: string) => void;
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

      startSession: (club) =>
        set({
          activeSession: {
            id: `${Date.now()}_cage`,
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
        }),

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
          if (!s.activeSession) return s;
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

      ingestUploadedSwing: ({ clipUri, club, upload }) => {
        const sessionId = `${Date.now()}_upload`;
        const shotId = `${Date.now()}_uploaded_shot`;
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
          source: 'uploaded_video',
          upload,
          analysis_status: 'pending',
          analysis_error: null,
        };
        set(s => ({ sessionHistory: [...s.sessionHistory, session].slice(-50) }));
        return sessionId;
      },

      addCageInsight: (session_id, club, insight) =>
        set(s => ({
          recentInsights: [
            ...s.recentInsights.filter(x => x.session_id !== session_id),
            { session_id, club, insight, created_at: Date.now() },
          ].slice(-5),
        })),

      setSessionAnalysis: (sessionId, primary_issue, drill_recommendation) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session, primary_issue, drill_recommendation,
              analysis_status: 'ok' as AnalysisStatus, analysis_error: null,
            }
          ),
        })),

      setSessionAnalysisStatus: (sessionId, status, error) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : {
              ...session,
              analysis_status: status,
              analysis_error: error ?? session.analysis_error ?? null,
            }
          ),
        })),

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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        // activeSession NOT persisted — in-flight session lost on crash is acceptable
        sessionHistory: s.sessionHistory,
        clubProfiles: s.clubProfiles,
        cameraAlignment: s.cameraAlignment,
        recentInsights: s.recentInsights,
      }),
    },
  ),
);
