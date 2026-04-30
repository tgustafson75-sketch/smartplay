export interface ParsedShotRecord {
  club: string | null;
  distance: number | null;
  direction: 'left' | 'straight' | 'right' | null;
  outcome: 'good' | 'neutral' | 'bad' | null;
  lie_followup: boolean;
  raw_utterance: string;
  confidence: 'high' | 'medium' | 'low';
  follow_up_question: string | null;
}

export interface ParseShotContext {
  hole_number: number | null;
  recent_user_phrases?: string[];   // top vocabulary entries for this user
  is_lie_followup?: boolean;        // true when this utterance answers the lie question
}
