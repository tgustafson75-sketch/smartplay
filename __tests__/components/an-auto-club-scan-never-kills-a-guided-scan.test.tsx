/**
 * 2026-10-27 (Phase SB4x — review of SB3, finding "capture #2").
 *
 * SmartMotion's periodic silent club scan waited 500 ms in setup, then started. Its guard knew about an
 * in-flight silent scan (scanningClub) but not the GUIDED scan's 3-2-1 countdown (clubScanActive), and
 * starting a guided scan did not clear its timer. Both scans share one scan epoch (captureLife.beginScan),
 * so the silent scan starting mid-countdown cancelled the guided scan the player had just tapped: the
 * framing box vanished with no picker and no word.
 *
 * Rendered: the hook the screen uses for the silent scan.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useAutoClubScan } from '../../hooks/useAutoClubScan';

describe('the silent club scan never starts over a guided scan', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  function mount(guidedScanActive = false) {
    const fire = jest.fn();
    const dueRef = { current: true };
    const pendingStartRef = { current: false };
    const hook = renderHook((p: { guided: boolean; phase: string }) => useAutoClubScan({
      phase: p.phase, dueRef, scanningClub: false, guidedScanActive: p.guided, pendingStartRef, fire,
    }), { initialProps: { guided: guidedScanActive, phase: 'setup' } });
    return { fire, dueRef, hook };
  }

  it('THE REPORT: the player taps Scan club inside the 500 ms — the silent scan never fires', () => {
    const { fire, hook } = mount();
    act(() => { jest.advanceTimersByTime(200); });
    hook.rerender({ guided: true, phase: 'setup' });     // startClubScan: the 3-2-1 begins
    act(() => { jest.advanceTimersByTime(1000); });
    expect(fire).not.toHaveBeenCalled();
  });

  it('a scan due while a guided scan is running waits; it is not started over the countdown', () => {
    const { fire } = mount(true);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(fire).not.toHaveBeenCalled();
  });

  it('guard: with no guided scan, a due scan fires once after 500 ms in setup', () => {
    const { fire, dueRef } = mount();
    act(() => { jest.advanceTimersByTime(499); });
    expect(fire).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(dueRef.current).toBe(false);
  });
});
