/**
 * 2026-08-13 — stable ANONYMOUS install id, so tester reports can be counted.
 *
 * Tim: "I am getting automatic [reports] but they have my email on them. I wonder if they are actually
 * other people's."
 *
 * He couldn't tell, and the code is why: a report's only identity is
 * `playerProfileStore.email || 'beta tester'`. Every tester who skips the email field arrives as
 * `beta tester` on `android` — so five people and one person reporting five times look identical. The
 * question "is anyone actually using this?" was unanswerable from the data.
 *
 * This is the smallest thing that fixes that: one random id per INSTALL, generated once, persisted,
 * attached to every report.
 *
 * PRIVACY: deliberately NOT a device identifier. It is random, generated locally, tied to nothing —
 * not the hardware, not the ad id, not the account. Reinstalling produces a new one, which is the
 * correct trade: it counts distinct installs without becoming a way to track a person. It ships
 * alongside diagnostics that are already gated on the `shareDiagnostics` consent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'spc_install_id_v1';
/** Cached after the first read so the send path never waits on storage twice. */
let cached: string | null = null;

/** Short, readable in an email subject, and collision-safe enough to count installs. */
function mint(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `spc-${rand}${time}`;
}

/**
 * The install id, creating it on first call. Never throws — a report that can't read storage should
 * still send (unattributed) rather than be lost, which is the whole point of the reporting path.
 */
export async function getInstallId(): Promise<string | null> {
  if (cached) return cached;
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing && existing.trim()) {
      cached = existing.trim();
      return cached;
    }
    const fresh = mint();
    await AsyncStorage.setItem(KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    return null;
  }
}

/** Test/debug only — lets a harness assert minting without touching the persisted value. */
export function _mintInstallId(): string {
  return mint();
}
