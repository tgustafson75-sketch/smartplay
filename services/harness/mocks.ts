/**
 * Scenario harness — state seeders.
 *
 * Push synthetic state into the same Zustand stores the production app
 * uses. Each seeder returns a teardown function so a scenario can
 * cleanly restore state. Snapshots persist via the store's own persist
 * middleware in real-life use; harness teardown brings the in-memory
 * state back to the pre-test snapshot only — persisted bytes are not
 * touched (that's why the harness IS owner-gated; an end user shouldn't
 * see random "test" shots in their library if a teardown drops).
 *
 * 2026-05-24 — Built per the harness expansion sketch.
 */

import { useCageStore, type PrimaryIssue } from '../../store/cageStore';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePracticeStore } from '../../store/practiceStore';
import {
  setCourseTruth,
  hydrateCourseTruthCache,
  type LatLng,
} from '../courseTruth';

export type Teardown = () => void | Promise<void>;

// ─── Cage session + shots ───────────────────────────────────────────

/**
 * Start a synthetic cage session and add a shot with a known id.
 * Returns the shotId + a teardown that ends the session.
 */
export function seedCageSession(opts: {
  club?: string;
  shot?: Partial<{ feel: string; shape: string; contact: string; direction: string; clipUri: string }>;
}): { sessionId: string; shotId: string; teardown: Teardown } {
  const store = useCageStore.getState();
  store.startSession(opts.club ?? 'driver');
  const sessionId = useCageStore.getState().activeSession?.id ?? '';
  store.addShot({
    club: opts.club ?? 'driver',
    feel: opts.shot?.feel ?? null,
    shape: opts.shot?.shape ?? null,
    contact: opts.shot?.contact ?? null,
    direction: opts.shot?.direction ?? null,
    clipUri: opts.shot?.clipUri ?? null,
    acousticContact: null,
    aiAnalysis: null,
  });
  const shotId = useCageStore.getState().activeSession?.shots[0]?.id ?? '';
  return {
    sessionId,
    shotId,
    teardown: () => {
      // Closing the session keeps the harness from leaving an open
      // session that persists across app launches via the live cage
      // hooks. The end-of-session reducer accepts an empty summary.
      try {
        useCageStore.getState().endSession({ dominantMiss: null, rootCause: null, summary: null });
      } catch { /* tolerate teardown noise */ }
    },
  };
}

/**
 * Build a session-level PrimaryIssue with the GolfFix structured fields
 * (primary_fault + cause/fix/drill/evidence). Returns the issue object;
 * caller injects via setSessionAnalysis.
 */
export function buildPrimaryIssue(opts: {
  primary_fault: NonNullable<PrimaryIssue['primary_fault']>;
  cause?: string;
  fix?: string;
  drill?: string;
  evidence?: string;
  shotIds?: string[];
}): PrimaryIssue {
  return {
    issue_id: `harness_${opts.primary_fault}`,
    name: opts.primary_fault.replace(/_/g, ' '),
    category: 'swing_path',
    severity: 'moderate',
    occurrence_count: opts.shotIds?.length ?? 1,
    visual_reference_path: null,
    mechanical_breakdown: 'Harness-injected primary issue for scenario verification.',
    feel_cue: 'Harness-injected feel cue.',
    detected_in_shots: opts.shotIds ?? [],
    confidence: 'high',
    primary_fault: opts.primary_fault,
    cause: opts.cause,
    fix: opts.fix,
    drill: opts.drill,
    evidence: opts.evidence,
  };
}

/** Apply a per-shot Phase K analysis payload to a seeded shot. */
export function injectPerShotAnalysis(
  sessionId: string,
  shotId: string,
  analysis: {
    detected_issue: string;
    severity: 'minor' | 'moderate' | 'significant' | 'none';
    confidence: 'high' | 'medium' | 'low';
    observation: string;
    fault_frame_index?: number;
    visual_reference_path?: string | null;
  },
): void {
  useCageStore.getState().setShotAnalysis(sessionId, shotId, analysis);
}

/** Apply a session-level PrimaryIssue (GolfFix structured payload). */
export function injectSessionAnalysis(sessionId: string, issue: PrimaryIssue | null): void {
  useCageStore.getState().setSessionAnalysis(sessionId, issue, null);
}

// ─── Course truth + round state ─────────────────────────────────────

/**
 * Seed surveyed ground-truth green coords for a course+hole. Re-hydrates
 * the in-memory cache so the same-call resolveGreenCoords lookup hits.
 */
export async function seedCourseTruth(courseId: string, hole: number, coord: LatLng): Promise<Teardown> {
  await setCourseTruth(courseId, hole, coord);
  await hydrateCourseTruthCache();
  return () => {
    // No teardown of AsyncStorage — leaving the truth in place is
    // harmless on subsequent runs and avoids racing the persist write.
    // Tests that need a clean slate should rotate the courseId.
  };
}

/**
 * Stamp an activeCourseId + currentHole into roundStore so handlers
 * that read `useRoundStore.getState()` see the test fixture.
 */
export function seedActiveCourse(courseId: string, hole: number): Teardown {
  const before = useRoundStore.getState();
  useRoundStore.setState({
    activeCourseId: courseId,
    currentHole: hole,
  });
  return () => {
    useRoundStore.setState({
      activeCourseId: before.activeCourseId,
      currentHole: before.currentHole,
    });
  };
}

/**
 * Force currentLocationType (and optionally currentTeeBox) without
 * triggering the GPS geofence path. Used by Tank tee-shot scenarios.
 */
export function seedLocationType(
  locType: 'tee' | 'fairway' | 'green' | 'unknown',
  teeBox?: { hole: number; lat: number; lng: number },
): Teardown {
  const before = {
    currentLocationType: useRoundStore.getState().currentLocationType,
    currentTeeBox: useRoundStore.getState().currentTeeBox,
  };
  useRoundStore.setState({
    currentLocationType: locType,
    ...(teeBox ? { currentTeeBox: teeBox } : {}),
  });
  return () => {
    useRoundStore.setState(before);
  };
}

// ─── Settings: language + tutorials ─────────────────────────────────

/**
 * Switch the i18n language (calls i18n.changeLanguage via setLanguage).
 * Returns a teardown that restores the previous language.
 */
export function seedLanguage(lang: 'en' | 'es' | 'zh'): Teardown {
  const before = useSettingsStore.getState().language;
  useSettingsStore.getState().setLanguage(lang);
  return () => {
    if (before !== lang) useSettingsStore.getState().setLanguage(before);
  };
}

/** Mark a tutorial as seen. */
export function seedTutorialSeen(key: string): Teardown {
  const before = useSettingsStore.getState().tutorialsSeen;
  useSettingsStore.getState().markTutorialSeen(key);
  return () => {
    useSettingsStore.setState({ tutorialsSeen: before });
  };
}

// ─── Practice stats ─────────────────────────────────────────────────

/**
 * Feed N mock swings through updateFromSwing with the same detected
 * issue + severity. Used to drive overTheTopCount / typicalMiss
 * accumulation in scenario #9.
 */
export function feedPracticeSwings(count: number, payload: {
  detected_issue?: string;
  severity?: 'minor' | 'moderate' | 'significant' | 'none';
  observation?: string;
  club?: string;
  carry_distance?: number;
  face_to_path?: number;
}): Teardown {
  const beforeState = usePracticeStore.getState();
  const beforeSnapshot = {
    swingCount: beforeState.swingCount,
    overTheTopCount: beforeState.overTheTopCount,
    fatShotCount: beforeState.fatShotCount,
    avgCarryDriver: beforeState.avgCarryDriver,
    avgCarry3Wood: beforeState.avgCarry3Wood,
    typicalMiss: beforeState.typicalMiss,
    lastSessionDate: beforeState.lastSessionDate,
  };
  for (let i = 0; i < count; i++) {
    usePracticeStore.getState().updateFromSwing(payload);
  }
  return () => {
    usePracticeStore.setState(beforeSnapshot);
  };
}

/** Reset practiceStore to its initial defaults. */
export function resetPracticeStats(): Teardown {
  const before = usePracticeStore.getState();
  const snapshot = {
    swingCount: before.swingCount,
    overTheTopCount: before.overTheTopCount,
    fatShotCount: before.fatShotCount,
    avgCarryDriver: before.avgCarryDriver,
    avgCarry3Wood: before.avgCarry3Wood,
    typicalMiss: before.typicalMiss,
    lastSessionDate: before.lastSessionDate,
  };
  usePracticeStore.getState().reset();
  return () => {
    usePracticeStore.setState(snapshot);
  };
}
