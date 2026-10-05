/**
 * 2026-10-04 (Tim: "all the upload settings like pov, dtl, club, player, etc was set correctly. Make
 * sure those are all wired correctly. no band aids") — WHO IS SWINGING IN THIS SESSION.
 *
 * The upload records the golfer (upload.swinger → session.player_id at ingest). The read and the pose
 * pass ignored it: handedness came from whichever family member was ACTIVE on the phone at analysis
 * time (services/swingerHandedness), and the read's player context (handicap, usual miss, first name)
 * was always the account holder's. A swing tagged "Matt" was read with Tim's handicap and Tim's hand;
 * a lefty's over-the-top and early-extension sides came out backwards. And the read was never sent
 * handedness at all.
 *
 * One resolver, from the SESSION, used by every analysis of a saved swing:
 *   self   → the profile (handedness, handicap, usual miss, experience, name)
 *   member → that family member (their hand, their approximate handicap, their name — not Tim's miss)
 *   guest  → the name given; handedness unknown (null → the pose geometry decides), no handicap
 */
import { derivePlayerId, OTHER_PLAYER_ID, resolveSwingerToPlayerId, type SwingSession } from '../../store/swingSessionStore';

export type SessionSwinger = {
  who: 'self' | 'member' | 'guest';
  handedness: 'left' | 'right' | null;
  firstName: string | null;
  handicap: number | null;
  dominantMiss: string | null;
  experience: string | null;
};

export function swingerForSession(session: Pick<SwingSession, 'player_id' | 'upload'> | null | undefined): SessionSwinger {
  const pid = session?.player_id ?? resolveSwingerToPlayerId((session?.upload as { swinger?: string | null } | undefined)?.swinger ?? null);
  const profile = (() => {
    try { return (require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore')).usePlayerProfileStore.getState(); }
    catch { return null; }
  })();
  if (!pid || pid === derivePlayerId()) {
    const h = profile?.handedness;
    return {
      who: 'self',
      handedness: h === 'left' || h === 'right' ? h : null,
      firstName: profile?.firstName || (profile as { name?: string } | null)?.name || null,
      handicap: typeof profile?.handicap_index === 'number' ? profile.handicap_index
        : typeof (profile as { handicap?: unknown } | null)?.handicap === 'number' ? (profile as { handicap: number }).handicap : null,
      dominantMiss: profile?.dominantMiss ?? null,
      experience: profile?.experienceContext ?? null,
    };
  }
  if (pid !== OTHER_PLAYER_ID) {
    try {
      const fam = (require('../../store/familyStore') as typeof import('../../store/familyStore')).useFamilyStore.getState();
      const m = (fam.members ?? []).find((x) => x.id === pid);
      if (m) {
        return {
          who: 'member',
          handedness: m.handedness === 'left' || m.handedness === 'right' ? m.handedness : null,
          firstName: m.firstName || null,
          handicap: typeof m.approximate_handicap === 'number' ? m.approximate_handicap : null,
          dominantMiss: null,
          experience: null,
        };
      }
    } catch { /* family store unavailable — a guest below */ }
  }
  const name = (session?.upload as { swinger?: string | null } | undefined)?.swinger ?? null;
  return { who: 'guest', handedness: null, firstName: name && name.toLowerCase() !== 'me' ? name : null, handicap: null, dominantMiss: null, experience: null };
}
