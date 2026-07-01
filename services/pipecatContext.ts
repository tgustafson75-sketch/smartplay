/**
 * 2026-07-01 (whole-app audit — mic convergence) — the SINGLE source of truth for the pipecat
 * brain's context, extracted from usePipecatVoice so BOTH the caddie-tab mic (the hook) AND the
 * universal badge / earbud / hands-free path (services/listeningSession via conversationalBrain)
 * build the exact same rich context. This is what makes every mic reach ONE unified, fully-informed
 * brain. Pure — reads stores via getState(); no React, safe to call from a service.
 */

import { useRoundStore } from '../store/roundStore';
import { useSettingsStore } from '../store/settingsStore';
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
    settings: {
      trustLevel,
      language: settings.language ?? 'en',
      aiProvider: 'anthropic',
      continuousConversationMode: settings.continuousConversationMode ?? false,
    },
    gps: {
      lat: getLastFix()?.lat ?? undefined,
      lng: getLastFix()?.lng ?? undefined,
    },
    memory: (() => {
      try {
        return getCaddieContext({
          courseId: round.activeCourseId ?? undefined,
          hole: round.currentHole ?? undefined,
          club: round.club ?? undefined,
        }).promptBlock;
      } catch { return ''; }
    })(),
  };
}
