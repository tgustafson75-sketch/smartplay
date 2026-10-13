/**
 * 2026-10-13 — ONE way to hear the BluetoothMediaButton module, on both platforms.
 *
 * Both call sites subscribed with DeviceEventEmitter. That works on Android, whose module emits
 * unconditionally. On iOS the module is an RCTEventEmitter, and RCTEventEmitter DROPS every event
 * while its listener count is 0 ("Sending … with no listeners registered") — and the count only
 * moves through NativeEventEmitter.addListener, which calls the module's exported addListener and
 * so startObserving(). Nothing ever did, so on iPhone an earbud tap never reached the caddie and an
 * earbud connect/disconnect never changed the audio route.
 */
import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type BluetoothMediaEvent = 'onRemoteControl' | 'onAudioRouteChanged';

let iosEmitter: NativeEventEmitter | null = null;

export function onBluetoothMediaEvent(
  name: BluetoothMediaEvent,
  handler: (payload: unknown) => void,
): { remove: () => void } {
  if (Platform.OS === 'ios') {
    const mod = (NativeModules as Record<string, unknown>).BluetoothMediaButton;
    if (!mod) return { remove: () => {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    iosEmitter ??= new NativeEventEmitter(mod as any);
    return iosEmitter.addListener(name, handler);
  }
  return DeviceEventEmitter.addListener(name, handler);
}
