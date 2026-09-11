/**
 * 2026-09-10 — A GPS WATCH THAT STARTED AND NEVER DELIVERED A FIX HAD NO RECOVERY.
 *
 * Both self-heal paths — the stall recovery in evaluateMode and the foreground handler — require
 * `lastTickAt > 0`. startGpsManager sets it to 0 before arming the watch, and only an actual fix
 * raises it. So a subscription that starts and never ticks (an OEM glitch, location services
 * switched off after start, a permission revoked mid-session) sat dead for the whole round.
 *
 * getGpsHealth even NAMES the state — `{ state: 'never_ticked' }` — and reports it. Nothing acted.
 *
 * The recovery is deliberately SEPARATE from the stall branch rather than relaxing its
 * `lastTickAt > 0`, because a never-ticked watch needs a longer grace period than a stalled one: it
 * may still be acquiring, and this file's own 2026-07-08 note says restarting inside the 30-60s
 * cold-lock window starves the chip.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../services/gpsManager.ts'), 'utf8');

describe('a watch that never ticked', () => {
  it('has a recovery branch of its own', () => {
    expect(src).toMatch(/lastTickAt === 0 && watchStartedAt > 0/);
    expect(src).toMatch(/watch never ticked/);
  });

  it('waits longer than cold acquisition before concluding anything', () => {
    // The file puts cold re-acquisition at 30-60s; restarting inside that starves the lock.
    expect(src).toMatch(/NEVER_TICKED_RECOVERY_MS = 90_000/);
    expect(src).toMatch(/now - watchStartedAt > NEVER_TICKED_RECOVERY_MS/);
  });

  it('respects the same 60s restart cooldown, so it cannot thrash', () => {
    const at = src.indexOf('watch never ticked');
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(Math.max(0, at - 400), at);
    expect(branch).toMatch(/now - lastWatchRestartAt > 60_000/);
  });

  it('leaves the stalled-watch branch exactly as it was', () => {
    // A ticking watch must be completely unaffected by this.
    expect(src).toMatch(/lastTickAt > 0 && now - lastTickAt > FIX_STALENESS_MS && now - lastWatchRestartAt > 60_000/);
  });

  it('records when the watch was armed, on every start and not only restarts', () => {
    // lastWatchRestartAt is set by restartWatch only; the FIRST start had no timestamp at all,
    // which is why "never ticked" could not be measured.
    expect(src).toMatch(/watchStartedAt = Date\.now\(\);/);
    const at = src.indexOf('watchStartedAt = Date.now();');
    expect(src.slice(at, at + 300)).toMatch(/watch_started/);
  });
});

describe('per-round GPS state does not outlive the round', () => {
  /** stopGpsManager's body, cut at the next top-level declaration. */
  const stopBody = (() => {
    const at = src.indexOf('export function stopGpsManager');
    if (at < 0) return '';
    const rest = src.slice(at);
    const next = rest.search(/\nexport (?:async )?function /);
    return next > 0 ? rest.slice(0, next) : rest.slice(0, 4000);
  })();

  it('the window actually captured stopGpsManager', () => {
    expect(stopBody.length).toBeGreaterThan(300);
    expect(stopBody).toMatch(/subscribers\.clear\(\)/);
  });

  it('clears the restart cooldowns, so round two can self-heal immediately', () => {
    expect(stopBody).toMatch(/watchStartedAt = 0;/);
    expect(stopBody).toMatch(/lastWatchRestartAt = 0;/);
  });

  it('clears the user-mark outlier bypass', () => {
    // A tap-to-place from last round must not bypass outlier rejection for this round's first fixes.
    expect(stopBody).toMatch(/userMarkedAt = 0;/);
  });

  it('clears the first-fix log marker so round two can still answer "did GPS start"', () => {
    expect(stopBody).toMatch(/firstFixLogged = false;/);
  });

  it('does NOT clear poorSignalListeners — that would unsubscribe the caddie for good', () => {
    // initGpsConfidenceAsk registers once behind an `initialized` flag; clearing here would
    // silently kill the soft-GPS ask for every round after the first.
    expect(stopBody).not.toMatch(/poorSignalListeners\.clear\(\)/);
  });
});
