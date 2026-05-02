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
  club: string;
  shots: CageShot[];
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
}

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
        };
        set(s => ({ sessionHistory: [...s.sessionHistory, session].slice(-50) }));
        return sessionId;
      },

      setSessionAnalysis: (sessionId, primary_issue, drill_recommendation) =>
        set(s => ({
          sessionHistory: s.sessionHistory.map(session =>
            session.id !== sessionId ? session : { ...session, primary_issue, drill_recommendation }
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
      }),
    },
  ),
);
