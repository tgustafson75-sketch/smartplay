/**
 * 2026-10-13 (full native audit before the 1.0.3 store build) — iOS modules that were IN the binary
 * and still delivered nothing to JS. RCTEventEmitter drops every event while its listener count is 0,
 * and the count only moves through the module's own exported addListener, which NativeEventEmitter
 * calls. Two modules never got there:
 *   - WearSwingBridge overrode addListener/removeListeners with empty bodies: every watch swing, tap,
 *     voice, command and connection event was dropped on iOS.
 *   - BluetoothMediaButton was subscribed through DeviceEventEmitter, which never calls addListener:
 *     every earbud tap and audio-route change was dropped on iOS.
 * Plus the Android half of the same audit: the pose frame's bitmap and MPImage were never released.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('earbud events reach JS on iOS', () => {
  afterEach(() => { jest.resetModules(); jest.dontMock('react-native'); });

  function load(os: 'ios' | 'android') {
    const mod = { addListener: jest.fn(), removeListeners: jest.fn() };
    const deviceAdd = jest.fn(() => ({ remove: jest.fn() }));
    const nativeAdd = jest.fn((_name: string) => {
      mod.addListener(_name); // what the real NativeEventEmitter does: tell the module, so it counts
      return { remove: jest.fn() };
    });
    jest.doMock('react-native', () => ({
      Platform: { OS: os },
      NativeModules: { BluetoothMediaButton: mod },
      DeviceEventEmitter: { addListener: deviceAdd },
      NativeEventEmitter: jest.fn(() => ({ addListener: nativeAdd })),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onBluetoothMediaEvent } = require('../../services/bluetoothMediaEvents');
    return { onBluetoothMediaEvent, mod, deviceAdd, nativeAdd };
  }

  it('iOS subscribes through NativeEventEmitter, so the module counts the listener and starts observing', () => {
    const { onBluetoothMediaEvent, mod, deviceAdd } = load('ios');
    onBluetoothMediaEvent('onRemoteControl', () => {});
    onBluetoothMediaEvent('onAudioRouteChanged', () => {});
    expect(mod.addListener).toHaveBeenCalledWith('onRemoteControl');
    expect(mod.addListener).toHaveBeenCalledWith('onAudioRouteChanged');
    expect(deviceAdd).not.toHaveBeenCalled();
  });

  it('Android keeps DeviceEventEmitter — its module emits without a count', () => {
    const { onBluetoothMediaEvent, deviceAdd, nativeAdd } = load('android');
    onBluetoothMediaEvent('onRemoteControl', () => {});
    expect(deviceAdd).toHaveBeenCalledWith('onRemoteControl', expect.any(Function));
    expect(nativeAdd).not.toHaveBeenCalled();
  });

  it('no caller subscribes to these events any other way', () => {
    for (const f of ['services/voiceTriggers.ts', 'services/audioRoutingService.ts']) {
      expect(code(f)).not.toMatch(/DeviceEventEmitter\.addListener\(\s*'on(RemoteControl|AudioRouteChanged)'/);
      expect(code(f)).toMatch(/onBluetoothMediaEvent\('on(RemoteControl|AudioRouteChanged)'/);
    }
  });
});

describe('watch events reach JS on iOS', () => {
  const swift = code('ios-native/WearSwingBridgeModule.swift');

  it('does not override addListener/removeListeners — RCTEventEmitter\'s own versions do the counting', () => {
    expect(swift).not.toMatch(/func addListener\(/);
    expect(swift).not.toMatch(/func removeListeners\(/);
    expect(swift).toMatch(/override func startObserving\(\) \{ hasListeners = true \}/);
  });

  it('answers getConnectedNodeCount like Android, and rejects (unknown) before activation', () => {
    expect(code('ios-native/WearSwingBridge.m')).toMatch(/RCT_EXTERN_METHOD\(getConnectedNodeCount:/);
    expect(swift).toMatch(/@objc\(getConnectedNodeCount:rejecter:\)/);
    const fn = swift.slice(swift.indexOf('func getConnectedNodeCount'));
    expect(fn.slice(0, 600)).toMatch(/activationState == \.activated else \{\s*reject\(/);
    expect(fn.slice(0, 600)).toContain('s.isPaired && s.isWatchAppInstalled ? 1 : 0');
  });
});

describe('Android pose frames are released', () => {
  const kt = code('android-native/MediaPipePoseModule.kt');

  it('closes the MPImage and recycles the bitmap after every detect, success or failure', () => {
    const fin = kt.slice(kt.indexOf('} finally {'));
    expect(kt).toContain('} finally {');
    expect(fin.slice(0, 200)).toMatch(/mpImage\.close\(\)/);
    expect(fin.slice(0, 200)).toMatch(/bitmap\.recycle\(\)/);
  });

  it('keeps the runtime GPU→CPU fallback (ad444eee)', () => {
    expect(kt).toMatch(/@Volatile private var forceCpu = false/);
    expect(kt).toMatch(/forceCpu = true/);
  });
});
