/**
 * 2026-05-22 — Junior Swing Analyzer.
 *
 * Warm, age-appropriate swing analysis for the SmartPlay Family
 * Coaching mode. Sibling to:
 *   - puttingAnalysisService (PuttingAnalysis: full putt structure)
 *   - smartAnalysisEngine    (general analysis orchestrator)
 *
 * Why a dedicated service:
 *   - Adult swing analysis (Phase K pose pipeline) is calibrated
 *     against tour / single-digit-handicap mechanics. Pointing it at
 *     a 9-year-old's swing produces "deceleration through impact"
 *     when the kid did exactly what their body should at that age.
 *   - Tone matters even more for kids. Same observation said two ways
 *     either builds a love of the game or kills it. Service threads
 *     ageBand → system prompt so Serena talks differently to a 6yo
 *     than a 14yo than a parent's own swing review.
 *   - Progress is the win condition. Returns a `vs_previous` block
 *     diffing against the family member's last analyzed swing so
 *     coaches can lead with "you kept your head still longer than
 *     last time" — that's the dopamine hit kids come back for.
 *
 * Inputs:
 *   - frames_base64 (POV/phone capture frames, 4-6 cap)
 *   - video_url (server can fetch + sample)
 *   - notes (parent's spoken context — "first time with the 7-iron")
 *   - family member id (looked up; drives tone band)
 *
 * Output: a JuniorSwingAnalysis with structured technical observations
 * AND age-appropriate coaching prose AND a progress diff when prior
 * analyses exist for this member.
 *
 * Storage: results are persisted to AsyncStorage keyed by member id
 * so the next analysis can read history without touching the main
 * cageStore (kids' data stays roster-local).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFamilyStore, ageBand, type FamilyMember, type AgeBand } from '../store/familyStore';
import { useSettingsStore } from '../store/settingsStore';
import { getCaddieName } from '../lib/persona';
import { getActiveVisionContext } from './glassesVisionInput';
import { devLog } from './devLog';

// ─── Schema ──────────────────────────────────────────────────────────────

export type GripObservation = 'square' | 'strong' | 'weak' | 'too_tight' | 'too_loose' | 'unknown';
export type StanceObservation = 'balanced' | 'too_wide' | 'too_narrow' | 'tilted' | 'unknown';
export type HeadMovementObservation = 'still' | 'slight' | 'lifting' | 'swaying' | 'unknown';
export type TempoObservation = 'smooth' | 'quick' | 'rushed' | 'jerky' | 'unknown';
export type BalanceObservation = 'finished_balanced' | 'fell_back' | 'fell_forward' | 'spun_out' | 'unknown';

export interface JuniorSwingAnalysis {
  swingId: string;
  timestamp: string;
  /** family member id this swing belongs to. */
  memberId: string;
  /** Snapshot of member tone band at analysis time. */
  ageBand: AgeBand;
  club: string | null;

  fundamentals: {
    grip: GripObservation;
    stance: StanceObservation;
    head_movement: HeadMovementObservation;
    tempo: TempoObservation;
    balance: BalanceObservation;
  };

  /** What WENT WELL (lead with this — confidence is the goal). */
  wins: string[];
  /** ONE focus area for next time. Never more than one — kids can't
   *  absorb a checklist mid-session. Empty when the swing is solid. */
  next_focus: string | null;
  /** Optional "next-time game" — turning the focus into something fun
   *  ("can you hit five in a row where your head doesn't move?"). */
  fun_drill: string | null;

  /** Comparison to this member's prior analyzed swing. Null on first
   *  swing or when no useful diff can be drawn. */
  vs_previous: {
    direction: 'improved' | 'same' | 'regressed';
    summary: string;
  } | null;

  overallScore: number;       // 0-100, age-relative
  /** Warm spoken summary in the active caddie's voice + age band. */
  coachComment: string;
}

export interface JuniorSwingAnalyzeInput {
  /** Required — must reference a non-archived family member. */
  memberId: string;
  frames_base64?: string[];
  video_url?: string | null;
  notes?: string | null;
  club?: string | null;
}

// ─── History persistence ─────────────────────────────────────────────────

const HISTORY_KEY_PREFIX = 'junior-swing-history-v1::';
const HISTORY_MAX_PER_MEMBER = 25;

async function readMemberHistory(memberId: string): Promise<JuniorSwingAnalysis[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY_PREFIX + memberId);
    return raw ? (JSON.parse(raw) as JuniorSwingAnalysis[]) : [];
  } catch {
    return [];
  }
}

async function writeMemberHistory(memberId: string, history: JuniorSwingAnalysis[]): Promise<void> {
  try {
    const sliced = history.slice(-HISTORY_MAX_PER_MEMBER);
    await AsyncStorage.setItem(HISTORY_KEY_PREFIX + memberId, JSON.stringify(sliced));
  } catch (e) {
    devLog('[juniorAnalyzer] history write failed (non-fatal): ' + String(e));
  }
}

export async function getMemberSwingHistory(memberId: string): Promise<JuniorSwingAnalysis[]> {
  return readMemberHistory(memberId);
}

// ─── Public API ──────────────────────────────────────────────────────────

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * Run junior swing analysis. Always resolves to a populated result —
 * on transport failure the fallback returns an age-appropriate "let me
 * see that one more time" message so the kid never sees a blank state.
 */
export async function analyzeJuniorSwing(
  input: JuniorSwingAnalyzeInput,
): Promise<JuniorSwingAnalysis | null> {
  const family = useFamilyStore.getState();
  const settings = useSettingsStore.getState();
  const member = family.getMember(input.memberId);
  if (!member) {
    devLog(`[juniorAnalyzer] member not found id=${input.memberId}`);
    return null;
  }
  const band = ageBand(member.age);
  const persona = settings.caddiePersonality;
  const history = await readMemberHistory(member.id);
  const prior = history.length > 0 ? history[history.length - 1] : null;

  // Opportunistic glasses frame attach (matches the puttingAnalysis pattern).
  let frames = input.frames_base64 ?? [];
  if (frames.length === 0) {
    try {
      const vision = await getActiveVisionContext();
      if (vision?.frame.uri) devLog(`[juniorAnalyzer] glasses frame uri=${vision.frame.uri}`);
    } catch { /* non-fatal */ }
  }

  try {
    const res = await fetch(`${apiUrl()}/api/junior-swing-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frames_base64: frames,
        video_url: input.video_url ?? null,
        notes: input.notes ?? null,
        club: input.club ?? null,
        member: serializeMemberForPrompt(member),
        age_band: band,
        persona,
        voiceGender: settings.voiceGender,
        prior_swing: prior ? serializePriorForPrompt(prior) : null,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      devLog(`[juniorAnalyzer] api non-ok ${res.status}`);
      return await persistFallback(member, band, persona, prior, input);
    }
    const data = (await res.json()) as Partial<JuniorSwingAnalysis>;
    const normalized = normalize(data, member, band, persona, prior, input);
    const updatedHistory = [...history, normalized];
    await writeMemberHistory(member.id, updatedHistory);
    devLog(
      `[juniorAnalyzer] ok member=${member.firstName} band=${band} ` +
      `score=${normalized.overallScore} vs_prev=${normalized.vs_previous?.direction ?? 'first'}`,
    );
    return normalized;
  } catch (e) {
    devLog('[juniorAnalyzer] exception: ' + String(e));
    return persistFallback(member, band, persona, prior, input);
  }
}

/**
 * Convenience for voice intent — speaks the coachComment back in the
 * active caddie's voice after the analysis lands. Caller is the
 * "analyze daughter's swing" intent handler.
 */
export async function speakJuniorAnalysis(memberId: string, notes: string | null): Promise<JuniorSwingAnalysis | null> {
  const result = await analyzeJuniorSwing({ memberId, notes });
  if (!result) return null;
  try {
    const settings = useSettingsStore.getState();
    const voiceMod = await import('./voiceService');
    void voiceMod.speak?.(
      result.coachComment,
      settings.voiceGender,
      settings.language ?? 'en',
      apiUrl(),
      { userInitiated: true },
    )?.catch?.(() => undefined);
  } catch (e) {
    devLog('[juniorAnalyzer] speak failed (non-fatal): ' + String(e));
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function serializeMemberForPrompt(m: FamilyMember): Record<string, unknown> {
  return {
    first_name: m.firstName,
    nickname: m.nickname ?? null,
    relationship: m.relationship,
    age: m.age,
    skill_level: m.skillLevel,
    handedness: m.handedness,
    approximate_handicap: m.approximate_handicap,
  };
}

function serializePriorForPrompt(p: JuniorSwingAnalysis): Record<string, unknown> {
  return {
    timestamp: p.timestamp,
    fundamentals: p.fundamentals,
    wins: p.wins,
    next_focus: p.next_focus,
    overall_score: p.overallScore,
  };
}

function normalize(
  data: Partial<JuniorSwingAnalysis>,
  member: FamilyMember,
  band: AgeBand,
  persona: string,
  prior: JuniorSwingAnalysis | null,
  input: JuniorSwingAnalyzeInput,
): JuniorSwingAnalysis {
  const fundamentals = (data.fundamentals ?? {}) as Partial<JuniorSwingAnalysis['fundamentals']>;
  const overall = clamp(data.overallScore, 70);
  return {
    swingId: data.swingId ?? newSwingId(member.id),
    timestamp: data.timestamp ?? new Date().toISOString(),
    memberId: member.id,
    ageBand: band,
    club: data.club ?? input.club ?? null,
    fundamentals: {
      grip: pick(fundamentals.grip, ['square', 'strong', 'weak', 'too_tight', 'too_loose', 'unknown'] as const, 'unknown'),
      stance: pick(fundamentals.stance, ['balanced', 'too_wide', 'too_narrow', 'tilted', 'unknown'] as const, 'unknown'),
      head_movement: pick(fundamentals.head_movement, ['still', 'slight', 'lifting', 'swaying', 'unknown'] as const, 'unknown'),
      tempo: pick(fundamentals.tempo, ['smooth', 'quick', 'rushed', 'jerky', 'unknown'] as const, 'unknown'),
      balance: pick(fundamentals.balance, ['finished_balanced', 'fell_back', 'fell_forward', 'spun_out', 'unknown'] as const, 'unknown'),
    },
    wins: cleanStringList(data.wins, 3),
    next_focus: trimString(data.next_focus),
    fun_drill: trimString(data.fun_drill),
    vs_previous: data.vs_previous ?? autoVsPrevious(overall, prior),
    overallScore: overall,
    coachComment: trimString(data.coachComment) ?? defaultCoachComment(member, band, persona, overall),
  };
}

function autoVsPrevious(overall: number, prior: JuniorSwingAnalysis | null): JuniorSwingAnalysis['vs_previous'] {
  if (!prior) return null;
  const diff = overall - prior.overallScore;
  if (Math.abs(diff) < 3) return { direction: 'same', summary: 'About the same as last time.' };
  if (diff > 0) {
    return {
      direction: 'improved',
      summary: `Up ${diff} points vs last swing — that\'s real progress.`,
    };
  }
  return {
    direction: 'regressed',
    summary: `Slightly down from last time. We\'ll dial it back in next swing.`,
  };
}

async function persistFallback(
  member: FamilyMember,
  band: AgeBand,
  persona: string,
  prior: JuniorSwingAnalysis | null,
  input: JuniorSwingAnalyzeInput,
): Promise<JuniorSwingAnalysis> {
  const fallback: JuniorSwingAnalysis = {
    swingId: newSwingId(member.id),
    timestamp: new Date().toISOString(),
    memberId: member.id,
    ageBand: band,
    club: input.club ?? null,
    fundamentals: {
      grip: 'unknown',
      stance: 'unknown',
      head_movement: 'unknown',
      tempo: 'unknown',
      balance: 'unknown',
    },
    wins: ['You stepped up and took a swing — that\'s the first big win.'],
    next_focus: null,
    fun_drill: null,
    vs_previous: prior ? autoVsPrevious(50, prior) : null,
    overallScore: 50,
    coachComment: defaultCoachComment(member, band, persona, 50, true),
  };
  // Don't persist the fallback — we don't want a transient network blip
  // to pollute the member's progress timeline.
  return fallback;
}

function defaultCoachComment(
  member: FamilyMember,
  band: AgeBand,
  persona: string,
  overall: number,
  isFallback = false,
): string {
  const caddieName = getCaddieName(persona);
  const name = member.firstName;
  if (isFallback) {
    return band === 'tiny'
      ? `${name}! Nice swing! Let's do another one and I'll watch you closer.`
      : band === 'junior'
      ? `Hey ${name}! Couldn't see that one clearly — let's do another and ${caddieName} will give you real feedback.`
      : `${caddieName} here — video came through fuzzy. Take another swing and we'll get a clean read.`;
  }
  if (band === 'tiny') {
    return `${name}! You did it! Big swing. Great job.`;
  }
  if (band === 'junior') {
    return overall >= 70
      ? `${name}, that was a great swing. ${caddieName} loved your tempo.`
      : `Nice try, ${name}. Let's keep working — every swing is getting better.`;
  }
  if (band === 'teen') {
    return overall >= 70
      ? `${name} — solid swing. ${caddieName} liked the tempo and balance.`
      : `${name} — good rep. Focus on staying balanced through finish next time.`;
  }
  return `${caddieName} here — solid swing review for ${name}.`;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

function cleanStringList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.trim());
}

function trimString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function clamp(v: unknown, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function newSwingId(memberId: string): string {
  return 'jswing_' + memberId + '_' + Date.now().toString(36);
}
