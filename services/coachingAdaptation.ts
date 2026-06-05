export type CoachingComplexity = 'simple' | 'standard' | 'advanced';

export interface CoachingProfileLike {
  handicap?: number | null;
  experienceContext?: 'starting' | 'improving' | 'returning' | 'competitive' | null;
  physicalLimitation?: string | null;
}

export function deriveComplexityLevel(profile: CoachingProfileLike): CoachingComplexity {
  if (profile.experienceContext === 'starting') return 'simple';
  if (profile.experienceContext === 'competitive' || (profile.handicap ?? 99) <= 8) return 'advanced';
  return 'standard';
}

export function hasMobilityFlag(profile: CoachingProfileLike): boolean {
  const note = (profile.physicalLimitation ?? '').toLowerCase();
  if (!note) return false;
  return /back|hip|knee|shoulder|mobility|pain|stiff/.test(note);
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
