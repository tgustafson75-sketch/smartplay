/**
 * 2026-08-10 — minimal react-native stub for the LOGIC test project (node env, no RN runtime).
 * Only the non-UI surfaces that pure services touch: AppState, Platform, Vibration, Dimensions.
 * Component tests keep using the real jest-expo preset in the other project.
 */
module.exports = {
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'ios', select: (o) => o.ios ?? o.default },
  Vibration: { vibrate: () => undefined },
  Dimensions: { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) },
  NativeModules: {},
  Linking: { openURL: async () => undefined, canOpenURL: async () => false },
};
