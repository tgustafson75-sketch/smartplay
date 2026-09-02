/**
 * 2026-09-02 (Tim) — "a second option for owner tools sim round that is non voice and goes by user
 * tendencies and data... watch hole transition, scoring, etc."
 *
 * The auto sim round is a DIAGNOSTIC, which makes a quiet failure in it worse than useless: a runner
 * that reports nine green holes because it never actually played one would hide the very bugs it was
 * built to surface. So these prove the runner runs — a real SIM round, a real scorecard, a real
 * advance — and that it leaves the app exactly as it found it.
 */
import { runAutoSimRound, readAutoSimPlayer } from '../../services/simRoundAuto';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useClubStatsStore } from '../../store/clubStatsStore';

function seedBag() {
  const s = useClubStatsStore.getState();
  ([['Driver', 240], ['5I', 175], ['7I', 150], ['9I', 125], ['PW', 110], ['SW', 80]] as const)
    .forEach(([club, yds]) => { s.recordCarry(club as never, yds); });
}

describe('the auto sim round plays a real round, silently', () => {
  beforeEach(() => {
    useSettingsStore.setState({ voiceEnabled: true, autoHoleAdvance: true });
    seedBag();
  });
  afterEach(() => {
    try { if (useRoundStore.getState().isRoundActive) useRoundStore.getState().discardRound(); } catch { /* noop */ }
  });

  it('plays nine holes and reports one scenario per hole', async () => {
    const reports = await runAutoSimRound({ nineHoles: true, seed: 7 });
    // SIM-0 start + 9 holes + SIM-END reconcile
    expect(reports.map(r => r.id)).toEqual([
      'SIM-0', 'SIM-H1', 'SIM-H2', 'SIM-H3', 'SIM-H4', 'SIM-H5', 'SIM-H6', 'SIM-H7', 'SIM-H8', 'SIM-H9', 'SIM-END',
    ]);
  }, 30_000);

  it('actually asserts things — a hole report is not an empty shell', async () => {
    const reports = await runAutoSimRound({ nineHoles: true, seed: 7 });
    const h1 = reports.find(r => r.id === 'SIM-H1');
    expect(h1).toBeDefined();
    // The four things Tim asked it to watch must each appear as a real check.
    const labels = (h1?.checks ?? []).map(c => c.label).join(' | ');
    expect(labels).toMatch(/MOVED the player/);
    expect(labels).toMatch(/counted down/);
    expect(labels).toMatch(/the scorecard holds hole 1/);
    expect(labels).toMatch(/hole ADVANCED 1 → 2/);
  }, 30_000);

  it('is deterministic — the same seed plays the same round', async () => {
    const a = await runAutoSimRound({ nineHoles: true, seed: 42 });
    const b = await runAutoSimRound({ nineHoles: true, seed: 42 });
    const scored = (rs: typeof a) => rs.flatMap(r => r.checks.filter(c => c.label.startsWith('the scorecard holds')).map(c => c.label));
    expect(scored(a)).toEqual(scored(b));
    expect(scored(a).length).toBe(9);
  }, 60_000);

  it('restores voiceEnabled and leaves no round running', async () => {
    useSettingsStore.setState({ voiceEnabled: true });
    await runAutoSimRound({ nineHoles: true, seed: 3 });
    // Silence is for the duration of the run only — a diagnostic that mutes the app permanently is a bug.
    expect(useSettingsStore.getState().voiceEnabled).toBe(true);
    expect(useRoundStore.getState().isRoundActive).toBe(false);
  }, 30_000);

  /**
   * THE ONE THAT MATTERS. A diagnostic that cannot go red is decoration. Turning off the
   * score-driven advance is the exact bug class Tim asked this to watch, so the runner must SEE it —
   * and must say WHY, not just print a mismatch. [[break-test-every-guard-you-write]]
   */
  it('FAILS, loudly and with a reason, when the hole stops advancing', async () => {
    useSettingsStore.setState({ autoHoleAdvance: false });
    const reports = await runAutoSimRound({ nineHoles: true, seed: 7 });
    const h1 = reports.find(r => r.id === 'SIM-H1');
    expect(h1?.status).toBe('fail');
    const advance = h1?.checks.find(c => c.label.includes('hole ADVANCED'));
    expect(advance?.status).toBe('fail');
    // The reason, from the store's own setting rather than a bare "expected 2, got 1".
    const why = h1?.checks.find(c => c.label === 'advance did not fire');
    expect(why?.detail).toContain('autoHoleAdvance=false');
    useSettingsStore.setState({ autoHoleAdvance: true });
  }, 30_000);

  it('an empty bag is reported honestly, not played on invented distances', async () => {
    useClubStatsStore.setState({ total: {}, carry: {} });
    const reports = await runAutoSimRound({ nineHoles: true, seed: 7 });
    const start = reports.find(r => r.id === 'SIM-0');
    const learned = start?.checks.find(c => c.label.includes('LEARNED club distances'));
    expect(learned?.status).toBe('fail');
    expect(learned?.detail).toContain('bag is empty');
  }, 30_000);

  it('reads the player from LEARNED data, not tour averages', () => {
    const p = readAutoSimPlayer();
    expect(p.clubs.length).toBeGreaterThan(0);
    // Sorted longest-first, and they are the carries that were actually logged.
    expect(p.clubs[0].carry).toBeGreaterThanOrEqual(p.clubs[p.clubs.length - 1].carry);
  });
});
