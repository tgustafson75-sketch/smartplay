/**
 * 2026-06-29 (Tim) — one-time Swing Library data repair, run once at boot.
 *
 *  1. "it" → "Me": an accidental familyStore member named "it" got swings
 *     attributed to it; those are the owner's own swings. Reassign them to the
 *     account holder and archive the bogus member so the "it" chip disappears.
 *  2. Practice-points BACKFILL: plain SmartMotion practice didn't award points
 *     until the gate fix today, so tonight's saved sessions earned nothing. Award
 *     them now (recent sessions only, so the practice graph isn't mis-dated), each
 *     marked `creditedPractice` so this can never double-count.
 *
 * Guarded by an AsyncStorage flag → runs exactly once. Never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCageStore } from '../store/cageStore';
import { useFamilyStore } from '../store/familyStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { usePracticePointsStore } from '../store/practicePointsStore';
import { usePracticeSessionStore } from '../store/practiceSessionStore';

const FLAG = 'lib_data_migration_v1';
const BACKFILL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // recent only (covers tonight)

export async function runLibraryDataMigration(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(FLAG)) === '1') return;

    const fam = useFamilyStore.getState();
    const profile = usePlayerProfileStore.getState();
    const accountHolderId = profile.email && profile.email.trim()
      ? profile.email.trim().toLowerCase()
      : 'account_holder';

    // 1) "it" → the owner.
    const itMember = fam.members.find((m) => (m.firstName ?? '').trim().toLowerCase() === 'it');
    if (itMember) {
      const cage = useCageStore.getState();
      for (const s of cage.sessionHistory) {
        if (s.player_id === itMember.id) cage.setSessionPlayer(s.id, accountHolderId);
      }
      try { fam.archiveMember(itMember.id); } catch { /* non-fatal */ }
      console.log('[libMigration] reassigned "it" swings to the owner + archived the bogus member');
    }

    // 2) Backfill practice credit for recent un-credited recorded sessions.
    const now = Date.now();
    let credited = 0;
    for (const s of useCageStore.getState().sessionHistory) {
      if (s.creditedPractice) continue;
      if (s.source === 'uploaded_video') continue;           // uploads aren't practice
      if (typeof s.date === 'number' && now - s.date > BACKFILL_WINDOW_MS) continue;
      const swings = Math.max(1, s.shots?.length ?? 1);
      const clubKey = String(s.currentClub ?? s.club ?? 'Practice');
      usePracticePointsStore.getState().awardPracticePoints({
        key: `smartmotion:${clubKey}`, label: clubKey, swings, now: s.date ?? now,
      });
      usePracticeSessionStore.getState().recordCompletedSession({
        kind: 'open_range', focus: clubKey, label: clubKey, swingCount: swings,
      });
      useCageStore.getState().setSessionCreditedPractice(s.id, true);
      credited++;
    }
    if (credited > 0) console.log(`[libMigration] backfilled practice credit for ${credited} session(s)`);

    await AsyncStorage.setItem(FLAG, '1');
  } catch (e) {
    console.log('[libMigration] non-fatal:', e);
  }
}
