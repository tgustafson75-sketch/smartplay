export type FillerCategory = 'tactical' | 'conversational' | 'social' | 'ghost';

export interface FillerClip {
  id: string;
  category: FillerCategory;
  text: string;
  duration_ms: number;
  audio_path: string;
  generated_at: number;
}

export interface FillerLibrary {
  clips: FillerClip[];
  generated_at: number;
  voice_settings_hash: string;
}
