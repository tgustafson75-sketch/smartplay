/**
 * Phase 410B — Profile sync between Supabase and the local Zustand store.
 *
 * Scope (Phase 410B): name, handicap, caddie persona. Round/shot/swing
 * history is Phase 410C.
 *
 * # Strategy — last-write-wins with first-sign-in migration
 *
 * On every sign-in:
 *   1. Fetch the user's row from `profiles` (the auto-trigger guarantees
 *      a row exists at signup, so this never 404s on a new user).
 *   2. If server fields are populated, mirror them into the local store
 *      (server wins).
 *   3. If server fields are empty AND local has data, push local up
 *      (migration: existing testers whose profile lives only in
 *      AsyncStorage get carried forward on first sign-in).
 *   4. Wire a debounced subscription so future local edits trickle up
 *      to Supabase.
 *
 * This is intentionally simple. Last-write-wins is fine for profile-only
 * data because edits are infrequent and a tester editing on two devices
 * simultaneously is not a real scenario for Phase 410B. Round/shot data
 * (high-volume, multi-device-conflicting) will need a real CRDT or
 * server-authoritative model in Phase 410C.
 */

import { supabase, supabaseIsConfigured } from '../lib/supabase';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useSettingsStore, type Persona } from '../store/settingsStore';

type RemoteProfile = {
  id: string;
  first_name: string | null;
  handicap: number | null;
  caddie_persona: Persona | null;
  updated_at: string;
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubProfile: (() => void) | null = null;
let unsubSettings: (() => void) | null = null;
let activeUserId: string | null = null;

/**
 * One-shot hydrate. Called from authStore on SIGNED_IN (or app boot
 * with an existing session). Idempotent per userId.
 */
export async function hydrateProfileFromServer(userId: string): Promise<void> {
  if (!supabaseIsConfigured()) return;
  if (activeUserId === userId) return; // already wired for this user
  activeUserId = userId;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, handicap, caddie_persona, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.log('[profileSync] hydrate select failed:', error.message);
      return;
    }

    const remote = data as RemoteProfile | null;
    const local = usePlayerProfileStore.getState();
    const localSettings = useSettingsStore.getState();

    if (!remote) {
      // First sign-in ever AND the auto-trigger somehow didn't fire.
      // Insert a fresh row with whatever local has.
      await pushNow(userId);
      wireListeners(userId);
      return;
    }

    // Determine merge direction per field. Server wins if non-null; local
    // wins if server is null and local has a value (migration path).
    const localFirstName = (local.firstName || local.name || '').trim();
    const localHandicap = local.handicap;
    const localPersona = localSettings.caddiePersonality;

    const mergedFirstName =
      remote.first_name && remote.first_name.length > 0
        ? remote.first_name
        : localFirstName;
    const mergedHandicap =
      remote.handicap != null ? remote.handicap : localHandicap;
    const mergedPersona =
      remote.caddie_persona ?? localPersona ?? 'kevin';

    // Apply merged values to the local store.
    if (mergedFirstName && mergedFirstName !== localFirstName) {
      usePlayerProfileStore.getState().setName(mergedFirstName);
    }
    if (mergedHandicap != null && mergedHandicap !== localHandicap) {
      usePlayerProfileStore.getState().setHandicap(mergedHandicap);
    }
    if (mergedPersona !== localPersona) {
      useSettingsStore.getState().setCaddiePersonality(mergedPersona);
    }

    // Push the merged shape back up so server reflects current truth
    // (handles the migration case where local had data and server didn't).
    const serverMissingAny =
      !remote.first_name || remote.handicap == null || !remote.caddie_persona;
    if (serverMissingAny && (mergedFirstName || mergedHandicap != null || mergedPersona)) {
      await pushNow(userId);
    }

    wireListeners(userId);
  } catch (e) {
    console.log('[profileSync] hydrate threw:', e);
  }
}

/**
 * Tear down subscriptions on sign-out so a subsequent sign-in re-wires
 * cleanly without double-firing pushes.
 */
export function clearProfileSync(): void {
  if (unsubProfile) unsubProfile();
  if (unsubSettings) unsubSettings();
  unsubProfile = null;
  unsubSettings = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  activeUserId = null;
}

function wireListeners(userId: string): void {
  if (unsubProfile) unsubProfile();
  if (unsubSettings) unsubSettings();
  unsubProfile = usePlayerProfileStore.subscribe((curr, prev) => {
    if (
      curr.firstName !== prev.firstName ||
      curr.name !== prev.name ||
      curr.handicap !== prev.handicap
    ) {
      schedulePush(userId);
    }
  });
  unsubSettings = useSettingsStore.subscribe((curr, prev) => {
    if (curr.caddiePersonality !== prev.caddiePersonality) {
      schedulePush(userId);
    }
  });
}

function schedulePush(userId: string): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushNow(userId);
  }, 1500);
}

async function pushNow(userId: string): Promise<void> {
  if (!supabaseIsConfigured()) return;
  const local = usePlayerProfileStore.getState();
  const settings = useSettingsStore.getState();
  const firstName = (local.firstName || local.name || '').trim() || null;
  const handicap = Number.isFinite(local.handicap) ? local.handicap : null;
  const persona = settings.caddiePersonality ?? 'kevin';

  try {
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId,
          first_name: firstName,
          handicap,
          caddie_persona: persona,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
    if (error) {
      console.log('[profileSync] upsert failed:', error.message);
    }
  } catch (e) {
    console.log('[profileSync] upsert threw:', e);
  }
}
