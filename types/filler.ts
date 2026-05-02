export type FillerCategory =
  // Phase A.4 categories
  | 'tactical' | 'conversational' | 'social' | 'ghost'
  // Phase P categories — context-specific bridges for latency masking
  | 'looking'      // vision-based: lie analysis, hole layout
  | 'thinking'     // deep reasoning: course strategy, complex planning
  | 'checking'     // data lookup that's slightly slow (cached fetch, etc.)
  | 'analyzing'    // post-session swing review, pattern detection
  | 'acknowledging'// conversational opener, no real response yet
  | 'confirming'   // quick acknowledgment of action ("Got it.", "Logged.")
  | 'engaging'     // Coach-mode opener for practice surfaces
  | 'casual';      // Psychologist-mode between-shot opener

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
