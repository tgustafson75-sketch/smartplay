export interface CageSession {
  id: string;
  player_id: string;
  started_at: number; // unix ms
  ended_at: number | null;
  duration_seconds: number;
  master_video_path: string;
  clips: CageClip[];
  distance_to_target_meters: number | null;
  notes: string | null;
  player_roster: string[];
}

export interface CageClip {
  id: string;
  session_id: string;
  detected_at_session_offset_seconds: number;
  detection_method: 'audio_transient' | 'manual';
  start_time_seconds: number; // offset into master video
  end_time_seconds: number;
  speaker_id: string;
  labels: Record<string, unknown>;
  raw_transcript: string | null;
}
