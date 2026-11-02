/**
 * 2026-11-01 — services/micCaptureService follows the round and never throws into a caller.
 * Break-test: make setMicForeground ignore `on` (always start) and the stop-on-round-end test fails.
 */

import { setMicForeground, startMicCaptureOnRound, stopMicCaptureOnRound } from '../../services/micCaptureService';

const native: { MicCapture?: { startMicForeground: jest.Mock; stopMicForeground: jest.Mock } } = {};
let listener: ((s: { isRoundActive: boolean }) => void) | null = null;
let roundActive = false;

jest.mock('react-native', () => ({
  get NativeModules() { return native; },
  Platform: { OS: 'android' },
}));
jest.mock('../../store/roundStore', () => ({
  useRoundStore: {
    getState: () => ({ isRoundActive: roundActive }),
    subscribe: (fn: (s: { isRoundActive: boolean }) => void) => { listener = fn; return () => { listener = null; }; },
  },
}));
jest.mock('../../services/devLog', () => ({ devLog: jest.fn() }));


const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  roundActive = false;
  listener = null;
  native.MicCapture = { startMicForeground: jest.fn().mockResolvedValue(true), stopMicForeground: jest.fn().mockResolvedValue(true) };
});

afterEach(() => stopMicCaptureOnRound());

test('an old binary without the module resolves false and does not throw', async () => {
  delete native.MicCapture;
  await expect(setMicForeground(true)).resolves.toBe(false);
});

test('a refused start resolves false, never throws', async () => {
  native.MicCapture!.startMicForeground.mockRejectedValue(new Error('background start'));
  await expect(setMicForeground(true)).resolves.toBe(false);
});

test('starts when a round begins and stops when it ends', async () => {
  startMicCaptureOnRound();
  listener!({ isRoundActive: true });
  await flush();
  expect(native.MicCapture!.startMicForeground).toHaveBeenCalledTimes(1);
  listener!({ isRoundActive: false });
  await flush();
  expect(native.MicCapture!.stopMicForeground).toHaveBeenCalledTimes(1);
});

test('an unchanged round state does not restart the service', async () => {
  startMicCaptureOnRound();
  listener!({ isRoundActive: true });
  listener!({ isRoundActive: true });
  await flush();
  expect(native.MicCapture!.startMicForeground).toHaveBeenCalledTimes(1);
});

test('a round already active at subscribe time starts the service once', async () => {
  roundActive = true;
  startMicCaptureOnRound();
  startMicCaptureOnRound();
  await flush();
  expect(native.MicCapture!.startMicForeground).toHaveBeenCalledTimes(1);
});
