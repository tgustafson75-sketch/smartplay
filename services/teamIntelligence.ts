/**
 * Phase 106 — Team Intelligence (trigger detection + suggestion building).
 *
 * Inputs (read-only, never mutated):
 *   - cageStore (recent session history, per-shot detection counts)
 *   - roundStore (current round shots, score-vs-par accumulation)
 *   - relationshipStore (rounds together, observations)
 *   - settingsStore (caddieAssignments, caddieSuggestions suppression)
 *
 * Output: a CaddieSuggestion offered into useTeamIntelligenceStore via
 * offerSuggestion(). The store enforces the per-session cap and the
 * pending-suggestion guard.
 *
 * Design discipline:
 *   - Detection is conservative. False positives erode user trust faster
 *     than missed opportunities. When in doubt, don't fire.
 *   - Each trigger has a single, named threshold tunable in
 *     TRIGGER_THRESHOLDS (teamIntelligenceStore.ts). Any "fudge factor"
 *     here lives behind a named const, not as a magic number inline.
 *   - Detection runs at clear boundary moments (cage session end,
 *     round end, drill complete) — never per-shot or per-tick. The
 *     wiring layer decides when to call the detection functions.
 */

import type { Persona, CaddiePillar } from '../store/settingsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCageStore } from '../store/cageStore';
import { useRoundStore } from '../store/roundStore';
import {
  useTeamIntelligenceStore,
  TRIGGER_THRESHOLDS,
  type SuggestionTrigger,
  type CaddieSuggestion,
} from '../store/teamIntelligenceStore';
import { getActiveCaddieForPillar } from './caddieResolver';

// Conservative trigger thresholds for detection. Each is a separately
// tunable constant; do not inline magic numbers in the detector bodies.
const DETECTION_THRESHOLDS = {
  // Drill plateau: N consecutive sessions on the same drill with no
  // measurable improvement. 3 is conservative (2 might be noise).
  drillPlateauSessionCount: 3,
  // Cage frustration: N consecutive shots flagged 'rejected' or with
  // low quality markers within the same session. 4 keeps random bad
  // strikes from triggering.
  cageFrustrationConsecutiveBadShots: 4,
  // Mental struggle: cumulative score-vs-par delta within recent N holes.
  // +5 over 4 holes is a real spiral; +3 over 8 holes is just a tough day.
  mentalStruggleHolesWindow: 4,
  mentalStruggleScoreDeltaOverPar: 5,
} as const;

// Build a suggestion in the active caddie's voice. The reason text is
// conservative and respectful — never disparages the active caddie.
function buildSuggestion(
  trigger: SuggestionTrigger,
  fromPersona: Persona,
  toPersona: Persona,
  pillar: CaddiePillar,
): CaddieSuggestion {
  const reasonByTrigger: Record<SuggestionTrigger, string> = {
    drill_plateau: `You've been steady on this drill but the consistency hasn't clicked. ${nameOf(toPersona)}'s approach has unlocked this for players in your spot. Want to try?`,
    cage_frustration: `Reps are getting tight. Take a beat with ${nameOf(toPersona)} to reset, then come back to the work.`,
    mental_struggle: `This stretch is grinding on you. ${nameOf(toPersona)} handles this kind of moment differently than I do. Want to bring ${objectOf(toPersona)} in for a few holes?`,
    tactical_to_mental: `You sound like you need the headspace, not the play. ${nameOf(toPersona)}'s the one for that. Switch?`,
    user_explicit_stuck: `You said you're stuck — ${nameOf(toPersona)} might see this from a different angle. Want to try?`,
  };

  return {
    id: `${Date.now()}_${trigger}_${fromPersona}_${toPersona}`,
    fromPersona,
    toPersona,
    trigger,
    reason: reasonByTrigger[trigger],
    pillar,
    createdAt: Date.now(),
  };
}

function nameOf(p: Persona): string {
  return p === 'kevin' ? 'Kevin' : p === 'serena' ? 'Serena' : p === 'harry' ? 'Harry' : 'Tank';
}
function objectOf(p: Persona): string {
  return p === 'serena' ? 'her' : 'him';
}

// Decide which teammate fits the trigger. Conservative routing — each
// trigger has one clear best fit; ties broken by Tim's product vision.
function pickTeammateForTrigger(trigger: SuggestionTrigger, currentPersona: Persona): Persona {
  switch (trigger) {
    case 'drill_plateau':
      // Plateau on technique → Tank's intensity / speed-drill push.
      return currentPersona === 'tank' ? 'serena' : 'tank';
    case 'cage_frustration':
      // Frustration in cage → Harry's calm reset.
      return currentPersona === 'harry' ? 'kevin' : 'harry';
    case 'mental_struggle':
      // On-course mental spiral → Harry's partnership counsel.
      return currentPersona === 'harry' ? 'kevin' : 'harry';
    case 'tactical_to_mental':
      // Coach voice when player needs Psychologist → Harry.
      return currentPersona === 'harry' ? 'kevin' : 'harry';
    case 'user_explicit_stuck':
      // User asked for help → suggest the natural alternate for the
      // current pillar.
      return currentPersona === 'kevin' ? 'harry'
           : currentPersona === 'tank'  ? 'serena'
           : currentPersona === 'serena' ? 'tank'
           : 'kevin';
  }
}

// Common preflight before any trigger fires: suppression off, not throttled,
// not at session cap, no pending suggestion already.
function canOffer(trigger: SuggestionTrigger): boolean {
  const settings = useSettingsStore.getState();
  if (settings.caddieSuggestions === 'off') return false;
  const intel = useTeamIntelligenceStore.getState();
  if (intel.pendingSuggestion) return false;
  if (intel.suggestionsThisSession >= TRIGGER_THRESHOLDS.maxSuggestionsPerSession) return false;
  if (intel.isThrottled(trigger)) return false;
  return true;
}

function offer(trigger: SuggestionTrigger, fromPersona: Persona, pillar: CaddiePillar): void {
  const toPersona = pickTeammateForTrigger(trigger, fromPersona);
  if (toPersona === fromPersona) return;
  const s = buildSuggestion(trigger, fromPersona, toPersona, pillar);
  useTeamIntelligenceStore.getState().offerSuggestion(s);
}

// ─── Trigger detectors ────────────────────────────────────────────────────────

// Called at end of a cage session. Reads recent session history; if the
// player has been working the same drill for N sessions without
// improvement, suggest the alternate caddie for technique-fix variation.
export function evaluateCageEnd(): void {
  if (!canOffer('drill_plateau')) return;
  const cage = useCageStore.getState();
  // Read the last N sessions. If every recent session's most-frequent
  // detected swing issue is the same, that's a plateau signal — the
  // player keeps hitting the same fault despite practice. Time to vary
  // the teaching approach (current caddie → other caddie's drill style).
  const recent = cage.sessionHistory ? cage.sessionHistory.slice(-DETECTION_THRESHOLDS.drillPlateauSessionCount) : [];
  if (recent.length < DETECTION_THRESHOLDS.drillPlateauSessionCount) return;
  // Per-session dominant issue: most-frequent detected_issue across that
  // session's per-shot Phase K analyses. Sessions without any per-shot
  // analysis are skipped (insufficient signal).
  const dominantIssues: string[] = [];
  for (const session of recent) {
    const issues = (session.shots ?? [])
      .map((s) => s.perShotAnalysis?.detected_issue)
      .filter((i): i is string => typeof i === 'string' && i.length > 0);
    if (issues.length === 0) return; // not enough signal anywhere — bail
    const counts = new Map<string, number>();
    for (const i of issues) counts.set(i, (counts.get(i) ?? 0) + 1);
    let best = ''; let bestN = 0;
    for (const [k, v] of counts.entries()) { if (v > bestN) { best = k; bestN = v; } }
    dominantIssues.push(best);
  }
  if (dominantIssues.length !== DETECTION_THRESHOLDS.drillPlateauSessionCount) return;
  const allSame = dominantIssues.every((l) => l === dominantIssues[0]);
  if (!allSame) return;
  const cagePersona = getActiveCaddieForPillar('cage');
  offer('drill_plateau', cagePersona, 'cage');
}

// Called per cage shot OR at end-of-session. Tracks consecutive bad
// reps within the active session. Conservative: only fires after a
// streak so single bad swings don't ping a suggestion.
export function evaluateCageShotStreak(consecutiveBadShots: number): void {
  if (consecutiveBadShots < DETECTION_THRESHOLDS.cageFrustrationConsecutiveBadShots) return;
  if (!canOffer('cage_frustration')) return;
  const cagePersona = getActiveCaddieForPillar('cage');
  offer('cage_frustration', cagePersona, 'cage');
}

// Called periodically during a round (e.g. every hole-change). Reads the
// recent N holes' score vs par; cumulative +5 over 4 holes triggers a
// mental-struggle handoff suggestion.
export function evaluateRoundProgress(): void {
  if (!canOffer('mental_struggle')) return;
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return;
  const window = DETECTION_THRESHOLDS.mentalStruggleHolesWindow;
  // Need to compute score-vs-par over the most recent `window` holes.
  // roundStore.scores is Record<holeNumber, strokes>; courseHoles has
  // par per hole. Use both for the delta.
  const holes = round.courseHoles ?? [];
  const scores = round.scores ?? {};
  const playedHoles = holes
    .filter((h: { hole: number }) => typeof scores[h.hole] === 'number')
    .slice(-window);
  if (playedHoles.length < window) return;
  const delta = playedHoles.reduce((acc: number, h: { hole: number; par: number }) => {
    return acc + ((scores[h.hole] as number) - h.par);
  }, 0);
  if (delta < DETECTION_THRESHOLDS.mentalStruggleScoreDeltaOverPar) return;
  const roundPersona = getActiveCaddieForPillar('round');
  offer('mental_struggle', roundPersona, 'round');
}

// Called when the user explicitly says "I'm stuck" or "what do you think"
// (intent surfaced via voice intent parser).
export function evaluateUserExplicitStuck(currentPillar: CaddiePillar): void {
  if (!canOffer('user_explicit_stuck')) return;
  const persona = getActiveCaddieForPillar(currentPillar);
  offer('user_explicit_stuck', persona, currentPillar);
}

// Called at app boot — resets per-session counters in the intelligence
// store so a fresh launch starts clean.
export function initTeamIntelligenceForSession(): void {
  useTeamIntelligenceStore.getState().resetSessionCounters();
}
