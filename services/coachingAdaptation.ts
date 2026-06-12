import { COMPLEXITY_ADVANCED_MAX_HCP } from '../constants/handicapTiers';

export type CoachingComplexity = 'simple' | 'standard' | 'advanced';

export interface CoachingProfileLike {
  handicap?: number | null;
  experienceContext?: 'starting' | 'improving' | 'returning' | 'competitive' | null;
  physicalLimitation?: string | null;
}

export function deriveComplexityLevel(profile: CoachingProfileLike): CoachingComplexity {
  if (profile.experienceContext === 'starting') return 'simple';
  if (profile.experienceContext === 'competitive' || (profile.handicap ?? 99) <= COMPLEXITY_ADVANCED_MAX_HCP) return 'advanced';
  return 'standard';
}

export function hasMobilityFlag(profile: CoachingProfileLike): boolean {
  const note = (profile.physicalLimitation ?? '').toLowerCase().trim();
  if (!note) return false;
  // 2026-06-11 (review finding) — negation/benign short-circuit. The broad
  // positive match below would otherwise flag clearly-negated profiles
  // ("no injuries", "no pain", "fully recovered", "none", "healthy") as
  // limitations. Bail on those FIRST.
  if (/^(none|n\/?a|healthy|fit|fine|good|nothing|no)\.?$/.test(note)) return false;
  if (/\bno\s+(injur|pain|issue|problem|limitation|condition|mobility|stiff|surger)/.test(note)) return false;
  // 2026-06-11 — broadened well beyond joint names. The prior regex
  // (back|hip|knee|shoulder|mobility|pain|stiff) missed "sciatica" entirely —
  // and nerve/disc/arthritis/surgery/injury phrasings — so the deterministic
  // on-course voice adaptation (lieAnalysis, metaCourseIntelligence,
  // smartAnalysisEngine) silently skipped real limitations the LLM path
  // already respects via physicalLimitation context. Kept generous on purpose:
  // a false positive just yields gentler, mobility-aware coaching, never harm.
  // "recovering" (ongoing) flags; "recovered" (done) does not.
  return /back|hip|knee|shoulder|neck|ankle|elbow|wrist|spine|spinal|mobility|pain|stiff|sore|sciatic|nerve|disc|herniat|arthrit|surger|surgic|replace|fusion|tendon|rotator|meniscus|sprain|strain|plantar|fasciit|bursit|scolios|fibro|injur|recovering/.test(note);
}

export function adaptOnCourseVoice(
  base: string,
  complexity: CoachingComplexity,
  mobilitySafe: boolean,
  confidence: number,
): string {
  const complexityHint =
    complexity === 'simple'
      ? ' Keep it simple: one target, one swing thought.'
      : complexity === 'advanced'
        ? ' Execute your stock pattern and commit to the miss-safe side.'
        : ' Commit to the target and tempo.';
  const mobilityHint = mobilitySafe
    ? ' Favor smooth tempo and balanced finish over max speed.'
    : '';
  const confidenceHint = confidence < 45
    ? ' Confidence is limited right now, so this is a conservative call.'
    : '';

  let out = base;
  if (!out.includes('Keep it simple: one target, one swing thought.')
    && !out.includes('Execute your stock pattern and commit to the miss-safe side.')
    && !out.includes('Commit to the target and tempo.')) {
    out += complexityHint;
  }
  if (mobilityHint && !out.includes('Favor smooth tempo and balanced finish over max speed.')) {
    out += mobilityHint;
  }
  if (confidenceHint && !out.includes('Confidence is limited right now, so this is a conservative call.')) {
    out += confidenceHint;
  }
  return out.trim();
}
