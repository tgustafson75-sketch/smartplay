/**
 * 2026-10-31 (Brain recheck r21, BRAIN-R21-3) — ONE WRITER FOR A "SAVE THAT" HERO MOMENT, ON EVERY ROUTE.
 *
 * Only the caddie tab's mic wrote a hero moment (useVoiceCaddie.checkBypasses). The earbud, the typed box and the watch
 * had no intercept, so "save that" went to the brain, whose prompt tells it to answer "Got it. That's yours." — the
 * caller heard a saved moment and the hero reel got nothing. Both routes now call this, with the same whole-utterance
 * test the tab mic uses (tabBypassKind), so a routine or a question is never filed as a moment.
 */
import { useRelationshipStore } from '../store/relationshipStore';
import { tabBypassKind } from './tabVoiceBypass';

export interface HeroSpot {
  hole: number;
  club: string;
  courseName: string;
}

/** Writes the moment and returns the line the store says back ("Got it. That's yours."). */
export function saveHeroMoment(spot: HeroSpot): string {
  return useRelationshipStore.getState().addHeroMoment({
    clipUri: null,
    hole: spot.hole,
    club: spot.club,
    courseName: spot.courseName,
    conditions: '',
    carlosNote: null,
  });
}

/** The utterance is a hero save: write it and return the line to say. Anything else returns null, untouched. */
export function heroSaveIfAsked(utterance: string, spot: HeroSpot & { isRoundActive: boolean; language: string }): string | null {
  if (tabBypassKind(utterance, { isRoundActive: spot.isRoundActive, language: spot.language }) !== 'hero') return null;
  return saveHeroMoment(spot);
}
