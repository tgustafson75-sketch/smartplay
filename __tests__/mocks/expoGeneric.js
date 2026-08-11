/**
 * 2026-08-10 — catch-all stub for native Expo modules in the LOGIC test project.
 *
 * Pure service logic sits behind long native import chains (clubRecognition → analytics → roundStore
 * → holeReconciliation → courseDataOrchestrator → glassesVisionInput → shotLocationService →
 * expo-location). Stubbing them one at a time is whack-a-mole; this returns a no-op for any property,
 * which is all a logic test ever needs from a native module. Specific stubs mapped ABOVE this one in
 * jest.config still win where a real shape matters (file-system, image-manipulator, …).
 */
const noop = () => undefined;
const asyncNoop = async () => undefined;
module.exports = new Proxy(
  { PermissionStatus: { GRANTED: 'granted', DENIED: 'denied' }, Accuracy: { Balanced: 3, High: 4 } },
  {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (prop === '__esModule') return true;
      if (typeof prop === 'string' && /^(request|get|start|stop|has|is|load|unload|set)/.test(prop)) return asyncNoop;
      return noop;
    },
  },
);
