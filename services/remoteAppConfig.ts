/**
 * 2026-10-10 (Tim: "adjust what's behind [the subscription] to encourage more play usage, feedback and
 * improvement" — weekly, without an app update) — the app half of api/app-config.
 *
 * Fetches the server's free/Pro table at launch and whenever the app returns to the foreground (at most
 * every 30 minutes), keeps the last good copy across launches, and hands it to featureAccess. An install
 * that has never reached the server uses the table built into the app. Only known features and the two
 * known editions are accepted — anything else in the payload is ignored, never guessed at.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from './ssrSafeStorage';
import type { Edition, FeatureKey } from './featureAccess';

type EditionOverrides = Partial<Record<FeatureKey, Edition>>;

interface AppConfigState {
  featureEdition: EditionOverrides;
  fetchedAt: number;
  set: (featureEdition: EditionOverrides) => void;
}

export const useAppConfigStore = create<AppConfigState>()(
  persist(
    (set) => ({
      featureEdition: {},
      fetchedAt: 0,
      set: (featureEdition) => set({ featureEdition, fetchedAt: Date.now() }),
    }),
    { name: 'app-config-v1', storage: createJSONStorage(() => getPersistStorage()) },
  ),
);

const KNOWN: readonly FeatureKey[] = ['round_start', 'smartvision', 'cage_mode', 'voice_advanced', 'smartfinder'];

/** Validate a server payload into overrides: known features, 'lite' | 'pro' only. Pure (tested). */
export function parseFeatureEdition(raw: unknown): EditionOverrides | null {
  if (!raw || typeof raw !== 'object') return null;
  const table = (raw as { featureEdition?: unknown }).featureEdition;
  if (!table || typeof table !== 'object') return null;
  const out: EditionOverrides = {};
  for (const k of KNOWN) {
    const v = (table as Record<string, unknown>)[k];
    if (v === 'lite' || v === 'pro') out[k] = v;
  }
  return out;
}

/** The server's edition for a feature, or undefined (use the built-in table). */
export function remoteEditionFor(feature: FeatureKey): Edition | undefined {
  try { return useAppConfigStore.getState().featureEdition[feature]; } catch { return undefined; }
}

const MIN_INTERVAL_MS = 30 * 60 * 1000;
let inflight = false;

/** Fetch the table (throttled). Never throws; a failure keeps the last good copy. */
export async function refreshAppConfig(opts: { force?: boolean } = {}): Promise<void> {
  if (inflight) return;
  const last = useAppConfigStore.getState().fetchedAt;
  if (!opts.force && Date.now() - last < MIN_INTERVAL_MS) return;
  inflight = true;
  try {
    const { getApiBaseUrl } = require('./apiBase') as typeof import('./apiBase');
    const res = await fetch(`${getApiBaseUrl()}/api/app-config`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const parsed = parseFeatureEdition(await res.json());
    if (parsed) useAppConfigStore.getState().set(parsed);
  } catch { /* offline / server down — the last good copy (or the built-in table) stands */ }
  finally { inflight = false; }
}

let started = false;
/** Fetch now and on every return to the foreground. Called once from the root layout. */
export function startAppConfigSync(): void {
  if (started) return;
  started = true;
  void refreshAppConfig({ force: true });
  try {
    const { AppState } = require('react-native') as typeof import('react-native');
    AppState.addEventListener('change', (st) => { if (st === 'active') void refreshAppConfig(); });
  } catch { /* no AppState (tests) */ }
}
