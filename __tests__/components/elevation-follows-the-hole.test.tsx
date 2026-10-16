/**
 * 2026-10-15 (review #10) — useElevationDeltaStatus kept the PREVIOUS hole's slope after a hole change
 * (badged as real data, fed to plays-like) until the new lookup resolved — up to the 8 s timeout.
 * Driven through the real hook: the new green's lookup is left pending, and the old value must not
 * be returned for it.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockPending: Array<(v: { deltaFeet: number; hasData: boolean }) => void> = [];
jest.mock('../../services/elevationService', () => ({
  getPlaysLikeElevation: () => new Promise((resolve) => { mockPending.push(resolve); }),
}));

import { useElevationDeltaStatus } from '../../hooks/useElevationDelta';

const player = { lat: 33.7, lng: -116.97 };
const green7 = { lat: 33.702, lng: -116.97 };
const green8 = { lat: 33.71, lng: -116.96 };

it('a new green does not inherit the last green\'s slope', async () => {
  const { result, rerender } = renderHook(({ t }: { t: typeof green7 }) => useElevationDeltaStatus(player, t), { initialProps: { t: green7 } });
  await act(async () => { mockPending[0]({ deltaFeet: 30, hasData: true }); });
  expect(result.current).toEqual({ deltaFeet: 30, hasData: true });

  rerender({ t: green8 });   // hole change; the lookup for green 8 stays in flight
  expect(result.current).toEqual({ deltaFeet: 0, hasData: false });

  await act(async () => { mockPending[mockPending.length - 1]({ deltaFeet: -12, hasData: true }); });
  expect(result.current).toEqual({ deltaFeet: -12, hasData: true });
});

it('walking within the hole keeps the current read while the next resolves', async () => {
  mockPending.length = 0;
  const { result, rerender } = renderHook(({ p }: { p: typeof player }) => useElevationDeltaStatus(p, green7), { initialProps: { p: player } });
  await act(async () => { mockPending[0]({ deltaFeet: 18, hasData: true }); });
  rerender({ p: { lat: 33.7005, lng: -116.97 } });
  expect(result.current).toEqual({ deltaFeet: 18, hasData: true });
});
