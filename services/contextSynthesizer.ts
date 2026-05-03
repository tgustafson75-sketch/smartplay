/**
 * Phase AQ — context synthesizer client.
 *
 * Three trigger sites + one periodic pass call into /api/context-synthesis
 * (single Sonnet call). Output persists in the appropriate store and is
 * read by the kevin.ts/brain.ts system prompt builders so every Kevin
 * response has user-specific grounding without per-call latency.
 *
 * All four entry points are fire-and-forget: errors are logged, no UI
 * blocking. If the synthesis call fails, Kevin falls back to whatever
 * context already exists (the prior insight, generic reply, etc).
 */

import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useCageStore } from '../store/cageStore';
import { useRoundStore, type RoundRecord } from '../store/roundStore';

const apiUrl = (): string => process.env.EXPO_PUBLIC_API_URL ?? '';

async function callSynthesis(
  type: 'onboarding' | 'cage_session' | 'round' | 'patterns',
  payload: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl()}/api/context-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.log(`[context-synthesis] non-ok ${res.status}`);
      return null;
    }
    const data = await res.json() as { summary?: string };
    return data.summary?.trim() || null;
  } catch (e) {
    console.log('[context-synthesis] error', e);
    return null;
  }
}

/** Component 1 — synthesize onboarding profile. Call after onboarding completes. */
export async function synthesizeOnboardingProfile(): Promise<void> {
  const profile = usePlayerProfileStore.getState();
  const summary = await callSynthesis('onboarding', {
    firstName: profile.firstName,
    handicap: profile.handicap,
    goal: profile.goal,
    dominantMiss: profile.dominantMiss,
    physicalLimitation: profile.physicalLimitation,
    homeCourse: profile.homeCourse,
    personalBest: profile.personalBest,
  });
  if (summary) {
    usePlayerProfileStore.getState().setKevinContext(summary);
    console.log('[path1:onboard] kevinContext synthesized chars=' + summary.length);
  }
}

/** Component 2 — synthesize cage session insight. Call after Phase K analysis completes. */
export async function synthesizeCageInsight(args: {
  sessionId: string;
  club: string;
  shotCount: number;
  primaryIssueName: string | null;
  severity: string | null;
  drillName: string | null;
  dominantMiss: string | null;
}): Promise<void> {
  const summary = await callSynthesis('cage_session', {
    club: args.club,
    shotCount: args.shotCount,
    primaryIssue: args.primaryIssueName,
    severity: args.severity,
    drillName: args.drillName,
    dominantMiss: args.dominantMiss,
  });
  if (summary) {
    useCageStore.getState().addCageInsight(args.sessionId, args.club, summary);
    console.log('[path3:cage] insight synthesized chars=' + summary.length);
  }
}

/** Component 3 — synthesize round insight. Call after recap generation. */
export async function synthesizeRoundInsight(record: RoundRecord, patterns: string[]): Promise<void> {
  const summary = await callSynthesis('round', {
    course: record.courseName,
    score: record.totalScore,
    scoreVsPar: record.scoreVsPar,
    holesPlayed: record.holesPlayed,
    patterns,
    heroCount: 0,
    dominantMiss: null,
  });
  if (summary) {
    useRoundStore.getState().addRoundInsight(record.id, record.courseName ?? 'unknown', summary);
    console.log('[path2:round] insight synthesized chars=' + summary.length);
  }
}

/** Component 4 — periodic cross-session pattern pass. Cheap heuristic gate:
 *  re-run when there are at least 3 cage insights or 5 round insights AND
 *  it's been >= 7 days since last synthesis (or never run). */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export async function maybeSynthesizePatterns(): Promise<void> {
  const profile = usePlayerProfileStore.getState();
  const now = Date.now();
  const due = !profile.patternsSynthesizedAt || (now - profile.patternsSynthesizedAt) > SEVEN_DAYS_MS;
  if (!due) return;
  const cageInsights = useCageStore.getState().recentInsights;
  const roundInsights = useRoundStore.getState().recentInsights;
  if (cageInsights.length < 3 && roundInsights.length < 5) return;
  const summary = await callSynthesis('patterns', {
    roundCount: roundInsights.length,
    cageCount: cageInsights.length,
    windowDays: 30,
    recentRoundInsights: roundInsights.map(r => r.insight),
    recentCageInsights: cageInsights.map(c => c.insight),
  });
  if (summary) {
    usePlayerProfileStore.getState().setPersistentPatterns(summary);
    console.log('[context-synthesis] patterns synthesized chars=' + summary.length);
  }
}
