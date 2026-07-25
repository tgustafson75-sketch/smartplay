/**
 * 2026-07-25 (deep audit S2 — root cause) — SINGLE source of truth for the "grow-mostly" backup keys.
 *
 * These are learned/earned/calibrated persist stores that only accumulate over a player's history —
 * an emptier or second device must NEVER clobber the cloud's richer copy last-write-wins. Both the
 * CLIENT direct-cloud path (services/cloudSync/snapshot.ts: applySnapshot restore + unionSnapshots
 * upload) and the SERVER-mediated path (api/backup.ts merge) apply the same near-empty guard.
 *
 * Previously each side kept its OWN hand-maintained copy of this list, and they DRIFTED —
 * coach-lesson-history-v1 + practice-plan-v1 were protected server-side but not client-side, and
 * five earned/calibrated stores were guarded on neither, so restores/unions clobbered them. This
 * module removes the drift class entirely: one array, imported by both. The file has ZERO runtime
 * dependencies (no react-native, no server SDKs) so it is safe to import from both the RN client and
 * the Vercel serverless function.
 *
 * The guard only overrides when the incoming blob is NEAR-EMPTY relative to the existing one
 * (length < 60%), so adding a key here protects a fresh/second device from clobbering it WITHOUT
 * blocking a legitimate edit/re-calibration of similar size.
 *
 * Every key here MUST also be in snapshot.ts BACKED_UP_STORE_KEYS (a store that isn't backed up
 * can't be clobbered). Keep this list a subset of that allowlist.
 */
export const GROW_MOSTLY_KEYS: readonly string[] = [
  // Core learned CNS / bag / profile / rounds-adjacent
  'caddie-memory-v1', 'club-stats-v1', 'club-bag-v1', 'player-profile-v2',
  // Practice / points / progression
  'practice-points', 'points-store-v1', 'points-baseline', 'workout-store-v1',
  'practice-session-v1', 'practice-store',
  // Social / relationships / team
  'family-store-v1', 'guest-profiles-v1', 'relationship-store-v1', 'team-intelligence-store-v1',
  // Authored / coaching knowledge
  'coach-knowledge-v1', 'coach-lesson-history-v1', 'practice-plan-v1', 'vocabulary-profile-v1',
  // Courses / captures / goals
  'custom-courses-v1', 'course-captures-v1', 'tee-goals-v1', 'tournament-v1',
  // Green reads / finder / watch
  'green-rolls-v1', 'smartfinder-store-v1', 'watch-store-v1',
  // Earned trust + calibrations
  'trust-level-store-v1', 'acoustic-calibration-v1', 'cage-overlay-calibration-v1',
];
