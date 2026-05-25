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
  let sessionId = '';
  let shotId = '';
  try {
    const store = useCageStore.getState();
    store.startSession(opts.club ?? 'driver');
    sessionId = useCageStore.getState().activeSession?.id ?? '';
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
    shotId = useCageStore.getState().activeSession?.shots[0]?.id ?? '';
  } catch (e) {
    console.log('[harness mocks] seedCageSession failed:', e);
  }
  return {
    sessionId,
    shotId,
    teardown: () => {
      // Direct activeSession clear — bypasses endSession's heavier
      // sessionHistory write to keep teardown infallible. End-user
      // session tracking is a separate concern; we never want a
      // harness teardown to push fake state into the user's library.
      try {
        useCageStore.setState({ activeSession: null });
      } catch (e) {
        console.log('[harness mocks] seedCageSession teardown noise:', e);
      }
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
 * Avoids flipping isRoundActive — that fires global subscribers
 * (startHoleDetection / movement / off-course / media-session) and
 * isn't safe to toggle from a synthetic harness.
 */
export function seedActiveCourse(courseId: string, hole: number): Teardown {
  let before: { activeCourseId: string | null; currentHole: number } = { activeCourseId: null, currentHole: 1 };
  try {
    const s = useRoundStore.getState();
    before = { activeCourseId: s.activeCourseId, currentHole: s.currentHole };
    useRoundStore.setState({ activeCourseId: courseId, currentHole: hole });
  } catch (e) {
    console.log('[harness mocks] seedActiveCourse failed:', e);
  }
  return () => {
    try {
      useRoundStore.setState({ activeCourseId: before.activeCourseId, currentHole: before.currentHole });
    } catch (e) {
      console.log('[harness mocks] seedActiveCourse teardown noise:', e);
    }
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
  let before: {
    currentLocationType: 'tee' | 'fairway' | 'green' | 'unknown';
    currentTeeBox: { hole: number; lat: number; lng: number } | null;
  } = { currentLocationType: 'unknown', currentTeeBox: null };
  try {
    const s = useRoundStore.getState();
    before = { currentLocationType: s.currentLocationType, currentTeeBox: s.currentTeeBox };
    useRoundStore.setState({ currentLocationType: locType, ...(teeBox ? { currentTeeBox: teeBox } : {}) });
  } catch (e) {
    console.log('[harness mocks] seedLocationType failed:', e);
  }
  return () => {
    try { useRoundStore.setState(before); } catch (e) { console.log('[harness mocks] seedLocationType teardown noise:', e); }
  };
}

// ─── Settings: language + tutorials ─────────────────────────────────

/**
 * Switch the i18n language (calls i18n.changeLanguage via setLanguage).
 * Returns a teardown that restores the previous language.
 */
export function seedLanguage(lang: 'en' | 'es' | 'zh'): Teardown {
  let before: 'en' | 'es' | 'zh' = 'en';
  try {
    before = useSettingsStore.getState().language;
    useSettingsStore.getState().setLanguage(lang);
  } catch (e) {
    console.log('[harness mocks] seedLanguage failed:', e);
  }
  return () => {
    try { if (before !== lang) useSettingsStore.getState().setLanguage(before); } catch (e) {
      console.log('[harness mocks] seedLanguage teardown noise:', e);
    }
  };
}

/** Mark a tutorial as seen. */
export function seedTutorialSeen(key: string): Teardown {
  let before: Record<string, boolean> = {};
  try {
    before = useSettingsStore.getState().tutorialsSeen;
    useSettingsStore.getState().markTutorialSeen(key);
  } catch (e) {
    console.log('[harness mocks] seedTutorialSeen failed:', e);
  }
  return () => {
    try { useSettingsStore.setState({ tutorialsSeen: before }); } catch (e) {
      console.log('[harness mocks] seedTutorialSeen teardown noise:', e);
    }
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
  let snapshot: Partial<ReturnType<typeof usePracticeStore.getState>> = {};
  try {
    const beforeState = usePracticeStore.getState();
    snapshot = {
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
  } catch (e) {
    console.log('[harness mocks] feedPracticeSwings failed:', e);
  }
  return () => {
    try { usePracticeStore.setState(snapshot); } catch (e) {
      console.log('[harness mocks] feedPracticeSwings teardown noise:', e);
    }
  };
}

/** Reset practiceStore to its initial defaults. */
export function resetPracticeStats(): Teardown {
  let snapshot: Partial<ReturnType<typeof usePracticeStore.getState>> = {};
  try {
    const before = usePracticeStore.getState();
    snapshot = {
      swingCount: before.swingCount,
      overTheTopCount: before.overTheTopCount,
      fatShotCount: before.fatShotCount,
      avgCarryDriver: before.avgCarryDriver,
      avgCarry3Wood: before.avgCarry3Wood,
      typicalMiss: before.typicalMiss,
      lastSessionDate: before.lastSessionDate,
    };
    usePracticeStore.getState().reset();
  } catch (e) {
    console.log('[harness mocks] resetPracticeStats failed:', e);
  }
  return () => {
    try { usePracticeStore.setState(snapshot); } catch (e) {
      console.log('[harness mocks] resetPracticeStats teardown noise:', e);
    }
  };
}
