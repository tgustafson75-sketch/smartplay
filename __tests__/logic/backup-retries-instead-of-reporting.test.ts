/**
 * 2026-09-03 (Tim: "don't build error states. Make it work.")
 *
 * The cloud backup POST and restore GET had no timeout at all — React Native's fetch has no default
 * one — so on a marginal course connection the promise simply never settled. CloudBackupCard does
 * setServerBusy(true), awaits, then setServerBusy(false), so a request that never resolved left the
 * button spinning forever with no outcome either way.
 *
 * The first fix bounded it and wrote a nicer failure message. That was the wrong instinct: a dropped
 * connection on a golf course is the expected condition, not an exception, and the job is to get the
 * data up anyway. These pin the retry policy — transient failures are retried, real answers are not.
 */
import { _isTransientForTest as isTransient } from '../../services/cloudSync/serverBackup';

describe('backup retry policy', () => {
  it('retries the connection giving out', () => {
    for (const r of ['timed_out', 'network', 'fetch failed', 'ECONNRESET', 'socket hang up', 'http_503', 'http_429']) {
      expect(isTransient(r)).toBe(true);
    }
  });

  it('does NOT retry a real answer — hammering a wrong passphrase helps nobody', () => {
    for (const r of ['no_key', 'no_secret', 'not_found', 'http_401', 'http_413', 'not_configured']) {
      expect(isTransient(r)).toBe(false);
    }
  });
});
