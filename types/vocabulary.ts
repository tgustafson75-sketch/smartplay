export interface VocabularyProfile {
  user_id: string;
  generated_at: number;
  total_clips_reviewed: number;
  observed_terminology: {
    strike_terms: string[];
    contact_terms: string[];
    diagnostic_terms: string[];
    feel_terms: string[];
  };
  kevin_summary: string;
}
