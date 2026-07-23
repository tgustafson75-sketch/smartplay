/**
 * 2026-07-01 (whole-app audit — mic convergence) — the SINGLE source of truth for the pipecat
 * brain's context, extracted from usePipecatVoice so BOTH the caddie-tab mic (the hook) AND the
 * universal badge / earbud / hands-free path (services/listeningSession via conversationalBrain)
 * build the exact same rich context. This is what makes every mic reach ONE unified, fully-informed
 * brain. Pure — reads stores via getState(); no React, safe to call from a service.
 */

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
import { brainSettings } from './voice/brainSettings';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useTrustLevelStore } from '../store/trustLevelStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { getLastFix } from './gpsManager';
import { bagDistances } from './shotStrategy';
import { getGreenYardagesSync } from './smartFinderService';
import { getCaddieContext } from './caddieMemoryRetrieval';

export function buildPipecatContext() {
  const round = useRoundStore.getState();
  const settings = useSettingsStore.getState();
  const profile = usePlayerProfileStore.getState();
  const trustLevel = useTrustLevelStore.getState().level;
  const relationship = useRelationshipStore.getState();

  return {
    player: {
      name: profile.name ?? 'golfer',
      handicap: profile.handicap ?? undefined,
      dominantMiss: profile.dominantMiss ?? undefined,
      // 2026-07-04 (clean-audit) — so the server prompt can speak AS the user's
      // custom caddie by its real name instead of defaulting to "Kevin".
      customCaddieName: profile.customCaddieName ?? undefined,
      caddiePersonality: settings.caddiePersonality,
      trustLevel,
    },
    round: {
      active: round.isRoundActive,
      currentHole: round.currentHole ?? undefined,
      courseId: round.activeCourseId ?? undefined,
      courseName: round.activeCourse ?? undefined,
      mentalState: relationship.currentMentalState ?? round.mentalState ?? undefined,
      consecutiveBadHoles: relationship.consecutiveBadHoles ?? 0,
      isSpiralRisk: (() => { try { return relationship.isSpiralRisk(); } catch { return false; } })(),
      emotionalLog: (() => { try { return (round.emotionalLog ?? []).slice(-5).map((e) => ({ state: e.state, valence: e.valence, hole: e.hole })); } catch { return []; } })(),
      goal: round.goal ?? undefined,
      holePar: round.courseHoles.find((h) => h.hole === round.currentHole)?.par ?? undefined,
      holeYardage: round.courseHoles.find((h) => h.hole === round.currentHole)?.distance ?? undefined,
      yardage: (() => {
        try {
          const y = getGreenYardagesSync(round.currentHole);
          return y.middle != null ? { front: y.front, middle: y.middle, back: y.back } : undefined;
        } catch { return undefined; }
      })(),
      // 2026-07-08 (Tim — Green Hill: "why won't it tell me the yardage") — when we have
      // no live green distance AND no GPS fix at all, flag it so the caddie SAYS it's
      // reacquiring GPS rather than asking the golfer for the number (the backwards ask).
      gpsLost: (() => {
        try {
          const y = getGreenYardagesSync(round.currentHole);
          return y.middle == null && getLastFix() == null;
        } catch { return false; }
      })(),
      score: (() => {
        const scores = round.scores ?? {};
        const holesPlayed = Object.values(scores).filter((v) => typeof v === 'number' && v > 0).length;
        if (holesPlayed === 0) return undefined;
        const total = Object.values(scores).reduce((s: number, v) => s + (typeof v === 'number' ? v : 0), 0);
        const parPlayed = Object.keys(scores).reduce((s, k) => {
          const h = round.courseHoles.find((x) => x.hole === Number(k));
          return s + (h?.par ?? 0);
        }, 0);
        return { total, holesPlayed, vsPar: parPlayed ? total - parPlayed : undefined };
      })(),
      mode: round.mode ?? undefined,
      // 2026-07-05 — sim awareness: the brain nudges for yardages so the sim moves.
      simRound: round.isSimRound || undefined,
      isCompetition: round.isCompetition ?? undefined,
      holeNote: (round.holeNotes ?? {})[round.currentHole] ?? undefined,
      recentShots: (round.shots ?? []).slice(-5).map((s) => ({
        club: s.club ?? null, hole: s.hole ?? null, distance: s.distance_yards ?? null, outcome: s.outcome_text ?? null,
      })),
    },
    bag: {
      club_distances: bagDistances() as Record<string, number>,
      registered_clubs: (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return (require('../store/clubBagStore').useClubBagStore.getState().bagList() as { club_id: string }[]).map((c) => c.club_id);
        } catch { return []; }
      })(),
    },
    // Every brain-bound setting flows through the pure brainSettings() map (tested). trustLevel is
    // computed from its own store so it stays separate.
    settings: {
      trustLevel,
      ...brainSettings(settings),
    },
    gps: {
      lat: getLastFix()?.lat ?? undefined,
      lng: getLastFix()?.lng ?? undefined,
    },
    memory: (() => {
      try {
        const base = getCaddieContext({
          courseId: round.activeCourseId ?? undefined,
          hole: round.currentHole ?? undefined,
          club: round.club ?? undefined,
        }).promptBlock;
        // 2026-07-04 (Tim — offline log "ingested later") — fold in anything the player
        // said while offline this round so the caddie acknowledges + uses it once signal
        // is back. Peek only (stays pending until round end); best-effort.
        let offline = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          offline = require('./voiceLogService').peekOfflineNotesBlock() as string;
        } catch { /* voice-log is additive */ }
        // 2026-07-04 (Tim — "SmartPlan should guide the week in terms of Caddie guidance")
        // — fold in the persisted weekly plan + the player's goals/challenges narrative so
        // the caddie steers coaching toward them all week.
        let plan = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          plan = require('../store/practicePlanStore').practicePlanPromptBlock() as string;
        } catch { /* plan block is additive */ }
        // 2026-07-04 (Tim — comprehensive coverage) — recent rounds + courses played +
        // practice focus, so the caddie can converse about history from real data.
        let history = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          history = require('./caddieHistoryContext').historyPromptBlock() as string;
        } catch { /* history block is additive */ }
        return [base, plan, history, offline].filter((b) => b && b.trim()).join('\n\n');
      } catch { return ''; }
    })(),
  };
}
