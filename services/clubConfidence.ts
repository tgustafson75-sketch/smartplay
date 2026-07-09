/**
 * 2026-07-09 — Real per-club confidence, from cage/SmartMotion CONTACT quality.
 *
 * ROOT-CAUSE FIX: the cage setup screen shows "Kevin rates your <club> at X% confidence"
 * (relationshipStore.confidenceByClub), but updateClubConfidence had NO caller, so the badge
 * never rendered. This computes an HONEST confidence — the clean-strike rate over the
 * player's recent rated swings with that club (perShotAnalysis.contact_read) — and writes it.
 * No fabrication: with < MIN_RATED real rated swings we leave it unset (badge stays hidden).
 */

const MIN_RATED = 3;   // need at least this many rated swings before we show a %
const WINDOW = 24;     // consider the most recent N rated swings for this club

export function updateClubConfidenceFromCage(club: string | null | undefined): void {
  if (!club || club === 'unknown') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cage = require('../store/cageStore') as typeof import('../store/cageStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rel = require('../store/relationshipStore') as typeof import('../store/relationshipStore');

    const sessions = cage.useCageStore.getState().sessionHistory;
    const contacts: string[] = [];
    for (let i = sessions.length - 1; i >= 0 && contacts.length < WINDOW; i--) {
      const s = sessions[i];
      if (s.club !== club) continue;
      for (const shot of s.shots) {
        const c = shot.perShotAnalysis?.contact_read;
        if (c && c !== 'unknown') contacts.push(c); // 'clean' | 'fat' | 'thin' | 'topped'
      }
    }
    if (contacts.length < MIN_RATED) return; // not enough real data — honest: leave unset
    const clean = contacts.filter((c) => c === 'clean').length;
    rel.useRelationshipStore.getState().updateClubConfidence(club, clean / contacts.length);
  } catch (e) {
    console.log('[clubConfidence] recompute failed:', e);
  }
}
